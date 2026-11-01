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
};
const ico = (k) => `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">${IC[k] || IC.soon}</svg>`;
const NAV = [
  ["home", "Головна", () => true],
  ["act", "Моя активність", () => true],
  ["rap", "Рапорти", () => true],
  ["staff", "Особовий склад", () => true],
  ["kb", "База даних", () => true],
  ["bonus", "Премії", () => true],
  ["disc", "Дисципліна", () => true],
  ["dept", "Розділ відділу", () => !!(ME.control && ME.control.length)],
  ["cases", "Кейс-файли", () => !!(ME.cases && ME.cases.view)],
  ["hr", "Кадри", () => !!(ME.hr && (ME.hr.vvb || ME.hr.vkpp))],
  ["audit", "Кадровий аудит", (u) => u.rank >= 12 || !!(ME.hr && ME.hr.vkpp)],
];
const SOON = [];
// Генеральний прокурор (не співробітник СБУ) бачить лише кейс-файли
const navOk = (n) => n[2](ME.me) && (ME.me.dept !== "prosecutor" || n[0] === "cases");
const TITLES = { home: "Службовий кабінет", act: "Звіти про діяльність", rap: "Рапорти", staff: "Особовий склад і штатна структура", audit: "Кадровий аудит", hr: "Кадри: кандидати й допуски", cases: "Кейс-файли", dept: "Розділ відділу", bonus: "Премії", disc: "Дисципліна", kb: "База даних" };

