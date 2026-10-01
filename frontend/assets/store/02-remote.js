/* Сховище порталу (2/5): Зв'язок із сервером: завантаження, кеш між візитами, збереження змін, живе оновлення.
   Файли assets/store/*.js підключаються саме в цьому порядку й разом утворюють спільні функції сторінок. */

/* ---------- Спільна база (Cloudflare Worker + D1) ----------
   Колекції з SHARED_KEYS читаються й пишуться лише на сервері (адреса — STATE_WORKER_URL у config.js),
   тож усі користувачі бачять одні й ті самі дані. У браузері лишаються тільки вхід (токен, сесія) і налаштування.
   Сторінки читають сховище синхронно, тому запити теж синхронні: дані завантажуються до запуску скриптів сторінки,
   а запис завершується до переходу на іншу сторінку. */
const SHARED_KEYS = [
  "state_users", "state_offices", "state_positions", "state_approval_routes",
  "state_docs", "state_appeals", "state_profile_requests", "state_doc_backgrounds", "state_doc_types"
];
const REMOTE = { url: String(window.STATE_WORKER_URL || "").trim().replace(/\/+$/, ""), cache: null, ok: false };

function apiToken() {
  try { return localStorage.getItem("state_token") || ""; } catch { return ""; }
}

function setApiToken(token) {
  try {
    if (token) localStorage.setItem("state_token", token);
    else localStorage.removeItem("state_token");
  } catch { /* приватний режим */ }
}

// Асинхронний запит: завантаження даних при відкритті сторінки й повних документів — сторінка не «застигає»
async function apiFetch(method, path, body) {
  const once = async () => {
    try {
      const token = apiToken();
      const headers = {};
      if (token) headers.Authorization = "Bearer " + token;
      if (body !== undefined) headers["Content-Type"] = "application/json";
      const r = await fetch(REMOTE.url + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
      let data = {};
      try { data = await r.json(); } catch { /* не JSON */ }
      return { ok: r.ok, status: r.status, data };
    } catch (err) {
      return { ok: false, status: 0, data: { error: "Немає зв'язку з сервером." } };
    }
  };
  const res = await once();
  if (method === "GET" && (res.status === 0 || res.status >= 500)) return once();
  return res;
}

// Синхронний запит лишається для дій користувача (зберегти, увійти, проголосувати): результат потрібен одразу
function apiRequest(method, path, body) {
  const res = apiRequestOnce(method, path, body);
  // Короткочасний збій (мережа, перевантаження Cloudflare) — одна повторна спроба для читання
  if (method === "GET" && (res.status === 0 || res.status >= 500)) return apiRequestOnce(method, path, body);
  return res;
}

function apiRequestOnce(method, path, body) {
  const xhr = new XMLHttpRequest();
  try {
    xhr.open(method, REMOTE.url + path, false);
    const token = apiToken();
    if (token) xhr.setRequestHeader("Authorization", "Bearer " + token);
    if (body !== undefined) xhr.setRequestHeader("Content-Type", "application/json");
    xhr.send(body === undefined ? null : JSON.stringify(body));
  } catch (err) {
    return { ok: false, status: 0, data: { error: "Немає зв'язку з сервером." } };
  }
  let data = {};
  try { data = JSON.parse(xhr.responseText || "{}"); } catch { /* не JSON */ }
  return { ok: xhr.status >= 200 && xhr.status < 300, status: xhr.status, data };
}

function applyRemoteData(data) {
  Object.keys(data || {}).forEach((key) => {
    if (!SHARED_KEYS.includes(key)) return;
    REMOTE.cache[key] = JSON.stringify(data[key] || []);
    noteRevs(data[key]);
  });
}

// Найсвіжіша відома версія запису (_rev) — з неї живе оновлення запитує лише нові зміни
function noteRevs(items) {
  (items || []).forEach((it) => { if (it && typeof it._rev === "number" && it._rev > (REMOTE.since || 0)) REMOTE.since = it._rev; });
}

// Точкове злиття: змінені записи замінюють старі за id, решта лишається
function mergeRemoteRows(data) {
  let changed = false;
  Object.keys(data || {}).forEach((key) => {
    const rows = data[key] || [];
    if (!SHARED_KEYS.includes(key) || !rows.length) return;
    const list = JSON.parse(REMOTE.cache[key] || "[]");
    rows.forEach((row) => {
      const id = remoteRowId(key, row);
      const i = list.findIndex((it) => remoteRowId(key, it) === id);
      if (i >= 0) list[i] = row; else list.push(row);
    });
    REMOTE.cache[key] = JSON.stringify(list);
    noteRevs(rows);
    changed = true;
  });
  if (changed) saveSnapshot();
  return changed;
}

/* Живе оновлення: сторінка, якій важливі свіжі дані (голосування, повідомлення), підписується через watchState(cb).
   Поки вкладка відкрита на екрані, раз на ~8 с запитуємо лише змінені записи (асинхронно, сторінка не підвисає). */
const STATE_WATCHERS = [];
let stateWatchTimer = null;
function watchState(cb) {
  STATE_WATCHERS.push(cb);
  if (stateWatchTimer) return;
  const tick = async () => {
    if (document.hidden || !REMOTE.ok || !REMOTE.since) return;
    try {
      const token = apiToken();
      const r = await fetch(REMOTE.url + "/api/changes?since=" + REMOTE.since, { headers: token ? { Authorization: "Bearer " + token } : {} });
      if (!r.ok) return;
      const body = await r.json();
      if (body.scope && REMOTE.scope && body.scope !== REMOTE.scope) { dropSnapshot(); location.reload(); return; }
      const removed = applyRemoved(body.removed);
      const merged = mergeRemoteRows(body.data);
      if (body.now > REMOTE.since) REMOTE.since = body.now;
      if (removed || merged) { saveSnapshot(); STATE_WATCHERS.forEach((fn) => { try { fn(); } catch (e) { console.error(e); } }); }
    } catch (e) { /* мережа — спробуємо наступного разу */ }
  };
  stateWatchTimer = setInterval(tick, 8000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) tick(); });
}

