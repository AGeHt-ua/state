/* Роль визначається апаратом автоматично (гілка влади апарату). Конгрес — не роль, а статус користувача
   (user.congressMember), який дає право голосувати в Конгресі. */
const ROLE_LABELS = {
  governor: "Кабінет Губернатора",
  official: "Виконавча влада",
  prosecutor: "Прокуратура",
  court: "Судова влада",
  citizen: "Кабінет громадянина",
  pending: "Очікує призначення"
};

// Гілки влади для апаратів (у формі «Новий апарат»)
const BRANCHES = [
  { role: "official", label: "Виконавча влада", hint: "уряд, департаменти, служби" },
  { role: "court", label: "Судова влада", hint: "суди" },
  { role: "prosecutor", label: "Прокуратура", hint: "нагляд, обвинувачення" },
  { role: "governor", label: "Кабінет Губернатора", hint: "повні права адміністратора" }
];

const OFFICE_BY_ROLE = {
  governor: "governor",
  official: "directors",
  prosecutor: "prosecutor",
  court: "court"
};

const OFFICE_NAMES = {
  governor: "Кабінет Губернатора",
  directors: "Кабінет Директорів Департаменту",
  prosecutor: "Кабінет Прокуратури",
  court: "Кабінет Судової влади"
};

const DEFAULT_OFFICES = [
  { id: "governor", name: "Кабінет Губернатора", role: "governor", canApprove: true },
  { id: "directors", name: "Кабінет Директорів Департаменту", role: "official", canApprove: true },
  { id: "prosecutor", name: "Кабінет Прокуратури", role: "prosecutor", canApprove: true },
  { id: "court", name: "Кабінет Судової влади", role: "court", canApprove: true }
];

const PERMISSION_LABELS = {
  createDocs: "Створювати документи",
  publishDocs: "Публікувати без погодження",
  approveDocs: "Погоджувати документи",
  approveAnyDocs: "Погоджувати й повертати будь-які документи поза чергою",
  editOwnDocs: "Редагувати свої документи",
  editAllDocs: "Редагувати всі документи",
  manageDocs: "Керувати реєстром: чинність, архів, кошик",
  manageAppeals: "Відповідати на звернення до всіх апаратів",
  managePeople: "Призначати людей на посади й видавати права",
  manageStructure: "Створювати апарати й посади",
  manageRoutes: "Налаштовувати, хто погоджує документи апаратів",
  approveProfiles: "Підтверджувати зміни профілю",
  manageCongress: "Надавати статус конгресмена"
};

// Рівні доступу: готові набори прав, щоб не ставити галочки вручну
const ACCESS_LEVELS = {
  head: { label: "Керівник апарату", hint: "створює документи й погоджує документи свого апарату", permissions: ["createDocs", "approveDocs", "editOwnDocs"] },
  staff: { label: "Співробітник", hint: "створює документи, вони йдуть на погодження керівнику", permissions: ["createDocs", "editOwnDocs"] },
  admin: { label: "Адміністратор", hint: "усі права: створення, публікація й погодження будь-яких документів, реєстр, звернення, люди, структура", permissions: Object.keys(PERMISSION_LABELS) },
  viewer: { label: "Лише перегляд", hint: "бачить кабінет, але не створює документів", permissions: [] }
};

function accessLevelOf(position) {
  if (!position) return "viewer";
  if (position.level && ACCESS_LEVELS[position.level]) {
    const same = ACCESS_LEVELS[position.level].permissions.slice().sort().join() === (position.permissions || []).slice().sort().join();
    if (same) return position.level;
  }
  const perms = (position.permissions || []).slice().sort().join();
  const found = Object.keys(ACCESS_LEVELS).find((k) => ACCESS_LEVELS[k].permissions.slice().sort().join() === perms);
  return found || "custom";
}

const DEFAULT_POSITIONS = [
  { id: "governor-chief", office: "governor", title: "Губернатор штату", level: "admin", permissions: ACCESS_LEVELS.admin.permissions.slice() },
  { id: "director", office: "directors", title: "Директор департаменту", level: "head", permissions: ACCESS_LEVELS.head.permissions.slice() },
  { id: "directors-staff", office: "directors", title: "Співробітник департаменту", level: "staff", permissions: ACCESS_LEVELS.staff.permissions.slice() },
  { id: "prosecutor-chief", office: "prosecutor", title: "Генеральний прокурор", level: "head", permissions: ACCESS_LEVELS.head.permissions.slice() },
  { id: "prosecutor-staff", office: "prosecutor", title: "Прокурор", level: "staff", permissions: ACCESS_LEVELS.staff.permissions.slice() },
  { id: "court-chief", office: "court", title: "Голова Верховного Суду", level: "head", permissions: ACCESS_LEVELS.head.permissions.slice() },
  { id: "court-staff", office: "court", title: "Суддя", level: "staff", permissions: ACCESS_LEVELS.staff.permissions.slice() }
];

function userOffice(user) {
  if (user && user.office) return user.office;
  const role = ((user && user.roles) || []).find((r) => r !== "pending") || "official";
  return OFFICE_BY_ROLE[role] || "directors";
}

function officeTitle(user) {
  if (user && user.office) return officeName(user.office);
  const role = ((user && user.roles) || [])[0] || "pending";
  return ROLE_LABELS[role] || ROLE_LABELS.pending;
}

const DOC_TYPES = ["Конституція штату", "Закон", "Указ", "Розпорядження", "Статут органу"];
const DOC_STATUSES = {
  ok: "Чинний",
  draft: "Проєкт",
  review: "На погодженні",
  congress: "На голосуванні Конгресу",
  adopted: "Прийнято Конгресом",
  rejected: "Відхилено",
  dead: "Втратив чинність",
  trash: "У кошику"
};

const VERSION_LABELS = {
  draft: "Проєкт",
  review: "Редакція",
  congress: "Голосування Конгресу",
  adopted: "Прийнято",
  rejected: "Відхилено",
  ok: "Чинна версія",
  dead: "Архів",
  trash: "Архів"
};

const DEFAULT_APPROVAL_ROUTES = [
  {
    id: "standard",
    name: "Автор → губернатор → публікація",
    ownerOffice: "all",
    steps: ["position:governor-chief"],
    active: true,
    seeded: true
  }
];