function viewShell(inner) {
  const p = ME.pending || {};
  const badge = { kb: p.exams, staff: p.orders, act: p.acts, rap: p.raps, hr: p.hr, cases: p.cases, disc: p.disc || (ME.disc && ME.disc.active) || 0 };
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
      <div class="right"><span class="dbadge">${esc(META.depts[ME.me.dept].s)}</span><button class="btn sm" data-a="logout">Вийти</button></div></header>
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

async function vHome() {
  const acts = await call("/api/acts");
  const pc = ME.promo;
  const pend = ME.pending || {};
  const me = ME.me, d = META.depts[me.dept];
  const wait = acts.filter((a) => a.status === "wait").length, okN = acts.filter((a) => a.status === "ok").length;
  const goal = Math.max(ME.pointsPrev, 20);
  const todo = [
    pend.acts && ["act", "review", "Звіти на перевірку", pend.acts],
    pend.raps && ["rap", "review", "Рапорти на розгляд", pend.raps],
    pend.hr && ["hr", "cand", "Кадрові справи", pend.hr],
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
    </div>
    <div class="hero-stats">
      ${ring(ME.points, goal, "балів за тиждень")}
      <div class="mini"><span>Минулий тиждень</span><b class="num">${ME.pointsPrev}</b></div>
      <div class="mini"><span>Звітів на перевірці</span><b class="num">${wait}</b></div>
      <div class="mini"><span>Підтверджено за весь час</span><b class="num">${okN}</b></div>
    </div>
  </section>
  ${todo.length ? `<section class="todo"><div class="eyebrow">Потребує вашого рішення</div><div class="todo-row">
    ${todo.map(([v, t, l, n]) => `<button class="todo-item" data-a="go" data-v="${v}" data-tab="${t}">${ico(v)}<span>${l}</span><b class="num">${n}</b></button>`).join("")}</div></section>` : ""}
  <div class="grid2">
    <div class="card"><header><h3>Наступне звання</h3>${pc ? `<span class="sp chip ${pc.eligible ? "ok" : "wait"}">${pc.eligible ? "Можна подати рапорт" : "Умови ще не виконано"}</span>` : ""}</header>
      ${pc ? `<div class="promo"><span class="from">${esc(me.rankName)}</span><i></i><span class="to">${esc(pc.name)}</span></div>
        ${pc.items[0] && pc.items[0].pct !== undefined ? `<div class="bar ${pc.items[0].ok ? "ok" : ""}"><i style="width:${Math.round(pc.items[0].pct * 100)}%"></i></div>` : ""}
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
        <div class="files"><a class="btn sm" href="${esc(a.evidence)}" target="_blank" rel="noopener">▶ Відкрити</a></div></li>` : ""}
      ${a.files.length ? `<li><div>Додатки: ${a.files.length} (зберігаються в ЄІС «Сова»)</div><div class="files">${a.files.map((f, i) => `<button class="btn sm" data-a="file" data-id="${esc(f)}">📎 Файл ${i + 1}</button>`).join("")}</div></li>` : ""}</ol>` : "<p>—</p>")}
    ${sec("V", "Резолюція", `<p class="kd-text">${a.status === "wait" ? "Очікує перевірки керівником підрозділу." : `${esc(stLabel[a.status] || "")}${a.reviewer ? ` · ${esc(a.reviewer.rankName || "")} <span class="kf-sign">${esc(a.reviewer.name)}</span>` : ""}${a.reviewed ? ` · ${fmtDT(a.reviewed)}` : ""}`}</p>`)}
    <div class="act-stamp ${sc}">${sw}</div>
    <footer class="kd-foot">ЄІС «Сова» · ${docNo("ЗВТ", a.id)} · Для службового користування</footer></div>`;
}
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
        <div class="files"><button class="btn sm gold" data-a="actopen" data-id="${a.id}">📂 Відкрити звіт</button><button class="btn sm" data-a="actpdf" data-id="${a.id}">⬇ PDF</button>${a.evidence ? `<a class="btn sm" href="${esc(a.evidence)}" target="_blank" rel="noopener">▶ Відкат</a>` : ""}${a.files.map((f, i) => `<button class="btn sm" data-a="file" data-id="${esc(f)}">📎 Файл ${i + 1}</button>`).join("")}</div>
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
      <button class="btn" data-a="actpdf" data-id="${a.id}">⬇ PDF</button>
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
        <label class="f"><span>Кількість (патруль — блоків по 30 хв)</span><input class="i" id="a-qty" type="number" min="1" max="12" value="1"></label>
        <label class="f"><span>Статті КК (через кому)</span><input class="i mono" id="a-arts" placeholder="напр. 263, 342"></label>
        <label class="f"><span>Фігурант</span><input class="i" id="a-subj" placeholder="ім'я або «невстановлена особа»"></label>
        <label class="f"><span>Доказ: посилання на відкат</span><input class="i" id="a-ev" placeholder="https://..."></label>
        <label class="f wide"><span>Скріни (до 5 файлів, зберігаються в Discord)</span><input class="i" id="a-files" type="file" accept="image/*,video/mp4,application/pdf" multiple></label>
        <label class="f wide"><span>Обставини</span><textarea class="i" id="a-note" placeholder="Що сталося, хто був у наряді"></textarea></label>
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
    : [["from", "нач. " + (META.depts[r.dept] || {}).s], ["to", "нач. " + (META.depts[d.to] || {}).s], ["chief", "Голова"]];
  return `<div class="tr-visas">${steps.map(([k, l]) => `<span class="${vis[k] ? (vis[k].ok === false ? "bad" : "ok") : r.status === "wait" && st === k ? "cur" : ""}">${vis[k] ? (vis[k].ok === false ? "✖" : "✔") : "○"} ${esc(l)}${vis[k] ? ` · ${esc(vis[k].name)}` : ""}</span>`).join("")}</div>`;
}

function rapDesc(r) {
  const d = r.data || {};
  if (r.type === "promo") return `→ <b>${esc(META.ranks[d.to - 1] ? META.ranks[d.to - 1].n : d.to)}</b>`;
  if (r.type === "vac") return `${d.days} діб${d.from ? " з " + esc(d.from) : ""}${d.reason ? " · " + esc(d.reason) : ""}`;
  if (r.type === "assign") return `Академія → ${deptTag(d.to)}${d.reason ? " · " + esc(d.reason) : ""}${trVisas(r)}`;
  if (r.type === "transfer") return `${deptTag(r.dept)} → ${deptTag(d.to)}${d.reason ? " · " + esc(d.reason) : ""}${trVisas(r)}`;
  return esc(d.reason || "");
}

const RAP_STAMP = { ok: ["ПОГОДЖЕНО", "ok"], rej: ["ВІДМОВЛЕНО", "bad"], wait: ["НА РОЗГЛЯДІ", "wait"], cancel: ["ВІДКЛИКАНО", "mute"] };
async function vRapView(id) {
  const r = await call(`/api/raps/${id}`);
  const a = r.by || { name: "—", rankName: "", sid: "" }, d = META.depts[r.dept] || {};
  const [sw, sc] = RAP_STAMP[r.status] || ["", ""];
  const bar = `<div class="kd-bar"><button class="btn" data-a="rapback">← До рапортів</button><span class="sp"></span>
    <button class="btn" data-a="pdfel" data-sel=".rap-doc" data-name="${docNo("РАП", r.id)}_${esc(META.rapTypes[r.type] || "")}">⬇ PDF</button>
    ${r.canDecide ? `<button class="btn ok" data-a="rapd" data-id="${r.id}" data-d="ok">Погодити</button><button class="btn bad" data-a="rapd" data-id="${r.id}" data-d="rej">Відмовити</button>` : ""}
    ${r.mine && r.status === "wait" ? `<button class="btn" data-a="wd" data-k="raps" data-id="${r.id}">↩ Відкликати</button>` : ""}
    ${r.mine && ["wait", "rej", "cancel"].includes(r.status) ? `<button class="btn bad" data-a="del" data-url="/api/raps/${r.id}/delete" data-q="Видалити рапорт?">🗑 Видалити</button>` : ""}</div>`;
  return bar + `<div class="rap-view"><div class="blank rap-doc">
      <div class="rap-no">${docNo("РАП", r.id)}</div>
      <div class="blank-to">Голові Служби безпеки штату NG<br>від ${esc((a.rankName || "").toLowerCase())}<br>${esc(d.n || "")}<br><b>${esc(a.name)}</b>, жетон №${a.sid}</div>
      <div class="blank-title">Р А П О Р Т</div>
      <div class="rap-sub">${esc((META.rapTypes[r.type] || "").replace("Рапорт ", ""))}</div>
      <p>${esc(r.text)}</p>
      <div class="blank-sign"><span>${new Date(r.t).toLocaleString("uk-UA", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}</span><span class="kf-sign">${esc(a.name)}</span></div>
      ${["transfer", "assign"].includes(r.type) ? `<div class="rap-visas"><b>Візи погодження</b>${trVisas(r)}</div>` : ""}
      <div class="rap-res"><b>Резолюція:</b> ${r.status === "wait" ? `очікує розгляду${r.stageLabel ? " · зараз: " + esc(r.stageLabel) : ""}` : esc(sw.toLowerCase())}
        ${r.reviewer ? ` · ${esc(r.reviewer.rankName || "")} <span class="kf-sign">${esc(r.reviewer.name)}</span>` : ""}${r.reviewed ? ` · ${fmtDT(r.reviewed)}` : ""}</div>
      <div class="rap-stamp ${sc}">${sw}</div>
    </div></div>`;
}

async function vRap() {
  if (UI.rapId) return vRapView(UI.rapId);
  const canRev = ME.me.rank >= 12 || !!(ME.hr && ME.hr.vkpp) || (ME.pending.raps || 0) > 0;
  const t = tab("rap", "mine");
  const head = tabsBar("rap", [["mine", "Мої рапорти"], ["new", "Подати рапорт"], ...(canRev ? [["review", "На розгляд", ME.pending.raps || 0]] : [])], "mine");
  if (t === "new") return head + rapForm();
  const list = await call("/api/raps" + (t === "review" ? "?scope=review" : ""));
  if (!list.length) return head + `<div class="empty">${t === "review" ? "Немає рапортів на розгляд." : "Ви ще не подавали рапортів."}</div>`;
  return head + `<div class="docs">${list.map((r) => `<article class="doc st-${r.status} clickable" data-a="rapopen" data-id="${r.id}" title="Відкрити рапорт">
      <div class="doc-no"><b>${docNo("РАП", r.id)}</b><span>${fmtDT(r.t)}</span></div>
      <div class="doc-main">${t === "review" ? `<div class="doc-who">${who(r.by)} ${deptTag(r.dept)}</div>` : ""}
        <div class="doc-title">${esc(META.rapTypes[r.type])}</div><div class="doc-line">${rapDesc(r)}</div></div>
      <div class="doc-side">${t === "review"
        ? `<button class="btn sm ok" data-a="rapd" data-id="${r.id}" data-d="ok">Погодити</button><button class="btn sm bad" data-a="rapd" data-id="${r.id}" data-d="rej">Відмовити</button>`
        : `<span class="doc-stamp">${{ ok: "Погоджено", rej: "Відмовлено", wait: "На розгляді", cancel: "Відкликано" }[r.status]}</span>${r.reviewer ? `<span class="muted small">${esc(r.reviewer.name)}</span>` : ""}${r.status === "wait" ? `<button class="btn sm" data-a="wd" data-k="raps" data-id="${r.id}">↩ Відкликати</button>` : ""}${["wait", "rej", "cancel"].includes(r.status) ? `<button class="btn sm bad" data-a="del" data-url="/api/raps/${r.id}/delete" data-q="Видалити документ? Його буде прибрано з кабінету, у журналі Discord лишиться запис.">🗑 Видалити</button>` : ""}`}</div>
    </article>`).join("")}</div>`;
}

const RAP_ICONS = { assign: "M12 3l8 4-8 4-8-4zM6 9.5V14c0 1.7 2.7 3 6 3s6-1.3 6-3V9.5M20 7v6", promo: "M12 4l6 6h-4v10h-4V10H6z", vac: "M4 20h16M7 20V9l5-5 5 5v11M10 14h4", dismiss: "M6 6l12 12M18 6L6 18", transfer: "M4 8h13l-3-3M20 16H7l3 3" };
function rapForm() {
  const t = UI.rapType;
  let body = "", ok = true;
  if (t === "promo") {
    const pc = ME.promo;
    ok = !!(pc && pc.eligible);
    body = pc ? `<div class="promo"><span class="from">${esc(ME.me.rankName)}</span><i></i><span class="to">${esc(pc.name)}</span></div><ul class="checklist">${pc.items.map((i) => `<li class="${i.ok ? "" : i.soft ? "soft" : "no"}">${esc(i.t)}</li>`).join("")}</ul>
      <p class="muted small" style="margin:0">До рапорту автоматично додаються бали за цей і минулий тиждень. Після погодження бот змінить роль звання в Discord.</p>` : '<p class="muted">Найвище звання.</p>';
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
      <div><button class="btn gold" type="submit" id="r-btn" ${ok ? "" : "disabled"}>Подати рапорт</button></div></form></div>
    <div class="blank" id="rap-prev">${rapPreview()}</div>
  </div>`;
}

const RAP_ASK = { assign: "розподілити мене після закінчення Академії СБУ до підрозділу", promo: "присвоїти мені чергове спеціальне звання", vac: "надати мені відпустку", dismiss: "звільнити мене зі служби в Службі безпеки штату NG", transfer: "перевести мене до іншого підрозділу" };
function rapPreview() {
  const t = UI.rapType, v = (id) => ($(id) ? $(id).value.trim() : "");
  let ask = RAP_ASK[t] || "";
  if (t === "promo" && ME.promo) ask += ` «${ME.promo.name}»`;
  if (t === "vac") ask += ` тривалістю ${v("#r-days") || "3"} діб з ${v("#r-from") || new Date().toISOString().slice(0, 10)}`;
  if ((t === "transfer" || t === "assign") && $("#r-to")) ask += ` — ${META.depts[$("#r-to").value].n}`;
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
      <div class="org-row">${node("Заступник Голови", of(14), "заступник")}${node("Начальник управління", of(13), "начальник управління")}</div>
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
  </div>
  ${c.note ? `<div class="dz-note"><b>Причина відмови:</b> ${esc(c.note)}</div>` : ""}
  ${candRoute(c)}
  ${r.vvb || r.vkpp ? `<div class="dz-del"><button class="btn sm bad" data-a="del" data-url="/api/hr/cand/${c.id}/delete" data-q="Видалити анкету ${docNo("АНК", c.id)} (спам, дубль)? Фото кандидата теж буде видалено.">🗑 Видалити анкету</button></div>` : ""}
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

/* ---------------- рендер ---------------- */
async function boot() {
  try {
    [META, ME] = await Promise.all([META || call("/api/meta"), call("/api/me")]);
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
  render();
}

async function render(err) {
  if (!TOKEN || !ME) {
    $("#app").innerHTML = viewLogin(err);
    checkBot();
    return;
  }
  if (!NAV.find((n) => n[0] === UI.view && navOk(n))) UI.view = (NAV.find(navOk) || ["home"])[0];
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
  nav: (b) => { UI.view = b.dataset.v; UI.rapId = null; HOOKS.forEach((f) => f(UI.view)); render(); scrollTo(0, 0); },
  go: (b) => { UI.actId = null; UI.view = b.dataset.v; if (b.dataset.tab) UI.tabs[b.dataset.v] = b.dataset.tab; render(); scrollTo(0, 0); },
  rapopen: (b) => { UI.rapId = +b.dataset.id; render(); scrollTo(0, 0); },
  rapback: () => { UI.rapId = null; render(); },
  raptype: (b) => { UI.rapType = b.dataset.v; render(); },
  auditf: (b) => { UI.auditF = b.dataset.v; render(); },
  tab: (b) => { UI.rapId = null; UI.actId = null; UI.tabs[b.dataset.k] = b.dataset.v; render(); },
  logout: () => logout(false),
  file: async (b) => {
    try { const r = await call(`/api/files/${encodeURIComponent(b.dataset.id)}/url`); window.open(r.url, "_blank", "noopener"); }
    catch (e) { toast(e.message, 1); }
  },
  // універсальна кнопка PDF: data-sel — селектор бланка на сторінці, data-name — назва файлу
  pdfel: (b) => window.SOVA.pdfBtn(b, b.dataset.sel, b.dataset.name),
  actopen: (b) => { UI.actId = +b.dataset.id; UI.view = "act"; render(); scrollTo(0, 0); },
  actback: () => { UI.actId = null; render(); },
  actpdf: (b) => {
    const a = window.SOVA.cache.acts && window.SOVA.cache.acts[b.dataset.id];
    if (a) window.SOVA.pdfBtn(b, actDoc(a), `${docNo("ЗВТ", a.id)}_${(META.acts[a.type] || {}).n || ""}`);
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
  del: async (b) => {
    if (!confirm(b.dataset.q || "Видалити?")) return;
    b.disabled = true;
    try { await call(b.dataset.url, { json: {} }); toast("Видалено"); UI.rapId = null; await refreshMe(); render(); }
    catch (e) { toast(e.message, 1); b.disabled = false; }
  },
  wd: async (b) => {
    if (!confirm(b.dataset.k === "acts" ? "Відкликати звіт з перевірки?" : "Відкликати рапорт з розгляду?")) return;
    b.disabled = true;
    try { await call(`/api/${b.dataset.k}/${b.dataset.id}/withdraw`, { json: {} }); toast("Документ відкликано"); await refreshMe(); render(); }
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

document.addEventListener("click", (e) => { const b = e.target.closest("[data-a]"); if (!b || b.disabled) return; const ln = e.target.closest("a[href]"); if (ln && ln !== b && b.contains(ln)) return; const f = A[b.dataset.a]; if (f) { e.preventDefault(); f(b); } });
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
  if (e.target.closest("form[data-f=rap]") && $("#rap-prev")) $("#rap-prev").innerHTML = rapPreview(); if (e.target.dataset.change === "raptype") { UI.rapType = e.target.value; render(); } });

// Спільні хелпери для модулів (cases.js)
window.SOVA = { esc, fmtDT, call, toast, $, uploadFiles, render, refreshMe, views: VIEWS, actions: A, forms: F, onNav: HOOKS, cache: {},
  ME: () => ME, META: () => META };

if (TOKEN) boot(); else render();
})();