// Повний документ (з версіями й історією) — список приходить скороченим, повний потрібен лише на сторінці документа
async function loadFullDoc(id) {
  const cached = JSON.parse(REMOTE.cache.state_docs || "[]").find((d) => d.id === id);
  if (cached && !cached._partial) return getDoc(id);
  const res = await apiFetch("GET", "/api/doc/" + encodeURIComponent(id));
  if (res.ok && res.data.doc) mergeRemoteRows({ state_docs: [res.data.doc] });
  return getDoc(id);
}

/* Кеш між візитами: дані з минулого відкриття лежать у браузері, а з сервера беремо лише зміни після них (/api/changes).
   Так кожна сторінка не перечитує всю базу — це головна економія лімітів Cloudflare. Кеш прив'язаний до входу й «області
   видимості» (права): змінились права чи вхід — завантажуємо все заново. Старший за добу — теж заново. */
const SNAPSHOT_KEY = "state_snapshot";
const SNAPSHOT_TTL = 24 * 3600 * 1000;
function snapshotOwner() { return (apiToken() || "anon").slice(-16); }

function loadSnapshot() {
  try {
    const snap = JSON.parse(localStorage.getItem(SNAPSHOT_KEY) || "null");
    if (!snap || snap.v !== 1 || snap.owner !== snapshotOwner() || !snap.since || Date.now() - snap.savedAt > SNAPSHOT_TTL) return null;
    return snap;
  } catch { return null; }
}

let snapshotTimer = null;
function saveSnapshot() {
  if (!REMOTE.ok || !REMOTE.since || !REMOTE.scope) return;
  clearTimeout(snapshotTimer);
  snapshotTimer = setTimeout(() => {
    try {
      // Повні документи (з текстом, оформленням і версіями) у кеш не кладемо — лише легкі, як у списку
      const docs = JSON.parse(REMOTE.cache.state_docs || "[]").map((d) => {
        if (d._partial) return d;
        const x = Object.assign({}, d, { _partial: true, _versions: (d.versions || []).length, _history: (d.history || []).length });
        delete x.versions; delete x.history; delete x.html; delete x.docHtml; delete x.editor;
        return x;
      });
      const cache = Object.assign({}, REMOTE.cache, { state_docs: JSON.stringify(docs) });
      localStorage.setItem(SNAPSHOT_KEY, JSON.stringify({ v: 1, owner: snapshotOwner(), scope: REMOTE.scope, since: REMOTE.since, savedAt: Date.now(), cache }));
    } catch (e) { try { localStorage.removeItem(SNAPSHOT_KEY); } catch { /* немає місця */ } }
  }, 0);
}

function dropSnapshot() {
  try { localStorage.removeItem(SNAPSHOT_KEY); } catch { /* приватний режим */ }
}

// Видалені (або тепер невидимі) записи прибираємо з кешу
function applyRemoved(list) {
  let changed = false;
  (list || []).forEach(({ coll, id }) => {
    if (!SHARED_KEYS.includes(coll) || !REMOTE.cache[coll]) return;
    const items = JSON.parse(REMOTE.cache[coll]);
    const left = items.filter((it) => remoteRowId(coll, it) !== id);
    if (left.length !== items.length) { REMOTE.cache[coll] = JSON.stringify(left); changed = true; }
  });
  return changed;
}

/* Завантаження даних при відкритті сторінки — асинхронне. Скрипти сторінок запускаються через whenStateReady(fn),
   коли дані вже в пам'яті, а сторінка готова; до того браузер нічого не блокує. */
