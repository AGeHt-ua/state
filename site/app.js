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
// дата з роком (службові документи, PDF і картинки в Discord), напр. «05.11.2026, 20:31»
const fmtDT = (t) => t ? new Date(t).toLocaleString("uk-UA", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";
// посилання з даних користувачів — лише веб-адреси (javascript: та інше стало б шкідливою кнопкою)
const safeUrl = (u) => /^https?:\/\//i.test(String(u || "").trim()) ? String(u).trim() : "";
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
  // наступний користувач планшета не бачить, де був попередній: адреса, вкладки, відкриті документи й кеш — з нуля
  if (!silent) {
    Object.assign(UI, { view: "home", tabs: {}, actId: null, rapId: null, file: null });
    HOOKS.forEach((f) => f("home"));
    if (window.SOVA) for (const k of Object.keys(window.SOVA.cache)) delete window.SOVA.cache[k];
    try { history.replaceState(null, "", location.pathname + location.search); } catch (e) {}
    if (typeof closeViewer === "function") closeViewer();
  }
  render();
}

/* ---------------- оболонка ---------------- */
const IC = {
  kb: '<path d="M4 5a2 2 0 0 1 2-2h12v16H6a2 2 0 0 0-2 2z"/><path d="M4 19V5M8 7h7M8 11h7"/>',
  disc: '<path d="M12 3v18M7 21h10M5 7h14M5 7l-2.5 6a3 3 0 0 0 5 0zM19 7l-2.5 6a3 3 0 0 0 5 0z"/>',
  bonus: '<circle cx="12" cy="12" r="8.5"/><path d="M14.8 9.2c-.5-.9-1.6-1.4-2.8-1.4-1.6 0-2.8.8-2.8 2 0 2.8 5.6 1.4 5.6 4.2 0 1.2-1.2 2.1-2.8 2.1-1.3 0-2.4-.6-2.9-1.5M12 6.3v1.5M12 16.9v1.4"/>',
  dept: '<path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z"/><path d="M8.5 12.5l2.3 2.3 4.7-5"/>',
  cases: '<path d="M3 7a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/><path d="M8 13h8M8 16h5"/>',
  home: '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  act: '<path d="M4 19V5m0 14h16M8 15l4-4 3 3 5-6"/>',
  rap: '<path d="M7 3h8l4 4v14H7zM15 3v4h4M10 12h6M10 16h6"/>',
  staff: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c.6-3.4 3-5.4 6-5.4s5.4 2 6 5.4M16 4.5a3 3 0 0 1 0 6M21 19c-.4-2.4-1.7-4-3.6-4.7"/>',
  audit: '<path d="M5 4h14v16H5zM9 8h6M9 12h6M9 16h3"/>',
  hr: '<circle cx="10" cy="8" r="3.4"/><path d="M3.5 20c.7-3.6 3.3-5.6 6.5-5.6 1.6 0 3 .5 4.1 1.4M15 18l2 2 4-4.5"/>',
  soon: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3 2"/>',
  game: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 1v5M12 18v5M1 12h5M18 12h5"/>',
  fin: '<rect x="3" y="6" width="18" height="12" rx="1"/><circle cx="12" cy="12" r="2.5"/><path d="M6 9v6M18 9v6"/>',
  admin: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
};
const ico = (k) => `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">${IC[k] || IC.soon}</svg>`;
const NAV = [
  ["home", "Головна", () => true],
  ["act", "Звіти", () => true],
  ["rap", "Рапорти", () => true],
  ["staff", "Особовий склад", () => true],
  ["kb", "База даних", () => true],
  ["bonus", "Премії", () => true],
  ["disc", "Дисципліна", () => true],
  ["dept", "Розділ відділу", () => !!(ME.control && ME.control.length)],
  ["cases", "Кейс-файли", () => !!(ME.cases && ME.cases.view)],
  ["hr", "Кадри", () => !!(ME.hr && (ME.hr.vvb || ME.hr.vkpp))],
  ["audit", "Кадровий аудит", (u) => u.rank >= 12 || !!(ME.hr && ME.hr.vkpp)],
  ["fin", "Клопотання Мінфіну", () => !!(ME.fin && ME.fin.view)],
  ["game", "Тренажер «Штурм»", () => true],
  ["admin", "Адмін-панель", () => !!ME.admin],
];
const SOON = [];
// Генеральний прокурор (не співробітник СБУ) бачить лише кейс-файли
const navOk = (n) => n[2](ME.me) && (ME.me.dept !== "prosecutor" || n[0] === "cases");
const TITLES = { home: "Службовий кабінет", act: "Звіти про діяльність", rap: "Рапорти", staff: "Особовий склад і штатна структура", audit: "Кадровий аудит", hr: "Кадри: кандидати й допуски", cases: "Кейс-файли", dept: "Розділ відділу", bonus: "Премії", disc: "Дисципліна", kb: "База даних", admin: "Адмін-панель", fin: "Клопотання до Мінфіну", game: "Тренажер «Штурм» · ЦСО «Альфа»" };

function viewShell(inner) {
  const p = ME.pending || {};
  const badge = { kb: p.exams, staff: p.orders, act: p.acts, rap: p.raps, hr: p.hr, cases: p.cases, fin: p.fin, disc: p.disc || (ME.disc && ME.disc.active) || 0 };
  const c = META.depts[ME.me.dept].color;
  return `<div class="shell" style="--dept:${c}">
  <aside class="side">
    <div class="brand"><img src="sbu-logo.webp" alt="" width="46" height="46"><div><b>СОВА</b><span>ЄІС Служби безпеки штату NG</span></div></div>
    <div class="me"><span class="dp">${esc(ME.me.deptName)}</span><span class="nm">${esc(ME.me.name)}</span><span class="rk">${esc(ME.me.rankName)}</span>
      <div class="meta"><span>${esc(META.depts[ME.me.dept].s)}</span><span>№${ME.me.sid}</span></div></div>
    <nav class="nav">
      ${NAV.filter(navOk).map(([k, l]) => `<button data-a="nav" data-v="${k}" class="${UI.view === k ? "on" : ""}">${ico(k)}<span>${l}</span>${badge[k] ? `<span class="cnt">${badge[k]}</span>` : ""}</button>`).join("")}
      ${SOON.length && ME.me.dept !== "prosecutor" ? '<div class="sec">У розробці</div>' : ""}
      ${ME.me.dept === "prosecutor" ? "" : SOON.map((l) => `<button class="soon" disabled>${ico("soon")}<span>${l}</span></button>`).join("")}
    </nav>
    <div class="side-foot"><button data-a="logout">Вийти із системи</button></div>
  </aside>
  <main class="main" style="--vc:${c}">
    <header class="top"><div><div class="crumbs">СБУ / ${esc(META.depts[ME.me.dept].s)} / ${esc(TITLES[UI.view])}</div><h2>${esc(TITLES[UI.view])}</h2></div>
      <div class="right"><form class="docgo" data-f="docgo" role="search"><input class="i mono" id="docgo-q" placeholder="№ документа: ЗВТ-0042" autocomplete="off" aria-label="Перейти до документа за номером"></form>
        <span class="dbadge">${esc(META.depts[ME.me.dept].s)}</span><button class="btn sm" data-a="logout">Вийти</button></div></header>
    ${ME.curator ? '<div class="note cur-note">👁 Наглядовий режим куратора: перегляд усіх розділів СБУ. Зміни — лише в адмін-панелі та схвалення відомостей премій. На сайті вас не видно.</div>' : ""}
    <section class="view" id="view">${inner}</section>
  </main></div>`;
}

const tabsBar = (key, items, def, extra) => `<div class="tabs">${items.map(([v, l, n]) => `<button class="tb ${tab(key, def) === v ? "on" : ""}" data-a="tab" data-k="${key}" data-v="${v}">${l}${n !== undefined ? `<span class="cnt">${n}</span>` : ""}</button>`).join("")}${extra || ""}</div>`;
const loading = '<div class="empty"><span class="spin"></span> Завантаження…</div>';
const stChip = (s) => s === "ok" ? '<span class="chip ok">Підтверджено</span>' : s === "wait" ? '<span class="chip wait">На розгляді</span>' : '<span class="chip bad">Відхилено</span>';

/* ---------------- головна ---------------- */
const deptColor = (k) => (META.depts[k] || {}).color || "#e2c07f";
const ring = (val, max, label) => {
  const p = Math.max(0, Math.min(1, max ? val / max : 0)), r = 46, c = 2 * Math.PI * r;
  return `<div class="ring"><svg viewBox="0 0 110 110" aria-hidden="true"><circle cx="55" cy="55" r="${r}" class="bg"/><circle cx="55" cy="55" r="${r}" class="fg" style="stroke-dasharray:${c};stroke-dashoffset:${c * (1 - p)}"/></svg>
    <div><b class="num">${val}</b><span>${label}</span></div></div>`;
};

// Звірка посвідчення з ролями Discord: свіжі ролі → звання й відділ на сайті, службовий нікнейм
async function verifyCard(btn, tries = 0) {
  const box = document.getElementById("idver");
  if (!box) { if (tries < 40) setTimeout(() => verifyCard(btn, tries + 1), 150); return; }  // сторінка ще вставляється
  if (box.dataset.done && !btn) return;
  box.dataset.done = "1";
  const box0 = box;
  if (btn) btn.disabled = true;
  try {
    const v = await call("/api/me/verify");
    const box = document.getElementById("idver") || box0;  // сторінка могла перемалюватися, поки йшла звірка
    if (v.changed) { toast("Звання або підрозділ оновлено з Discord"); await refreshMe(); return render(); }
    const bad = v.items.filter((i) => !i.ok && !i.soft).length;
    box.className = `idcard-ver ${v.ok ? "ok" : "bad"}`;
    box.innerHTML = `<span class="iv-st">${v.ok ? "✔ ЗВІРЕНО З DISCORD" : `✖ РОЗБІЖНОСТІ: ${bad}`}</span><span class="iv-t">${new Date(v.t).toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit" })}</span>
      <button class="iv-btn" data-a="verify" title="Звірити ще раз">⟳</button>
      ${v.items.length ? `<ul>${v.items.map((i) => `<li class="${i.ok ? "ok" : i.soft ? "soft" : "no"}">${esc(i.t)}</li>`).join("")}</ul>` : ""}${v.why ? `<p>${esc(v.why)}</p>` : ""}`;
  } catch (e) { box.innerHTML = `<span class="iv-st">Звірка недоступна: ${esc(e.message)}</span>`; }
  if (btn) btn.disabled = false;
}