function esc(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function attr(value) {
  return esc(value).replace(/`/g, "&#96;");
}

/* ---------- Санітизація HTML документів ----------
   HTML документа пише автор, а бачать усі, тож перед показом прибираємо все, що може виконати код:
   небезпечні теги, обробники подій, небезпечні URL (javascript:, data:text/html тощо) та CSS-трюки. */
const DOC_DROP_TAGS = "script,style,iframe,frame,frameset,object,embed,applet,link,meta,base,form,input,button,textarea,select,option," +
  "noscript,template,portal,svg,math,audio,video,source,track,dialog";
const DOC_URL_ATTRS = ["href", "src", "xlink:href", "action", "formaction", "poster", "background", "cite", "data", "longdesc"];
const DOC_DROP_ATTRS = ["srcset", "srcdoc", "ping", "contenteditable", "name", "form", "is", "autofocus"];

// Дозволені URL: http(s), mailto, tel, якорі й відносні шляхи; для зображень ще data:image (крім SVG)
function isSafeUrl(value, forImage) {
  const v = String(value || "").replace(/[\x00-\x20\x7f-\x9f]/g, "");
  if (!v) return true;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(v)) return true;
  if (/^(https?|mailto|tel):/i.test(v)) return true;
  return !!forImage && /^data:image\/(png|jpe?g|gif|webp|bmp|avif);/i.test(v);
}

function isSafeStyle(style) {
  const s = String(style || "").replace(/\\/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  if (/expression\s*\(|javascript:|vbscript:|behavior\s*:|-moz-binding|@import|position\s*:\s*fixed/i.test(s)) return false;
  const urls = s.match(/url\s*\(\s*(['"]?)([^'")]*)\1\s*\)/gi) || [];
  return urls.every((u) => isSafeUrl(u.replace(/^url\s*\(\s*['"]?|['"]?\s*\)$/gi, ""), true));
}

function sanitizeDocHtml(html) {
  const parsed = new DOMParser().parseFromString(String(html || ""), "text/html");
  parsed.body.querySelectorAll(DOC_DROP_TAGS).forEach((el) => el.remove());
  parsed.body.querySelectorAll("*").forEach((el) => {
    const isImage = el.tagName === "IMG";
    Array.from(el.attributes).forEach((a) => {
      const name = a.name.toLowerCase();
      if (name.startsWith("on") || DOC_DROP_ATTRS.includes(name)) el.removeAttribute(a.name);
      else if (DOC_URL_ATTRS.includes(name) && !isSafeUrl(a.value, isImage)) el.removeAttribute(a.name);
      else if (name === "style" && !isSafeStyle(a.value)) el.removeAttribute(a.name);
    });
    if (el.tagName === "A" && el.getAttribute("target")) el.setAttribute("rel", "noopener noreferrer");
  });
  return parsed.body.innerHTML;
}

const SEED_DOCS = [
  {
    id: "const-sa-01",
    type: "Конституція штату",
    number: "КС-01",
    date: "2026-09-08",
    publishedAt: "2026-09-08T12:00:00",
    status: "ok",
    body: "Уряд штату Сан-Андреас",
    title: "Конституція штату Сан-Андреас",
    text: "Ми, народ штату San Andreas (Ukraine GTA 5), розуміючи цінність свободи, порядку та справедливості, ухвалюємо цю Конституцію.",
    publishHome: true,
    seeded: true
  },
  {
    id: "law-gov-01",
    type: "Закон",
    number: "З-17",
    date: "2026-09-09",
    publishedAt: "2026-09-09T10:30:00",
    status: "ok",
    body: "Уряд штату Сан-Андреас",
    title: "Закон про діяльність Уряду",
    text: "Цей Закон визначає організацію роботи Уряду штату.",
    publishHome: true,
    seeded: true
  },
  {
    id: "decree-warrant-01",
    type: "Указ",
    number: "У-04",
    date: "2026-09-09",
    status: "draft",
    body: "Апарат Уряду",
    title: "Порядок видачі ордерів",
    text: "Ордер — службовий документ, що уповноважує визначену дію.",
    seeded: true
  },
  {
    id: "project-congress-law-01",
    type: "Закон",
    number: "ПЗ-01",
    date: "2026-09-11",
    publishedAt: "2026-09-11T09:00:00",
    status: "congress",
    body: "Конгрес штату Сан-Андреас",
    title: "Проєкт Закону про порядок розгляду актів Конгресом",
    text: "Цей проєкт визначає, як Конституція, кодекси та закони проходять погодження і голосування Конгресу перед набранням чинності.",
    author: "Кабінет Губернатора",
    office: "governor",
    publishHome: true,
    approvalRouteName: "Автор → Конгрес → публікація",
    approvalSteps: ["congress"],
    approvalIndex: 0,
    approverOffice: "congress",
    seeded: true
  }
];

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
function loadFullDoc(id) {
  const cached = JSON.parse(REMOTE.cache.state_docs || "[]").find((d) => d.id === id);
  if (cached && !cached._partial) return getDoc(id);
  const res = apiRequest("GET", "/api/doc/" + encodeURIComponent(id));
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

function remoteBoot() {
  REMOTE.cache = {};
  if (!REMOTE.url) { console.error("state: у config.js не вказано STATE_WORKER_URL"); return; }
  const snap = loadSnapshot();
  if (snap) {
    const diff = apiRequest("GET", "/api/changes?since=" + snap.since);
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
  const res = apiRequest("GET", "/api/state");
  if (!res.ok) {
    console.warn("state: сервер недоступний", res.status, res.data);
    document.addEventListener("DOMContentLoaded", () => {
      document.body.insertAdjacentHTML("afterbegin",
        '<div id="state-offline" role="alert" style="background:#8a2b2b;color:#fff;padding:8px 16px;text-align:center;font-size:14px">' +
        "Немає зв'язку з сервером порталу — дані не завантажені, зміни не зберігаються. Оновіть сторінку пізніше.</div>");
    });
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

remoteBoot();

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

function allUsers() {
  const extra = loadLS("state_users", []);
  const seed = (window.STATE_ACCOUNTS || []).map((a) => ({
    login: a.login,
    name: a.name || a.login,
    roles: a.roles && a.roles.includes("governor") ? a.roles : remapSeedRoles(a),
    office: a.office || OFFICE_BY_ROLE[(a.roles || [])[0]] || "",
    positionId: a.positionId || defaultPositionForAccount(a),
    post: a.post || "",
    statId: a.statId || "",
    contact: a.contact || "",
    photo: a.photo || "",
    seeded: true
  }));
  const byLogin = {};
  seed.forEach((u) => { byLogin[u.login] = u; });
  extra.forEach((u) => { byLogin[u.login] = Object.assign({}, byLogin[u.login] || {}, u); });
  return Object.values(byLogin).map(normalizeUser);
}

// Сумісність зі старими даними: колишня роль/посада «Конгрес» → статус конгресмена у звичайного посадовця
function normalizeUser(u) {
  const roles = u.roles || [];
  const legacyPos = u.positionId ? allPositions().find((p) => p.id === u.positionId) : null;
  const legacyCongress = roles.includes("congress") || u.positionId === "congressman" ||
    !!(legacyPos && (legacyPos.congressMember || (legacyPos.permissions || []).includes("voteCongress")));
  let out = u;
  if (!("congressMember" in u) && legacyCongress) out = Object.assign({}, out, { congressMember: true });
  if (roles.includes("congress") || u.office === "congress" || u.positionId === "congressman") {
    out = Object.assign({}, out, {
      roles: roles.includes("congress") ? ["official"] : roles,
      office: !u.office || u.office === "congress" ? "directors" : u.office,
      positionId: !u.positionId || u.positionId === "congressman" ? "directors-staff" : u.positionId
    });
  }
  return out;
}

function roleForOffice(officeId) {
  const office = allOffices().find((o) => o.id === officeId);
  return (office && office.role) || "official";
}

// Призначення людини: роль виводиться з апарату, публічна посада за замовчуванням — назва посади
function assignUser(login, patch, byUser) {
  const user = allUsers().find((u) => u.login === login);
  if (!user) return null;
  const next = Object.assign({}, user);
  if ("office" in patch) {
    if (!patch.office) { next.roles = ["pending"]; next.office = ""; next.positionId = ""; next.extraPermissions = []; }
    else { next.office = patch.office; next.roles = [roleForOffice(patch.office)]; }
  }
  if ("positionId" in patch) next.positionId = patch.positionId || "";
  if ("post" in patch) {
    const pos = positionById(next.positionId);
    next.post = String(patch.post || "").trim() || (pos ? pos.title : "");
  }
  if ("congressMember" in patch && byUser && hasPermission(byUser, "manageCongress")) next.congressMember = !!patch.congressMember;
  saveUser(next);
  return next;
}

function setCongressMember(login, on, byUser) {
  if (!byUser || !hasPermission(byUser, "manageCongress")) return null;
  return assignUser(login, { congressMember: !!on }, byUser);
}

function remapSeedRoles(a) {
  const roles = a.roles || [];
  if (roles.includes("governor")) return roles;
  if (a.login === "castro" || a.login === "admin") return ["governor"];
  if (roles.includes("court")) return ["court"];
  if (roles.includes("admin_stub")) return ["official"];
  return roles.length ? roles : ["pending"];
}

function defaultPositionForAccount(a) {
  const roles = a.roles || [];
  if (roles.includes("governor") || a.login === "castro" || a.login === "admin") return "governor-chief";
  if (roles.includes("congress")) return "directors-staff";
  if (roles.includes("prosecutor")) return "prosecutor-chief";
  if (roles.includes("court")) return "court-chief";
  if (roles.includes("official")) return "director";
  return "";
}

function saveUser(user) {
  const extra = loadLS("state_users", []);
  const i = extra.findIndex((u) => u.login === user.login);
  const row = {
    login: user.login,
    name: user.name,
    roles: user.roles || ["pending"],
    office: user.office || userOffice(user),
    positionId: user.positionId || "",
    post: user.post || "",
    statId: user.statId || "",
    contact: user.contact || "",
    photo: user.photo || ""
  };
  // Статус конгресмена: зберігаємо, якщо переданий; інакше лишаємо як був
  if ("congressMember" in user) row.congressMember = !!user.congressMember;
  if ("extraPermissions" in user) row.extraPermissions = (user.extraPermissions || []).slice();
  if (i >= 0) extra[i] = Object.assign({}, extra[i], row);
  else extra.push(row);
  saveLS("state_users", extra);
}

// Реєстрація й вхід — лише на сервері; паролі в браузері не зберігаються
const LOGIN_RE = /^[a-z0-9_.-]{3,32}$/;

function registerUser({ login, password, name, post, accountType, statId, contact }) {
  login = String(login || "").trim().toLowerCase();
  name = String(name || "").trim();
  if (!login || !password || !name) return { ok: false, error: "Заповни всі поля." };
  if (!LOGIN_RE.test(login)) return { ok: false, error: "Логін: 3–32 символи, лише латиниця, цифри, крапка, дефіс і підкреслення." };
  if (name.length > 64) return { ok: false, error: "Ім'я занадто довге (до 64 символів)." };
  if (allUsers().some((u) => u.login === login)) return { ok: false, error: "Такий логін уже зайнятий." };
  const res = apiRequest("POST", "/api/register", { login, password, name, post, accountType, statId, contact });
  return res.ok ? { ok: true } : { ok: false, error: res.data.error || "Не вдалося зареєструватися." };
}

function loginWithPassword(login, password) {
  login = String(login || "").trim().toLowerCase();
  const res = apiRequest("POST", "/api/auth", { login, password: String(password || "") });
  REMOTE.lastError = res.ok ? "" : (res.data.error || "");
  if (!res.ok) return null;
  setApiToken(res.data.token);
  // Вхід віддає всі дані — навіть якщо під час завантаження сторінки сервер не відповідав, тепер зв'язок є
  dropSnapshot();
  applyRemoteData(res.data.data);
  REMOTE.ok = true;
  REMOTE.scope = res.data.scope || "";
  saveSnapshot();
  // Адмін скинув пароль — людина має змінити тимчасовий (банер на всіх сторінках, доки не змінить)
  try {
    if (res.data.mustChangePassword) localStorage.setItem("state_must_change", "1");
    else localStorage.removeItem("state_must_change");
  } catch { /* приватний режим */ }
  const banner = document.getElementById("state-offline");
  if (banner) banner.remove();
  const found = allUsers().find((a) => a.login === res.data.login);
  if (!found) return null;
  const session = {
    id: found.login,
    login: found.login,
    username: found.name || found.login,
    roles: found.roles || ["pending"],
    office: found.office || userOffice(found),
    positionId: found.positionId || "",
    post: found.post || "",
    statId: found.statId || "",
    contact: found.contact || "",
    source: "manual"
  };
  saveLS("state_session", session);
  session.photo = found.photo || "";
  return session;
}

function currentUser() {
  const raw = loadLS("state_session", null);
  if (!raw || !raw.login && !raw.id) return null;
  const fresh = allUsers().find((u) => u.login === (raw.login || raw.id));
  if (!fresh) return raw;
  const session = {
    id: fresh.login,
    login: fresh.login,
    username: fresh.name,
    roles: fresh.roles || [],
    office: fresh.office || userOffice(fresh),
    positionId: fresh.positionId || "",
    post: fresh.post || "",
    statId: fresh.statId || "",
    contact: fresh.contact || "",
    source: "manual"
  };
  // Фото береться з профілю й у сесію не пишеться; сесію перезаписуємо лише коли вона змінилась
  const stored = Object.assign({}, raw);
  delete stored.photo;
  if (JSON.stringify(stored) !== JSON.stringify(session)) saveLS("state_session", session);
  session.photo = fresh.photo || "";
  return session;
}

function logout() {
  if (apiToken()) apiRequest("POST", "/api/signout", {});
  setApiToken("");
  dropSnapshot();
  try { localStorage.removeItem("state_must_change"); } catch { /* приватний режим */ }
  try { localStorage.removeItem("state_session"); } catch { /* приватний режим */ }
  // Приватні дані попереднього користувача не лишаються в пам'яті сторінки
  remoteBoot();
}

// Фото профілю зберігаємо зменшеним (до 256 px, JPEG): воно їде кожному відвідувачу разом зі списком людей,
// а мегабайтні фото перевантажували сервер. done(dataUrl) або done("") при помилці.
function shrinkImage(file, maxSize, done) {
  const reader = new FileReader();
  reader.onerror = () => done("");
  reader.onload = () => {
    const img = new Image();
    img.onerror = () => done("");
    img.onload = () => {
      const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      done(canvas.toDataURL("image/jpeg", 0.85));
    };
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
}

function changePassword(oldPassword, newPassword) {
  const user = currentUser();
  if (!user) return { ok: false, error: "Спершу увійдіть." };
  newPassword = String(newPassword || "");
  if (newPassword.length < 8 || newPassword.length > 128) return { ok: false, error: "Новий пароль: від 8 до 128 символів." };
  const res = apiRequest("POST", "/api/password", { oldPassword: String(oldPassword || ""), newPassword });
  if (res.ok) { try { localStorage.removeItem("state_must_change"); } catch { /* приватний режим */ } }
  return res.ok ? { ok: true } : { ok: false, error: res.data.error || "Не вдалося змінити пароль." };
}

// Скидання пароля адміністратором (managePeople): повертає тимчасовий пароль, людина змінить його після входу
function resetUserPassword(login) {
  const res = apiRequest("POST", "/api/reset-password", { login });
  return res.ok ? { ok: true, password: res.data.password } : { ok: false, error: res.data.error || "Не вдалося скинути пароль." };
}

// Журнал дій адміністрації: найновіші 100 записів, далі — сторінками (before = id останнього показаного)
function loadAudit(before) {
  const res = apiRequest("GET", "/api/audit" + (before ? "?before=" + encodeURIComponent(before) : ""));
  return res.ok ? { ok: true, items: res.data.items || [] } : { ok: false, error: res.data.error || "Не вдалося завантажити журнал." };
}

// Зв'язки між документами: що змінює / скасовує цей документ і хто змінив / скасував його
function docLinks(doc) {
  const l = (doc && doc.links) || {};
  return { amends: Array.isArray(l.amends) ? l.amends : [], repeals: Array.isArray(l.repeals) ? l.repeals : [] };
}
function docBacklinks(id) {
  const all = allDocs();
  return {
    amendedBy: all.filter((d) => d.id !== id && d.status === "ok" && docLinks(d).amends.includes(id)),
    repealedBy: all.filter((d) => d.id !== id && ["ok", "review", "congress"].includes(d.status) && docLinks(d).repeals.includes(id))
  };
}

// Видалення акаунта: лише з правом managePeople; себе й службові акаунти (accounts.js) — не можна
function deleteUserAccount(login, byUser) {
  if (!byUser || !hasPermission(byUser, "managePeople")) return { ok: false, error: "Недостатньо прав для цієї дії." };
  const user = allUsers().find((u) => u.login === login);
  if (!user) return { ok: false, error: "Акаунт не знайдено." };
  if (user.login === byUser.login) return { ok: false, error: "Свій акаунт видалити не можна." };
  if (user.seeded) return { ok: false, error: "Службовий акаунт видалити не можна." };
  const res = apiRequest("POST", "/api/delete-user", { login });
  if (!res.ok) return { ok: false, error: res.data.error || "Не вдалося видалити акаунт." };
  applyRemoteData(res.data.data);
  return { ok: true };
}

function hasRole(user, role) {
  const roles = (user && user.roles) || [];
  if (roles.includes("governor")) return true;
  return roles.includes(role);
}

function allOffices() {
  const extra = loadLS("state_offices", []);
  const byId = {};
  DEFAULT_OFFICES.forEach((o) => { byId[o.id] = o; });
  extra.forEach((o) => { byId[o.id] = Object.assign({}, byId[o.id] || {}, o); });
  return Object.values(byId);
}

function saveOffice(office) {
  const extra = loadLS("state_offices", []);
  const row = {
    id: String(office.id || newDocId()).trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-"),
    name: String(office.name || "").trim(),
    role: office.role || "official",
    canApprove: !!office.canApprove
  };
  if (office.approval) row.approval = { head: office.approval.head !== false, governor: office.approval.governor !== false };
  if (!row.id || !row.name) return null;
  const i = extra.findIndex((o) => o.id === row.id);
  if (i >= 0) extra[i] = Object.assign({}, extra[i], row);
  else extra.push(row);
  saveLS("state_offices", extra);
  return row;
}

function allPositions() {
  const extra = loadLS("state_positions", []);
  const byId = {};
  DEFAULT_POSITIONS.forEach((p) => { byId[p.id] = p; });
  extra.forEach((p) => { byId[p.id] = Object.assign({}, byId[p.id] || {}, p); });
  // Рівень «Адміністратор» завжди має всі права, зокрема ті, що з'явилися після збереження посади
  return Object.values(byId).map((p) => p.level === "admin" ? Object.assign({}, p, { permissions: ACCESS_LEVELS.admin.permissions.slice() }) : p);
}

function positionById(id) {
  return allPositions().find((p) => p.id === id) || null;
}

function slugId(value) {
  const map = { а:"a", б:"b", в:"v", г:"h", ґ:"g", д:"d", е:"e", є:"ye", ж:"zh", з:"z", и:"y", і:"i", ї:"yi", й:"y", к:"k", л:"l", м:"m", н:"n", о:"o", п:"p", р:"r", с:"s", т:"t", у:"u", ф:"f", х:"kh", ц:"ts", ч:"ch", ш:"sh", щ:"shch", ю:"yu", я:"ya", ь:"" };
  return String(value || "").toLowerCase().split("").map((ch) => map[ch] != null ? map[ch] : ch).join("")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 36);
}
function uniqueId(base, taken) {
  let id = base || "item";
  let n = 2;
  while (taken.includes(id)) id = base + "-" + n++;
  return id;
}

// Видаляти можна лише створені в адмінці (не вбудовані) і лише коли на них ніхто не призначений
function isDefaultOffice(id) { return DEFAULT_OFFICES.some((o) => o.id === id); }
function isDefaultPosition(id) { return DEFAULT_POSITIONS.some((p) => p.id === id); }
function deletePosition(id) {
  if (isDefaultPosition(id) || allUsers().some((u) => u.positionId === id)) return false;
  saveLS("state_positions", loadLS("state_positions", []).filter((p) => p.id !== id));
  return true;
}
function deleteOffice(id) {
  if (isDefaultOffice(id) || allUsers().some((u) => u.office === id && isStaff(u))) return false;
  saveLS("state_positions", loadLS("state_positions", []).filter((p) => p.office !== id));
  saveLS("state_approval_routes", loadLS("state_approval_routes", []).filter((r) => r.ownerOffice !== id));
  saveLS("state_offices", loadLS("state_offices", []).filter((o) => o.id !== id));
  return true;
}
function deleteApprovalRoute(id) {
  saveLS("state_approval_routes", loadLS("state_approval_routes", []).filter((r) => r.id !== id));
}

// Новий апарат одним кроком: апарат + посади «Керівник» і «Співробітник»
function createOffice({ name, role, approval }) {
  const title = String(name || "").trim();
  if (!title) return null;
  const id = uniqueId(slugId(title) || "office", allOffices().map((o) => o.id));
  const office = saveOffice({ id, name: title, role: role || "official", canApprove: true, approval });
  if (!office) return null;
  const taken = allPositions().map((p) => p.id);
  savePosition({ id: uniqueId(id + "-head", taken), office: id, title: "Керівник · " + title, level: "head" });
  savePosition({ id: uniqueId(id + "-staff", taken), office: id, title: "Співробітник · " + title, level: "staff" });
  return office;
}

function savePosition(position) {
  const level = position.level && ACCESS_LEVELS[position.level] ? position.level : "custom";
  const row = {
    id: String(position.id || uniqueId(slugId(position.title) || "position", allPositions().map((p) => p.id))).trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-"),
    office: position.office || "directors",
    title: String(position.title || "").trim(),
    level,
    permissions: level !== "custom" && !position.permissions ? ACCESS_LEVELS[level].permissions.slice() : (position.permissions || [])
  };
  if (!row.id || !row.title) return null;
  const extra = loadLS("state_positions", []);
  const i = extra.findIndex((p) => p.id === row.id);
  if (i >= 0) extra[i] = Object.assign({}, extra[i], row);
  else extra.push(row);
  saveLS("state_positions", extra);
  return row;
}

function allApprovalRoutes() {
  const extra = loadLS("state_approval_routes", []);
  const byId = {};
  DEFAULT_APPROVAL_ROUTES.forEach((r) => { byId[r.id] = r; });
  extra.forEach((r) => { byId[r.id] = Object.assign({}, byId[r.id] || {}, r); });
  return Object.values(byId);
}

function routesForOffice(office) {
  return allApprovalRoutes().filter((r) => !r.ownerOffice || r.ownerOffice === "all" || r.ownerOffice === office);
}

// Автоматичний маршрут: керівник апарату автора → Губернатор (кроки, де автор погоджував би сам себе, пропускаються)
function autoApprovalRoute(office) {
  return { id: "auto", name: "Автоматично: керівник апарату → Губернатор", ownerOffice: office || "all", steps: ["authorOffice", "position:governor-chief"], active: true, auto: true };
}

// Закон завжди проходить голосування Конгресу: крок вставляється перед Губернатором (або в кінець маршруту)
function withCongressStep(route) {
  if (!route || (route.steps || []).includes("congress")) return route;
  const steps = (route.steps || []).slice();
  const gov = steps.indexOf("position:governor-chief");
  if (gov >= 0) steps.splice(gov, 0, "congress");
  else steps.push("congress");
  return Object.assign({}, route, { id: route.id + "-congress", name: route.name + " (закон — через Конгрес)", steps });
}

/* ---------- Шлях погодження ----------
   Кожен апарат має простий шлях: [керівник апарату] → [Конгрес — лише для законодавчих типів] → [Губернатор] → публікація.
   Що з цього вмикати, адміністратор задає в картці апарату. Автор не погоджує сам себе: його крок пропускається. */
function officeApproval(officeId) {
  const office = allOffices().find((o) => o.id === officeId);
  const a = (office && office.approval) || {};
  return { head: a.head !== false, governor: a.governor !== false };
}

function activeApprovalRoute(office) {
  const a = officeApproval(office);
  const steps = [];
  if (a.head) steps.push("authorOffice");
  if (a.governor) steps.push("position:governor-chief");
  const names = { authorOffice: "керівник апарату", "position:governor-chief": "Губернатор" };
  return { id: "path-" + (office || "all"), name: "Шлях апарату: " + (steps.map((x) => names[x]).join(" → ") || "без погодження"), ownerOffice: office || "all", steps, active: true, auto: true };
}

// Хто саме зараз займає посаду кроку — щоб у шляху було видно не лише посаду, а й людину
function stepHolders(step) {
  const raw = String(step || "");
  if (raw.startsWith("position:")) return allUsers().filter((u) => u.positionId === raw.slice(9) && isStaff(u)).map((u) => u.name || u.login);
  if (raw.startsWith("user:")) { const u = allUsers().find((x) => x.login === raw.slice(5)); return u ? [u.name || u.login] : []; }
  return [];
}

function stepShortName(step, doc) {
  if (step === "congress") return "Конгрес";
  if (String(step || "").startsWith("user:")) {
    const u = allUsers().find((x) => x.login === String(step).slice(5));
    const p = u && positionById(u.positionId);
    return p ? p.title : "Посадовець";
  }
  return routeStepName(step, doc).split(" · ")[0];
}

/* Шлях документа ланцюжком: Автор → кроки → Публікація. Пройдені кроки — ✓, поточний підсвічено.
   Для попереднього перегляду (ще не відправлено) передайте { approvalSteps, preview: true }. */
function approvalPathHtml(doc, opts = {}) {
  const steps = doc.approvalSteps || [];
  const status = doc.status;
  const current = Number(doc.approvalIndex || 0);
  const inRoute = !opts.preview && (status === "review" || status === "congress");
  const finished = !opts.preview && ["ok", "adopted", "dead"].includes(status);
  const returned = !opts.preview && (status === "draft" || status === "rejected") && (doc.returnedReason || doc.rejectedReason);
  const item = (cls, title, sub) => `<li class="${cls}"><b>${esc(title)}</b>${sub ? `<small>${esc(sub)}</small>` : ""}</li>`;
  const parts = [item("done", opts.authorLabel || "Автор", opts.authorName || doc.author || "")];
  steps.forEach((step, i) => {
    let cls = "wait";
    if (finished || (inRoute && i < current)) cls = "done";
    else if (inRoute && i === current) cls = "current";
    else if (returned && i === current) cls = "back";
    let sub = "";
    if (step === "congress") {
      const t = congressTally(doc);
      sub = inRoute && i === current ? "за " + t.pro + " з " + t.needed + " потрібних" : t.members + " конгресм., потрібно " + t.needed + " «за»";
    } else sub = stepHolders(step).join(", ") || (String(step).startsWith("position:") ? "посада вакантна" : "");
    parts.push(item(cls, stepShortName(step, doc), sub));
  });
  parts.push(item(finished ? "done final" : "wait final", status === "dead" && !opts.preview ? "Втратив чинність" : "Публікація", ""));
  return `<ol class="approval-path${opts.compact ? " compact" : ""}">${parts.join("")}</ol>`;
}

function saveApprovalRoute(route) {
  const ownerOffice = route.ownerOffice || "all";
  const row = {
    id: String(route.id || newDocId()).trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-"),
    name: String(route.name || "").trim(),
    ownerOffice,
    steps: (route.steps || []).map((s) => String(s).trim()).filter((s) => s && (s === "congress" || s === "authorOffice" || s.startsWith("position:") || s.startsWith("user:"))),
    active: !!route.active,
    seeded: false
  };
  if (!row.id || !row.name || !row.steps.length) return null;
  const extra = loadLS("state_approval_routes", []);
  const normalized = row.active
    ? extra.map((r) => (r.ownerOffice || "all") === ownerOffice ? Object.assign({}, r, { active: false }) : r)
    : extra.slice();
  const i = normalized.findIndex((r) => r.id === row.id);
  if (i >= 0) normalized[i] = Object.assign({}, normalized[i], row);
  else normalized.push(row);
  saveLS("state_approval_routes", normalized);
  return row;
}

function approverPositionForOffice(office) {
  const positions = allPositions().filter((p) => p.office === office && (p.permissions || []).includes("approveDocs"))
    .sort((a, b) => (b.level === "head") - (a.level === "head"));
  return positions[0] ? "position:" + positions[0].id : "";
}

function normalizeApprovalStep(step, doc) {
  const raw = String(step || "").trim();
  // Немає керівника з правом погодження — крок пропускається
  if (raw === "authorOffice") return approverPositionForOffice(doc.office || "directors");
  if (raw.startsWith("office:")) return approverPositionForOffice(raw.slice(7)) || raw.slice(7);
  if (raw.startsWith("position:") || raw.startsWith("user:")) return raw;
  if (allOffices().some((office) => office.id === raw)) return approverPositionForOffice(raw) || raw;
  return raw;
}

function resolveApprovalSteps(doc, route) {
  const seen = {};
  const raw = (route && route.steps && route.steps.length ? route.steps : ["position:governor-chief"]);
  // Автор не погоджує власний документ: його посада / він сам у маршруті пропускаються
  const author = doc && doc.ownerLogin ? allUsers().find((u) => u.login === doc.ownerLogin) : null;
  const own = author ? ["user:" + author.login, author.positionId ? "position:" + author.positionId : ""] : [];
  const steps = raw.map((step) => normalizeApprovalStep(step, doc))
    .filter((step) => {
      if (!step || seen[step] || own.includes(step)) return false;
      seen[step] = true;
      return true;
    });
  // Вакантна посада (ніхто її не займає) пропускається, інакше документ застряг би на ній.
  // Якщо вакантне все — лишаємо останній крок: такі документи може погодити адміністратор (approveAnyDocs).
  const staffed = steps.filter((step) => !String(step).startsWith("position:") || stepHolders(step).length);
  return staffed.length ? staffed : steps.slice(-1);
}

function routeStepName(step, doc) {
  if (step === "authorOffice") return "Керівник апарату автора";
  if (step === "congress") return "Конгрес";
  if (String(step || "").startsWith("office:")) return officeName(String(step).slice(7));
  if (String(step || "").startsWith("position:")) {
    const id = String(step).slice(9);
    const position = positionById(id);
    return position ? (position.title + " · " + officeName(position.office)) : id;
  }
  if (String(step || "").startsWith("user:")) {
    const login = String(step).slice(5);
    const user = allUsers().find((u) => u.login === login);
    return user ? (user.name || user.login) : login;
  }
  return officeName(step || (doc && doc.approverOffice));
}

function routeProgressLabel(doc) {
  const steps = doc.approvalSteps || [];
  if (!steps.length) return doc.approverOffice ? officeName(doc.approverOffice) : "Погодження";
  const current = Math.min(Number(doc.approvalIndex || 0), steps.length - 1);
  const who = stepHolders(steps[current]).join(", ");
  return "Зараз у: " + stepShortName(steps[current], doc) + (who ? " (" + who + ")" : "") + " · крок " + (current + 1) + " з " + steps.length;
}

// Права = права посади + особисті права, видані в адмін-панелі (лише посадовцям)
function userPermissions(user) {
  if (!user) return [];
  if (((user.roles || [])[0]) === "governor") return Object.keys(PERMISSION_LABELS);
  if (!isStaff(user)) return [];
  const position = positionById(user.positionId);
  const own = position ? (position.permissions || []) : [];
  const full = "extraPermissions" in user ? user : allUsers().find((u) => u.login === (user.login || user.id));
  const extra = ((full && full.extraPermissions) || []).filter((p) => PERMISSION_LABELS[p]);
  return own.concat(extra.filter((p) => !own.includes(p)));
}

function isFullAdmin(user) {
  return Object.keys(PERMISSION_LABELS).every((p) => hasPermission(user, p));
}

// Особисті права: видати можна лише ті, що є в самого адміністратора
function setUserPermissions(login, permissions, byUser) {
  if (!byUser || !hasPermission(byUser, "managePeople")) return null;
  const user = allUsers().find((u) => u.login === login);
  if (!user) return null;
  const allowed = (permissions || []).filter((p) => PERMISSION_LABELS[p] && hasPermission(byUser, p));
  // Права, яких адміністратор не має, він і не може забрати
  const kept = (user.extraPermissions || []).filter((p) => PERMISSION_LABELS[p] && !hasPermission(byUser, p));
  const next = Object.assign({}, user, { extraPermissions: kept.concat(allowed.filter((p) => !kept.includes(p))) });
  saveUser(next);
  return next;
}

function hasPermission(user, permission) {
  return userPermissions(user).includes(permission);
}

function isCongressPosition(position) {
  return !!(position && (position.congressMember || (position.permissions || []).includes("voteCongress")));
}

// Конгресмен — статус конкретної людини (ставиться в адмін-панелі), а не посада чи роль
function isCongressMember(user) {
  if (!user) return false;
  if ("congressMember" in user) return !!user.congressMember;
  const full = allUsers().find((u) => u.login === (user.login || user.id));
  return !!(full && full.congressMember);
}

function congressMembers() {
  return allUsers().filter((user) => isCongressMember(user));
}

function congressPositions() {
  return allPositions().filter(isCongressPosition);
}

function isStaff(user) {
  const roles = (user && user.roles) || [];
  return ["governor", "official", "prosecutor", "court"].some((r) => roles.includes(r));
}

function isCitizen(user) {
  return ((user && user.roles) || []).includes("citizen");
}

function isCabinetUser(user) {
  return isStaff(user) || isCitizen(user);
}

function requireAuth(neededRole) {
  const user = currentUser();
  if (!user) {
    location.href = pathTo("cabinet/portal/");
    return null;
  }
  if (!isCabinetUser(user)) {
    location.href = pathTo("cabinet/pending/");
    return null;
  }
  if (neededRole && !hasRole(user, neededRole)) {
    location.href = pathTo("denied/");
    return null;
  }
  return user;
}

function requireGovernor() {
  return requireAuth("governor");
}

function allDocs() {
  const extra = loadLS("state_docs", []);
  const byId = {};
  SEED_DOCS.forEach((d) => { byId[d.id] = d; });
  extra.forEach((d) => { byId[d.id] = d; });
  return Object.values(byId)
    .filter((d) => d.status !== "deleted")
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

function publishedDocs() {
  return allDocs().filter((d) => d.status === "ok" || d.status === "dead");
}

function isLegislativeDoc(doc) {
  return ["Конституція штату", "Кодекс", "Закон"].includes(doc && doc.type) ||
    customDocTypes().some((t) => t.congress && t.label === (doc && doc.type));
}

// Публічна база: чинні й архівні акти будь-якого виду; проєкти (у т.ч. на погодженні) — лише законодавчі
function publicLegislativeDocs() {
  return allDocs().filter((d) =>
    d.status === "ok" || d.status === "dead" ||
    (isLegislativeDoc(d) && ["review", "congress", "adopted", "draft"].includes(d.status))
  );
}

function homeDocs() {
  return allDocs()
    .filter((d) => d.publishHome === true && d.status !== "trash" && d.status !== "rejected")
    .sort((a, b) => String(b.publishedAt || b.date).localeCompare(String(a.publishedAt || a.date)));
}

function cabinetCreatedDocs() {
  return allDocs()
    .filter((d) => !d.seeded && d.status !== "trash")
    .sort((a, b) => String(b.publishedAt || b.date).localeCompare(String(a.publishedAt || a.date)));
}

function reviewDocsFor(user) {
  if (!user || !isStaff(user)) return [];
  const office = userOffice(user);
  const positionStep = "position:" + (user.positionId || "");
  return allDocs().filter((d) => {
    if (d.status !== "review" && d.status !== "congress") return false;
    // Голосування Конгресу: показуємо членам, які ще не голосували
    if (d.approverOffice === "congress") return isCongressMember(user) && !((d.votes || {})[user.login]);
    return d.approverOffice === office ||
      d.approverOffice === positionStep ||
      d.approverOffice === "user:" + user.login ||
      d.approverLogin === user.login;
  });
}

function approvalNewsFor(user) {
  return reviewDocsFor(user).map((doc) => ({
    id: "approval-" + doc.id,
    at: doc.updatedAt || doc.publishedAt || doc.date || new Date().toISOString(),
    title: "Надійшов документ на погодження",
    text: (doc.type || "Документ") + " · " + (doc.title || "Без назви"),
    href: pathTo("cabinet/inbox/"),
    docId: doc.id
  }));
}

function allAppeals() {
  return loadLS("state_appeals", []).sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)));
}

function appealNumber() {
  const year = new Date().getFullYear();
  const n = allAppeals().filter((a) => String(a.number || "").includes("-" + year + "-")).length + 1;
  return "ZV-" + year + "-" + String(n).padStart(4, "0");
}

function appealsForUser(user) {
  if (!user) return [];
  if (isCitizen(user)) return allAppeals().filter((a) => a.ownerLogin === user.login);
  if (isStaff(user)) return allAppeals().filter((a) => a.ownerLogin === user.login || a.office === userOffice(user) || canSeeAllAppeals(user));
  return [];
}

function canSeeAllAppeals(user) {
  return hasPermission(user, "manageAppeals") || hasPermission(user, "managePeople");
}

function citizenAppealsFor(user) {
  return allAppeals().filter((a) => a.ownerLogin === (user && user.login));
}

function officeAppealsFor(user) {
  if (!isStaff(user)) return [];
  return allAppeals().filter((a) => a.office === userOffice(user) || canSeeAllAppeals(user));
}

function saveAppeal(appeal, meta = {}) {
  const previous = allAppeals().find((a) => a.id === appeal.id);
  const now = new Date().toISOString();
  const actor = meta.user || currentUser();
  const next = Object.assign({}, previous || {}, appeal, {
    id: appeal.id || ("appeal-" + Date.now().toString(36)),
    number: appeal.number || (previous && previous.number) || appealNumber(),
    status: appeal.status || (previous && previous.status) || "waiting",
    createdAt: (previous && previous.createdAt) || appeal.createdAt || now,
    updatedAt: now
  });
  const thread = (previous && previous.thread) || appeal.thread || [];
  if (meta.message) {
    thread.push({
      at: now,
      by: actor && (actor.login || actor.id),
      byName: actorName(actor),
      text: String(meta.message || "").trim()
    });
  }
  next.thread = thread;
  const items = allAppeals().filter((a) => a.id !== next.id);
  items.push(next);
  saveLS("state_appeals", items);
  return next;
}

function appealStatusLabel(status) {
  return {
    waiting: "Очікує відповіді",
    answered: "Відповідь надана",
    closed: "Закрито"
  }[status] || status;
}

function pendingAppealsFor(user) {
  return officeAppealsFor(user).filter((a) => a.status === "waiting" && a.ownerLogin !== (user && user.login));
}

function allProfileRequests() {
  return loadLS("state_profile_requests", []).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

function pendingProfileRequests() {
  return allProfileRequests().filter((r) => r.status === "pending");
}

function profileRequestsForUser(user) {
  return allProfileRequests().filter((r) => r.login === (user && user.login));
}

function saveProfileRequest(request) {
  const now = new Date().toISOString();
  const row = Object.assign({}, request, {
    id: request.id || ("profile-" + Date.now().toString(36)),
    status: request.status || "pending",
    createdAt: request.createdAt || now,
    updatedAt: now
  });
  const items = allProfileRequests().filter((r) => r.id !== row.id);
  items.push(row);
  saveLS("state_profile_requests", items);
  return row;
}

function decideProfileRequest(id, admin, approved) {
  const request = allProfileRequests().find((r) => r.id === id);
  if (!request) return null;
  const user = allUsers().find((u) => u.login === request.login);
  const next = Object.assign({}, request, {
    status: approved ? "approved" : "rejected",
    decidedAt: new Date().toISOString(),
    decidedBy: admin && admin.login
  });
  saveProfileRequest(next);
  if (approved && user) {
    const patch = {
      name: request.name || user.name,
      photo: request.photo || user.photo,
      contact: request.contact || user.contact,
      statId: request.statId || user.statId,
      post: request.post || user.post
    };
    saveUser(Object.assign({}, user, patch));
    const current = currentUser();
    if (current && current.login === user.login) saveLS("state_session", Object.assign(current, patch, { username: patch.name }));
  }
  return next;
}

function formatDocWhen(doc) {
  const raw = doc.publishedAt || doc.date || "";
  if (/^\d{2}\.\d{2}\.\d{4}$/.test(raw)) return raw;
  const d = new Date(raw);
  if (!isNaN(d.getTime()) && String(raw).includes("T")) {
    const pad = (n) => String(n).padStart(2, "0");
    return pad(d.getDate()) + "." + pad(d.getMonth() + 1) + "." + d.getFullYear() +
      " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const [y, m, day] = raw.split("-");
    return day + "." + m + "." + y;
  }
  return raw;
}

const ACT_SECTIONS = [
  { key: "all", label: "Усі акти" },
  { key: "Конституція штату", label: "Конституція" },
  { key: "Кодекс", label: "Кодекси" },
  { key: "Закон", label: "Закони" },
  { key: "Наказ", label: "Накази" },
  { key: "Указ", label: "Укази" },
  { key: "Розпорядження", label: "Розпорядження" },
  { key: "Постанова", label: "Постанови" },
  { key: "Доручення", label: "Доручення" },
  { key: "Ордер", label: "Ордери" },
  { key: "Наказ Голови ВС", label: "Накази ВС" },
  { key: "Повістка", label: "Повістки" },
  { key: "Ухвала суду", label: "Ухвали" }
];

/* ---------- Типи документів, створені в адмін-панелі (state_doc_types) ----------
   { id, label: «Постанова», section: «Постанови» (розділ у законодавчій базі), offices: [апарати, порожньо — усі],
     title / subject / preamble / effective — тексти шаблону в редакторі, congress: іде через голосування Конгресу,
     showInBase: окремий розділ у законодавчій базі } */
function customDocTypes() {
  return loadLS("state_doc_types", []);
}

function isBuiltinDocType(label) {
  return ACT_SECTIONS.some((s) => s.key === label) || DOC_TYPES.includes(label) ||
    ["Наказ суду", "Статут органу"].includes(label);
}

function saveDocType(type) {
  const label = String(type.label || "").trim().slice(0, 60);
  if (!label) return { ok: false, error: "Вкажіть назву типу." };
  const items = customDocTypes();
  const id = type.id || uniqueId(slugId(label) || "type", items.map((t) => t.id));
  if (isBuiltinDocType(label) || items.some((t) => t.id !== id && t.label.toLowerCase() === label.toLowerCase())) {
    return { ok: false, error: "Тип «" + label + "» уже існує." };
  }
  const row = {
    id,
    label,
    section: String(type.section || "").trim().slice(0, 60) || label,
    offices: (type.offices || []).filter((o) => allOffices().some((x) => x.id === o)),
    title: String(type.title || "").trim().slice(0, 200) || label + " №{НОМЕР}",
    subject: String(type.subject || "").trim().slice(0, 300),
    preamble: String(type.preamble || "").trim().slice(0, 1000),
    effective: String(type.effective || "").trim().slice(0, 500),
    congress: !!type.congress,
    showInBase: type.showInBase !== false
  };
  const i = items.findIndex((t) => t.id === id);
  if (i >= 0) items[i] = row;
  else items.push(row);
  return saveLS("state_doc_types", items) ? { ok: true, type: row } : { ok: false, error: "Не вдалося зберегти тип." };
}

function deleteDocType(id) {
  return saveLS("state_doc_types", customDocTypes().filter((t) => t.id !== id));
}

function docTypeUsage(label) {
  return allDocs().filter((d) => d.type === label).length;
}

// Розділи законодавчої бази: вбудовані + створені адміністратором
function actSections() {
  const custom = customDocTypes()
    .filter((t) => t.showInBase !== false && !ACT_SECTIONS.some((s) => s.key === t.label))
    .map((t) => ({ key: t.label, label: t.section || t.label }));
  return ACT_SECTIONS.concat(custom);
}

function docsBySection(section) {
  const list = publicLegislativeDocs();
  if (!section || section === "all") return list;
  if (section === "Ордер") return list.filter((d) => /ордер/i.test(d.type));
  return list.filter((d) => d.type === section);
}

function getDoc(id) {
  return allDocs().find((d) => d.id === id) || null;
}

function actorName(user) {
  return (user && (user.username || user.name || user.login)) || "Система";
}

function docVersionLabel(doc) {
  return VERSION_LABELS[doc.status] || "Редакція";
}

function describeDocChange(prev, next) {
  if (!prev) return "Створено документ.";
  const changes = [];
  const fields = [
    ["type", "вид"],
    ["number", "номер"],
    ["date", "дату"],
    ["title", "назву"],
    ["status", "статус"],
    ["publishHome", "публікацію на головній"],
    ["office", "апарат"]
  ];
  fields.forEach(([key, label]) => {
    if (String(prev[key] == null ? "" : prev[key]) !== String(next[key] == null ? "" : next[key])) changes.push("змінено " + label);
  });
  if (String(prev.text || "") !== String(next.text || "") || String(prev.docHtml || "") !== String(next.docHtml || "")) {
    changes.push("оновлено текст A4-документа");
  }
  if (String(prev.approverOffice || "") !== String(next.approverOffice || "")) changes.push("змінено поточний крок погодження");
  return changes.length ? changes.join(", ") + "." : "Без змін.";
}

function makeDocVersion(doc, actor, label) {
  return {
    id: "ver-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 6),
    at: new Date().toISOString(),
    by: actor && (actor.login || actor.id),
    byName: actorName(actor),
    label: label || docVersionLabel(doc),
    status: doc.status || "draft",
    title: doc.title || "",
    number: doc.number || "",
    date: doc.date || "",
    text: doc.text || "",
    docHtml: doc.docHtml || ""
  };
}

function saveDoc(doc, meta = {}) {
  if ((doc.status === "ok" || doc.status === "dead") && !doc.publishedAt) doc.publishedAt = new Date().toISOString();
  // Крок «Конгрес» завжди має статус голосування, інші кроки — «На погодженні»
  if (doc.status === "review" || doc.status === "congress") doc.status = doc.approverOffice === "congress" ? "congress" : "review";
  const previous = getDoc(doc.id);
  const actor = meta.user || currentUser();
  const summary = meta.summary || describeDocChange(previous, doc);
  const action = meta.action || (previous ? "Оновлено" : "Створено");
  const next = Object.assign({}, doc);
  next.updatedAt = new Date().toISOString();
  const history = (previous && previous.history) || doc.history || [];
  const versions = (previous && previous.versions) || doc.versions || [];
  next.history = history.concat([{
    at: new Date().toISOString(),
    by: actor && (actor.login || actor.id),
    byName: actorName(actor),
    action,
    summary
  }]).slice(-80);
  const shouldVersion = meta.forceVersion || !previous || summary !== "Без змін.";
  next.versions = shouldVersion ? versions.concat([makeDocVersion(next, actor, meta.versionLabel)]).slice(-30) : versions;
  const extra = loadLS("state_docs", []);
  const i = extra.findIndex((d) => d.id === next.id);
  if (i >= 0) extra[i] = next;
  else extra.push(next);
  saveLS("state_docs", extra);
  return next;
}

function trashDoc(id, byUser) {
  const doc = getDoc(id);
  if (!doc) return null;
  return saveDoc(Object.assign({}, doc, {
    status: "trash",
    previousStatus: doc.status || "draft",
    trashedAt: new Date().toISOString(),
    trashedBy: byUser && byUser.login,
    seeded: false
  }), { user: byUser, action: "Перенесено в кошик", summary: "Документ перенесено в кошик.", versionLabel: "Архів" });
}

function restoreDoc(id, byUser) {
  const doc = getDoc(id);
  if (!doc) return null;
  return saveDoc(Object.assign({}, doc, {
    status: doc.previousStatus || "draft",
    trashedAt: "",
    trashedBy: "",
    seeded: false
  }), { user: byUser, action: "Відновлено", summary: "Документ відновлено з кошика." });
}

function deleteDoc(id) {
  const extra = loadLS("state_docs", []);
  const doc = getDoc(id);
  if (!doc) return false;
  const isSeedDoc = SEED_DOCS.some((seed) => seed.id === id);
  if (isSeedDoc) {
    saveDoc(Object.assign({}, doc, { status: "deleted", seeded: false, deletedAt: new Date().toISOString() }));
    return true;
  }
  saveLS("state_docs", extra.filter((d) => d.id !== id));
  return true;
}

/* ---------- Погодження ----------
   Документ іде кроками approvalSteps; поточний крок — approverOffice (approvalIndex).
   Крок "congress" — колегіальне голосування: статус "congress", рішення більшістю членів Конгресу.
   Кожне рішення пишеться в doc.approvals — з цього будується блок «Підписанти». */
function docSteps(doc) {
  return doc.approvalSteps || (doc.approverOffice ? [doc.approverOffice] : []);
}

function canApproveDoc(doc, user) {
  if (!doc || !user || (doc.status !== "review" && doc.status !== "congress")) return false;
  if (reviewDocsFor(user).some((d) => d.id === doc.id)) return true;
  // Адміністратор погоджує будь-який крок поза чергою; голос Конгресу — лише особисто
  return doc.status === "review" && hasPermission(user, "approveAnyDocs");
}

/* ---------- Права адміністратора над документами ---------- */
// Документи на погодженні, що чекають не цього користувача, але він може втрутитися
function overrideDocsFor(user) {
  if (!isStaff(user) || !hasPermission(user, "approveAnyDocs")) return [];
  const own = reviewDocsFor(user).map((d) => d.id);
  return allDocs().filter((d) => (d.status === "review" || d.status === "congress") && !own.includes(d.id));
}

function canReturnDoc(doc, user) {
  return canApproveDoc(doc, user) || !!(doc && user && doc.status === "congress" && hasPermission(user, "approveAnyDocs"));
}

function canForcePublish(doc, user) {
  if (!doc || !user || !hasPermission(user, "publishDocs")) return false;
  if (!["draft", "review", "congress", "adopted"].includes(doc.status)) return false;
  return doc.ownerLogin === user.login || hasPermission(user, "approveAnyDocs");
}

// Публікація одразу, без решти маршруту
function forcePublishDoc(id, user) {
  const doc = getDoc(id);
  if (!canForcePublish(doc, user)) return null;
  const now = new Date().toISOString();
  return saveDoc(Object.assign({}, doc, {
    status: "ok",
    approverOffice: "",
    approverLogin: "",
    approvals: (doc.approvals || []).concat([{ step: "admin", by: user.login, byName: actorName(user), post: user.post || "", at: now, decision: "approved" }]),
    approvedAt: now,
    approvedBy: user.login,
    publishedAt: doc.publishedAt || now,
    seeded: false
  }), { user, action: "Опубліковано адміністратором", summary: "Документ опубліковано без решти маршруту погодження.", versionLabel: "Чинна версія" });
}

function canManageDocs(user) {
  return ((user && user.roles) || [])[0] === "governor" || hasPermission(user, "manageDocs") || hasPermission(user, "editAllDocs");
}

// Чинний ↔ втратив чинність
function setDocValidity(id, user, active) {
  const doc = getDoc(id);
  if (!doc || !canManageDocs(user)) return null;
  if (active ? doc.status !== "dead" : doc.status !== "ok") return null;
  return saveDoc(Object.assign({}, doc, { status: active ? "ok" : "dead", seeded: false }), {
    user,
    action: active ? "Відновлено чинність" : "Втратив чинність",
    summary: active ? "Документ знову чинний." : "Документ переведено в архів як такий, що втратив чинність.",
    versionLabel: active ? "Чинна версія" : "Архів"
  });
}

function congressTally(doc) {
  const votes = (doc && doc.votes) || {};
  const members = congressMembers().length;
  const values = Object.keys(votes).map((k) => votes[k].vote);
  const pro = values.filter((v) => v === "for").length;
  const contra = values.filter((v) => v === "against").length;
  return { pro, contra, voted: values.length, members, needed: Math.floor(Math.max(members, 1) / 2) + 1 };
}

function advanceDoc(doc, user, meta) {
  const steps = docSteps(doc);
  const index = Number(doc.approvalIndex || 0);
  const now = new Date().toISOString();
  const approvals = (doc.approvals || []).concat([{
    step: steps[index] || doc.approverOffice || "",
    by: user && user.login,
    byName: meta.byName || actorName(user),
    post: meta.post != null ? meta.post : ((user && user.post) || ""),
    at: now,
    decision: "approved"
  }]);
  if (steps.length && index + 1 < steps.length) {
    const nextStep = steps[index + 1];
    return saveDoc(Object.assign({}, doc, {
      status: nextStep === "congress" ? "congress" : "review",
      approvalIndex: index + 1,
      approverOffice: nextStep,
      approverLogin: String(nextStep).startsWith("user:") ? String(nextStep).slice(5) : "",
      votes: {},
      approvals,
      lastApprovedAt: now,
      lastApprovedBy: user && user.login
    }), {
      user,
      action: meta.action || "Погоджено крок маршруту",
      summary: (meta.summaryPrefix || "Погоджено: " + routeStepName(steps[index], doc) + ".") + " Наступний крок: " + routeStepName(nextStep, doc) + ".",
      versionLabel: "Редакція"
    });
  }
  return saveDoc(Object.assign({}, doc, {
    status: "ok",
    approvalIndex: steps.length ? steps.length - 1 : 0,
    approverOffice: "",
    approverLogin: "",
    approvals,
    approvedAt: now,
    approvedBy: user && user.login,
    publishedAt: doc.publishedAt || now
  }), {
    user,
    action: "Опубліковано",
    summary: (meta.summaryPrefix ? meta.summaryPrefix + " " : "") + (steps.length ? "Фінальний крок погоджено, документ опубліковано." : "Документ погоджено й опубліковано."),
    versionLabel: "Чинна версія"
  });
}

function approveDoc(id, user) {
  const doc = getDoc(id);
  if (!doc || !canApproveDoc(doc, user)) return null;
  if (doc.approverOffice === "congress") return voteDoc(id, user, "for");
  const inQueue = reviewDocsFor(user).some((d) => d.id === doc.id);
  if (inQueue) return advanceDoc(doc, user, {});
  const step = docSteps(doc)[Number(doc.approvalIndex || 0)] || doc.approverOffice;
  return advanceDoc(doc, user, {
    action: "Погоджено адміністратором поза чергою",
    summaryPrefix: "Адміністратор погодив крок «" + routeStepName(step, doc) + "» поза чергою."
  });
}

function voteDoc(id, user, vote) {
  const doc = getDoc(id);
  if (!doc || !canApproveDoc(doc, user) || doc.approverOffice !== "congress") return null;
  // На сервері голос дописується до документа атомарно — одночасні голоси не затирають один одного
  const res = apiRequest("POST", "/api/vote", { id, vote: vote === "against" ? "against" : "for" });
  if (res.data && res.data.doc) mergeRemoteRows({ state_docs: [res.data.doc] });
  if (!res.ok) { alert(res.data.error || "Не вдалося зарахувати голос."); return null; }
  return congressOutcome(getDoc(id), user) || getDoc(id);
}

// Підсумок голосування: більшість «за» — документ іде далі шляхом, більшість «проти» — відхилено; інакше null
function congressOutcome(next, user) {
  if (!next || next.approverOffice !== "congress") return null;
  const t = congressTally(next);
  if (t.pro >= t.needed) {
    return advanceDoc(next, user, {
      byName: "Конгрес штату",
      post: "За — " + t.pro + ", проти — " + t.contra + " з " + t.members,
      action: "Конгрес підтримав документ",
      summaryPrefix: "Конгрес проголосував «за» (" + t.pro + " з " + t.members + ")."
    });
  }
  if (t.contra >= t.needed) {
    return saveDoc(Object.assign({}, next, {
      status: "rejected",
      approverOffice: "",
      approverLogin: "",
      rejectedAt: new Date().toISOString(),
      rejectedReason: "Конгрес проголосував проти (" + t.contra + " з " + t.members + ").",
      approvals: (next.approvals || []).concat([{ step: "congress", byName: "Конгрес штату", post: "За — " + t.pro + ", проти — " + t.contra, at: new Date().toISOString(), decision: "rejected" }])
    }), { user, action: "Конгрес відхилив документ", summary: "Більшість членів Конгресу проголосувала проти.", versionLabel: "Відхилено" });
  }
  return null;
}

function returnDoc(id, user, reason) {
  const doc = getDoc(id);
  if (!doc || !canReturnDoc(doc, user)) return null;
  const now = new Date().toISOString();
  const text = String(reason || "").trim();
  return saveDoc(Object.assign({}, doc, {
    status: "draft",
    returnedAt: now,
    returnedBy: user.login,
    returnedByName: actorName(user),
    returnedReason: text,
    approverOffice: "",
    approverLogin: "",
    approvalIndex: 0,
    votes: {},
    approvals: (doc.approvals || []).concat([{ step: doc.approverOffice || "", by: user.login, byName: actorName(user), post: user.post || "", at: now, decision: "returned", comment: text }])
  }), {
    user,
    action: "Повернено на доопрацювання",
    summary: "Документ повернено автору" + (text ? ": " + text : "."),
    versionLabel: "Проєкт"
  });
}

/* Сповіщення кабінету: що чекає дії користувача і що сталося з його документами та зверненнями */
function notificationsFor(user) {
  if (!user) return [];
  const items = [];
  const weekAgo = Date.now() - 7 * 24 * 3600 * 1000;
  const recent = (iso) => iso && new Date(iso).getTime() > weekAgo;
  if (isStaff(user)) {
    reviewDocsFor(user).forEach((doc) => items.push({
      kind: doc.approverOffice === "congress" ? "vote" : "approve",
      attention: true,
      at: doc.updatedAt || doc.publishedAt || doc.date,
      title: doc.approverOffice === "congress" ? "Голосування Конгресу" : "Потрібне ваше погодження",
      text: (doc.type || "Документ") + " · " + (doc.title || "Без назви"),
      doc
    }));
    allDocs().filter((d) => d.ownerLogin === user.login).forEach((doc) => {
      if (doc.status === "draft" && doc.returnedAt && recent(doc.returnedAt)) items.push({ kind: "returned", attention: true, at: doc.returnedAt, title: "Документ повернено на доопрацювання", text: (doc.title || "") + (doc.returnedReason ? " — " + doc.returnedReason : ""), doc });
      else if (doc.status === "rejected" && recent(doc.rejectedAt || doc.updatedAt)) items.push({ kind: "rejected", attention: true, at: doc.rejectedAt || doc.updatedAt, title: "Документ відхилено", text: (doc.title || "") + (doc.rejectedReason ? " — " + doc.rejectedReason : ""), doc });
      else if (doc.status === "ok" && doc.approvedAt && recent(doc.approvedAt)) items.push({ kind: "published", at: doc.approvedAt, title: "Документ погоджено й опубліковано", text: doc.title || "", doc });
      else if (doc.status === "review" || doc.status === "congress") items.push({ kind: "progress", at: doc.updatedAt, title: "Ваш документ на погодженні", text: (doc.title || "") + " · " + routeProgressLabel(doc), doc });
    });
    pendingAppealsFor(user).forEach((a) => items.push({ kind: "appeal", attention: true, at: a.updatedAt || a.createdAt, title: "Нове звернення до апарату", text: a.number + " · " + (a.name || "") , appeal: a }));
    if (hasPermission(user, "approveProfiles") || hasPermission(user, "managePeople")) {
      const n = pendingProfileRequests().length;
      if (n) items.push({ kind: "profile", attention: true, at: new Date().toISOString(), title: "Заявки на зміну профілю", text: "Очікують підтвердження: " + n });
      const pend = allUsers().filter((u) => (u.roles || []).includes("pending")).length;
      if (pend) items.push({ kind: "people", attention: true, at: new Date().toISOString(), title: "Нові учасники без ролі", text: "Очікують призначення: " + pend });
    }
  }
  citizenAppealsFor(user).filter((a) => a.status === "answered").forEach((a) => items.push({ kind: "answer", attention: true, at: a.updatedAt, title: "Відповідь на звернення", text: a.number + " · " + officeName(a.office), appeal: a }));
  return items.sort((a, b) => (b.attention ? 1 : 0) - (a.attention ? 1 : 0) || String(b.at || "").localeCompare(String(a.at || "")));
}

function newDocId() {
  return "act-" + Date.now().toString(36);
}

function roleLabel(code) {
  return ROLE_LABELS[code] || code;
}

function badgeClass(status) {
  return status === "ok" || status === "adopted" ? "ok" : status === "draft" || status === "review" || status === "congress" ? "draft" : "dead";
}

function docHref(doc) {
  return pathTo("acts/view/?id=" + encodeURIComponent(doc.id));
}

function officeName(code) {
  const custom = allOffices().find((o) => o.id === code);
  return (custom && custom.name) || OFFICE_NAMES[code] || code || "—";
}

/* ---------- Пошук ----------
   Шукаємо за назвою, номером, видом, органом, автором і повним текстом документа.
   Кілька слів — документ має містити всі; у результатах показуємо уривок тексту з виділеним збігом. */
function docSearchText(d) {
  return [d.title, d.number, d.type, d.body, d.author, d.text].map((x) => String(x || "")).join(" ").toLowerCase();
}
function searchWords(q) {
  return String(q || "").toLowerCase().split(/\s+/).filter(Boolean);
}
function docMatches(d, q) {
  const words = searchWords(q);
  if (!words.length) return true;
  const hay = docSearchText(d);
  return words.every((w) => hay.includes(w));
}
// Уривок тексту довкола першого збігу: текст екранований, збіги — у <mark>
function searchSnippet(d, q) {
  const words = searchWords(q);
  const text = String(d.text || "").replace(/\s+/g, " ");
  const lower = text.toLowerCase();
  const first = words.map((w) => lower.indexOf(w)).filter((i) => i >= 0).sort((a, b) => a - b)[0];
  if (first === undefined) return "";
  const from = Math.max(0, first - 70), to = Math.min(text.length, first + 130);
  let html = "", i = from;
  while (i < to) {
    // Найближчий збіг будь-якого слова, починаючи з позиції i
    let at = -1, len = 0;
    words.forEach((w) => { const p = lower.indexOf(w, i); if (p >= 0 && p < to && (at < 0 || p < at)) { at = p; len = w.length; } });
    if (at < 0) { html += esc(text.slice(i, to)); break; }
    html += esc(text.slice(i, at)) + "<mark>" + esc(text.slice(at, Math.min(at + len, to))) + "</mark>";
    i = at + len;
  }
  return (from ? "…" : "") + html + (to < text.length ? "…" : "");
}

function renderActList(targetId, query = "") {
  const root = document.getElementById(targetId);
  if (!root) return;
  const params = new URLSearchParams(location.search);
  const q = (query || params.get("q") || "").trim().toLowerCase();
  const section = params.get("type") || "all";
  const office = params.get("office") || "all";
  const sort = params.get("sort") || "date-desc";
  let items = docsBySection(section).filter((a) => docMatches(a, q));
  if (office !== "all") items = items.filter((a) => (a.office || "") === office);
  items.sort((a, b) => {
    if (sort === "date-asc") return String(a.publishedAt || a.date).localeCompare(String(b.publishedAt || b.date));
    if (sort === "title") return String(a.title).localeCompare(String(b.title), "uk");
    if (sort === "office") return String(officeName(a.office) + a.title).localeCompare(officeName(b.office) + b.title, "uk");
    if (sort === "type") return String(a.type + a.title).localeCompare(b.type + b.title, "uk");
    return String(b.publishedAt || b.date).localeCompare(String(a.publishedAt || a.date));
  });
  const counter = document.getElementById("acts-count");
  if (counter) counter.textContent = "Знайдено: " + items.length;
  if (!items.length) {
    root.innerHTML = "<p class='empty-note muted'>Документів за цими умовами не знайдено.</p>";
    return;
  }
  root.innerHTML = items.map((a) => `
    <article class="act-row">
      <div class="act-num">${esc(a.number)}<br>${esc(formatDocWhen(a))}</div>
      <div>
        <h3><a href="${attr(docHref(a))}">${esc(a.title)}</a></h3>
        <div class="act-meta">${esc(a.type)} · ${esc(officeName(a.office) !== "—" ? officeName(a.office) : (a.body || ""))}</div>
        ${q && searchSnippet(a, q) ? `<p class="search-snippet">${searchSnippet(a, q)}</p>` : ""}
      </div>
      <span class="badge ${attr(badgeClass(a.status))}">${esc(DOC_STATUSES[a.status] || a.status)}</span>
    </article>
  `).join("");
}