let STATE_READY = null;
function startState() {
  if (!STATE_READY) STATE_READY = remoteBoot().catch((e) => console.error("state:", e));
  return STATE_READY;
}
function whenStateReady(fn) {
  startState().then(() => {
    const run = () => { try { const r = fn(); if (r && r.catch) r.catch((e) => console.error(e)); } catch (e) { console.error(e); } };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run, { once: true });
    else run();
  });
}

function showOfflineBanner() {
  const add = () => {
    if (document.getElementById("state-offline")) return;
    document.body.insertAdjacentHTML("afterbegin",
      '<div id="state-offline" role="alert" style="background:#8a2b2b;color:#fff;padding:8px 16px;text-align:center;font-size:14px">' +
      "Немає зв'язку з сервером порталу — дані не завантажені, зміни не зберігаються. Оновіть сторінку пізніше.</div>");
  };
  if (document.body) add(); else document.addEventListener("DOMContentLoaded", add, { once: true });
}

async function remoteBoot() {
  REMOTE.cache = {};
  if (!REMOTE.url) { console.error("state: у config.js не вказано STATE_WORKER_URL"); return; }
  const snap = loadSnapshot();
  if (snap) {
    const diff = await apiFetch("GET", "/api/changes?since=" + snap.since);
    if (diff.ok && diff.data.scope === snap.scope && (diff.data.user || snap.scope === "anon")) {
      REMOTE.ok = true;
      REMOTE.cache = snap.cache;
      REMOTE.scope = snap.scope;
      REMOTE.since = snap.since;
      applyRemoved(diff.data.removed);
      mergeRemoteRows(diff.data.data);
      if (diff.data.now > REMOTE.since) REMOTE.since = diff.data.now;
      saveSnapshot();
      return;
    }
    dropSnapshot();
  }
  const res = await apiFetch("GET", "/api/state");
  if (!res.ok) {
    console.warn("state: сервер недоступний", res.status, res.data);
    showOfflineBanner();
    return;
  }
  REMOTE.ok = true;
  // Токен недійсний або сесія з часів локального сховища — потрібно увійти на сервері
  if (!res.data.user) {
    setApiToken("");
    try { localStorage.removeItem("state_session"); } catch { /* ignore */ }
  }
  REMOTE.scope = res.data.scope || (res.data.user ? "" : "anon");
  applyRemoteData(res.data.data);
  saveSnapshot();
}

function remoteRowId(key, item) {
  return item && typeof item === "object" ? String((key === "state_users" ? item.login : item.id) || "") : "";
}

// Надсилаємо лише різницю (змінені й видалені елементи), щоб не затерти одночасні зміни інших людей
function remoteSave(key, value) {
  if (!REMOTE.ok) {
    alert("Немає зв'язку з сервером порталу — зміни не збережено. Оновіть сторінку.");
    return false;
  }
  const old = {};
  JSON.parse(REMOTE.cache[key] || "[]").forEach((item) => {
    const id = remoteRowId(key, item);
    if (id) old[id] = JSON.stringify(item);
  });
  const upsert = [];
  const seen = {};
  (Array.isArray(value) ? value : []).forEach((item) => {
    const id = remoteRowId(key, item);
    if (!id) { console.warn("state: запис без id не збережено", key, item); return; }
    seen[id] = true;
    let row = item;
    if (key === "state_users" && "password" in row) {
      row = Object.assign({}, row);
      delete row.password;
    }
    if (old[id] !== JSON.stringify(row)) upsert.push(row);
  });
  const remove = Object.keys(old).filter((id) => !seen[id]);
  if (!upsert.length && !remove.length) return true;
  const res = apiRequest("POST", "/api/sync", { ops: [{ coll: key, upsert, remove }] });
  if (!res.ok) {
    if (res.status === 401) {
      setApiToken("");
      try { localStorage.removeItem("state_session"); } catch { /* ignore */ }
    }
    if (res.status === 409 && res.data.data) { applyRemoteData(res.data.data); saveSnapshot(); }
    alert(res.data.error || "Не вдалося зберегти зміни на сервері.");
    return false;
  }
  applyRemoteData(res.data.data);
  saveSnapshot();
  return true;
}


// Спільні колекції — з пам'яті сторінки (завантажені з сервера), решта ключів (сесія, налаштування) — з браузера
function loadLS(key, fallback) {
  if (SHARED_KEYS.includes(key)) {
    const raw = REMOTE.cache[key];
    return raw ? JSON.parse(raw) : fallback;
  }
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

// Спільні колекції пишуться на сервер; решта — у браузер. Запис ніколи не кидає помилку: при невдачі повертає false.
function saveLS(key, value) {
  if (SHARED_KEYS.includes(key)) return remoteSave(key, value);
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (err) {
    console.warn("localStorage", key, err);
    return false;
  }
}