// Позивний: подання (АТЦ, ДЕБ, ЦСО «А», ВВБ) і затвердження начальником відділу
const CS_ST = { wait: ["На розгляді", "wait"], ok: ["Затверджено", "ok"], rej: ["Відмовлено", "bad"] };
function callsignCard(c) {
  if (!c || (!c.eligible && !c.todo.length && !c.current)) return "";
  const wait = c.mine.find((r) => r.status === "wait");
  return `<div class="card cs-card" id="cs-card"><header><h3>Позивний</h3>${c.current ? `<span class="sp cs-badge">${esc(c.current)}</span>` : ""}</header>
    ${c.eligible ? `<div class="cs-nick"><span>Ваш нікнейм у Discord</span><b class="mono">${esc(c.nick || "")}</b></div>
      ${wait ? `<div class="note">Заявка на позивний <b>${esc(wait.callsign)}</b> на розгляді у начальника відділу · ${fmtDT(wait.t)}
          <button class="btn sm" data-a="cswd" data-id="${wait.id}">↩ Відкликати</button></div>`
        : `<form class="cs-form" data-f="cs"><input class="i mono" id="cs-in" maxlength="16" placeholder="${c.current ? "Новий позивний" : "Напр. LEO, ВОВК-7"}" autocomplete="off">
          <button class="btn gold" type="submit">${c.current ? "Подати зміну" : "Подати на затвердження"}</button></form>
          <p class="muted small">2–16 символів: літери, цифри, дефіс. Після затвердження начальником відділу нікнейм стане: <b class="mono" id="cs-prev" data-s="${esc(c.sample || "")}">${esc(c.sample || "")}</b></p>`}
      ${c.mine.filter((r) => r.status !== "wait").slice(0, 3).map((r) => `<div class="cs-hist"><span class="chip ${CS_ST[r.status][1]}">${CS_ST[r.status][0]}</span><b class="mono">${esc(r.callsign)}</b><span class="muted small">${fmtDT(r.reviewed || r.t)}${r.reviewerName ? " · " + esc(r.reviewerName) : ""}${r.note ? " · «" + esc(r.note) + "»" : ""}</span></div>`).join("")}`
      : ""}
    ${c.todo.length ? `<div class="cs-todo"><div class="eyebrow">На затвердження · ${c.todo.length}</div>${c.todo.map((r) => `<div class="cs-req">
        <div><b>${esc(r.name || "№" + r.sid)}</b> <span class="muted small">${esc(r.rankName)} · №${r.sid} · ${esc((META.depts[r.dept] || {}).s || "")}</span>
          <div>Позивний: <b class="mono cs-badge">${esc(r.callsign)}</b> → нікнейм <span class="mono">${esc(r.preview)}</span></div></div>
        <div class="acts"><button class="btn sm ok" data-a="csdec" data-id="${r.id}" data-d="ok">Затвердити</button><button class="btn sm bad" data-a="csdec" data-id="${r.id}" data-d="rej">Відмовити</button></div></div>`).join("")}</div>` : ""}
  </div>`;
}

async function vHome() {
  const cs = (ME.callsign && ME.callsign.eligible) || (ME.pending && ME.pending.callsign) ? call("/api/callsign").catch(() => null) : null;
  const acts = await call("/api/acts");
  const csData = await cs;
  setTimeout(() => verifyCard(), 60);  // після вставки сторінки (render вставляє HTML одразу після цього return)
  const pc = ME.promo;
  const pend = ME.pending || {};
  const me = ME.me, d = META.depts[me.dept];
  const wait = acts.filter((a) => a.status === "wait").length, okN = acts.filter((a) => a.status === "ok").length;
  const goal = Math.max(ME.pointsPrev, 20);
  const todo = [  // [іконка, адреса, підпис, кількість]
    pend.acts && ["act", "act/review", "Звіти на перевірку", pend.acts],
    pend.raps && ["rap", "rap/review", "Рапорти на розгляд", pend.raps],
    pend.orders && ["staff", "staff/appoint", "Накази на підпис", pend.orders],
    pend.cases && ["cases", "cases/todo", "Кейс-файли на погодженні", pend.cases],
    pend.disc && ["disc", "disc/journal", "Скарги й службові перевірки", pend.disc],
    pend.fin && ["fin", "fin", "Клопотання Мінфіну", pend.fin],
    pend.exams && ["kb", "kb/exams", "Іспити на перевірку", pend.exams],
    pend.hr && ["hr", "hr/cand", "Кадрові справи", pend.hr],
    pend.callsign && ["home", "", "Позивні на затвердження", pend.callsign],
  ].filter(Boolean);
  return `
  <section class="hero" style="--dc:${deptColor(me.dept)}">
    <div class="idcard">
      <div class="idcard-top"><img src="sbu-logo.webp" alt="" width="54" height="54"><div><b>СЛУЖБА БЕЗПЕКИ ШТАТУ NG</b><span>Службове посвідчення</span></div></div>
      <div class="idcard-body">
        <div class="idcard-name">${esc(me.name)}</div>
        <dl><dt>Звання</dt><dd>${esc(me.rankName)}</dd><dt>Підрозділ</dt><dd>${esc(d.n)}</dd><dt>Жетон</dt><dd class="mono">${me.sid}</dd><dt>На званні з</dt><dd>${fmtDT(me.since)}</dd></dl>
      </div>
      <div class="idcard-foot"><span class="mono">SBU-NG · ${String(me.sid).padStart(8, "0")}</span><span class="idcard-rank">${me.rank}<small>/15</small></span></div>
      ${(ME.gameBadges || []).length ? `<div class="idcard-badges">${ME.gameBadges.map((b) => `<span title="Тренажер «Штурм»">${b.icon} ${esc(b.t)}</span>`).join("")}</div>` : ""}
      <div class="idcard-ver" id="idver"><span class="iv-st">⟳ Звіряю з Discord…</span></div>
    </div>
    <div class="hero-stats">
      ${ring(ME.points, goal, "підтверджених балів за цей тиждень")}
      <div class="mini"><span>Минулий тиждень</span><b class="num">${ME.pointsPrev}</b></div>
      <div class="mini"><span>Звітів на перевірці</span><b class="num">${wait}</b></div>
      <div class="mini"><span>Підтверджено за весь час</span><b class="num">${okN}</b></div>
    </div>
  </section>
  ${todo.length ? `<section class="todo"><div class="eyebrow">Потребує вашого рішення</div><div class="todo-row">
    ${todo.map(([v, path, l, n]) => `<button class="todo-item" data-a="${v === "home" ? "csgo" : "goto"}" data-path="${path}">${ico(v === "home" ? "staff" : v)}<span>${l}</span><b class="num">${n}</b></button>`).join("")}</div></section>` : ""}
  ${callsignCard(csData)}
  <div class="grid2">
    <div class="card"><header><h3>Наступне звання</h3>${pc ? `<span class="sp chip ${pc.eligible ? "ok" : "wait"}">${pc.eligible ? "Можна подати рапорт" : "Умови ще не виконано"}</span>` : ""}</header>
      ${pc ? `<div class="promo"><span class="from">${esc(me.rankName)}</span><i></i><span class="to">${esc(pc.name)}</span></div>
        ${pc.need !== undefined ? `<div class="promo-pts"><b class="num">${pc.points}</b><span>/ ${pc.need} балів на званні (для підвищення)</span>${pc.points > pc.need ? `<em>+${pc.points - pc.need} перейде далі</em>` : ""}</div>` : ""}
        ${(pc.items.find((i) => i.pct !== undefined)) ? `<div class="bar ${pc.items.find((i) => i.pct !== undefined).ok ? "ok" : ""}"><i style="width:${Math.round(pc.items.find((i) => i.pct !== undefined).pct * 100)}%"></i></div>` : ""}
        <ul class="checklist">${pc.items.map((i) => `<li class="${i.ok ? "" : i.soft ? "soft" : "no"}">${esc(i.t)}</li>`).join("")}</ul>
        <div><button class="btn ${pc.eligible ? "gold" : ""}" data-a="go" data-v="rap" data-tab="new" ${pc.eligible ? "" : "disabled"}>Подати рапорт на підвищення</button></div>`
      : '<p class="muted">Найвище звання у відомстві.</p>'}
    </div>
    <div class="card"><header><h3>Швидкі дії</h3></header>
      <div class="quick">
        <button data-a="go" data-v="act" data-tab="new">${ico("act")}<b>Звіт про дію</b><span>арешт, патруль, операція</span></button>
        <button data-a="go" data-v="rap" data-tab="new">${ico("rap")}<b>Рапорт</b><span>підвищення, відпустка, переведення</span></button>
        <button data-a="go" data-v="staff" data-tab="tree">${ico("staff")}<b>Штатна структура</b><span>хто є хто у відділах</span></button>
      </div>
      <div class="do-line"><code>/do На спорядженні закріплений номерний жетон СБУ ${esc(d.s)} №${me.sid}.</code></div>
    </div>
  </div>
  <div class="card"><header><h3>Останні звіти</h3><button class="sp btn sm" data-a="go" data-v="act" data-tab="new">+ Новий звіт</button></header>
    ${acts.length ? actFeed(acts.slice(0, 6), false) : '<div class="empty">Звітів ще немає. Додайте перший після зміни.</div>'}
  </div>`;
}

/* ---------------- звіти ---------------- */
const stLabel = { ok: "Підтверджено", wait: "На перевірці", rej: "Відхилено", cancel: "Відкликано" };
const ACT_STAMP = { ok: ["ПІДТВЕРДЖЕНО", "ok"], rej: ["ВІДХИЛЕНО", "bad"], wait: ["НА ПЕРЕВІРЦІ", "wait"], cancel: ["ВІДКЛИКАНО", "mute"] };
// Повний бланк службового звіту (той самий для перегляду й PDF)
function actDoc(a) {
  const meta = META.acts[a.type] || { n: a.type, p: 0 }, dp = META.depts[a.dept] || {}, by = a.by || ME.me, q = a.qty || 1;
  const [sw, sc] = ACT_STAMP[a.status] || ["", ""];
  const sec = (n, t, body) => `<section class="kd-sec"><h4><b>${n}</b>${t}</h4>${body}</section>`;
  return `<div class="kd act-kd" style="--dc:${dp.color || "#c9a24d"}">
    <div class="kd-grif g-dsk">ДСК · Службовий</div>
    <header class="kd-head"><img src="sbu-logo.webp" alt="" width="84" height="84">
      <div><div class="kd-agency">Служба безпеки штату NG</div><div class="kd-dept">${esc(dp.n || "")}</div></div>
      <div class="kd-no"><span>Службовий звіт</span><b>${docNo("ЗВТ", a.id)}</b><span>${fmtDT(a.t)}</span></div></header>
    <div class="kd-title"><span>Звіт про виконану роботу</span><h2>${esc(meta.n)}</h2></div>
    <dl class="kd-meta"><dt>Виконавець</dt><dd>${esc(by.rankName || "")} ${esc(by.name || "")}${by.sid ? `, жетон №${by.sid}` : ""}</dd><dt>Підрозділ</dt><dd>${esc(dp.n || "—")}</dd>
      <dt>Дата і час</dt><dd>${fmtDT(a.t)}</dd><dt>Обсяг</dt><dd>${q > 1 ? `×${q} · ` : ""}${meta.p * q} б.</dd></dl>
    ${sec("I", "Фігурант", `<p class="kd-text">${esc(a.subj || "—")}</p>`)}
    ${sec("II", "Кваліфікація", a.arts.length ? `<div class="kd-arts">${a.arts.map((n) => `<span>ст. ${esc(n)} КК штату NG</span>`).join("")}</div>` : "<p>—</p>")}
    ${sec("III", "Обставини", `<p class="kd-text">${esc(a.note || "—")}</p>`)}
    ${sec("IV", "Докази", a.evidence || a.files.length ? `<ol class="kd-ev">${a.evidence ? `<li><div>Відеозапис (відкат)</div><div class="mono small">${esc(a.evidence)}</div>
        ${safeUrl(a.evidence) ? `<div class="files"><a class="btn sm" href="${esc(safeUrl(a.evidence))}" target="_blank" rel="noopener">▶ Відкрити</a></div>` : ""}</li>` : ""}
      ${a.files.length ? `<li><div>Додатки: ${a.files.length} (зберігаються в ЄІС «Сова»)</div><div class="files">${a.files.map((f, i) => `<button class="btn sm" data-a="file" data-id="${esc(f)}">📎 Файл ${i + 1}</button>`).join("")}</div></li>` : ""}</ol>` : "<p>—</p>")}
    ${sec("V", "Резолюція", `<p class="kd-text">${a.status === "wait" ? "Очікує перевірки керівником підрозділу." : `${esc(stLabel[a.status] || "")}${a.reviewer ? ` · ${esc(a.reviewer.rankName || "")} <span class="kf-sign">${esc(a.reviewer.name)}</span>` : ""}${a.reviewed ? ` · ${fmtDT(a.reviewed)}` : ""}`}</p>`)}
    <div class="act-stamp ${sc}">${sw}</div>
    <footer class="kd-foot">ЄІС «Сова» · ${docNo("ЗВТ", a.id)} · Для службового користування</footer></div>`;
}
// аркуші А4 (PDF і картинка в картці Discord)
const actA4 = (a) => window.SOVA.a4(actDoc(a), docNo("ЗВТ", a.id), { bare: true });
const rapA4 = (r) => window.SOVA.a4(rapDoc(r), docNo("РАП", r.id), { date: fmtDT(r.t), sub: (META.rapTypes[r.type] || "Рапорт") });
async function actImage(id) { try { const a = await call(`/api/acts/${id}`); return await window.SOVA.docImage("act", id, actA4(a)); } catch (e) { console.warn(e); return false; } }
async function rapImage(id) { try { const r = await call(`/api/raps/${id}`); return await window.SOVA.docImage("rap", id, rapA4(r)); } catch (e) { console.warn(e); return false; } }

