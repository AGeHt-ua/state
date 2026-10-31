/* Кабінет СБУ «Сова» — сайт. Своєї бази не має: усі дані бере з бота через API. */
(function () {
"use strict";

const DEFAULT_API = "https://sova.d-f-12339.workers.dev";
const qs = new URLSearchParams(location.search);
const API = (qs.get("api") || DEFAULT_API).replace(/\/$/, "");
const KEY = "sova-token";

const store = {
  get() { try { return localStorage.getItem(KEY); } catch (e) { return null; } },
  set(v) { try { v ? localStorage.setItem(KEY, v) : localStorage.removeItem(KEY); } catch (e) {} },
};

let TOKEN = store.get();
let META = null, ME = null;
const UI = { view: "home", tabs: {}, rapType: "promo", busy: false };

/* ---------------- утиліти ---------------- */
const $ = (s) => document.querySelector(s);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtDT = (t) => t ? new Date(t).toLocaleString("uk-UA", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";
const localInput = (t) => new Date(t - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 16);
const tab = (k, d) => UI.tabs[k] || d;
const deptTag = (d) => META && META.depts[d] ? `<span class="dtag" style="--c:${META.depts[d].color}">${esc(META.depts[d].s)}</span>` : "";
const who = (u) => u ? `${esc(u.name)} <span class="muted small">№${u.sid}</span>` : "—";

function toast(msg, bad) {
  const d = document.createElement("div");
  d.textContent = msg;
  if (bad) d.className = "bad";
  $("#toast").appendChild(d);
  setTimeout(() => d.remove(), 4000);
}

async function call(path, opts = {}) {
  const headers = Object.assign({}, opts.headers);
  if (TOKEN) headers.Authorization = "Bearer " + TOKEN;
  let body = opts.body;
  if (opts.json !== undefined) { headers["Content-Type"] = "application/json"; body = JSON.stringify(opts.json); }
  let r;
  try {
    r = await fetch(API + path, { method: opts.method || (body ? "POST" : "GET"), headers, body });
  } catch (e) {
    throw new Error("Немає зв'язку з ботом «Сова». Перевірте інтернет або спробуйте за хвилину.");
  }
  let data = null;
  try { data = await r.json(); } catch (e) {}
  if (r.status === 401 && path !== "/api/login") { logout(true); throw new Error("Сесія завершилась. Увійдіть знову."); }
  if (!r.ok) throw new Error((data && data.error) || `Помилка ${r.status}`);
  return data;
}

/* ---------------- вхід ---------------- */
function viewLogin(err) {
  return `<div class="login"><div class="login-card">
    <img src="sbu-logo.webp" alt="Емблема Служби безпеки штату NG" width="140" height="140">
    <h1>СЛУЖБА БЕЗПЕКИ ШТАТУ NG</h1>
    <p class="sub">Єдина інформаційна система «СОВА» · вхід для особового складу</p>
    <form data-f="login" autocomplete="on">
      <label class="f"><span>Static ID (номер жетона)</span><input class="i mono" id="lg-id" name="username" inputmode="numeric" autocomplete="username" required></label>
      <label class="f"><span>Код доступу</span><input class="i" id="lg-pw" name="password" type="password" autocomplete="current-password" required></label>
      ${err ? `<p class="err">${esc(err)}</p>` : ""}
      <button class="btn gold" type="submit" id="lg-btn">Увійти до системи</button>
    </form>
    <p class="botstate" id="botstate"><span class="spin"></span> Перевіряю зв'язок з ботом…</p>
    <p class="fine">Немає допуску? На сервері «Служба Безпеки NG» натисніть <b>«Отримати допуск»</b>; після підтвердження ВКПП код доступу надійде в особисті.
      Вхід лише для складу СБУ; звання й підрозділ підтягуються автоматично.</p>
  </div></div>`;
}

async function checkBot() {
  const el = $("#botstate");
  if (!el) return;
  try {
    const h = await call("/api/health");
    el.className = "botstate " + (h.discord ? "ok" : "bad");
    el.textContent = h.discord ? "● Бот «Сова» на зв'язку" : "● Бот працює, але не під'єднаний до Discord";
  } catch (e) {
    el.className = "botstate bad";
    el.textContent = "● " + e.message;
  }
}

async function doLogin() {
  const btn = $("#lg-btn");
  btn.disabled = true;
  btn.innerHTML = '<span class="spin"></span> Перевірка ролей у Discord…';
  try {
    const r = await call("/api/login", { json: { sid: $("#lg-id").value.trim(), password: $("#lg-pw").value } });
    TOKEN = r.token;
    store.set(TOKEN);
    if (r.multi) toast("У вас кілька ролей відділів — вхід до першого.");
    await boot();
  } catch (e) {
    render(e.message);
  }
}

function logout(silent) {
  if (TOKEN && !silent) call("/api/logout", { method: "POST" }).catch(() => {});
  TOKEN = null;
  ME = null;
  store.set(null);
  render();
}

/* ---------------- оболонка ---------------- */
const IC = {
  home: '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  act: '<path d="M4 19V5m0 14h16M8 15l4-4 3 3 5-6"/>',
  rap: '<path d="M7 3h8l4 4v14H7zM15 3v4h4M10 12h6M10 16h6"/>',
  staff: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c.6-3.4 3-5.4 6-5.4s5.4 2 6 5.4M16 4.5a3 3 0 0 1 0 6M21 19c-.4-2.4-1.7-4-3.6-4.7"/>',
  audit: '<path d="M5 4h14v16H5zM9 8h6M9 12h6M9 16h3"/>',
  hr: '<circle cx="10" cy="8" r="3.4"/><path d="M3.5 20c.7-3.6 3.3-5.6 6.5-5.6 1.6 0 3 .5 4.1 1.4M15 18l2 2 4-4.5"/>',
  soon: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3 2"/>',
};
const ico = (k) => `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">${IC[k] || IC.soon}</svg>`;
const NAV = [
  ["home", "Головна", () => true],
  ["act", "Моя активність", () => true],
  ["rap", "Рапорти", () => true],
  ["staff", "Особовий склад", (u) => u.rank >= 8],
  ["hr", "Кадри", () => !!(ME.hr && (ME.hr.vvb || ME.hr.vkpp))],
  ["audit", "Кадровий аудит", (u) => u.rank >= 12 || !!(ME.hr && ME.hr.vkpp)],
];
const SOON = ["Кейс-файли", "Запити між відділами", "Розділ відділу", "Дисципліна", "Премії"];
const TITLES = { home: "Службовий кабінет", act: "Звіти про діяльність", rap: "Рапорти", staff: "Особовий склад", audit: "Кадровий аудит", hr: "Кадри: кандидати й допуски" };

function viewShell(inner) {
  const p = ME.pending || {};
  const badge = { act: p.acts, rap: p.raps, hr: p.hr };
  const c = META.depts[ME.me.dept].color;
  return `<div class="shell" style="--dept:${c}">
  <aside class="side">
    <div class="brand"><img src="sbu-logo.webp" alt="" width="46" height="46"><div><b>СОВА</b><span>ЄІС Служби безпеки штату NG</span></div></div>
    <div class="me"><span class="dp">${esc(ME.me.deptName)}</span><span class="nm">${esc(ME.me.name)}</span><span class="rk">${esc(ME.me.rankName)}</span>
      <div class="meta"><span>${esc(META.depts[ME.me.dept].s)}</span><span>№${ME.me.sid}</span></div></div>
    <nav class="nav">
      ${NAV.filter((n) => n[2](ME.me)).map(([k, l]) => `<button data-a="nav" data-v="${k}" class="${UI.view === k ? "on" : ""}">${ico(k)}<span>${l}</span>${badge[k] ? `<span class="cnt">${badge[k]}</span>` : ""}</button>`).join("")}
      <div class="sec">У розробці</div>
      ${SOON.map((l) => `<button class="soon" disabled>${ico("soon")}<span>${l}</span></button>`).join("")}
    </nav>
    <div class="side-foot"><button data-a="logout">Вийти із системи</button></div>
  </aside>
  <main class="main" style="--vc:${c}">
    <header class="top"><div><div class="crumbs">СБУ / ${esc(META.depts[ME.me.dept].s)} / ${esc(TITLES[UI.view])}</div><h2>${esc(TITLES[UI.view])}</h2></div>
      <div class="right"><span class="dbadge">${esc(META.depts[ME.me.dept].s)}</span><button class="btn sm" data-a="logout">Вийти</button></div></header>
    <section class="view" id="view">${inner}</section>
  </main></div>`;
}

const tabsBar = (key, items, def, extra) => `<div class="tabs">${items.map(([v, l, n]) => `<button class="tb ${tab(key, def) === v ? "on" : ""}" data-a="tab" data-k="${key}" data-v="${v}">${l}${n !== undefined ? `<span class="cnt">${n}</span>` : ""}</button>`).join("")}${extra || ""}</div>`;
const loading = '<div class="empty"><span class="spin"></span> Завантаження…</div>';
const stChip = (s) => s === "ok" ? '<span class="chip ok">Підтверджено</span>' : s === "wait" ? '<span class="chip wait">На розгляді</span>' : '<span class="chip bad">Відхилено</span>';

/* ---------------- головна ---------------- */
async function vHome() {
  const acts = await call("/api/acts");
  const pc = ME.promo;
  const pend = ME.pending || {};
  return `
  <div class="tiles">
    <div class="tile accent"><span class="k">Бали за цей тиждень</span><span class="v num">${ME.points}</span><span class="s">Минулий тиждень: ${ME.pointsPrev}</span></div>
    <div class="tile"><span class="k">Звітів на перевірці</span><span class="v num">${acts.filter((a) => a.status === "wait").length}</span><span class="s">Очікують керівника</span></div>
    <div class="tile"><span class="k">Підтверджено всього</span><span class="v num">${acts.filter((a) => a.status === "ok").length}</span><span class="s">За весь час</span></div>
    <div class="tile"><span class="k">На званні з</span><span class="v num" style="font-size:20px">${fmtDT(ME.me.since)}</span><span class="s">${esc(ME.me.rankName)}</span></div>
  </div>
  ${pend.acts || pend.raps ? `<div class="card"><header><h3>Потребує вашого рішення</h3></header><div class="acts">
    ${pend.acts ? `<button class="btn" data-a="go" data-v="act" data-tab="review">Звіти на перевірку: <b class="num">${pend.acts}</b></button>` : ""}
    ${pend.raps ? `<button class="btn" data-a="go" data-v="rap" data-tab="review">Рапорти на розгляд: <b class="num">${pend.raps}</b></button>` : ""}
  </div></div>` : ""}
  <div class="grid2">
    <div class="card"><header><h3>Службовий профіль</h3></header>
      <dl class="kv">
        <dt>Звання</dt><dd>${esc(ME.me.rankName)} <span class="muted">(${ME.me.rank} з 15)</span></dd>
        <dt>Підрозділ</dt><dd>${deptTag(ME.me.dept)} ${esc(ME.me.deptName)}</dd>
        <dt>Жетон</dt><dd class="mono">№${ME.me.sid}</dd>
      </dl>
      <div class="do-line"><code>/do На спорядженні закріплений номерний жетон СБУ ${esc(META.depts[ME.me.dept].s)} №${ME.me.sid}.</code></div>
    </div>
    <div class="card"><header><h3>До наступного звання</h3>${pc ? `<span class="sp chip ${pc.eligible ? "ok" : "wait"}">${pc.eligible ? "Можна подати рапорт" : "Умови не виконано"}</span>` : ""}</header>
      ${pc ? `<div><span class="eyebrow">${esc(ME.me.rankName)} → ${esc(pc.name)}</span></div>
        ${pc.items[0] && pc.items[0].pct !== undefined ? `<div class="bar ${pc.items[0].ok ? "ok" : ""}"><i style="width:${Math.round(pc.items[0].pct * 100)}%"></i></div>` : ""}
        <ul class="checklist">${pc.items.map((i) => `<li class="${i.ok ? "" : i.soft ? "soft" : "no"}">${esc(i.t)}</li>`).join("")}</ul>
        <div><button class="btn ${pc.eligible ? "gold" : ""}" data-a="go" data-v="rap" data-tab="new" ${pc.eligible ? "" : "disabled"}>Подати рапорт на підвищення</button></div>`
      : '<p class="muted">Найвище звання у відомстві.</p>'}
    </div>
  </div>
  <div class="card"><header><h3>Останні звіти</h3><button class="sp btn sm" data-a="go" data-v="act" data-tab="new">+ Новий звіт</button></header>
    ${acts.length ? actTable(acts.slice(0, 8), false) : '<div class="empty">Звітів ще немає. Додайте перший після зміни.</div>'}
  </div>`;
}

/* ---------------- звіти ---------------- */
function actTable(list, review) {
  return `<div class="tbl-wrap"><table class="t"><thead><tr>${review ? "<th>Співробітник</th>" : ""}<th>Дія</th><th>Коли</th><th>Статті</th><th>Доказ</th><th class="r">Статус</th></tr></thead><tbody>
  ${list.map((a) => `<tr>${review ? `<td>${who(a.by)}<div>${deptTag(a.dept)}</div></td>` : ""}
    <td>${esc(META.acts[a.type] ? META.acts[a.type].n : a.type)}${a.qty > 1 ? ` ×${a.qty}` : ""}${a.subj ? `<div class="muted small">${esc(a.subj)}</div>` : ""}${a.note ? `<div class="muted small">${esc(a.note)}</div>` : ""}</td>
    <td class="num muted">${fmtDT(a.t)}</td>
    <td>${a.arts.length ? `<div class="art-list">${a.arts.map((n) => `<span class="art">${esc(n)}</span>`).join("")}</div>` : '<span class="muted">—</span>'}</td>
    <td><div class="files">${a.evidence ? `<a href="${esc(a.evidence)}" target="_blank" rel="noopener">відкат</a>` : ""}${a.files.map((f, i) => `<button class="btn sm" data-a="file" data-id="${esc(f)}" style="padding:2px 8px">файл ${i + 1}</button>`).join("")}</div></td>
    <td class="r">${review ? `<div class="acts" style="justify-content:flex-end"><button class="btn sm ok" data-a="actd" data-id="${a.id}" data-d="ok">Підтвердити</button><button class="btn sm bad" data-a="actd" data-id="${a.id}" data-d="rej">Відхилити</button></div>` : stChip(a.status) + (a.reviewer ? `<div class="muted small">${esc(a.reviewer.name)}</div>` : "")}</td></tr>`).join("")}
  </tbody></table></div>`;
}

async function vAct() {
  const canRev = ME.me.rank >= 8;
  const t = tab("act", "mine");
  const head = tabsBar("act", [["mine", "Мої звіти"], ["new", "Новий звіт"], ...(canRev ? [["review", "На перевірку", ME.pending.acts || 0]] : [])], "mine");
  if (t === "new") {
    const allowed = ME.allowedActs.map((k) => [k, META.acts[k]]);
    return head + `<div class="card"><header><h3>Звіт про виконану дію</h3><span class="sp">${deptTag(ME.me.dept)}</span></header>
      ${ME.me.rank === 1 ? '<p class="note warn">Стажер не проводить затримань самостійно (Положення про стажування, р. IV). Доступні патруль з наставником і навчання.</p>' : ""}
      <form data-f="act" class="form-grid">
        <label class="f"><span>Тип дії</span><select class="i" id="a-type">${allowed.map(([k, a]) => `<option value="${k}">${esc(a.n)} · ${a.p} б.</option>`).join("")}</select></label>
        <label class="f"><span>Дата і час</span><input class="i" id="a-t" type="datetime-local" value="${localInput(Date.now())}"></label>
        <label class="f"><span>Кількість (патруль — блоків по 30 хв)</span><input class="i" id="a-qty" type="number" min="1" max="12" value="1"></label>
        <label class="f"><span>Статті КК (через кому)</span><input class="i mono" id="a-arts" placeholder="напр. 263, 342"></label>
        <label class="f"><span>Фігурант</span><input class="i" id="a-subj" placeholder="ім'я або «невстановлена особа»"></label>
        <label class="f"><span>Доказ: посилання на відкат</span><input class="i" id="a-ev" placeholder="https://..."></label>
        <label class="f wide"><span>Скріни (до 5 файлів, зберігаються в Discord)</span><input class="i" id="a-files" type="file" accept="image/*,video/mp4,application/pdf" multiple></label>
        <label class="f wide"><span>Коментар</span><textarea class="i" id="a-note" placeholder="Що сталося, хто був у наряді"></textarea></label>
        <div class="wide"><button class="btn gold" type="submit" id="a-btn">Надіслати на перевірку</button>
          <span class="muted small" style="margin-left:8px">Звіт з'явиться в каналі вашого відділу в Discord. Бали — після підтвердження.</span></div>
      </form></div>`;
  }
  const list = await call("/api/acts" + (t === "review" ? "?scope=review" : ""));
  return head + `<div class="card">${list.length ? actTable(list, t === "review") : `<div class="empty">${t === "review" ? "Немає звітів, що очікують перевірки." : "Звітів ще немає."}</div>`}</div>`;
}

async function uploadFiles(input) {
  const ids = [];
  for (const f of [...input.files].slice(0, 5)) {
    const fd = new FormData();
    fd.append("file", f, f.name);
    const r = await call("/api/files", { method: "POST", body: fd });
    ids.push(r.id);
  }
  return ids;
}

/* ---------------- рапорти ---------------- */
function rapDesc(r) {
  const d = r.data || {};
  if (r.type === "promo") return `→ <b>${esc(META.ranks[d.to - 1] ? META.ranks[d.to - 1].n : d.to)}</b>`;
  if (r.type === "vac") return `${d.days} діб${d.from ? " з " + esc(d.from) : ""}${d.reason ? " · " + esc(d.reason) : ""}`;
  if (r.type === "transfer") return `${deptTag(r.dept)} → ${deptTag(d.to)}${d.reason ? " · " + esc(d.reason) : ""}`;
  return esc(d.reason || "");
}

async function vRap() {
  const canRev = ME.me.rank >= 13 || !!(ME.hr && ME.hr.vkpp);
  const t = tab("rap", "mine");
  const head = tabsBar("rap", [["mine", "Мої рапорти"], ["new", "Подати рапорт"], ...(canRev ? [["review", "На розгляд", ME.pending.raps || 0]] : [])], "mine");
  if (t === "new") return head + rapForm();
  const list = await call("/api/raps" + (t === "review" ? "?scope=review" : ""));
  if (!list.length) return head + `<div class="empty">${t === "review" ? "Немає рапортів на розгляд." : "Ви ще не подавали рапортів."}</div>`;
  return head + `<div class="card"><div class="tbl-wrap"><table class="t"><thead><tr>${t === "review" ? "<th>Співробітник</th>" : ""}<th>Рапорт</th><th>Зміст</th><th>Подано</th><th class="r">Рішення</th></tr></thead><tbody>
    ${list.map((r) => `<tr>${t === "review" ? `<td>${who(r.by)}<div>${deptTag(r.dept)}</div></td>` : ""}<td>${esc(META.rapTypes[r.type])}</td><td>${rapDesc(r)}</td><td class="muted num">${fmtDT(r.t)}</td>
      <td class="r">${t === "review" ? `<div class="acts" style="justify-content:flex-end"><button class="btn sm ok" data-a="rapd" data-id="${r.id}" data-d="ok">Погодити</button><button class="btn sm bad" data-a="rapd" data-id="${r.id}" data-d="rej">Відмовити</button></div>`
        : (r.status === "ok" ? '<span class="chip ok">Погоджено</span>' : r.status === "rej" ? '<span class="chip bad">Відмовлено</span>' : '<span class="chip wait">На розгляді</span>') + (r.reviewer ? `<div class="muted small">${esc(r.reviewer.name)}</div>` : "")}</td></tr>`).join("")}
  </tbody></table></div></div>`;
}

function rapForm() {
  const t = UI.rapType;
  let body = "", ok = true;
  if (t === "promo") {
    const pc = ME.promo;
    ok = !!(pc && pc.eligible);
    body = pc ? `<div><span class="eyebrow">${esc(ME.me.rankName)} → ${esc(pc.name)}</span></div><ul class="checklist">${pc.items.map((i) => `<li class="${i.ok ? "" : i.soft ? "soft" : "no"}">${esc(i.t)}</li>`).join("")}</ul>
      <p class="muted small" style="margin:0">До рапорту автоматично додаються бали за цей і минулий тиждень. Після погодження бот змінить роль звання в Discord.</p>` : '<p class="muted">Найвище звання.</p>';
  } else if (t === "vac") {
    body = `<div class="form-grid"><label class="f"><span>З дати</span><input class="i" type="date" id="r-from" value="${new Date().toISOString().slice(0, 10)}"></label>
      <label class="f"><span>Кількість діб (до 7, ст. 19 ТК)</span><input class="i" type="number" id="r-days" min="1" max="7" value="3"></label>
      <label class="f wide"><span>Причина</span><input class="i" id="r-reason"></label></div>
      <p class="note">На час відпустки здати посвідчення, табельну зброю та спецзасоби.</p>`;
  } else if (t === "dismiss") {
    body = `<label class="f"><span>Мотивований рапорт на ім'я Голови СБУ</span><textarea class="i" id="r-reason" placeholder="Прошу звільнити мене за власним бажанням..."></textarea></label>
      <p class="note warn">Після звільнення бот зніме ролі СБУ. Здайте жетон, посвідчення, зброю та спорядження (п. 5.3 Регламенту).</p>`;
  } else if (t === "transfer") {
    const opts = META.opsDepts.filter((k) => k !== ME.me.dept);
    body = `<div class="form-grid"><label class="f"><span>До відділу</span><select class="i" id="r-to">${opts.map((k) => `<option value="${k}">${esc(META.depts[k].n)}</option>`).join("")}</select></label>
      <label class="f wide"><span>Обґрунтування</span><input class="i" id="r-reason"></label></div>
      <p class="note">Погоджує керівництво СБУ. Бот замінить роль відділу в Discord.</p>`;
  }
  return `<div class="card"><header><h3>Новий рапорт</h3></header><form data-f="rap" style="display:grid;gap:14px">
    <label class="f" style="max-width:420px"><span>Тип рапорту</span><select class="i" id="r-type" data-change="raptype">${Object.entries(META.rapTypes).map(([k, n]) => `<option value="${k}" ${k === t ? "selected" : ""}>${esc(n)}</option>`).join("")}</select></label>
    ${body}<div><button class="btn gold" type="submit" id="r-btn" ${ok ? "" : "disabled"}>Подати рапорт</button></div></form></div>`;
}

/* ---------------- склад і аудит ---------------- */
async function vStaff() {
  const list = await call("/api/staff");
  return `${ME.me.dept !== "lead" ? `<p class="note">Особовий склад вашого відділу: ${esc(ME.me.deptName)}.</p>` : ""}
  <div class="card"><div class="tbl-wrap"><table class="t"><thead><tr><th>№</th><th>Співробітник</th><th>Звання</th><th>Відділ</th><th>На званні з</th><th class="r">Бали тиж.</th><th>Статус</th></tr></thead><tbody>
  ${list.map((p) => `<tr><td class="mono">${p.sid}</td><td>${esc(p.name)}</td><td>${esc(p.rankName)}</td><td>${deptTag(p.dept)}</td><td class="num muted">${fmtDT(p.since)}</td><td class="r num mono">${p.points}</td>
    <td>${p.status === "vacation" ? '<span class="chip info">Відпустка</span>' : '<span class="chip ok">На службі</span>'}</td></tr>`).join("") || '<tr><td colspan="7" class="muted">Нікого немає.</td></tr>'}
  </tbody></table></div></div>`;
}

async function vAudit() {
  const list = await call("/api/audit");
  return `<div class="card"><header><h3>Журнал кадрового аудиту</h3><span class="sp muted small">Дублюється в канал «кадровий-аудит» у Discord</span></header>
  <div class="tbl-wrap"><table class="t"><thead><tr><th>Коли</th><th>Хто</th><th>Дія</th><th>Співробітник</th><th>Деталі</th></tr></thead><tbody>
  ${list.map((a) => `<tr><td class="num muted">${fmtDT(a.t)}</td><td>${a.actorUser ? esc(a.actorUser.name) : '<span class="tag">бот</span>'}</td><td>${esc(a.action)}</td><td>${a.targetUser ? esc(a.targetUser.name) : "№" + a.target}</td><td>${esc(a.details)}</td></tr>`).join("") || '<tr><td colspan="5" class="muted">Записів ще немає.</td></tr>'}
  </tbody></table></div></div>`;
}

/* ---------------- кадри: анкети кандидатів (ВВБ → ВКПП) і заявки на допуск ---------------- */
const CST = { vvb: ["chip wait", "Перевірка ВВБ"], vkpp: ["chip wait", "Очікує ВКПП"], ok: ["chip ok", "Погоджено · зв'язатись"], rej: ["chip bad", "Відмовлено"] };
const candChip = (c) => `<span class="${CST[c.status][0]}">${CST[c.status][1]}</span>`;
const docNo = (p, n) => `${p}-${String(n).padStart(4, "0")}`;

const CDOCS = { passport: "Паспорт", med: "Медична карта", military: "Військовий квиток", idcard: "Посвідчення особи" };
const CDRIVE = { A: "A", B: "B", CD: "C/D", water: "водний", air: "повітряний" };
const CLICS = { weapon: "на зброю", hunt: "на полювання", fish: "на рибальство" };
const CHOUSE = { none: "немає", flat: "квартира", house: "будинок", rent: "орендоване" };
function candExtra(x) {
  const docs = ["passport", "med", "military", "idcard"].filter((k) => k !== "idcard" || x.docs.includes(k))
    .map((k) => `<span class="chip ${x.docs.includes(k) ? "ok" : "bad"}">${CDOCS[k]}</span>`).join(" ");
  const flags = [x.record && "судимості", x.wanted && "у розшуку", x.warn && "активний Warn", x.fired_1d && "звільнення < 1 доби"].filter(Boolean);
  return `<dt>Дата народження</dt><dd>${esc(x.birth || "—")}${x.phone ? " · тел. " + esc(x.phone) : ""}</dd>
    <dt>Документи</dt><dd>${docs}</dd>
    <dt>Посв. водія / ліцензії</dt><dd>${esc(x.drive.map((d) => CDRIVE[d]).join(", ") || "немає")} · ${esc(x.lics.map((l) => CLICS[l]).join(", ") || "ліцензій немає")}</dd>
    <dt>Майно</dt><dd>Житло: ${esc(CHOUSE[x.housing] || "—")}${x.housing_note ? " (" + esc(x.housing_note) + ")" : ""} · Транспорт: ${esc(x.cars || "немає")} · Бізнес: ${esc(x.business || "немає")}</dd>
    <dt>Правова історія</dt><dd>${flags.length ? flags.map((f) => `<span class="chip bad">${f}</span>`).join(" ") : '<span class="chip ok">Чисто</span>'}
      ${x.record_note ? "<div>" + esc(x.record_note) + "</div>" : ""}${x.admin_note ? '<div class="muted">Адмін.: ' + esc(x.admin_note) + "</div>" : ""}</dd>`;
}

function candCard(c, r) {
  const mine = (c.status === "vvb" && r.vvb) || (c.status === "vkpp" && r.vkpp);
  return `<article class="card"><header><h3>${esc(c.name)} <span class="muted mono small">№${c.sid}</span></h3><span class="sp"></span>
    <span class="mono small muted">${docNo("АНК", c.id)}</span>${candChip(c)}</header>
    ${c.photoUrl ? `<img class="cand-photo" src="${esc(c.photoUrl)}" alt="Фото кандидата" loading="lazy">` : ""}
    <dl class="kv">${c.extra ? candExtra(c.extra) : ""}<dt>Вік / онлайн</dt><dd>${esc(c.age || "—")}${c.extra && c.extra.online ? " · " + esc(c.extra.online) : ""}</dd><dt>Досвід</dt><dd>${esc(c.exp || "—")}</dd>
      <dt>Мотивація</dt><dd>${esc(c.motive || "—")}</dd><dt>Подано</dt><dd class="num">${fmtDT(c.t)}</dd>
      ${c.vvb_t ? `<dt>ВВБ</dt><dd>${c.status === "rej" && !c.vkpp_t ? "відмовлено" : "погоджено"} · ${esc(c.vvbName || "—")} · ${fmtDT(c.vvb_t)}</dd>` : ""}
      ${c.vkpp_t ? `<dt>Discord</dt><dd class="mono">${esc(c.discord_name || "—")}</dd><dt>ВКПП</dt><dd>${c.status === "ok" ? "погоджено" : "відмовлено"} · ${esc(c.vkppName || "—")} · ${fmtDT(c.vkpp_t)}</dd>` : ""}
      ${c.note ? `<dt>Причина</dt><dd>${esc(c.note)}</dd>` : ""}</dl>
    ${mine ? `<div class="acts"><button class="btn ok" data-a="cand" data-id="${c.id}" data-d="ok">${c.status === "vvb" ? "Погодити й передати до ВКПП" : "Погодити зарахування"}</button>
      <button class="btn bad" data-a="cand" data-id="${c.id}" data-d="rej">Відмовити</button></div>` : ""}</article>`;
}

async function vHr() {
  const d = await call("/api/hr");
  const r = d.rights;
  const t = tab("hr", "cand");
  const head = tabsBar("hr", [["cand", "Анкети кандидатів", d.cand.length], ...(r.vkpp ? [["access", "Заявки на допуск", d.access.length]] : []), ["done", "Архів рішень"]], "cand");
  const stage = r.vvb && r.vkpp ? "ВВБ перевіряє анкети, ВКПП приймає на службу." : r.vvb ? "Ви перевіряєте анкети як ВВБ: погоджена анкета йде до ВКПП." : "Ви погоджуєте зарахування як ВКПП: після погодження зв'яжіться з кандидатом у Discord і запросіть на сервер, там він оформить допуск і отримає «Стажера».";
  const note = `<p class="note">${stage} Усі рішення бот дублює в Discord: картки в каналах оновлюються.</p>`;
  if (t === "access") {
    if (!d.access.length) return head + note + '<div class="empty">Немає заявок на допуск.</div>';
    return head + note + `<div class="card"><div class="tbl-wrap"><table class="t"><thead><tr><th>Заявка</th><th>Ім'я</th><th>Static ID</th><th>Подано</th><th class="r">Рішення</th></tr></thead><tbody>
      ${d.access.map((a) => `<tr><td class="mono">${docNo("ЗД", a.id)}</td><td>${esc(a.name)}</td><td class="num">№${a.sid}</td><td class="muted num">${fmtDT(a.t)}</td>
        <td class="r"><div class="acts" style="justify-content:flex-end"><button class="btn sm ok" data-a="accd" data-id="${a.id}" data-d="ok">Надати допуск</button><button class="btn sm bad" data-a="accd" data-id="${a.id}" data-d="rej">Відмовити</button></div></td></tr>`).join("")}
      </tbody></table></div></div>`;
  }
  if (t === "done") {
    const acc = d.accessDone.map((a) => `<tr><td class="mono">${docNo("ЗД", a.id)}</td><td>${esc(a.name)} <span class="muted">№${a.sid}</span></td><td>${a.status === "ok" ? '<span class="chip ok">Допуск надано</span>' : '<span class="chip bad">Відмовлено</span>'}</td><td>${esc(a.reviewerName || "—")}</td><td class="muted num">${fmtDT(a.reviewed)}</td></tr>`).join("");
    return head + (d.candDone.length ? d.candDone.map((c) => candCard(c, r)).join("") : '<div class="empty">Розглянутих анкет ще немає.</div>')
      + (acc ? `<div class="card"><header><h3>Заявки на допуск</h3></header><div class="tbl-wrap"><table class="t"><thead><tr><th>Заявка</th><th>Заявник</th><th>Рішення</th><th>Хто</th><th>Коли</th></tr></thead><tbody>${acc}</tbody></table></div></div>` : "");
  }
  return head + note + (d.cand.length ? d.cand.map((c) => candCard(c, r)).join("") : '<div class="empty">Немає анкет на розгляд.</div>');
}

const VIEWS = { home: vHome, act: vAct, rap: vRap, staff: vStaff, audit: vAudit, hr: vHr };

/* ---------------- рендер ---------------- */
async function boot() {
  try {
    [META, ME] = await Promise.all([META || call("/api/meta"), call("/api/me")]);
  } catch (e) {
    if (!TOKEN) return render();
    return render(e.message);
  }
  render();
}

async function render(err) {
  if (!TOKEN || !ME) {
    $("#app").innerHTML = viewLogin(err);
    checkBot();
    return;
  }
  if (!NAV.find((n) => n[0] === UI.view && n[2](ME.me))) UI.view = "home";
  $("#app").innerHTML = viewShell(loading);
  const view = UI.view;
  try {
    const html = await VIEWS[view]();
    if (UI.view === view && $("#view")) $("#view").innerHTML = html;
  } catch (e) {
    if ($("#view")) $("#view").innerHTML = `<p class="note bad">${esc(e.message)}</p>`;
  }
}

async function refreshMe() {
  try { ME = await call("/api/me"); } catch (e) {}
}

const A = {
  nav: (b) => { UI.view = b.dataset.v; render(); scrollTo(0, 0); },
  go: (b) => { UI.view = b.dataset.v; if (b.dataset.tab) UI.tabs[b.dataset.v] = b.dataset.tab; render(); scrollTo(0, 0); },
  tab: (b) => { UI.tabs[b.dataset.k] = b.dataset.v; render(); },
  logout: () => logout(false),
  file: async (b) => {
    try { const r = await call(`/api/files/${encodeURIComponent(b.dataset.id)}/url`); window.open(r.url, "_blank", "noopener"); }
    catch (e) { toast(e.message, 1); }
  },
  actd: async (b) => {
    b.disabled = true;
    try { await call(`/api/acts/${b.dataset.id}/decision`, { json: { decision: b.dataset.d } }); toast(b.dataset.d === "ok" ? "Звіт підтверджено" : "Звіт відхилено"); await refreshMe(); render(); }
    catch (e) { toast(e.message, 1); b.disabled = false; }
  },
  cand: async (b) => {
    let note = "";
    if (b.dataset.d === "rej") { note = prompt("Причина відмови (кандидат її побачить):", ""); if (note === null) return; }
    b.disabled = true;
    try { const r = await call(`/api/hr/cand/${b.dataset.id}`, { json: { decision: b.dataset.d, note } }); toast(r.text); await refreshMe(); render(); }
    catch (e) { toast(e.message, 1); b.disabled = false; }
  },
  accd: async (b) => {
    if (b.dataset.d === "rej" && !confirm("Відмовити в допуску?")) return;
    b.disabled = true;
    try { const r = await call(`/api/hr/access/${b.dataset.id}`, { json: { decision: b.dataset.d } }); toast(r.text); await refreshMe(); render(); }
    catch (e) { toast(e.message, 1); b.disabled = false; }
  },
  rapd: async (b) => {
    b.disabled = true;
    try { await call(`/api/raps/${b.dataset.id}/decision`, { json: { decision: b.dataset.d } }); toast(b.dataset.d === "ok" ? "Рапорт погоджено. Бот оновив ролі й журнал аудиту" : "Рапорт відхилено"); await refreshMe(); render(); }
    catch (e) { toast(e.message, 1); b.disabled = false; }
  },
};

const F = {
  login: doLogin,
  act: async () => {
    const btn = $("#a-btn");
    btn.disabled = true;
    btn.innerHTML = '<span class="spin"></span> Надсилаю…';
    try {
      const files = await uploadFiles($("#a-files"));
      await call("/api/acts", { json: {
        type: $("#a-type").value, t: new Date($("#a-t").value).getTime() || Date.now(), qty: +$("#a-qty").value || 1,
        arts: $("#a-arts").value.split(/[,;\s]+/).filter(Boolean), subj: $("#a-subj").value, evidence: $("#a-ev").value.trim(), files, note: $("#a-note").value,
      } });
      toast("Звіт надіслано. Картка з'явилась у каналі відділу");
      UI.tabs.act = "mine";
      render();
    } catch (e) { toast(e.message, 1); btn.disabled = false; btn.textContent = "Надіслати на перевірку"; }
  },
  rap: async () => {
    const btn = $("#r-btn");
    btn.disabled = true;
    const v = (id) => ($(id) ? $(id).value.trim() : "");
    try {
      await call("/api/raps", { json: { type: UI.rapType, reason: v("#r-reason"), days: +v("#r-days") || undefined, from: v("#r-from"), to: v("#r-to") } });
      toast("Рапорт подано");
      UI.tabs.rap = "mine";
      await refreshMe();
      render();
    } catch (e) { toast(e.message, 1); btn.disabled = false; }
  },
};

document.addEventListener("click", (e) => { const b = e.target.closest("[data-a]"); if (!b || b.disabled) return; const f = A[b.dataset.a]; if (f) { e.preventDefault(); f(b); } });
document.addEventListener("submit", (e) => { const f = e.target.closest("[data-f]"); if (!f) return; e.preventDefault(); const h = F[f.dataset.f]; if (h) h(f); });
document.addEventListener("change", (e) => { if (e.target.dataset.change === "raptype") { UI.rapType = e.target.value; render(); } });

if (TOKEN) boot(); else render();
})();