function actFeed(list, review) {
  window.SOVA.cache.acts = { ...(window.SOVA.cache.acts || {}), ...Object.fromEntries(list.map((a) => [a.id, a])) };
  return `<div class="docs">${list.map((a) => {
    const meta = META.acts[a.type] || { n: a.type, p: 0 };
    const dp = META.depts[a.dept] || {};
    return `<article class="doc act-row st-${a.status}" style="--dc:${dp.color || "#c9a24d"}" data-a="actopen" data-id="${a.id}" title="Відкрити звіт повністю">
      <div class="doc-no"><b>${docNo("ЗВТ", a.id)}</b><span>${fmtDT(a.t)}</span><i class="act-ds">${esc(dp.s || "")}</i></div>
      <div class="doc-main">
        ${review ? `<div class="doc-who">${who(a.by)} ${deptTag(a.dept)}</div>` : ""}
        <div class="doc-title">${esc(meta.n)}${a.qty > 1 ? ` <span class="muted">×${a.qty}</span>` : ""} <span class="pts">+${meta.p * (a.qty || 1)} б.</span></div>
        ${a.subj ? `<div class="doc-line"><span>Фігурант</span>${esc(a.subj)}</div>` : ""}
        ${a.arts.length ? `<div class="art-list">${a.arts.map((n) => `<span class="art">ст. ${esc(n)}</span>`).join("")}</div>` : ""}
        ${a.note ? `<div class="doc-note">${esc(a.note)}</div>` : ""}
        <div class="files"><button class="btn sm gold" data-a="actopen" data-id="${a.id}">📂 Відкрити звіт</button><button class="btn sm" data-a="actpdf" data-id="${a.id}">⬇ PDF</button>${safeUrl(a.evidence) ? `<a class="btn sm" href="${esc(safeUrl(a.evidence))}" target="_blank" rel="noopener">▶ Відкат</a>` : ""}${a.files.map((f, i) => `<button class="btn sm" data-a="file" data-id="${esc(f)}">📎 Файл ${i + 1}</button>`).join("")}</div>
      </div>
      <div class="doc-side">${review === "review"
        ? `<button class="btn sm ok" data-a="actd" data-id="${a.id}" data-d="ok">Підтвердити</button><button class="btn sm bad" data-a="actd" data-id="${a.id}" data-d="rej">Відхилити</button>`
        : `<span class="doc-stamp">${stLabel[a.status]}</span>${a.reviewer ? `<span class="muted small">${esc(a.reviewer.name)}</span>` : ""}${review ? "" : `${a.status === "wait" ? `<button class="btn sm" data-a="wd" data-k="acts" data-id="${a.id}">↩ Відкликати</button>` : ""}${["wait", "rej", "cancel"].includes(a.status) ? `<button class="btn sm bad" data-a="del" data-url="/api/acts/${a.id}/delete" data-q="Видалити документ? Його буде прибрано з кабінету, у журналі Discord лишиться запис.">🗑 Видалити</button>` : ""}`}`}</div>
    </article>`;
  }).join("")}</div>`;
}

async function vActView(id) {
  const a = await call(`/api/acts/${id}`);
  window.SOVA.cache.acts = { ...(window.SOVA.cache.acts || {}), [a.id]: a };
  const ev = [[a.t, "Звіт складено й подано на перевірку", a.by]];
  if (a.reviewed) ev.push([a.reviewed, a.status === "ok" ? "Підтверджено, бали нараховано" : a.status === "rej" ? "Відхилено" : stLabel[a.status], a.reviewer]);
  return `<div class="kd-bar"><button class="btn" data-a="actback">← До звітів</button><span class="sp"></span>
      <button class="btn" data-a="actpdf" data-id="${a.id}">⬇ PDF</button>${window.SOVA.docImgBtn("act", a.id)}
      ${a.canDecide ? `<button class="btn ok" data-a="actd" data-id="${a.id}" data-d="ok">Підтвердити</button><button class="btn bad" data-a="actd" data-id="${a.id}" data-d="rej">Відхилити</button>` : ""}
      ${a.mine && a.status === "wait" ? `<button class="btn" data-a="wd" data-k="acts" data-id="${a.id}">↩ Відкликати</button>` : ""}
      ${a.mine && ["wait", "rej", "cancel"].includes(a.status) ? `<button class="btn bad" data-a="del" data-url="/api/acts/${a.id}/delete" data-q="Видалити звіт?">🗑 Видалити</button>` : ""}</div>
    <div class="act-page"><div class="kd-wrap">${actDoc(a)}</div>
      <aside class="card act-trail"><header><h3>Рух документа</h3></header><div class="aud">${ev.map(([t, l, u]) => `<div class="aud-it k-${l.startsWith("Відхил") ? "down" : "in"}"><i></i>
        <div class="aud-when"><b>${new Date(t).toLocaleDateString("uk-UA", { day: "2-digit", month: "2-digit" })}</b><span>${new Date(t).toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit" })}</span></div>
        <div class="aud-body"><div class="aud-act">${esc(l)}</div><div class="aud-who">${u ? `<b>${esc(u.name)}</b> · ${esc(u.rankName || "")}` : ""}</div></div></div>`).join("")}</div></aside></div>`;
}

async function vAct() {
  if (UI.actId) return vActView(UI.actId);
  const canRev = ME.me.rank >= 8;
  const canJournal = ME.me.rank >= 8 || !!(ME.hr && ME.hr.vkpp);
  const t = tab("act", "mine");
  const head = tabsBar("act", [["mine", "Мої звіти"], ["new", "Новий звіт"], ...(canRev ? [["review", "На перевірку", ME.pending.acts || 0]] : []), ...(canJournal ? [["journal", "Журнал підрозділів"]] : [])], "mine");
  if (t === "new") {
    const allowed = ME.allowedActs.map((k) => [k, META.acts[k]]);
    return head + `<div class="card paper"><header class="paper-head"><div><div class="eyebrow">Служба безпеки штату NG · ${esc(META.depts[ME.me.dept].s)}</div><h3>СЛУЖБОВИЙ ЗВІТ</h3></div>
        <div class="paper-no">ЗВТ-<span class="mono">нов.</span></div></header>
      ${ME.me.rank === 1 ? '<p class="note warn">Стажер не проводить затримань самостійно (Положення про стажування, р. IV). Доступні патруль з наставником і навчання.</p>' : ""}
      <form data-f="act" class="form-grid">
        <label class="f"><span>Тип дії</span><select class="i" id="a-type">${allowed.map(([k, a]) => `<option value="${k}">${esc(a.n)} · ${a.p} б.</option>`).join("")}</select></label>
        <label class="f"><span>Дата і час</span><input class="i" id="a-t" type="datetime-local" value="${localInput(Date.now())}"></label>
        <label class="f" id="a-qty-f" ${allowed[0] && allowed[0][0] === "patrol" ? "" : "hidden"}><span>Кількість блоків патрулювання по 30 хв</span><input class="i" id="a-qty" type="number" min="1" max="12" value="1"></label>
        <label class="f"><span>Статті КК (через кому)</span><input class="i mono" id="a-arts" placeholder="напр. 263, 342"></label>
        <label class="f"><span>Фігурант</span><input class="i" id="a-subj" placeholder="ім'я або «невстановлена особа»"></label>
        <label class="f"><span>Доказ: посилання на відкат</span><input class="i" id="a-ev" placeholder="https://..."></label>
        <label class="f wide"><span>Скріни (до 5 файлів, зберігаються в Discord)</span><input class="i" id="a-files" type="file" accept="image/*,video/mp4,application/pdf" multiple></label>
        <label class="f wide"><span>Обставини</span><textarea class="i" id="a-note" placeholder="Що сталося, хто був у наряді"></textarea></label>
        ${window.SOVA.tagSelect('id="a-tag"', "")}
        <div class="wide paper-sign"><span class="muted small">Звіт піде на перевірку керівнику; запис з'явиться в журналі відділу в Discord. Бали — після підтвердження.</span>
          <button class="btn gold" type="submit" id="a-btn">Надіслати на перевірку</button></div>
      </form></div>`;
  }
  const list = await call("/api/acts" + (t === "review" || t === "journal" ? "?scope=" + t : ""));
  const empty = { review: "Немає звітів, що очікують перевірки.", journal: "У ваших підрозділах звітів ще немає." }[t] || "Звітів ще немає.";
  return head + (t === "journal" ? '<p class="note">Усі звіти співробітників підрозділів, якими ви керуєте. Натисніть на звіт, щоб відкрити його повністю.</p>' : "")
    + (list.length ? actFeed(list, t === "mine" ? false : t) : `<div class="empty">${empty}</div>`);
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
// Візи рапорту на переведення: начальник відділу «звідки» → «куди» → Голова
function trVisas(r) {
  const d = r.data || {}, st = d.stage || "from", vis = Object.fromEntries((d.visas || []).map((v) => [v.stage, v]));
  const steps = r.type === "assign" ? [["from", "нач. академії"], ["to", "нач. " + (META.depts[d.to] || {}).s]]
    : [["from", "нач. " + (META.depts[r.dept] || {}).s], ["to", "нач. " + (META.depts[d.to] || {}).s]];
  return `<div class="tr-visas">${steps.map(([k, l]) => `<span class="${vis[k] ? (vis[k].ok === false ? "bad" : "ok") : r.status === "wait" && st === k ? "cur" : ""}">${vis[k] ? (vis[k].ok === false ? "✖" : "✔") : "○"} ${esc(l)}${vis[k] ? ` · ${esc(vis[k].name)}` : ""}</span>`).join("")}</div>`;
}

function rapDesc(r) {
  const d = r.data || {};
  if (r.type === "promo") return `→ <b>${esc(META.ranks[d.to - 1] ? META.ranks[d.to - 1].n : d.to)}</b>`;
  if (r.type === "vac") return `${d.days} діб${d.from ? " з " + esc(d.from) : ""}${d.reason ? " · " + esc(d.reason) : ""}`;
  if (r.type === "assign") return `Академія → ${deptTag(d.to)}${d.reason ? " · " + esc(d.reason) : ""}${trVisas(r)}`;
  if (r.type === "transfer") return `${deptTag(r.dept)} → ${deptTag(d.to)}${d.reason ? " · " + esc(d.reason) : ""}${trVisas(r)}${evTag(d)}`;
  if (r.type === "refund") return `<b class="mono">$${(d.amount || 0).toLocaleString("uk-UA")}</b> · ${esc(d.reason || "")}${evTag(d)}`;
  return esc(d.reason || "") + evTag(d);
}
// позначка «є докази» в списку рапортів
const evTag = (d) => (d.files || []).length || d.evidence ? ` <span class="chip info">📎 доказів: ${(d.files || []).length + (d.evidence ? 1 : 0)}</span>` : "";
// докази в повному бланку рапорту: на екрані — кнопки, у PDF — перелік
const rapEvidence = (d) => (d.files || []).length || d.evidence ? `<div class="rap-evd"><b>Додатки (докази):</b>
  ${d.evidence ? `<div class="mono small">▶ ${esc(d.evidence)}</div>` : ""}${(d.files || []).length ? `<div class="small">Файлів: ${d.files.length} (зберігаються в ЄІС «Сова»)</div>` : ""}
  <div class="files">${safeUrl(d.evidence) ? `<a class="btn sm" href="${esc(safeUrl(d.evidence))}" target="_blank" rel="noopener">▶ Відкрити відео</a>` : ""}${(d.files || []).map((f, i) => `<button class="btn sm" data-a="file" data-id="${esc(f)}">📎 Файл ${i + 1}</button>`).join("")}</div></div>` : "";

const RAP_STAMP = { ok: ["ПОГОДЖЕНО", "ok"], rej: ["ВІДМОВЛЕНО", "bad"], wait: ["НА РОЗГЛЯДІ", "wait"], cancel: ["ВІДКЛИКАНО", "mute"] };
async function vRapView(id) {
  const r = await call(`/api/raps/${id}`);
  const a = r.by || { name: "—", rankName: "", sid: "" }, d = META.depts[r.dept] || {};
  const [sw, sc] = RAP_STAMP[r.status] || ["", ""];
  const bar = `<div class="kd-bar"><button class="btn" data-a="rapback">← До рапортів</button><span class="sp"></span>
    <button class="btn" data-a="rappdf">⬇ PDF</button>${window.SOVA.docImgBtn("rap", r.id)}
    ${r.canDecide ? `<button class="btn ok" data-a="rapd" data-id="${r.id}" data-d="ok">Погодити</button><button class="btn bad" data-a="rapd" data-id="${r.id}" data-d="rej">Відмовити</button>` : ""}
    ${r.mine && r.status === "wait" ? `<button class="btn" data-a="wd" data-k="raps" data-id="${r.id}">↩ Відкликати</button>` : ""}
    ${r.mine && ["wait", "rej", "cancel"].includes(r.status) ? `<button class="btn bad" data-a="del" data-url="/api/raps/${r.id}/delete" data-q="Видалити рапорт?">🗑 Видалити</button>` : ""}</div>`;
  window.SOVA.cache.rap = r;
  return bar + `<div class="rap-view">${rapDoc(r)}</div>`;
}
function rapDoc(r) {
  const a = r.by || { name: "—", rankName: "", sid: "" }, d = META.depts[r.dept] || {};
  const [sw, sc] = RAP_STAMP[r.status] || ["", ""];
  return `<div class="blank rap-doc">
      <div class="rap-no">${docNo("РАП", r.id)}</div>
      <div class="blank-to">Голові Служби безпеки штату NG<br>від ${esc((a.rankName || "").toLowerCase())}<br>${esc(d.n || "")}<br><b>${esc(a.name)}</b>, жетон №${a.sid}</div>
      <div class="blank-title">Р А П О Р Т</div>
      <div class="rap-sub">${esc((META.rapTypes[r.type] || "").replace("Рапорт ", ""))}</div>
      <p>${esc(r.text)}</p>
      ${r.type === "refund" ? `<div class="rap-sum">До відшкодування: <b>$${((r.data || {}).amount || 0).toLocaleString("uk-UA")}</b></div>` : ""}
      ${rapEvidence(r.data || {})}
      <div class="blank-sign"><span>${new Date(r.t).toLocaleString("uk-UA", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}</span><span class="kf-sign">${esc(a.name)}</span></div>
      ${["transfer", "assign"].includes(r.type) ? `<div class="rap-visas"><b>Візи погодження</b>${trVisas(r)}</div>` : ""}
      <div class="rap-res"><b>Резолюція:</b> ${r.status === "wait" ? `очікує розгляду${r.stageLabel ? " · зараз: " + esc(r.stageLabel) : ""}` : esc(sw.toLowerCase())}
        ${r.reviewer ? ` · ${esc(r.reviewer.rankName || "")} <span class="kf-sign">${esc(r.reviewer.name)}</span>` : ""}${r.reviewed ? ` · ${fmtDT(r.reviewed)}` : ""}</div>
      <div class="rap-stamp ${sc}">${sw}</div>
    </div>`;
}

async function vRap() {
  if (UI.rapId) return vRapView(UI.rapId);
  const canRev = ME.me.rank >= 11 || !!(ME.hr && ME.hr.vkpp) || (ME.pending.raps || 0) > 0;
  const t = tab("rap", "mine");
  const head = tabsBar("rap", [["mine", "Мої рапорти"], ["new", "Подати рапорт"], ...(canRev ? [["review", "На розгляд", ME.pending.raps || 0]] : [])], "mine");
  if (t === "new") return head + rapForm();
  const list = await call("/api/raps" + (t === "review" ? "?scope=review" : ""));
  if (!list.length) return head + `<div class="empty">${t === "review" ? "Немає рапортів на розгляд." : "Ви ще не подавали рапортів."}</div>`;
  return head + `<div class="docs">${list.map((r) => `<article class="doc st-${r.status} clickable" data-a="rapopen" data-id="${r.id}" title="Відкрити рапорт">
      <div class="doc-no"><b>${docNo("РАП", r.id)}</b><span>${fmtDT(r.t)}</span></div>
      <div class="doc-main">${t === "review" ? `<div class="doc-who">${who(r.by)} ${deptTag(r.dept)}</div>` : ""}
        <div class="doc-title">${esc(META.rapTypes[r.type])}</div><div class="doc-line">${rapDesc(r)}</div></div>
      <div class="doc-side">${t === "review" && r.canDecide === false
        ? `<span class="doc-stamp">Чекає візи</span><span class="muted small">${esc(r.stageLabel || "іншої сторони")}</span>`
        : t === "review"
        ? `<button class="btn sm ok" data-a="rapd" data-id="${r.id}" data-d="ok">Погодити</button><button class="btn sm bad" data-a="rapd" data-id="${r.id}" data-d="rej">Відмовити</button>`
        : `<span class="doc-stamp">${{ ok: "Погоджено", rej: "Відмовлено", wait: "На розгляді", cancel: "Відкликано" }[r.status]}</span>${r.reviewer ? `<span class="muted small">${esc(r.reviewer.name)}</span>` : ""}${r.status === "wait" ? `<button class="btn sm" data-a="wd" data-k="raps" data-id="${r.id}">↩ Відкликати</button>` : ""}${["wait", "rej", "cancel"].includes(r.status) ? `<button class="btn sm bad" data-a="del" data-url="/api/raps/${r.id}/delete" data-q="Видалити документ? Його буде прибрано з кабінету, у журналі Discord лишиться запис.">🗑 Видалити</button>` : ""}`}</div>
    </article>`).join("")}</div>`;
}

const RAP_ICONS = { refund: "M3 7h18v10H3zM7 12h.01M17 12h.01M12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z", assign: "M12 3l8 4-8 4-8-4zM6 9.5V14c0 1.7 2.7 3 6 3s6-1.3 6-3V9.5M20 7v6", promo: "M12 4l6 6h-4v10h-4V10H6z", vac: "M4 20h16M7 20V9l5-5 5 5v11M10 14h4", dismiss: "M6 6l12 12M18 6L6 18", transfer: "M4 8h13l-3-3M20 16H7l3 3" };
function rapForm() {
  const t = UI.rapType;
  let body = "", ok = true;
  if (t === "promo") {
    const pc = ME.promo;
    ok = !!(pc && pc.eligible);
    body = pc ? `<div class="promo"><span class="from">${esc(ME.me.rankName)}</span><i></i><span class="to">${esc(pc.name)}</span></div><ul class="checklist">${pc.items.map((i) => `<li class="${i.ok ? "" : i.soft ? "soft" : "no"}">${esc(i.t)}</li>`).join("")}</ul>
      <p class="muted small" style="margin:0">До рапорту автоматично додаються бали на поточному званні й перелік підтверджених звітів. Надлишок балів перейде на наступне звання. Після погодження бот змінить роль звання в Discord.</p>` : '<p class="muted">Найвище звання.</p>';
  } else if (t === "vac") {
    body = `<div class="form-grid"><label class="f"><span>З дати</span><input class="i" type="date" id="r-from" value="${new Date().toISOString().slice(0, 10)}"></label>
      <label class="f"><span>Кількість діб (до 7, ст. 19 ТК)</span><input class="i" type="number" id="r-days" min="1" max="7" value="3"></label>
      <label class="f wide"><span>Причина</span><input class="i" id="r-reason"></label></div>
      <p class="note">На час відпустки здати посвідчення, табельну зброю та спецзасоби.</p>`;
  } else if (t === "dismiss") {
    body = `<label class="f"><span>Мотивування</span><textarea class="i" id="r-reason" placeholder="за власним бажанням у зв'язку з..."></textarea></label>
      <p class="note warn">Після звільнення бот зніме ролі СБУ. Здайте жетон, посвідчення, зброю та спорядження (п. 5.3 Регламенту).</p>`;
  } else if (t === "assign") {
    body = `<div class="form-grid"><label class="f"><span>Підрозділ, до якого проситесь</span><select class="i" id="r-to">${META.opsDepts.map((k) => `<option value="${k}">${esc(META.depts[k].n)}</option>`).join("")}</select></label>
      <label class="f wide"><span>Чому саме цей підрозділ</span><input class="i" id="r-reason"></label></div>
      <p class="note">Погодження: Начальник академії → начальник обраного відділу. Після погодження бот видасть роль відділу.</p>`;
  } else if (t === "refund") {
    body = `<div class="form-grid"><label class="f"><span>Сума, $</span><input class="i mono" type="number" id="r-amount" min="1" step="1" placeholder="напр. 15000"></label>
      <label class="f"><span>Коли витрачено</span><input class="i" type="date" id="r-spent" value="${new Date().toISOString().slice(0, 10)}"></label>
      <label class="f wide"><span>На що витрачено (службова потреба)</span><textarea class="i" id="r-reason" placeholder="напр. заправка службового авто під час операції, ремонт після погоні, купівля спецзасобів…"></textarea></label></div>
      <p class="note">Докази витрат обов'язкові: скріни чеків, банківських переказів або відео. Розглядає Голова СБУ або Заступник.</p>`;
  } else if (t === "transfer") {
    const opts = META.opsDepts.filter((k) => k !== ME.me.dept);
    body = `<div class="form-grid"><label class="f"><span>До відділу</span><select class="i" id="r-to">${opts.map((k) => `<option value="${k}">${esc(META.depts[k].n)}</option>`).join("")}</select></label>
      <label class="f wide"><span>Обґрунтування</span><input class="i" id="r-reason"></label></div>
      <p class="note">Погодження: начальник вашого відділу → начальник відділу, куди переводитесь → Голова СБУ або заступник. Після останньої візи бот замінить роль відділу в Discord.</p>`;
  }
  const academy = ME.me.dept === "academy";
  return `<div class="rap-types">${Object.entries(META.rapTypes).filter(([k]) => k === "assign" ? academy && ME.me.rank === 4 : !(k === "transfer" && academy)).map(([k, n]) => `<button type="button" class="${k === t ? "on" : ""}" data-a="raptype" data-v="${k}">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="${RAP_ICONS[k] || RAP_ICONS.promo}"/></svg><span>${esc(n)}</span></button>`).join("")}</div>
  <div class="grid2 rap-wrap">
    <div class="card"><header><h3>${esc(META.rapTypes[t])}</h3></header><form data-f="rap" style="display:grid;gap:14px">${body}
      <fieldset class="rap-ev"><legend>Докази ${t === "refund" ? "(обов'язково)" : "(за потреби)"}</legend>
        <label class="f"><span>Посилання на відео / відкат</span><input class="i" id="r-ev" placeholder="https://…"></label>
        <label class="f"><span>Файли: скріни, чеки, PDF (до 5)</span><input class="i" id="r-files" type="file" multiple accept="image/*,video/mp4,application/pdf"></label></fieldset>
      ${window.SOVA.tagSelect('id="r-tag"', "")}
      <div><button class="btn gold" type="submit" id="r-btn" ${ok ? "" : "disabled"}>Подати рапорт</button></div></form></div>
    <div class="blank" id="rap-prev">${rapPreview()}</div>
  </div>`;
}

const RAP_ASK = { refund: "відшкодувати мені власні кошти", assign: "розподілити мене після закінчення Академії СБУ до підрозділу", promo: "присвоїти мені чергове спеціальне звання", vac: "надати мені відпустку", dismiss: "звільнити мене зі служби в Службі безпеки штату NG", transfer: "перевести мене до іншого підрозділу" };
function rapPreview() {
  const t = UI.rapType, v = (id) => ($(id) ? $(id).value.trim() : "");
  let ask = RAP_ASK[t] || "";
  if (t === "promo" && ME.promo) ask += ` «${ME.promo.name}»`;
  const dmy = (iso) => iso ? iso.split("-").reverse().join(".") : new Date().toLocaleDateString("uk-UA");
  if (t === "vac") ask += ` тривалістю ${v("#r-days") || "3"} діб з ${dmy(v("#r-from"))}`;
  if ((t === "transfer" || t === "assign") && $("#r-to")) ask += ` — ${META.depts[$("#r-to").value].n}`;
  if (t === "refund") ask += ` у сумі ${(+v("#r-amount") || 0).toLocaleString("uk-UA")}, витрачені ${v("#r-spent") ? dmy(v("#r-spent")) : "…"} на службові потреби`;
  const why = v("#r-reason");
  return `<div class="blank-to">Голові Служби безпеки штату NG<br>від ${esc(ME.me.rankName.toLowerCase())}<br>${esc(META.depts[ME.me.dept].n)}<br><b>${esc(ME.me.name)}</b>, жетон №${ME.me.sid}</div>
    <div class="blank-title">Р А П О Р Т</div>
    <p>Прошу ${esc(ask)}${why ? `, ${esc(why)}` : ""}.</p>
    <div class="blank-sign"><span>${new Date().toLocaleDateString("uk-UA")}</span><span>${esc(ME.me.name)}</span></div>
    <div class="blank-stamp">ЄІС «СОВА»</div>`;
}

/* ---------------- особовий склад і штатна структура ---------------- */
const TIERS = [["Керівництво відділу", 11, 12], ["Керівники груп, секторів та інструктори", 8, 10], ["Оперативний склад", 3, 7], ["Молодший склад", 1, 2]];
const RSHORT = ["Стажер", "Мол. агент", "Агент", "Ст. агент", "Мол. опер", "Опер", "Ст. опер", "Інструктор", "Кер. групи", "Кер. сектору", "Заст. нач. відділу", "Нач. відділу", "Нач. управління", "Заст. Голови", "Голова СБУ"];
const person = (p) => `<div class="pp ${p.sid === ME.me.sid ? "me" : ""} ${p.status === "vacation" ? "vac" : ""}" title="${esc(p.rankName)}"><b>${esc(p.name)}</b><span>${RSHORT[p.rank - 1]}${p.dept === "vkpp" && p.rank >= 5 && p.rank <= 10 ? " академії" : ""}${p.press ? " · прес" : ""} · ${p.sid}</span></div>`;

async function vStaff() {
  const canList = ME.me.rank >= 8;
  const t = tab("staff", "tree");
  const head = tabsBar("staff", [["tree", "Штатна структура"], ...(canList ? [["list", "Особовий склад"]] : []), ["orders", "Накази"], ...(ME.appoint ? [["appoint", "Призначення", ME.pending.orders || undefined]] : [])], "tree");
  if (t === "appoint" && ME.appoint) return window.SOVA.appointView(head);
  if (t === "orders") return window.SOVA.freeOrdersView(head);
  if (t === "list" && canList) {
    const list = await call("/api/staff");
    return head + `${ME.me.dept !== "lead" ? `<p class="note">Особовий склад вашого відділу: ${esc(ME.me.deptName)}.</p>` : ""}
    <div class="card"><div class="tbl-wrap"><table class="t"><thead><tr><th>Жетон</th><th>Співробітник</th><th>Звання</th><th>Відділ</th><th>На званні з</th><th class="r">Бали тиж.</th><th>Статус</th></tr></thead><tbody>
    ${list.map((p) => `<tr><td class="mono">${p.sid}</td><td><b>${esc(p.name)}</b></td><td><span class="rk-dot" style="--n:${p.rank}"></span>${esc(p.rankName)}</td><td>${deptTag(p.dept)}</td><td class="num muted">${fmtDT(p.since)}</td>
      <td class="r"><span class="pts-bar"><i style="width:${Math.min(100, p.points * 4)}%"></i></span><span class="num mono">${p.points}</span></td>
      <td>${p.status === "vacation" ? '<span class="chip info">Відпустка</span>' : '<span class="chip ok">На службі</span>'}</td></tr>`).join("") || '<tr><td colspan="7" class="muted">Нікого немає.</td></tr>'}
    </tbody></table></div></div>`;
  }
  const all = await call("/api/structure");
  const D = META.depts;
  const vac = (t) => `<div class="pp vacant"><b>Вакантно</b><span>${t}</span></div>`;
  const node = (label, ps, empty) => `<div class="org-node ${ps.length ? "" : "empty"}"><div class="org-pos">${label}</div>${ps.length ? ps.map(person).join("") : vac(empty || "")}</div>`;
  const of = (r) => all.filter((p) => p.rank === r);
  // Начальники, що ведуть два відділи (ОРВ+ДЕБ, АТЦ+Альфа), — в Управлінні
  const dualHeads = all.filter((p) => p.rank === 12 && p.depts.length >= 2);
  const inDept = (p, k) => p.dept === k || (p.rank >= 11 && p.rank <= 12 && p.depts.includes(k));
  const tier = (label, ps, empty) => !ps.length && !empty ? "" :
    `<div class="org-tier"><div class="org-tier-t">${label}</div>${ps.length ? ps.map(person).join("") : vac(empty)}</div>`;
  const deptCard = (k) => {
    const d = D[k], ps = all.filter((p) => inDept(p, k) && p.rank < 13);
    return `<section class="org-dept" style="--dc:${d.color}">
      <header><span class="org-abbr">${esc(d.s)}</span><div><b>${esc(d.n)}</b><span>${ps.length} ос.</span></div></header>
      ${tier("Начальник управління · курує відділ", all.filter((p) => p.rank === 13 && p.depts.includes(k)))}
      ${tier("Управління", ps.filter((p) => p.rank >= 11), "начальник відділу")}
      ${tier("Особовий склад", ps.filter((p) => p.rank >= 5 && p.rank <= 10))}
      ${tier("Старші агенти · випускники Академії", ps.filter((p) => p.rank === 4))}
      ${tier("Звання 1–3 з роллю відділу · за структурою мають бути в Академії", ps.filter((p) => p.rank <= 3))}
    </section>`;
  };
  const academy = () => {
    const d = D.vkpp, staff = all.filter((p) => inDept(p, "vkpp") && p.rank < 13), cadets = all.filter((p) => p.dept === "academy");
    return `<section class="org-dept org-academy" style="--dc:${d.color}">
      <header><span class="org-abbr">ВКПП</span><div><b>ВКПП та Академія СБУ</b><span>${staff.length} ос. · ${cadets.length} курсантів</span></div></header>
      ${tier("Управління: начальник академії та заступник", staff.filter((p) => p.rank >= 11), "начальник академії")}
      ${tier("Викладацький та кадровий склад", staff.filter((p) => p.rank >= 5 && p.rank <= 10))}
      ${tier("Випускники · очікують розподілу", cadets.filter((p) => p.rank === 4))}
      ${tier("Новобранці академії", cadets.filter((p) => p.rank <= 3))}
    </section>`;
  };
  const press = all.filter((p) => p.press);
  return head + `<div class="org">
    <div class="org-band">УПРАВЛІННЯ</div>
    <div class="org-top">
      ${node("Голова Служби безпеки", of(15), "Голова СБУ")}
      <div class="org-row">${node("Заступник Голови", of(14), "заступник")}${of(13).length ? of(13).map((p) => node(`Начальник управління${p.depts.length ? ` (${p.depts.map((k) => esc(D[k].s)).join(", ")})` : ""}`, [p])).join("") : node("Начальник управління", [], "начальник управління")}</div>
      ${dualHeads.length ? `<div class="org-row">${dualHeads.map((p) => node(`Начальник відділу (${p.depts.map((k) => esc(D[k].s)).join(", ")})`, [p])).join("")}</div>` : ""}
    </div>
    ${press.length ? `<section class="org-press"><div class="org-press-h"><b>ПРЕС-СЛУЖБА</b><span>позаштатна служба · усі з роллю прес-секретаря</span></div>
      <div class="org-press-l">${press.map(person).join("")}</div></section>` : ""}
    <div class="org-band">ВІДДІЛИ</div>
    <div class="org-depts">${["orv", "vvb", "deb", "atc", "alpha"].map(deptCard).join("")}${academy()}</div>
    <p class="muted small org-legend"><span class="pp me"><b>Ви</b></span> <span class="pp vac"><b>Відпустка</b></span> Склад оновлюється автоматично з ролей Discord.</p>
  </div>`;
}

/* ---------------- кадровий аудит ---------------- */
const AUD_KIND = (a) => /Підвищ/.test(a) ? "up" : /Пониж|Звільн|Відмов|анульов/i.test(a) ? "down" : /допуск|Прийнят|зарахув/i.test(a) ? "in" : /Переведен|Відпуст/.test(a) ? "move" : "misc";
async function vAudit() {
  const list = await call("/api/audit");
  const f = UI.auditF || "all";
  const kinds = [["all", "Усі"], ["in", "Прийом і допуск"], ["up", "Підвищення"], ["move", "Переведення й відпустки"], ["down", "Звільнення й відмови"], ["misc", "Інше"]];
  const q = (UI.auditQ || "").trim().toLowerCase();
  const shown = list.filter((a) => (f === "all" || AUD_KIND(a.action) === f) && (!q || (a.action + " " + a.details + " " + (a.targetUser ? a.targetUser.name : "") + " " + a.target).toLowerCase().includes(q)));
  return `<div class="aud-bar"><div class="aud-f">${kinds.map(([k, l]) => `<button class="${k === f ? "on" : ""}" data-a="auditf" data-v="${k}">${l}</button>`).join("")}</div>
    <input class="i aud-q" id="aud-q" placeholder="Пошук: ім'я, жетон, дія…" value="${esc(UI.auditQ || "")}"></div>
  <div class="aud">${shown.map((a) => `<div class="aud-it k-${AUD_KIND(a.action)}" data-q="${esc((a.action + " " + a.details + " " + (a.targetUser ? a.targetUser.name : "") + " " + a.target + " " + (a.actorUser ? a.actorUser.name : "")).toLowerCase())}">
      <i></i><div class="aud-when"><b>${new Date(a.t).toLocaleDateString("uk-UA", { day: "2-digit", month: "2-digit" })}</b><span>${new Date(a.t).toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit" })}</span></div>
      <div class="aud-body"><div class="aud-act">${esc(a.action)} <span class="mono muted small">${docNo("АУД", a.id)}</span></div>
        <div class="aud-who"><b>${a.targetUser ? esc(a.targetUser.name) : a.target ? "№" + a.target : "—"}</b>${a.details ? ` · ${esc(a.details)}` : ""}</div>
        <div class="muted small">Ухвалив: ${a.actorUser ? esc(a.actorUser.name) : "система «Сова»"}</div></div></div>`).join("") || '<div class="empty">Записів немає.</div>'}</div>`;
}

/* ---------------- кадри: анкети кандидатів (ВВБ → ВКПП) і заявки на допуск ---------------- */
const CST = { vvb: ["chip wait", "Перевірка ВВБ"], vkpp: ["chip wait", "Очікує ВКПП"], ok: ["chip ok", "Погоджено · зв'язатись"], rej: ["chip bad", "Відмовлено"] };
const candChip = (c) => `<span class="${CST[c.status][0]}">${CST[c.status][1]}</span>`;
const docNo = (p, n) => `${p}-${String(n).padStart(4, "0")}`;

const CDOCS = { passport: "Паспорт громадянина", med: "Медична карта", military: "Військовий квиток", kmb: "КМБ у НГУ (замість квитка)", idcard: "Посвідчення особи" };
const CDRIVE = { A: "A", B: "B", CD: "C/D", water: "Водний", air: "Повітряний" };
const CLICS = { weapon: "На зброю", hunt: "На полювання", fish: "На рибальство" };
const CHOUSE = { none: "Немає", flat: "Квартира", house: "Будинок", rent: "Орендоване" };
const dash = (v) => esc(v && String(v).trim() && !/^(немає|нема|-|—)$/i.test(String(v).trim()) ? v : "—");

/* Перевірка вимог: п. 1.4 Положення про стажування СБУ, ст. 8 Закону «Про державні документи», пп. 1.35/1.37/1.38 правил держорганізацій */
function candChecks(x) {
  const d = x.docs || [];
  return [
    ["Паспорт громадянина", d.includes("passport")], ["Медична карта", d.includes("med")], [d.includes("kmb") && !d.includes("military") ? "Військовий квиток → КМБ у НГУ" : "Військовий квиток", d.includes("military") || d.includes("kmb")],
    ["Не перебуває в розшуку", !x.wanted], ["Без активного Warn", !x.warn], ["Не звільнявся протягом доби", !x.fired_1d],
  ];
}

function candRoute(c) {
  const st = c.status, rejAt = st === "rej" ? (c.vkpp_t ? "vkpp" : "vvb") : null;
  const steps = [
    ["Подано", "done", fmtDT(c.t)],
    ["Перевірка ВВБ", rejAt === "vvb" ? "bad" : c.vvb_t ? "done" : "cur", c.vvb_t ? `${esc(c.vvbName || "—")} · ${fmtDT(c.vvb_t)}` : "очікує"],
    ["Рішення ВКПП", rejAt === "vkpp" ? "bad" : c.vkpp_t ? "done" : st === "vkpp" ? "cur" : "", c.vkpp_t ? `${esc(c.vkppName || "—")} · ${fmtDT(c.vkpp_t)}` : st === "vkpp" ? "очікує" : ""],
    ["Зв'язок і допуск", st === "ok" ? "cur" : "", st === "ok" ? "ВКПП запрошує на сервер" : ""],
  ];
  return `<ol class="dz-route">${steps.map(([t, s, sub]) => `<li class="${s}"><i></i><b>${t}</b>${sub ? `<span>${sub}</span>` : ""}</li>`).join("")}</ol>`;
}

function candCard(c, r) {
  const x = c.extra || { docs: [], drive: [], lics: [] };
  const mine = (c.status === "vvb" && r.vvb) || (c.status === "vkpp" && r.vkpp);
  const checks = candChecks(x);
  const fit = checks.every((k) => k[1]);
  const stamp = c.status === "rej" ? ["bad", "ВІДМОВЛЕНО"] : c.status === "ok" ? ["ok", "ПОГОДЖЕНО"] : fit ? ["ok", "ВІДПОВІДАЄ ВИМОГАМ"] : ["bad", "НЕ ВІДПОВІДАЄ ВИМОГАМ"];
  const legal = [x.record && "Судимості", x.wanted && "У розшуку"].filter(Boolean);
  return `<article class="card dz" id="cand-${c.id}">
  <header class="dz-head">
    <div><div class="dz-eyebrow">Служба безпеки штату NG · ВВБ / ВКПП</div><h3>ОСОБОВА СПРАВА КАНДИДАТА</h3></div>
    <div class="dz-no"><span>справа</span><b>${docNo("АНК", c.id)}</b>${candChip(c)}<button class="btn sm" data-a="pdfel" data-sel="#cand-${c.id}" data-name="${docNo("АНК", c.id)}_${esc(c.name)}">⬇ PDF</button></div>
  </header>
  <div class="dz-grif">ДЛЯ СЛУЖБОВОГО КОРИСТУВАННЯ</div>
  <div class="dz-top">
    <figure class="dz-photo">${c.photoUrl ? `<img src="${esc(c.photoUrl)}" alt="Фото кандидата" loading="lazy">` : "<div>ФОТО<br>ВІДСУТНЄ</div>"}
      <figcaption>STATIC ID ${c.sid}</figcaption></figure>
    <div class="dz-id">
      <div class="dz-name">${esc(c.name)}</div>
      <dl class="dz-kv">
        <dt>Static ID</dt><dd class="mono">${c.sid}</dd>
        <dt>Дата народження</dt><dd>${dash(x.birth)}</dd>
        <dt>Стать</dt><dd>${x.gender === "ж" ? "Жіноча" : x.gender === "ч" ? "Чоловіча" : "—"}</dd>
        <dt>Телефон (IC)</dt><dd class="mono">${dash(x.phone)}</dd>
        <dt>Discord</dt><dd class="mono">${dash(c.discord_name)}</dd>
        <dt>OOC</dt><dd>${esc(c.age || "—")} р.${x.online ? " · онлайн " + esc(x.online) : ""}</dd>
      </dl>
    </div>
    <div class="dz-verdict">
      <div class="dz-stamp ${stamp[0]}">${stamp[1]}</div>
      <ul class="dz-checks">${checks.map(([t, ok]) => `<li class="${ok ? "ok" : "bad"}">${t}</li>`).join("")}</ul>
    </div>
  </div>
  <div class="dz-grid">
    <section><h4><b>I</b>Документи</h4>
      <div class="dz-docs">${["passport", "med", (x.docs || []).includes("kmb") && !(x.docs || []).includes("military") ? "kmb" : "military", "idcard"].filter((k) => k !== "idcard" || (x.docs || []).includes(k))
        .map((k) => `<span class="${k === "kmb" ? "warn" : (x.docs || []).includes(k) ? "ok" : "bad"}">${CDOCS[k]}</span>`).join("")}</div>
      <dl class="dz-kv"><dt>Посвідчення водія</dt><dd>${esc((x.drive || []).map((d) => CDRIVE[d]).join(" · ") || "—")}</dd>
        <dt>Ліцензії</dt><dd>${esc((x.lics || []).map((l) => CLICS[l]).join(" · ") || "—")}</dd></dl></section>
    <section><h4><b>II</b>Майно</h4>
      <dl class="dz-kv"><dt>Житло</dt><dd>${esc(CHOUSE[x.housing] || "—")}${x.housing_note ? ` <span class="muted">(${esc(x.housing_note)})</span>` : ""}</dd>
        <dt>Транспорт</dt><dd>${dash(x.cars)}</dd><dt>Бізнес</dt><dd>${dash(x.business)}</dd></dl></section>
    <section><h4><b>III</b>Правова історія</h4>
      <div class="dz-docs">${legal.length ? legal.map((t) => `<span class="bad">${t}</span>`).join("") : '<span class="ok">Судимостей і розшуку немає</span>'}</div>
      <dl class="dz-kv">${x.record_note ? `<dt>Судимості</dt><dd>${esc(x.record_note)}</dd>` : ""}<dt>Адмінпорушення</dt><dd>${dash(x.admin_note)}</dd></dl></section>
    <section><h4><b>IV</b>Службовий досвід</h4><p class="dz-text">${esc(c.exp || "—")}</p></section>
    <section class="wide"><h4><b>V</b>Мотивація</h4><p class="dz-text quote">${esc(c.motive || "—")}</p></section>
    <section class="wide"><h4><b>VI</b>Трудова книжка</h4>${c.workUrl
      ? `<a href="${esc(c.workUrl)}" target="_blank" rel="noopener" title="Відкрити в повному розмірі"><img src="${esc(c.workUrl)}" alt="Трудова книжка кандидата" loading="lazy" style="display:block;max-width:100%;max-height:520px;border:1px solid var(--line2)"></a>`
      : '<p class="dz-text muted">Не додано (анкета подана до запровадження цього пункту).</p>'}</section>
  </div>
  ${c.note ? `<div class="dz-note"><b>Причина відмови:</b> ${esc(c.note)}</div>` : ""}
  ${candRoute(c)}
  ${r.vvb || r.vkpp ? `<div class="dz-del"><button class="btn sm bad" data-a="del" data-url="/api/hr/cand/${c.id}/delete" data-q="Видалити анкету ${docNo("АНК", c.id)} (спам, дубль)? Фото кандидата й трудову книжку теж буде видалено.">🗑 Видалити анкету</button></div>` : ""}
  ${mine ? `<footer class="dz-act"><span class="muted small">${c.status === "vvb" ? "Висновок Відділу внутрішньої безпеки" : "Рішення Відділу кадрів та підготовки персоналу"}</span>
    <div class="acts"><button class="btn ok" data-a="cand" data-id="${c.id}" data-d="ok">${c.status === "vvb" ? "Погодити й передати до ВКПП" : "Погодити зарахування"}</button>
    <button class="btn bad" data-a="cand" data-id="${c.id}" data-d="rej">Відмовити</button></div></footer>` : ""}
</article>`;
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
        <td class="r"><div class="acts" style="justify-content:flex-end"><button class="btn sm ok" data-a="accd" data-id="${a.id}" data-d="ok">Надати допуск</button><button class="btn sm bad" data-a="accd" data-id="${a.id}" data-d="rej">Відмовити</button><button class="btn sm" data-a="del" data-url="/api/hr/access/${a.id}/delete" data-q="Видалити заявку на допуск (спам, дубль)?" title="Видалити">🗑</button></div></td></tr>`).join("")}
      </tbody></table></div></div>`;
  }
  if (t === "done") {
    const acc = d.accessDone.map((a) => `<tr><td class="mono">${docNo("ЗД", a.id)}</td><td>${esc(a.name)} <span class="muted">№${a.sid}</span></td><td>${a.status === "ok" ? '<span class="chip ok">Допуск надано</span>' : '<span class="chip bad">Відмовлено</span>'}</td><td>${esc(a.reviewerName || "—")}</td><td class="muted num">${fmtDT(a.reviewed)}</td></tr>`).join("");
    return head + (d.candDone.length ? d.candDone.map((c) => candCard(c, r)).join("") : '<div class="empty">Розглянутих анкет ще немає.</div>')
      + (acc ? `<div class="card"><header><h3>Заявки на допуск</h3></header><div class="tbl-wrap"><table class="t"><thead><tr><th>Заявка</th><th>Заявник</th><th>Рішення</th><th>Хто</th><th>Коли</th></tr></thead><tbody>${acc}</tbody></table></div></div>` : "");
  }
  return head + note + (d.cand.length ? d.cand.map((c) => candCard(c, r)).join("") : '<div class="empty">Немає анкет на розгляд.</div>');
}

const HOOKS = [];
const VIEWS = { home: vHome, act: vAct, rap: vRap, staff: vStaff, audit: vAudit, hr: vHr };

/* ---------------- адреси сторінок: #/розділ/вкладка/документ ----------------
   Кожен екран має свою адресу: працюють «Назад» / «Вперед» (браузер, планшет), оновлення сторінки й посилання.
   Розділ описує свій стан у ROUTES[розділ] = { get: () => [частини адреси], set: (частини) => стан }.
   Без опису — адреса з поточної вкладки розділу. Переглядач файлів додає «/~/<id файлу>». */
const ROUTES = {};
const defRoute = (v) => ({ get: () => [UI.tabs[v]], set: (p) => { if (p[0]) UI.tabs[v] = p[0]; else delete UI.tabs[v]; } });
const isId = (x) => /^\d+$/.test(x || "");
ROUTES.home = { get: () => [], set: () => {} };
ROUTES.act = { get: () => UI.actId ? [UI.actId] : [UI.tabs.act],
  set: (p) => { UI.actId = isId(p[0]) ? +p[0] : null; if (!UI.actId) { if (p[0]) UI.tabs.act = p[0]; else delete UI.tabs.act; } } };
ROUTES.rap = { get: () => UI.rapId ? [UI.rapId] : UI.tabs.rap === "new" ? ["new", UI.rapType] : [UI.tabs.rap],
  set: (p) => { UI.rapId = isId(p[0]) ? +p[0] : null; if (!UI.rapId) { if (p[0]) UI.tabs.rap = p[0]; else delete UI.tabs.rap; } if (p[0] === "new" && p[1]) UI.rapType = p[1]; } };
let fromHistory = false, lastPath = "", DIRTY = false;
function routePath() {
  const parts = ((ROUTES[UI.view] || defRoute(UI.view)).get() || []).filter((x) => x !== null && x !== undefined && x !== "");
  return "#/" + UI.view + (parts.length ? "/" + parts.map((x) => encodeURIComponent(x)).join("/") : "") + (UI.file ? "/~/" + encodeURIComponent(UI.file) : "");
}
// розібрати адресу: розділ, його частини й відкритий у переглядачі файл
function parseRoute(hash) {
  const parts = (hash || "").replace(/^#\/?/, "").split("/").filter(Boolean).map((x) => { try { return decodeURIComponent(x); } catch (e) { return x; } });
  const fi = parts.indexOf("~");
  return { view: parts[0] || "home", parts: (fi >= 0 ? parts.slice(0, fi) : parts).slice(1), file: fi >= 0 ? parts[fi + 1] || null : null };
}
function applyRoute(hash) {
  const r = parseRoute(hash);
  if (r.view !== UI.view) HOOKS.forEach((f) => f(r.view));  // інші розділи скидають свій стан, як при переході з меню
  UI.view = r.view;
  UI.actId = null; UI.rapId = null;
  try { (ROUTES[r.view] || defRoute(r.view)).set(r.parts); } catch (e) { console.warn("Адреса", hash, e); }
  UI.file = r.file;
}
// після кожного рендеру — записати адресу; новий екран = новий запис в історії, той самий — без змін
function syncUrl() {
  const p = routePath();
  if (p !== location.hash) {
    if (fromHistory || !location.hash || !lastPath) history.replaceState({ y: 0 }, "", p);
    else history.pushState({ y: 0 }, "", p);
  }
  lastPath = p; fromHistory = false;
  const open = document.getElementById("viewer");
  if (UI.file && !(open && !open.hidden && open.dataset.id === UI.file)) openViewer(UI.file);
  else if (!UI.file) closeViewer();
}
// позиція прокрутки кожного запису історії — щоб «Назад» повертав на те саме місце
let scrollT = 0;
addEventListener("scroll", () => {
  clearTimeout(scrollT);
  scrollT = setTimeout(() => { try { history.replaceState({ ...(history.state || {}), y: scrollY }, ""); } catch (e) {} }, 250);
}, { passive: true });
addEventListener("popstate", async (e) => {
  if (!TOKEN || !ME) return;
  const was = parseRoute(lastPath), now = parseRoute(location.hash);
  const sameScreen = was.view === now.view && was.parts.join("/") === now.parts.join("/");
  if (!sameScreen && DIRTY && !confirm("Є незбережені зміни у формі. Вийти без збереження?")) { history.pushState({ y: scrollY }, "", lastPath); return; }
  if (sameScreen) {  // змінився лише переглядач файлу — без перемальовування сторінки
    UI.file = now.file; lastPath = location.hash;
    return now.file ? openViewer(now.file) : closeViewer();
  }
  DIRTY = false;
  applyRoute(location.hash);
  fromHistory = true;
  await render();
  scrollTo(0, (e.state && e.state.y) || 0);
});
// незбережені зміни: введення у формах на сторінці; попередження при виході зі сторінки чи закритті вкладки
document.addEventListener("input", (e) => { if (e.target.closest("#view form, #view .kf-ed, #view [data-f]") && e.target.type !== "search" && !/-q$/.test(e.target.id || "")) DIRTY = true; });
document.addEventListener("submit", (e) => { if (!e.target.closest(".docgo")) DIRTY = false; }, true);
addEventListener("beforeunload", (e) => { if (DIRTY) { e.preventDefault(); e.returnValue = ""; } });
// кнопки переходу поза формою (меню, вкладки, «← назад», відкрити документ) — спитати, якщо форма змінена
const LEAVE = /^(nav|go|goto|tab|\w*back|\w*open|\w*tab|kbopen|dpsel)$/;
function leaveOk(b) {
  if (!DIRTY || !LEAVE.test(b.dataset.a || "") || b.closest("form")) return true;
  if (!confirm("Є незбережені зміни у формі. Вийти без збереження?")) return false;
  DIRTY = false;
  return true;
}

/* ---------------- переглядач скрінів і відео всередині сайту (своя адреса: «Назад» закриває його) ---------------- */
async function openViewer(id) {
  let box = document.getElementById("viewer");
  if (!box) {
    box = document.createElement("div");
    box.id = "viewer";
    box.className = "viewer";
    box.addEventListener("click", (e) => { if (e.target === box || e.target.closest("[data-vclose]")) closeFile(); });
    document.body.append(box);
  }
  box.dataset.id = id;
  box.innerHTML = '<div class="viewer-bar"><span class="spin"></span><span class="sp"></span><button class="btn sm" data-vclose>✕ Закрити</button></div>';
  box.hidden = false;
  document.body.classList.add("viewer-on");
  try {
    const r = await call(`/api/files/${encodeURIComponent(id)}/url`);
    if (box.dataset.id !== id) return;
    const ext = (new URL(r.url).pathname.split(".").pop() || "").toLowerCase();
    const media = /^(png|jpe?g|gif|webp|bmp)$/.test(ext) ? `<img src="${esc(r.url)}" alt="Файл">`
      : /^(mp4|webm|mov|m4v)$/.test(ext) ? `<video src="${esc(r.url)}" controls autoplay playsinline></video>`
      : `<div class="viewer-file"><p>Цей файл (.${esc(ext)}) не відкривається в переглядачі.</p><a class="btn gold" href="${esc(r.url)}" target="_blank" rel="noopener">Відкрити файл</a></div>`;
    box.innerHTML = `<div class="viewer-bar"><a class="btn sm" href="${esc(r.url)}" target="_blank" rel="noopener" download>⬇ Завантажити</a><span class="sp"></span><button class="btn sm" data-vclose>✕ Закрити</button></div><div class="viewer-body">${media}</div>`;
  } catch (e) {
    box.innerHTML = `<div class="viewer-bar"><span class="sp"></span><button class="btn sm" data-vclose>✕ Закрити</button></div><div class="viewer-body"><p class="note bad">${esc(e.message)}</p></div>`;
  }
}
function closeViewer() {
  const box = document.getElementById("viewer");
  if (box) { box.hidden = true; box.innerHTML = ""; delete box.dataset.id; }
  document.body.classList.remove("viewer-on");
}
// відкрити файл: новий запис історії; закрити — «Назад» (якщо відкрили ми) або просто прибрати з адреси
function showFile(id) {
  UI.file = id;
  const p = routePath();
  history.pushState({ y: scrollY, file: id }, "", p);
  lastPath = p;
  openViewer(id);
}
function closeFile() {
  if (history.state && history.state.file) return history.back();
  UI.file = null;
  const p = routePath();
  history.replaceState({ y: scrollY }, "", p);
  lastPath = p;
  closeViewer();
}
addEventListener("keydown", (e) => { if (e.key === "Escape" && UI.file) closeFile(); });

/* ---------------- рендер ---------------- */
async function boot() {
  try {
    [META, ME] = await Promise.all([META || call("/api/meta"), call("/api/me")]);
    meAt = Date.now();
    if (window.SOVA.loadTags) await window.SOVA.loadTags();
  } catch (e) {
    if (!TOKEN) return render();
    // Бот перезапускається або тунель ще не піднявся: вхід збережено — чекаємо й пробуємо знову, а не показуємо екран входу
    if (/зв'язку/.test(e.message)) {
      $("#app").innerHTML = `<div class="login"><div class="login-card"><img src="sbu-logo.webp" alt="" width="120" height="120">
        <h1>ЄІС «СОВА»</h1><p class="sub"><span class="spin"></span> Відновлюю зв'язок із ботом… Вхід збережено, сторінка відкриється автоматично.</p></div></div>`;
      return setTimeout(boot, 5000);
    }
    return render(e.message);
  }
  applyRoute(location.hash);
  fromHistory = true;  // перший екран — замінити запис, а не додавати
  await render();
  const y = history.state && history.state.y;
  if (y) scrollTo(0, y);
}

async function render(err) {
  if (!TOKEN || !ME) {
    $("#app").innerHTML = viewLogin(err);
    checkBot();
    return;
  }
  if (!NAV.find((n) => n[0] === UI.view && navOk(n))) UI.view = (NAV.find(navOk) || ["home"])[0];
  if (Date.now() - meAt > ME_FRESH) await refreshMe();
  if (!TOKEN || !ME) return render();
  $("#app").innerHTML = viewShell(loading);
  const view = UI.view;
  try {
    const html = await VIEWS[view]();
    if (UI.view === view && $("#view")) $("#view").innerHTML = html;
  } catch (e) {
    if ($("#view")) $("#view").innerHTML = `<p class="note bad">${esc(e.message)}</p>`;
  }
  DIRTY = false;
  if (UI.view === view) syncUrl();
}

let meAt = 0;  // коли востаннє оновлювали дані співробітника (бали, баланс для підвищення, лічильники в меню)
const ME_FRESH = 30_000;
async function refreshMe() {
  try { ME = await call("/api/me"); meAt = Date.now(); } catch (e) {}
}
// Повернення у вкладку чи застосунок: свіжі бали (напр., поки людини не було, начальник підтвердив звіт).
// Форму, яку людина заповнює, не чіпаємо; прокрутка лишається на місці.
// Нова версія сайту: сторінка, відкрита давно (планшет, вкладка на весь день), сама перезавантажується —
// інакше людина й далі працює старим кодом (напр., шле в Discord криві картинки документів). Форму, яку заповнюють, не перериваємо.
const assetVer = (doc) => [...doc.querySelectorAll("script[src*=\"?v=\"], link[href*=\"?v=\"]")].map((n) => n.getAttribute("src") || n.getAttribute("href")).sort().join("|");
let updTold = false;
async function checkUpdate() {
  try {
    const html = await (await fetch(`index.html?u=${Date.now()}`, { cache: "no-store" })).text();
    const live = assetVer(new DOMParser().parseFromString(html, "text/html")), mine = assetVer(document);
    if (!live || !mine || live === mine) return;
    if (!DIRTY) return location.reload();
    if (!updTold) { updTold = true; toast("Вийшло оновлення сайту: збережіть форму — і сторінка оновиться сама", 1); }
  } catch (e) {}
}
setInterval(checkUpdate, 5 * 60 * 1000);
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") checkUpdate(); });
document.addEventListener("visibilitychange", async () => {
  if (document.visibilityState !== "visible" || !TOKEN || !ME || DIRTY || Date.now() - meAt < ME_FRESH) return;
  const y = scrollY;
  await render();
  scrollTo(0, y);
});

// номер документа → його адреса на сайті
const DOC_PATHS = { "ЗВТ": "act/{}", "РАП": "rap/{}", "КФ": "cases/{}", "ПЗ": "kb/prot/{}", "КЛ": "fin/{}", "ЗВК": "fin/{}", "ВП": "bonus/{}",
  "НС": "disc/journal", "НП": "staff/appoint", "НГ": "staff/orders", "АНК": "hr" };
const LAT = { Z: "З", V: "В", T: "Т", R: "Р", A: "А", P: "П", K: "К", F: "Ф", L: "Л", N: "Н", S: "С", G: "Г", H: "Н", C: "С" };
function docPath(q) {
  const m = String(q || "").trim().toUpperCase().replace(/[A-Z]/g, (c) => LAT[c] || c).match(/^([А-ЯІЇЄҐ]{2,3})[\s№#-]*0*(\d{1,6})$/);
  return m && DOC_PATHS[m[1]] ? DOC_PATHS[m[1]].replace("{}", m[2]) : null;
}

const A = {
  goto: (b) => { applyRoute("#/" + (b.dataset.path || "home")); render(); scrollTo(0, 0); },
  nav: (b) => { UI.view = b.dataset.v; UI.rapId = null; HOOKS.forEach((f) => f(UI.view)); render(); scrollTo(0, 0); },
  go: (b) => { UI.actId = null; UI.view = b.dataset.v; if (b.dataset.tab) UI.tabs[b.dataset.v] = b.dataset.tab; render(); scrollTo(0, 0); },
  rapopen: (b) => { UI.rapId = +b.dataset.id; render(); scrollTo(0, 0); },
  rapback: () => { UI.rapId = null; render(); },
  raptype: (b) => { UI.rapType = b.dataset.v; render(); },
  auditf: (b) => { UI.auditF = b.dataset.v; render(); },
  tab: (b) => { UI.rapId = null; UI.actId = null; UI.tabs[b.dataset.k] = b.dataset.v; render(); },
  logout: () => logout(false),
  file: async (b) => {
    showFile(b.dataset.id);
  },
  // універсальна кнопка PDF: data-sel — селектор бланка на сторінці, data-name — назва файлу
  verify: (b) => verifyCard(b),
  csgo: () => document.getElementById("cs-card")?.scrollIntoView({ behavior: "smooth", block: "center" }),
  cswd: async (b) => {
    if (!confirm("Відкликати заявку на позивний?")) return;
    b.disabled = true;
    try { await call(`/api/callsign/${b.dataset.id}/withdraw`, { json: {} }); toast("Заявку відкликано"); await refreshMe(); render(); }
    catch (e) { toast(e.message, 1); b.disabled = false; }
  },
  csdec: async (b) => {
    let note = "";
    if (b.dataset.d === "rej") { note = prompt("Причина відмови (співробітник її побачить):", ""); if (note === null) return; }
    b.disabled = true;
    try { await call(`/api/callsign/${b.dataset.id}/decide`, { json: { decision: b.dataset.d, note } }); toast(b.dataset.d === "ok" ? "Позивний затверджено — нікнейм змінено" : "Відмовлено"); await refreshMe(); render(); }
    catch (e) { toast(e.message, 1); b.disabled = false; }
  },
  pdfel: (b) => window.SOVA.pdfBtn(b, b.dataset.sel, b.dataset.name),
  actopen: (b) => { UI.actId = +b.dataset.id; UI.view = "act"; render(); scrollTo(0, 0); },
  actback: () => { UI.actId = null; render(); },
  actpdf: (b) => {
    const a = window.SOVA.cache.acts && window.SOVA.cache.acts[b.dataset.id];
    if (a) window.SOVA.pdfA4(b, actA4(a), `${docNo("ЗВТ", a.id)}_${(META.acts[a.type] || {}).n || ""}`);
  },
  rappdf: (b) => { const r = window.SOVA.cache.rap; if (r) window.SOVA.pdfA4(b, rapA4(r), `${docNo("РАП", r.id)}_${META.rapTypes[r.type] || ""}`); },
  actd: async (b) => {
    b.disabled = true;
    try { await call(`/api/acts/${b.dataset.id}/decision`, { json: { decision: b.dataset.d } }); toast(b.dataset.d === "ok" ? "Звіт підтверджено" : "Звіт відхилено"); await actImage(+b.dataset.id); await refreshMe(); render(); }
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
  del: async (b) => {
    if (!confirm(b.dataset.q || "Видалити?")) return;
    b.disabled = true;
    try { await call(b.dataset.url, { json: {} }); toast("Видалено"); UI.rapId = null; await refreshMe(); render(); }
    catch (e) { toast(e.message, 1); b.disabled = false; }
  },
  wd: async (b) => {
    if (!confirm(b.dataset.k === "acts" ? "Відкликати звіт з перевірки?" : "Відкликати рапорт з розгляду?")) return;
    b.disabled = true;
    try { await call(`/api/${b.dataset.k}/${b.dataset.id}/withdraw`, { json: {} }); toast("Документ відкликано"); await (b.dataset.k === "acts" ? actImage : rapImage)(+b.dataset.id); await refreshMe(); render(); }
    catch (e) { toast(e.message, 1); b.disabled = false; }
  },
  rapd: async (b) => {
    b.disabled = true;
    try { await call(`/api/raps/${b.dataset.id}/decision`, { json: { decision: b.dataset.d } }); toast(b.dataset.d === "ok" ? "Рапорт погоджено. Бот оновив ролі й журнал аудиту" : "Рапорт відхилено"); await rapImage(+b.dataset.id); await refreshMe(); render(); }
    catch (e) { toast(e.message, 1); b.disabled = false; }
  },
};

const F = {
  docgo: () => {
    const inp = $("#docgo-q"), path = docPath(inp.value);
    if (!path) return toast("Вкажіть номер документа, напр. ЗВТ-0042, РАП-13, КФ-7, ПЗ-12, НС-5", 1);
    inp.value = "";
    if (DIRTY && !confirm("Є незбережені зміни у формі. Вийти без збереження?")) return;
    DIRTY = false;
    applyRoute("#/" + path);
    render();
    scrollTo(0, 0);
  },
  cs: async (f) => {
    const b = f.querySelector("[type=submit]"), v = $("#cs-in").value.trim();
    if (!v) return toast("Вкажіть позивний", 1);
    b.disabled = true;
    try { await call("/api/callsign", { json: { callsign: v } }); toast("Позивний подано начальнику відділу"); await refreshMe(); render(); }
    catch (e) { toast(e.message, 1); b.disabled = false; }
  },
  login: doLogin,
  act: async () => {
    const btn = $("#a-btn");
    btn.disabled = true;
    btn.innerHTML = '<span class="spin"></span> Надсилаю…';
    try {
      const files = await uploadFiles($("#a-files"));
      const r = await call("/api/acts", { json: {
        type: $("#a-type").value, t: new Date($("#a-t").value).getTime() || Date.now(), qty: +$("#a-qty").value || 1,
        arts: $("#a-arts").value.split(/[,;\s]+/).filter(Boolean), subj: $("#a-subj").value, evidence: $("#a-ev").value.trim(), files, note: $("#a-note").value,
        tag: $("#a-tag") ? $("#a-tag").value : "",
      } });
      toast("Звіт надіслано. Картка з'явилась у каналі відділу");
      await actImage(r.id);
      UI.tabs.act = "mine";
      render();
    } catch (e) { toast(e.message, 1); btn.disabled = false; btn.textContent = "Надіслати на перевірку"; }
  },
  rap: async () => {
    const btn = $("#r-btn");
    btn.disabled = true;
    const v = (id) => ($(id) ? $(id).value.trim() : "");
    try {
      const files = $("#r-files") && $("#r-files").files.length ? await uploadFiles($("#r-files")) : [];
      const r = await call("/api/raps", { json: { type: UI.rapType, reason: v("#r-reason"), days: +v("#r-days") || undefined, from: v("#r-from"), to: v("#r-to"),
        amount: v("#r-amount") || undefined, spent: v("#r-spent") || undefined, evidence: v("#r-ev"), files, tag: v("#r-tag") } });
      toast("Рапорт подано");
      await rapImage(r.id);
      UI.tabs.rap = "mine";
      await refreshMe();
      render();
    } catch (e) { toast(e.message, 1); btn.disabled = false; }
  },
};

// живий приклад нікнейму під полем позивного
document.addEventListener("input", (e) => {
  if (e.target.id !== "cs-in") return;
  const p = document.getElementById("cs-prev");
  if (p) p.textContent = p.dataset.s.replace("ПОЗИВНИЙ", e.target.value.replace(/\s+/g, "").toUpperCase() || "ПОЗИВНИЙ").slice(0, 32);
});
document.addEventListener("click", (e) => { const b = e.target.closest("[data-a]"); if (!b || b.disabled) return; const ln = e.target.closest("a[href]"); if (ln && ln !== b && b.contains(ln)) return; const f = A[b.dataset.a]; if (f) { e.preventDefault(); if (leaveOk(b)) f(b); } });
document.addEventListener("submit", (e) => { const f = e.target.closest("[data-f]"); if (!f) return; e.preventDefault(); const h = F[f.dataset.f]; if (h) h(f, e); });
document.addEventListener("input", (e) => {
  if (e.target.closest("form[data-f=rap]") && $("#rap-prev")) $("#rap-prev").innerHTML = rapPreview();
  if (e.target.id === "aud-q") {
    UI.auditQ = e.target.value;
    const q = e.target.value.trim().toLowerCase();
    document.querySelectorAll(".aud-it").forEach((el) => { el.hidden = !!q && !el.dataset.q.includes(q); });
  }
});
document.addEventListener("change", (e) => {
  if (e.target.id === "a-type" && $("#a-qty-f")) { $("#a-qty-f").hidden = e.target.value !== "patrol"; if (e.target.value !== "patrol") $("#a-qty").value = 1; }
  if (e.target.closest("form[data-f=rap]") && $("#rap-prev")) $("#rap-prev").innerHTML = rapPreview(); if (e.target.dataset.change === "raptype") { UI.rapType = e.target.value; render(); } });

// Спільні хелпери для модулів (cases.js)
window.SOVA = { esc, fmtDT, call, toast, $, uploadFiles, render, refreshMe, views: VIEWS, actions: A, forms: F, onNav: HOOKS, cache: {},
  ME: () => ME, META: () => META, routes: ROUTES, safeUrl, showFile, setDirty: (v) => { DIRTY = !!v; }, reloadMeta: async () => { META = await call("/api/meta"); } };

window.SOVA.docImageFns = Object.assign(window.SOVA.docImageFns || {}, { act: actImage, rap: rapImage });
if (TOKEN) boot(); else render();
})();
