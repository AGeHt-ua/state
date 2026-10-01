/* Сайт кабінету (office/<id>/ або office/?o=<id>): окремий інтерфейс зі своїм гербом, кольорами й меню,
   але на спільних даних порталу (люди, документи, звернення, справи, state_ws — рапорти, завдання, премії).
   Заходять працівники кабінету й повні адміністратори; керують — керівник і заступники. Права перевіряє й сервер. */
const WS_THEMES = {
  governor:   { side: "#0d1f3a", side2: "#17345f", accent: "#d4a62f", ink: "#1b1400", motto: "Уряд штату Сан-Андреас" },
  prosecutor: { side: "#0b2236", side2: "#14395a", accent: "#8fb8de", ink: "#08131f", motto: "Законність · Справедливість" },
  court:      { side: "#3b0d19", side2: "#5c1628", accent: "#c9a227", ink: "#1f1300", motto: "Правосуддя · Незалежність" },
  finance:    { side: "#0b3326", side2: "#13513c", accent: "#3cc48c", ink: "#03140d", motto: "Бюджет · Прозорість" },
  security:   { side: "#16191f", side2: "#262b35", accent: "#e5484d", ink: "#fff", motto: "Безпека · Порядок" },
  culture:    { side: "#2a1240", side2: "#43205f", accent: "#c08ae6", ink: "#1a0a26", motto: "Мистецтво · Спадщина" },
  health:     { side: "#0a3536", side2: "#125052", accent: "#36c2b4", ink: "#03201d", motto: "Здоров'я · Турбота" },
  bar:        { side: "#33200f", side2: "#4f3218", accent: "#d2a86a", ink: "#1f1406", motto: "Захист · Право" },
  usss:       { side: "#08080b", side2: "#17171d", accent: "#e0b84a", ink: "#130e00", motto: "Worthy of Trust and Confidence" },
  directors:  { side: "#10294d", side2: "#1a3d6e", accent: "#5b9be0", ink: "#04101f", motto: "Виконавча влада" }
};
const WS_DEFAULT_THEME = { side: "#0d1f3a", side2: "#17345f", accent: "#d4a62f", ink: "#1b1400", motto: "Робочий простір кабінету" };

whenStateReady(async function () {
  const $ = (id) => document.getElementById(id);
  const user = requireAuth();
  if (!user) return;
  const officeId = document.body.dataset.office || new URLSearchParams(location.search).get("o") || userOffice(user);
  const office = allOffices().find((o) => o.id === officeId);
  const theme = WS_THEMES[officeId] || WS_DEFAULT_THEME;
  const gov = (GOV_STRUCTURE.find((g) => g.office.id === officeId) || {}).office || {};
  const icon = (office && office.icon) || gov.icon || "🏛️";
  const body = document.body;
  body.style.setProperty("--ws-side", theme.side);
  body.style.setProperty("--ws-side-2", theme.side2);
  body.style.setProperty("--ws-accent", theme.accent);
  body.style.setProperty("--ws-accent-ink", theme.ink);
  body.style.setProperty("--ws-soft", theme.accent + "22");

  const allowed = !!office && canEnterOffice(user, officeId);
  const manager = allowed && isOfficeManager(user, officeId);
  const officeName = office ? office.name : "Кабінет";
  document.title = officeName + " — робочий простір";

  // Розділи сайту кабінету
  const SECTIONS = [
    { id: "home", icon: "🏠", label: "Головна" },
    { id: "reports", icon: "📝", label: "Рапорти" },
    { id: "tasks", icon: "📌", label: "Завдання" }
  ].concat(officeId === "prosecutor" ? [{ id: "proc", icon: "⚖", label: "Провадження" }] : [])
    .concat(officeId === "court" ? [{ id: "cases", icon: "⚖", label: "Судові справи" }] : [])
    .concat([
      { id: "docs", icon: "📄", label: "Документи" },
      { id: "appeals", icon: "✉", label: "Звернення" },
      { id: "people", icon: "👥", label: "Склад" },
      { id: "work", icon: "📊", label: "Облік і звіти" }
    ]).concat(manager ? [{ id: "settings", icon: "⚙", label: "Налаштування" }] : []);
  // Ланцюжок звітів: Мінфін перевіряє й підписує звіти всіх підрозділів, Губернатор погоджує премії
  const payrollRole = manager && officeId === "finance" ? "finance" : manager && officeId === "governor" ? "governor" : "";
  if (payrollRole) SECTIONS.splice(3, 0, payrollRole === "finance"
    ? { id: "payrolls", icon: "🧾", label: "Звіти підрозділів" }
    : { id: "payrolls", icon: "💰", label: "Премії на погодження" });

  /* ---------- Каркас сторінки ---------- */
  const others = workspaceOffices().filter((o) => o.id !== officeId && canEnterOffice(user, o.id));
  body.innerHTML = `
    <aside class="ws-side" id="ws-side">
      <div class="ws-brand">
        <div class="ws-emblem" aria-hidden="true">${esc(icon)}</div>
        <b>${esc(officeName)}</b>
        <small>${esc(theme.motto)}</small>
      </div>
      <nav class="ws-nav" id="ws-nav" aria-label="Розділи кабінету"></nav>
      ${others.length ? `<label class="ws-switch-label"><small style="color:rgba(233,238,247,.6)">Інший кабінет</small>
        <select id="ws-switch" style="width:100%;margin-top:4px"><option value="">— обрати —</option>${others.map((o) => `<option value="${attr(o.id)}">${esc(o.name)}</option>`).join("")}</select></label>` : ""}
      <div class="ws-me">
        <div class="ws-me-row">
          ${user.photo ? `<img src="${attr(user.photo)}" alt="">` : `<span class="ws-av">${esc(String(user.username || "?").charAt(0).toUpperCase())}</span>`}
          <div style="min-width:0"><b>${esc(user.username || user.login)}</b><small>${esc((positionById(user.positionId) || {}).title || user.post || officeTitle(user))}</small></div>
        </div>
        <div class="ws-me-actions">
          <a href="${attr(pathTo(""))}" title="Основний портал штату">↩ Портал</a>
          <a href="${attr(pathTo("cabinet/"))}">Профіль</a>
          <button type="button" id="theme-toggle" title="Тема">◐</button>
          <button type="button" data-logout>Вийти</button>
        </div>
      </div>
    </aside>
    <div class="ws-main">
      <header class="ws-top">
        <button type="button" class="ws-menu-btn" id="ws-menu" aria-label="Меню">☰</button>
        <div><div class="ws-crumb">${esc(officeName)}</div><h1 id="ws-title">—</h1></div>
        <div class="ws-top-actions" id="ws-actions"></div>
      </header>
      <main class="ws-content" id="ws-content"></main>
    </div>
    ${modalsHtml()}`;
  if (others.length) $("ws-switch").addEventListener("change", (e) => { if (e.target.value) location.href = officeUrl(e.target.value); });
  $("ws-menu").addEventListener("click", () => body.classList.toggle("ws-menu-open"));
  $("ws-side").addEventListener("click", (e) => { if (e.target.closest(".ws-nav a")) body.classList.remove("ws-menu-open"); });

  if (!allowed) {
    $("ws-nav").innerHTML = "";
    $("ws-title").textContent = "Немає доступу";
    $("ws-content").innerHTML = `<section class="card"><h3>Робочий простір закритий</h3>
      <p class="muted">Сюди заходять лише працівники кабінету «${esc(officeName)}». Якщо ви тут працюєте — попросіть адміністратора призначити вас на посаду.</p>
      <a class="btn gold" href="${attr(pathTo("cabinet/"))}">До свого кабінету</a></section>`;
    return;
  }

  /* ---------- Допоміжне ---------- */
  const nameOf = (login) => { const u = allUsers().find((x) => x.login === login); return u ? u.name || u.login : login || "—"; };
  const posOf = (u) => (positionById(u.positionId) || {}).title || u.post || "";
  const isMgr = (u) => { const p = positionById(u.positionId); return !!p && (p.level === "head" || p.manager === true); };
  const money = (n, cur) => (Number(n) || 0).toLocaleString("uk-UA") + " " + (cur || "$");
  const today = () => new Date().toISOString().slice(0, 10);
  const avatar = (u, cls) => u && u.photo ? `<img src="${attr(u.photo)}" alt="">` : `<span class="${cls || "ws-av"}">${esc(String((u && (u.name || u.login)) || "?").charAt(0).toUpperCase())}</span>`;
  let courtSel = location.hash.startsWith("#case=") ? decodeURIComponent(location.hash.slice(6)) : "";
  const ui = { section: courtSel && officeId === "court" ? "cases" : SECTIONS.some((s) => s.id === location.hash.slice(1)) ? location.hash.slice(1) : "home",
    reportFilter: manager ? "review" : "mine", period: "week", payrollFilter: "", payrollOpen: "", from: "", to: "", open: "", docStatus: "all" };
  let noteFiles = null;

  function counts() {
    const reports = wsItems(officeId, "report");
    const tasks = wsItems(officeId, "task");
    return {
      reports: manager ? reports.filter((r) => r.status === "submitted").length : reports.filter((r) => r.author === user.login && r.status === "returned").length,
      tasks: tasks.filter((t) => manager ? t.status === "done" : t.assignee === user.login && ["new", "returned"].includes(t.status)).length,
      cases: officeId === "court" ? allCases().filter((c) => c.status === "new").length : 0,
      appeals: allAppeals().filter((a) => a.office === officeId && a.status === "waiting").length,
      payrolls: payrollRole === "finance" ? allPayrolls().filter((p) => p.status === "submitted").length
        : payrollRole === "governor" ? allPayrolls().filter((p) => p.status === "signed").length : 0,
      work: manager ? allPayrolls().filter((p) => p.office === officeId && p.status === "returned").length : 0
    };
  }

  function period() {
    const now = new Date();
    let from, to, label;
    if (ui.period === "week") {
      from = new Date(now.getFullYear(), now.getMonth(), now.getDate()); from.setDate(from.getDate() - ((from.getDay() + 6) % 7));
      to = new Date(from); to.setDate(to.getDate() + 7); label = "цей тиждень";
    } else if (ui.period === "prevweek") {
      const w = weekRange(-1); return { from: w.from, to: w.to, label: "тиждень " + w.label };
    } else if (ui.period === "prev") {
      from = new Date(now.getFullYear(), now.getMonth() - 1, 1); to = new Date(now.getFullYear(), now.getMonth(), 1); label = "минулий місяць";
    } else if (ui.period === "custom" && ui.from && ui.to) {
      from = new Date(ui.from + "T00:00"); to = new Date(ui.to + "T00:00"); to.setDate(to.getDate() + 1); label = ui.from + " — " + ui.to;
    } else {
      from = new Date(now.getFullYear(), now.getMonth(), 1); to = new Date(now.getFullYear(), now.getMonth() + 1, 1); label = "цей місяць";
    }
    return { from: from.toISOString(), to: to.toISOString(), label };
  }

  /* ---------- Головна ---------- */
  function secHome() {
    const c = counts();
    const myTasks = wsItems(officeId, "task").filter((t) => t.assignee === user.login && t.status !== "accepted");
    const p = period();
    const stats = workStats(officeId, p.from, p.to);
    const mine = stats.rows.find((r) => r.login === user.login);
    // Стрічка: останні події кабінету
    const feed = [];
    wsItems(officeId).forEach((w) => (w.events || []).slice(-3).forEach((e) => feed.push({ at: e.at, icon: w.kind === "report" ? "📝" : w.kind === "task" ? "📌" : w.kind === "bonus" ? "💰" : "•", text: (w.title ? "«" + w.title + "»: " : "") + (e.text || ""), by: e.byName })));
    allDocs().filter((d) => d.office === officeId && ["ok", "review", "congress"].includes(d.status)).slice(0, 10).forEach((d) => feed.push({ at: d.publishedAt || d.updatedAt || d.date, icon: "📄", text: d.title + " — " + (DOC_STATUSES[d.status] || d.status), by: d.author }));
    feed.sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")));
    return `
      <section class="ws-hero">
        <div class="ws-emblem" aria-hidden="true">${esc(icon)}</div>
        <div><h2>Вітаємо, ${esc(user.username || user.login)}</h2><p>${esc(officeName)} · ${esc((positionById(user.positionId) || {}).title || user.post || "")}${manager ? " · керівництво кабінету" : ""}</p></div>
      </section>
      <div class="ws-cards">
        <div class="ws-card"><b>${officeMembers(officeId).length}</b><span>працівників</span></div>
        <div class="ws-card"><b>${mine ? mine.points : 0}</b><span>ваших балів за ${esc(p.label)}</span></div>
        <div class="ws-card"><b>${c.reports}</b><span>${manager ? "рапортів на розгляді" : "рапортів повернено"}</span></div>
        <div class="ws-card"><b>${c.tasks}</b><span>${manager ? "завдань на перевірці" : "нових завдань"}</span></div>
        ${officeId === "court" ? `<div class="ws-card"><b>${c.cases}</b><span>нових справ</span></div>` : ""}
        <div class="ws-card"><b>${c.appeals}</b><span>звернень чекають відповіді</span></div>
      </div>
      <div class="ws-grid-2">
        <section class="card">
          <div class="section-head"><h3>Мої завдання</h3><a class="btn ghost" href="#tasks">Усі завдання</a></div>
          <div class="ws-list">${myTasks.length ? myTasks.map((t) => `<a class="ws-item ws-item-head ws-link" href="#tasks" data-goto-task="${attr(t.id)}"><span><b>${esc(t.title)}</b><small>${esc(WS_TASK_STATUSES[t.status] || t.status)}${t.due ? " · до " + esc(t.due.split("-").reverse().join(".")) : ""}</small></span><span class="pill">${esc(t.points || 0)} б.</span></a>`).join("") : `<div class="admin-empty">Активних завдань немає.</div>`}</div>
        </section>
        <section class="card">
          <h3>Останні події</h3>
          <div class="ws-feed">${feed.slice(0, 8).map((f) => `<div class="ws-feed-item"><span>${f.icon}</span><div><b>${esc(f.text)}</b><small>${esc(f.by || "")}${f.at ? " · " + esc(formatDocWhen({ date: f.at })) : ""}</small></div></div>`).join("") || `<p class="muted">Подій ще немає.</p>`}</div>
        </section>
      </div>`;
  }

  /* ---------- Рапорти ---------- */
  function secReports() {
    let items = wsItems(officeId, "report");
    if (!manager) items = items.filter((r) => r.author === user.login);
    if (ui.reportFilter === "review") items = items.filter((r) => r.status === "submitted");
    if (ui.reportFilter === "mine") items = items.filter((r) => r.author === user.login);
    const statusCls = (s) => s === "accepted" ? "ok" : s === "submitted" ? "draft" : "dead";
    const w = wsSettings(officeId).weights;
    return `
      <div class="appeals-toolbar">
        <div class="seg" id="report-filter">
          ${manager ? `<button type="button" data-rf="review" class="${ui.reportFilter === "review" ? "active" : ""}">На розгляді</button>` : ""}
          <button type="button" data-rf="mine" class="${ui.reportFilter === "mine" ? "active" : ""}">Мої</button>
          ${manager ? `<button type="button" data-rf="all" class="${ui.reportFilter === "all" ? "active" : ""}">Усі</button>` : ""}
        </div>
      </div>
      <div class="ws-list">
        ${items.length ? items.map((r) => `
          <article class="ws-item${ui.open === r.id ? " is-open" : ""}">
            <button type="button" class="ws-item-head" data-open="${attr(r.id)}">
              <span><b>${esc(r.title || "Рапорт")}</b><small>${esc(r.type || "")} · ${esc(nameOf(r.author))} · ${esc(formatDocWhen({ date: r.createdAt || r.updatedAt }))}</small></span>
              <span class="ws-item-side">${r.status === "accepted" ? `<span class="pill">+${esc(r.points != null && r.points !== "" ? r.points : w.report)} б.</span>` : ""}<span class="badge ${statusCls(r.status)}">${esc(WS_REPORT_STATUSES[r.status] || r.status)}</span></span>
            </button>
            ${ui.open === r.id ? `
            <div class="ws-item-body">
              <p class="ws-text">${esc(r.text || "").replace(/\n/g, "<br>")}</p>
              ${attachmentsHtml((r.events || []).filter((e) => e.kind === "files").flatMap((e) => e.attachments || []))}
              ${(r.events || []).filter((e) => e.kind === "review").map((e) => `<p class="notice">${esc(e.text)} <small class="muted">— ${esc(e.byName || "")}, ${esc(formatDocWhen({ date: e.at }))}</small></p>`).join("")}
              ${manager && r.status === "submitted" ? `
                <form class="case-action-row" data-review="${attr(r.id)}">
                  <b>Рішення</b>
                  <label class="muted">Бали <input type="number" name="points" min="0" max="100" value="${attr(w.report)}" style="width:80px"></label>
                  <input name="comment" placeholder="Коментар (необов'язково)">
                  <button type="submit" class="btn gold" data-decision="accepted">Прийняти</button>
                  <button type="submit" class="btn ghost" data-decision="returned">Повернути</button>
                  <button type="submit" class="btn ghost danger" data-decision="rejected">Відхилити</button>
                </form>` : ""}
              ${r.author === user.login && r.status === "returned" ? `<button type="button" class="btn ghost" data-edit-report="${attr(r.id)}">Доопрацювати й подати знову</button>` : ""}
            </div>` : ""}
          </article>`).join("") : `<div class="admin-empty">${ui.reportFilter === "review" ? "Рапортів на розгляді немає." : "Рапортів ще немає. Натисніть «+ Подати рапорт»."}</div>`}
      </div>`;
  }

  /* ---------- Завдання ---------- */
  function secTasks() {
    let tasks = wsItems(officeId, "task");
    if (!manager) tasks = tasks.filter((t) => t.assignee === user.login);
    const cols = [
      { label: "Нові й повернені", match: (t) => t.status === "new" || t.status === "returned" },
      { label: "У роботі", match: (t) => t.status === "progress" },
      { label: "На перевірці", match: (t) => t.status === "done" },
      { label: "Прийнято", match: (t) => t.status === "accepted", limit: 8 }
    ];
    const card = (t) => {
      const overdue = t.due && t.due < today() && !["done", "accepted"].includes(t.status);
      return `<button type="button" class="ws-task${ui.open === t.id ? " is-active" : ""}" data-open="${attr(t.id)}">
        <b>${esc(t.title)}</b>
        <small>${esc(nameOf(t.assignee))}${t.due ? ` · <span class="${overdue ? "ws-overdue" : ""}">до ${esc(t.due.split("-").reverse().join("."))}</span>` : ""}</small>
        <span class="pill">${esc(t.points || 0)} б.</span>${t.transferredFrom ? `<span class="pill">з: ${esc((allOffices().find((o) => o.id === t.transferredFrom) || {}).name || t.transferredFrom)}</span>` : ""}
      </button>`;
    };
    const t = tasks.find((x) => x.id === ui.open);
    return `
      <p class="muted" style="margin:0">${manager ? "Ставте завдання працівникам і приймайте виконані — бали підуть в облік." : "Ваші завдання: візьміть у роботу й позначте виконаним — керівництво перевірить."}</p>
      <div class="ws-board">
        ${cols.map((c) => { const list = tasks.filter(c.match); return `<div class="ws-col"><h4>${esc(c.label)} <small class="muted">${list.length}</small></h4>${(c.limit ? list.slice(0, c.limit) : list).map(card).join("") || `<p class="muted ws-empty">—</p>`}</div>`; }).join("")}
      </div>
      ${t ? `
      <section class="card ws-task-detail">
        <div class="section-head">
          <div><h3>${esc(t.title)}</h3><p class="muted">${esc(WS_TASK_STATUSES[t.status] || t.status)} · виконавець: ${esc(nameOf(t.assignee))}${t.due ? " · строк " + esc(t.due.split("-").reverse().join(".")) : ""} · ${esc(t.points || 0)} б.</p></div>
          <button type="button" class="btn ghost" data-close-task>Закрити</button>
        </div>
        ${t.text ? `<p class="ws-text">${esc(t.text).replace(/\n/g, "<br>")}</p>` : ""}
        <div class="case-timeline appeal-chat">${(t.events || []).map((e) => `<div class="case-event"><span>•</span><div><b>${esc(e.text || "")}</b>${attachmentsHtml(e.attachments)}<small>${esc(e.byName || "")} · ${esc(formatDocWhen({ date: e.at }))}</small></div></div>`).join("")}</div>
        <div class="case-action-row">
          ${t.assignee === user.login && ["new", "returned"].includes(t.status) ? `<button type="button" class="btn ghost" data-task-status="progress">Взяти в роботу</button>` : ""}
          ${t.assignee === user.login && ["new", "progress", "returned"].includes(t.status) ? `<button type="button" class="btn gold" data-task-status="done">Виконано</button>` : ""}
          ${manager && t.status === "done" ? `<button type="button" class="btn gold" data-task-status="accepted">Прийняти (+${esc(t.points || 0)} б.)</button><button type="button" class="btn ghost" data-task-status="returned">Повернути на доопрацювання</button>` : ""}
          ${manager && t.status !== "accepted" ? `<button type="button" class="btn ghost" data-edit-task="${attr(t.id)}">Редагувати</button><button type="button" class="btn ghost" data-transfer-task="${attr(t.id)}">Передати в інший кабінет</button>` : ""}
          ${manager ? `<button type="button" class="btn ghost danger" data-delete-task="${attr(t.id)}">Видалити</button>` : ""}
        </div>
        ${manager || t.assignee === user.login ? `
        <form class="appeal-reply" id="task-note">
          <textarea name="text" rows="2" placeholder="Коментар, результат, докази… (Ctrl+Enter)"></textarea>
          <div class="att-chips" id="task-files-list" hidden></div>
          <div class="form-actions">
            <label class="btn ghost att-add" title="Фото чи PDF">📎<input type="file" id="task-files" accept="image/*,application/pdf" multiple hidden></label>
            <button class="btn ghost" type="submit">Додати коментар</button>
          </div>
        </form>` : ""}
      </section>` : ""}`;
  }

  /* ---------- Прокуратура: провадження ---------- */
  function secProc() {
    const mine = allCases().filter((c) => officeMembers("prosecutor").some((m) => m.login === c.createdBy) || c.createdBy === user.login);
    return `
      <p class="muted" style="margin:0">Сформуйте справу й передайте її до Верховного Суду. Суд відкриє провадження, призначить засідання й винесе рішення — хід справи видно тут.</p>
      <div class="ws-list">
        ${mine.length ? mine.map((c) => `
          <a class="ws-item ws-item-head ws-link" href="${attr(pathTo("cabinet/court/#" + encodeURIComponent(c.id)))}">
            <span><b>${esc(c.number)} · ${esc(c.title || "")}</b><small>${esc(c.kind || "")} · проти ${esc((c.defendant && c.defendant.name) || "—")} · передав ${esc(nameOf(c.createdBy))}${c.hearing && c.hearing.at ? " · засідання " + esc(formatHearing(c.hearing.at)) : ""}</small></span>
            <span class="badge ${caseStatusClass(c.status)}">${esc(CASE_STATUSES[c.status] || c.status)}</span>
          </a>`).join("") : `<div class="admin-empty">Прокуратура ще не передавала справ до суду.</div>`}
      </div>`;
  }

  /* ---------- Суд: справи (повний судовий інтерфейс, assets/ws/court-ui.js) ---------- */
  function secCases() {
    return `<div id="court-root"></div>`;
  }

  /* ---------- Документи кабінету ---------- */
  function secDocs() {
    let docs = allDocs().filter((d) => d.office === officeId && d.status !== "trash");
    if (ui.docStatus === "ok") docs = docs.filter((d) => d.status === "ok");
    if (ui.docStatus === "work") docs = docs.filter((d) => ["draft", "review", "congress"].includes(d.status));
    if (ui.docStatus === "mine") docs = docs.filter((d) => d.ownerLogin === user.login);
    return `
      <div class="appeals-toolbar">
        <div class="seg" id="doc-filter">
          ${[["all", "Усі"], ["ok", "Чинні"], ["work", "У роботі"], ["mine", "Мої"]].map(([k, l]) => `<button type="button" data-df="${k}" class="${ui.docStatus === k ? "active" : ""}">${l}</button>`).join("")}
        </div>
      </div>
      <div class="ws-list">
        ${docs.length ? docs.map((d) => `
          <a class="ws-item ws-item-head ws-link" href="${attr(docHref(d))}">
            <span><b>${esc(d.title)}</b><small>${esc(d.type)} · ${esc(d.number || "")} · ${esc(d.author || "")} · ${esc(formatDocWhen(d))}</small></span>
            <span class="badge ${attr(badgeClass(d.status))}">${esc(DOC_STATUSES[d.status] || d.status)}</span>
          </a>`).join("") : `<div class="admin-empty">Документів кабінету за цим фільтром немає.</div>`}
      </div>`;
  }

  /* ---------- Звернення до кабінету ---------- */
  function secAppeals() {
    const list = allAppeals().filter((a) => a.office === officeId).sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)));
    const cls = (s) => s === "answered" ? "ok" : s === "closed" ? "dead" : "draft";
    return `
      <p class="muted" style="margin:0">Звернення громадян до кабінету. Відповідь — у переписці звернення.</p>
      <div class="ws-list">
        ${list.length ? list.map((a) => `
          <a class="ws-item ws-item-head ws-link" href="${attr(pathTo("cabinet/appeals/#" + encodeURIComponent(a.id)))}">
            <span><b>${esc(a.number || "")} · ${esc(a.kind || "Звернення")}</b><small>${esc(a.name || "")} · ${esc(String(a.text || "").slice(0, 120))}</small></span>
            <span class="badge ${cls(a.status)}">${esc(appealStatusLabel(a.status))}</span>
          </a>`).join("") : `<div class="admin-empty">Звернень до кабінету ще немає.</div>`}
      </div>`;
  }

  /* ---------- Склад: посади кабінету й люди на них (вакантні — теж) ---------- */
  function secPeople() {
    const positions = allPositions().filter((p) => p.office === officeId).sort((a, b) => (a.order || 9) - (b.order || 9));
    const members = officeMembers(officeId);
    const groups = positions.map((p) => ({ p, people: members.filter((u) => u.positionId === p.id) }));
    const unplaced = members.filter((u) => !positions.some((p) => p.id === u.positionId));
    const person = (u) => `<div class="ws-person">${avatar(u)}<b>${esc(u.name || u.login)}</b><small>${esc(posOf(u))}</small>${isMgr(u) ? `<span class="badge ok">керівництво</span>` : ""}</div>`;
    return groups.map((g) => `
      <p class="ws-section-title">${esc(g.p.title)}</p>
      <div class="ws-people">${g.people.length ? g.people.map(person).join("") : `<div class="ws-person ws-vacant"><span class="ws-av">—</span><b>ВАКАНТНО</b><small>${esc(g.p.title)}</small></div>`}</div>`).join("") +
      (unplaced.length ? `<p class="ws-section-title">Інші працівники</p><div class="ws-people">${unplaced.map(person).join("")}</div>` : "") ||
      `<div class="admin-empty">У кабінеті ще немає посад.</div>`;
  }

  /* ---------- Облік і звіти ----------
     Облік роботи за період; керівництво формує тижневий звіт із пропонованими преміями й подає його до Департаменту фінансів. */
  function secWork() {
    const p = period();
    const stats = workStats(officeId, p.from, p.to);
    const g = payrollGlobal();
    const rows = manager ? stats.rows : stats.rows.filter((r) => r.login === user.login);
    const mine = allPayrolls().filter((x) => x.office === officeId);
    const weeks = [weekRange(0), weekRange(-1)];
    // Премії працівника з погоджених і виплачених звітів
    const myBonuses = mine.filter((x) => ["approved", "paid"].includes(x.status)).map((x) => ({ x, r: (x.rows || []).find((r) => r.login === user.login) })).filter((v) => v.r);
    return `
      <div class="appeals-toolbar">
        <div class="seg" id="work-period">
          ${[["week", "Цей тиждень"], ["prevweek", "Минулий тиждень"], ["month", "Цей місяць"], ["custom", "Період…"]].map(([k, l]) => `<button type="button" data-p="${k}" class="${ui.period === k ? "active" : ""}">${l}</button>`).join("")}
        </div>
        ${ui.period === "custom" ? `<span class="ws-range"><input type="date" id="work-from" value="${attr(ui.from)}"> — <input type="date" id="work-to" value="${attr(ui.to)}"></span>` : ""}
      </div>
      <section class="card">
        <h3>Облік роботи: ${esc(p.label)}</h3>
        <p class="muted">Бали: рапорти й завдання — як виставило керівництво, документи ${stats.settings.weights.doc} б., відповідь на звернення ${stats.settings.weights.appealReply} б., дія у справі ${stats.settings.weights.caseAction} б. · усього: ${stats.total}</p>
        <div class="table-scroll"><table class="ws-table">
          <thead><tr><th>Працівник</th><th>Рапорти</th><th>Завдання</th><th>Документи</th><th>Відповіді</th><th>Справи</th><th>Бали</th></tr></thead>
          <tbody>${rows.map((r) => `<tr><td><b>${esc(r.name)}</b><small>${esc(r.post)}${r.post ? " · " : ""}@${esc(r.login)}</small></td>
            <td>${r.reports}${r.reportPoints ? ` <small>(${r.reportPoints} б.)</small>` : ""}</td><td>${r.tasks}${r.taskPoints ? ` <small>(${r.taskPoints} б.)</small>` : ""}</td>
            <td>${r.docs}</td><td>${r.appealReplies}</td><td>${r.caseActions}</td><td><b>${r.points}</b></td></tr>`).join("") || `<tr><td colspan="7" class="muted">У кабінеті ще немає працівників.</td></tr>`}</tbody>
        </table></div>
      </section>
      ${manager ? `
      <section class="card">
        <div class="section-head"><div><h3>Тижневий звіт до Департаменту фінансів</h3>
          <p class="muted">Звіт про пророблену роботу з пропонованими преміями (до ${esc(money(g.maxBonus, g.currency))} на людину за тиждень). Мінфін перевіряє й підписує, Губернатор погоджує й виплачує.</p></div></div>
        <div class="ws-list">${weeks.map((w) => {
          const ex = wsGet(payrollId(officeId, w));
          return `<div class="ws-item ws-item-head"><span><b>Тиждень ${esc(w.label)}</b><small>${ex ? esc(PAYROLL_STATUSES[ex.status] || ex.status) + " · " + esc(money(ex.totalAmount, g.currency)) : "звіт ще не сформовано"}</small></span>
            ${ex ? `<button type="button" class="btn ghost" data-open-payroll="${attr(ex.id)}">Відкрити</button>` : `<button type="button" class="btn gold" data-new-payroll="${attr(w.key)}">Сформувати звіт</button>`}</div>`;
        }).join("")}</div>
      </section>` : ""}
      ${ui.payrollOpen && wsGet(ui.payrollOpen) && wsGet(ui.payrollOpen).office === officeId ? payrollView(wsGet(ui.payrollOpen), "unit") : ""}
      ${manager && mine.length ? `<section class="card"><h3>Усі звіти підрозділу</h3><div class="ws-list">${mine.map(payrollRow).join("")}</div></section>` : ""}
      <section class="card">
        <h3>Мої премії</h3>
        ${myBonuses.length ? `<div class="table-scroll"><table class="ws-table"><thead><tr><th>Тиждень</th><th>Бали</th><th>Премія</th><th>Стан</th></tr></thead><tbody>${myBonuses.map(({ x, r }) => `<tr><td>${esc(x.period.label)}</td><td>${r.points}</td><td><b>${esc(money(r.amount, g.currency))}</b></td><td><span class="badge ${payrollStatusClass(x.status)}">${esc(PAYROLL_STATUSES[x.status])}</span></td></tr>`).join("")}</tbody></table></div>`
          : `<p class="muted">Погоджених премій ще немає. Премія з'являється тут, коли Губернатор погодить звіт підрозділу.</p>`}
      </section>`;
  }

  /* ---------- Звіт (спільний вигляд для підрозділу, Мінфіну й Губернатора) ---------- */
  function payrollRow(x) {
    const unit = (allOffices().find((o) => o.id === x.office) || {}).name || x.office;
    return `<button type="button" class="ws-item ws-item-head${ui.payrollOpen === x.id ? " is-open" : ""}" data-open-payroll="${attr(x.id)}">
      <span><b>${esc(unit)} · тиждень ${esc(x.period && x.period.label)}</b><small>${(x.rows || []).length} працівників · ${esc(money(x.totalAmount, payrollGlobal().currency))}${x.submittedByName ? " · подав " + esc(x.submittedByName) : ""}</small></span>
      <span class="badge ${payrollStatusClass(x.status)}">${esc(PAYROLL_STATUSES[x.status] || x.status)}</span></button>`;
  }
  function payrollView(x, mode) {
    const g = payrollGlobal();
    const unit = (allOffices().find((o) => o.id === x.office) || {}).name || x.office;
    const editable = (mode === "unit" && ["draft", "returned"].includes(x.status)) || (mode === "finance" && x.status === "submitted");
    const total = (x.rows || []).reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
    const step = (label, who, at) => who ? `<li><b>${label}</b> — ${esc(who)}${at ? ", " + esc(formatDocWhen({ date: at })) : ""}</li>` : "";
    return `
      <section class="card payroll-card" id="payroll-view" data-payroll="${attr(x.id)}">
        <div class="section-head">
          <div><p class="eyebrow">${esc(unit)}</p><h3>Звіт за тиждень ${esc(x.period && x.period.label)}</h3></div>
          <span class="badge ${payrollStatusClass(x.status)}">${esc(PAYROLL_STATUSES[x.status] || x.status)}</span>
        </div>
        <ol class="payroll-steps">
          ${step("Подав підрозділ", x.submittedByName, x.submittedAt)}
          ${step("Підписав Мінфін", x.signedByName, x.signedAt)}
          ${step("Погодив Губернатор", x.approvedByName, x.approvedAt)}
          ${step("Виплачено", x.paidByName, x.paidAt)}
        </ol>
        ${x.returnNote && ["returned", "draft"].includes(x.status) ? `<p class="notice danger">Мінфін повернув: ${esc(x.returnNote)}</p>` : ""}
        ${x.govNote && x.status === "submitted" ? `<p class="notice">Губернатор повернув Мінфіну: ${esc(x.govNote)}</p>` : ""}
        ${x.summary ? `<p class="ws-text"><b>Підсумок роботи підрозділу:</b> ${esc(x.summary).replace(/\n/g, "<br>")}</p>` : ""}
        ${x.financeNote ? `<p class="ws-text"><b>Висновок Мінфіну:</b> ${esc(x.financeNote).replace(/\n/g, "<br>")}</p>` : ""}
        <div class="table-scroll"><table class="ws-table">
          <thead><tr><th>Працівник</th><th>Рапорти</th><th>Завдання</th><th>Документи</th><th>Відповіді</th><th>Справи</th><th>Бали</th><th>Премія, ${esc(g.currency)}</th></tr></thead>
          <tbody>${(x.rows || []).map((r) => `<tr><td><b>${esc(r.name)}</b><small>${esc(r.post || "")}${r.post ? " · " : ""}@${esc(r.login)}</small></td>
            <td>${r.reports}</td><td>${r.tasks}</td><td>${r.docs}</td><td>${r.appealReplies}</td><td>${r.caseActions}</td><td><b>${r.points}</b></td>
            <td>${editable ? `<input type="number" class="payroll-amount" data-amount="${attr(r.login)}" min="0" max="${g.maxBonus}" step="1000" value="${attr(r.amount)}">` : `<b>${esc(money(r.amount, g.currency))}</b>`}</td></tr>`).join("")}</tbody>
          <tfoot><tr><td colspan="7"><b>Разом</b> <small>межа — ${esc(money(g.maxBonus, g.currency))} на людину</small></td><td><b id="payroll-total">${esc(money(total, g.currency))}</b></td></tr></tfoot>
        </table></div>
        ${mode === "unit" && editable ? `<label>Підсумок роботи за тиждень<textarea id="payroll-summary" rows="3" placeholder="Що зроблено підрозділом, ключові результати, хто відзначився.">${esc(x.summary || "")}</textarea></label>` : ""}
        ${mode === "finance" && x.status === "submitted" ? `<label>Висновок Мінфіну<textarea id="payroll-finance-note" rows="2" placeholder="Перевірено, суми відповідають обсягу роботи…">${esc(x.financeNote || "")}</textarea></label>` : ""}
        <div class="form-actions payroll-actions">
          ${mode === "unit" && editable ? `<button type="button" class="btn ghost" data-payroll-act="save">Зберегти чернетку</button>
            <button type="button" class="btn ghost" data-payroll-act="refresh" title="Перерахувати рядки з обліку за цей тиждень">Оновити з обліку</button>
            <button type="button" class="btn gold" data-payroll-act="submit">Подати до Департаменту фінансів</button>
            ${x.status === "draft" ? `<button type="button" class="btn ghost danger" data-payroll-act="delete">Видалити чернетку</button>` : ""}` : ""}
          ${mode === "finance" && x.status === "submitted" ? `<button type="button" class="btn gold" data-payroll-act="sign">Підписати й передати Губернатору</button>
            <button type="button" class="btn ghost" data-payroll-act="finsave">Зберегти зміни</button>
            <button type="button" class="btn ghost danger" data-payroll-act="return">Повернути підрозділу</button>` : ""}
          ${mode === "governor" && x.status === "signed" ? `<button type="button" class="btn gold" data-payroll-act="approve">Погодити премії</button>
            <button type="button" class="btn ghost danger" data-payroll-act="govreturn">Повернути до Мінфіну</button>` : ""}
          ${mode === "governor" && x.status === "approved" ? `<button type="button" class="btn gold" data-payroll-act="paid">Позначити виплаченим</button>` : ""}
          <button type="button" class="btn ghost" data-payroll-act="close">Закрити</button>
        </div>
      </section>`;
  }

  /* ---------- Мінфін / Губернатор: звіти всіх підрозділів ---------- */
  function secPayrolls() {
    const g = payrollGlobal();
    const filters = payrollRole === "finance"
      ? [["submitted", "На перевірці"], ["signed", "Передано Губернатору"], ["returned", "Повернено"], ["done", "Погоджено й виплачено"], ["all", "Усі"]]
      : [["signed", "На погодженні"], ["approved", "До виплати"], ["paid", "Виплачено"], ["all", "Усі"]];
    const f = ui.payrollFilter || filters[0][0];
    let list = allPayrolls().filter((x) => x.status !== "draft");
    if (payrollRole === "governor") list = list.filter((x) => ["signed", "approved", "paid"].includes(x.status));
    if (f === "done") list = list.filter((x) => ["approved", "paid"].includes(x.status));
    else if (f !== "all") list = list.filter((x) => x.status === f);
    const open = ui.payrollOpen && wsGet(ui.payrollOpen);
    const weekTotal = allPayrolls().filter((x) => x.period && x.period.key === weekRange(-1).key && ["signed", "approved", "paid"].includes(x.status)).reduce((sum, x) => sum + (x.totalAmount || 0), 0);
    return `
      <p class="muted" style="margin:0">${payrollRole === "finance"
        ? "Звіти підрозділів про пророблену роботу. Перевірте облік і суми (межа — " + esc(money(g.maxBonus, g.currency)) + " на людину за тиждень), підпишіть і передайте Губернатору або поверніть на доопрацювання."
        : "Звіти, підписані Департаментом фінансів. Погодьте премії — після виплати в грі позначте звіт виплаченим."}</p>
      <div class="ws-cards">
        <div class="ws-card"><b>${allPayrolls().filter((x) => x.status === "submitted").length}</b><span>на перевірці в Мінфіні</span></div>
        <div class="ws-card"><b>${allPayrolls().filter((x) => x.status === "signed").length}</b><span>на погодженні в Губернатора</span></div>
        <div class="ws-card"><b>${allPayrolls().filter((x) => x.status === "approved").length}</b><span>погоджено, до виплати</span></div>
        <div class="ws-card"><b>${esc(money(weekTotal, g.currency))}</b><span>премій за минулий тиждень</span></div>
      </div>
      <div class="appeals-toolbar"><div class="seg" id="payroll-filter">${filters.map(([k, l]) => `<button type="button" data-pf="${k}" class="${f === k ? "active" : ""}">${l}</button>`).join("")}</div></div>
      <div class="ws-list">${list.map(payrollRow).join("") || `<div class="admin-empty">Звітів за цим фільтром немає.</div>`}</div>
      ${open && open.kind === "payroll" ? payrollView(open, payrollRole) : ""}`;
  }

  /* ---------- Налаштування (керівництво) ---------- */
  function secSettings() {
    const st = wsSettings(officeId);
    return `
      <section class="card">
        <h3>Облік роботи й премії</h3>
        <p class="muted">Скільки балів дає кожна дія і як рахувати премії. Бали за завдання ставите в самому завданні, за рапорт — при прийнятті (або типові нижче).</p>
        <form id="ws-settings" class="ws-settings">
          <div class="form-grid">
            <label>Рапорт (типово)<input type="number" name="report" min="0" max="100" value="${attr(st.weights.report)}"></label>
            <label>Опублікований документ<input type="number" name="doc" min="0" max="100" value="${attr(st.weights.doc)}"></label>
            <label>Відповідь на звернення<input type="number" name="appealReply" min="0" max="100" value="${attr(st.weights.appealReply)}"></label>
            <label>Дія у судовій справі<input type="number" name="caseAction" min="0" max="100" value="${attr(st.weights.caseAction)}"></label>
          </div>
          <div class="form-grid">
            <label>Премії<select name="mode"><option value="pool"${st.mode === "pool" ? " selected" : ""}>Фонд ділиться пропорційно балам</option><option value="rate"${st.mode === "rate" ? " selected" : ""}>Фіксована сума за бал</option></select></label>
            <label>Фонд премій за період<input type="number" name="pool" min="0" value="${attr(st.pool)}"></label>
            <label>Сума за 1 бал<input type="number" name="rate" min="0" value="${attr(st.rate)}"></label>
            <label>Валюта<input name="currency" maxlength="4" value="${attr(st.currency)}"></label>
          </div>
          <button class="btn gold" type="submit">Зберегти налаштування</button>
        </form>
      </section>
      ${payrollRole ? `
      <section class="card">
        <h3>Премії: загальні правила</h3>
        <p class="muted">Діють для всіх підрозділів і організацій. Більшу суму сервер не прийме навіть у підробленому запиті.</p>
        <form id="payroll-global" class="ws-settings">
          <div class="form-grid">
            <label>Максимальна премія на людину за тиждень<input type="number" name="maxBonus" min="1" step="1000" value="${attr(payrollGlobal().maxBonus)}"></label>
            <label>Валюта<input name="currency" maxlength="4" value="${attr(payrollGlobal().currency)}"></label>
          </div>
          <button class="btn gold" type="submit">Зберегти</button>
        </form>
      </section>` : ""}`;
  }

  /* ---------- Малювання ---------- */
  const RENDER = { payrolls: secPayrolls, home: secHome, reports: secReports, tasks: secTasks, proc: secProc, cases: secCases, docs: secDocs, appeals: secAppeals, people: secPeople, work: secWork, settings: secSettings };
  const canCreateDocs = (user.roles || [])[0] === "governor" || hasPermission(user, "createDocs");
  function actions() {
    const s = ui.section;
    if (s === "reports" || s === "home") return `<button class="btn gold" type="button" data-new-report>+ Подати рапорт</button>`;
    if (s === "tasks" && manager) return `<button class="btn gold" type="button" data-new-task>+ Нове завдання</button>`;
    if (s === "proc") return `<button class="btn gold" type="button" data-new-proc>+ Передати справу до суду</button>`;
    if (s === "docs" && canCreateDocs) return `<a class="btn gold" href="${attr(pathTo("cabinet/create/"))}">+ Створити документ</a>`;
    return "";
  }
  function drawNav() {
    const c = counts();
    const badge = { reports: c.reports, tasks: c.tasks, cases: c.cases, appeals: c.appeals, payrolls: c.payrolls, work: c.work };
    $("ws-nav").innerHTML = SECTIONS.map((s) => (s.id === "docs" ? `<div class="ws-nav-sep"></div>` : "") +
      `<a href="#${s.id}" class="${s.id === ui.section ? "active" : ""}"${s.id === ui.section ? ' aria-current="page"' : ""}><span class="ws-ico">${s.icon}</span><span>${esc(s.label)}</span>${badge[s.id] ? `<span class="ws-count">${badge[s.id]}</span>` : ""}</a>`).join("");
  }
  function draw() {
    const c = counts();
    const badge = { reports: c.reports, tasks: c.tasks, cases: c.cases, appeals: c.appeals, payrolls: c.payrolls, work: c.work };
    $("ws-nav").innerHTML = SECTIONS.map((s, i) => (s.id === "docs" ? `<div class="ws-nav-sep"></div>` : "") +
      `<a href="#${s.id}" class="${s.id === ui.section ? "active" : ""}"${s.id === ui.section ? ' aria-current="page"' : ""}><span class="ws-ico">${s.icon}</span><span>${esc(s.label)}</span>${badge[s.id] ? `<span class="ws-count">${badge[s.id]}</span>` : ""}</a>`).join("");
    $("ws-title").textContent = (SECTIONS.find((s) => s.id === ui.section) || SECTIONS[0]).label;
    $("ws-actions").innerHTML = actions();
    $("ws-content").innerHTML = RENDER[ui.section]();
    if (ui.section === "cases" && typeof mountCourtUI === "function") {
      mountCourtUI($("court-root"), { selected: courtSel, hashPrefix: "case=", emptyHash: "#cases" });
      courtSel = "";
    }
    hydrateAttachments($("ws-content"));
    noteFiles = $("task-files") ? attachPicker($("task-files"), $("task-files-list")) : null;
  }
  window.addEventListener("hashchange", () => {
    if (location.hash.startsWith("#case=") && officeId === "court") {
      courtSel = decodeURIComponent(location.hash.slice(6));
      ui.section = "cases"; draw(); return;
    }
    const s = location.hash.slice(1);
    if (SECTIONS.some((x) => x.id === s) && s !== ui.section) { ui.section = s; ui.open = ui.pendingOpen || ""; ui.pendingOpen = ""; draw(); window.scrollTo(0, 0); }
  });

  /* ---------- Дії ---------- */
  const content = $("ws-content");
  document.addEventListener("click", (e) => {
    const pick = (sel) => e.target.closest(sel);
    let b;
    if (pick("[data-new-report]")) return openReport(null);
    if (pick("[data-new-task]")) return openTask(null);
    if (pick("[data-new-proc]")) return openProc();
    if ((b = pick("[data-goto-task]"))) { ui.pendingOpen = b.dataset.gotoTask; return; }
    if (!content.contains(e.target)) return;
    if ((b = pick("[data-rf]"))) { ui.reportFilter = b.dataset.rf; ui.open = ""; return draw(); }
    if ((b = pick("[data-df]"))) { ui.docStatus = b.dataset.df; return draw(); }
    if ((b = pick("[data-p]"))) {
      ui.period = b.dataset.p;
      if (ui.period === "custom" && !ui.from) { const n = new Date(); ui.from = new Date(n.getFullYear(), n.getMonth(), 1).toISOString().slice(0, 10); ui.to = today(); }
      return draw();
    }
    if ((b = pick("[data-open]"))) { ui.open = ui.open === b.dataset.open ? "" : b.dataset.open; return draw(); }
    if (pick("[data-close-task]")) { ui.open = ""; return draw(); }
    if ((b = pick("[data-edit-report]"))) return openReport(wsGet(b.dataset.editReport));
    if ((b = pick("[data-edit-task]"))) return openTask(wsGet(b.dataset.editTask));
    if ((b = pick("[data-task-status]"))) {
      const task = wsGet(ui.open);
      if (!task) return;
      const st = b.dataset.taskStatus;
      let comment = "";
      if (st === "returned") { comment = prompt("Що доопрацювати?") || ""; if (!comment.trim()) return; }
      const texts = { progress: "Взято в роботу.", done: "Позначено виконаним.", accepted: "Прийнято, нараховано " + (task.points || 0) + " б.", returned: "Повернено на доопрацювання: " + comment };
      saveWs(Object.assign({}, task, { status: st }, st === "accepted" ? { acceptedAt: new Date().toISOString() } : {}), { user, event: { kind: "status", text: texts[st] } });
      return draw();
    }
    if ((b = pick("[data-transfer-task]"))) {
      const task = wsGet(b.dataset.transferTask);
      const targets = workspaceOffices().filter((o) => o.id !== officeId);
      const ans = prompt("Передати «" + task.title + "» в кабінет (введіть номер):\n" + targets.map((o, i) => (i + 1) + ". " + o.name).join("\n"));
      const target = targets[Number(ans) - 1];
      if (!target) return;
      saveWs(Object.assign({}, task, { office: target.id, status: "new", assignee: "", transferredFrom: officeId }), { user, event: { kind: "status", text: "Передано з «" + officeName + "» до «" + target.name + "»." } });
      ui.open = "";
      return draw();
    }
    if ((b = pick("[data-delete-task]"))) {
      const task = wsGet(b.dataset.deleteTask);
      if (!task || !confirm("Видалити завдання «" + task.title + "»?")) return;
      saveLS("state_ws", loadLS("state_ws", []).filter((x) => x.id !== task.id));
      ui.open = "";
      return draw();
    }
    if ((b = pick("[data-pf]"))) { ui.payrollFilter = b.dataset.pf; ui.payrollOpen = ""; return draw(); }
    if ((b = pick("[data-open-payroll]"))) { ui.payrollOpen = ui.payrollOpen === b.dataset.openPayroll ? "" : b.dataset.openPayroll; draw(); const v = $("payroll-view"); if (v) v.scrollIntoView({ block: "start" }); return; }
    if ((b = pick("[data-new-payroll]"))) {
      const w = [weekRange(0), weekRange(-1)].find((x) => x.key === b.dataset.newPayroll);
      if (!w) return;
      const saved = saveWs({ id: payrollId(officeId, w), kind: "payroll", office: officeId, period: { key: w.key, from: w.from, to: w.to, label: w.label },
        rows: buildPayrollRows(officeId, w), status: "draft", summary: "" }, { user, event: { kind: "status", text: "Звіт сформовано з обліку роботи." } });
      ui.payrollOpen = saved.id;
      draw();
      const v = $("payroll-view"); if (v) v.scrollIntoView({ block: "start" });
      return;
    }
    if ((b = pick("[data-payroll-act]"))) return payrollAction(b.dataset.payrollAct);
  });
  // Суми в звіті: не більше межі, разом — наживо
  content.addEventListener("input", (e) => {
    if (!e.target.matches(".payroll-amount")) return;
    const g = payrollGlobal();
    let total = 0;
    content.querySelectorAll(".payroll-amount").forEach((i) => { total += Math.min(g.maxBonus, Math.max(0, Math.floor(Number(i.value) || 0))); });
    const t = $("payroll-total"); if (t) t.textContent = money(total, g.currency);
    e.target.classList.toggle("is-over", Number(e.target.value) > g.maxBonus);
  });
  function payrollAmounts(x) {
    const g = payrollGlobal();
    return (x.rows || []).map((r) => {
      const i = content.querySelector('.payroll-amount[data-amount="' + CSS.escape(r.login) + '"]');
      return Object.assign({}, r, { amount: i ? Math.min(g.maxBonus, Math.max(0, Math.floor(Number(i.value) || 0))) : r.amount });
    });
  }
  function payrollAction(act) {
    const view = $("payroll-view");
    const x = view && wsGet(view.dataset.payroll);
    if (act === "close") { ui.payrollOpen = ""; return draw(); }
    if (!x) return;
    const g = payrollGlobal();
    const over = Array.from(content.querySelectorAll(".payroll-amount")).some((i) => Number(i.value) > g.maxBonus);
    if (over && !confirm("Деякі суми більші за межу " + money(g.maxBonus, g.currency) + " — їх буде зменшено до межі. Продовжити?")) return;
    const summary = $("payroll-summary") ? $("payroll-summary").value.trim() : x.summary;
    const financeNote = $("payroll-finance-note") ? $("payroll-finance-note").value.trim() : x.financeNote;
    const save = (patch, text) => { saveWs(Object.assign({}, x, patch), { user, event: { kind: "status", text } }); draw(); };
    if (act === "save") return save({ rows: payrollAmounts(x), summary }, "Чернетку збережено.");
    if (act === "refresh") {
      if (!confirm("Перерахувати рядки з обліку за цей тиждень? Ручні зміни сум буде замінено.")) return;
      return save({ rows: buildPayrollRows(officeId, { from: x.period.from, to: x.period.to }), summary }, "Рядки оновлено з обліку.");
    }
    if (act === "submit") {
      if (!confirm("Подати звіт за тиждень " + x.period.label + " до Департаменту фінансів?")) return;
      return save({ rows: payrollAmounts(x), summary, status: "submitted", returnNote: "" }, "Звіт подано до Департаменту фінансів.");
    }
    if (act === "delete") {
      if (!confirm("Видалити чернетку звіту?")) return;
      saveLS("state_ws", loadLS("state_ws", []).filter((w) => w.id !== x.id));
      ui.payrollOpen = "";
      return draw();
    }
    if (act === "finsave") return save({ rows: payrollAmounts(x), financeNote }, "Мінфін змінив суми.");
    if (act === "sign") {
      if (!confirm("Підписати звіт і передати Губернатору на погодження?")) return;
      return save({ rows: payrollAmounts(x), financeNote, status: "signed" }, "Підписано Мінфіном і передано Губернатору.");
    }
    if (act === "return") {
      const note = prompt("Що доопрацювати підрозділу?");
      if (!note || !note.trim()) return;
      return save({ status: "returned", returnNote: note.trim(), financeNote }, "Мінфін повернув на доопрацювання: " + note.trim());
    }
    if (act === "approve") {
      if (!confirm("Погодити премії підрозділу на " + money(x.totalAmount, g.currency) + "?")) return;
      return save({ status: "approved" }, "Губернатор погодив премії.");
    }
    if (act === "govreturn") {
      const note = prompt("Що перевірити Мінфіну?");
      if (!note || !note.trim()) return;
      return save({ status: "submitted", govNote: note.trim() }, "Губернатор повернув до Мінфіну: " + note.trim());
    }
    if (act === "paid") {
      if (!confirm("Позначити премії виплаченими в грі?")) return;
      return save({ status: "paid" }, "Премії виплачено.");
    }
  }
  content.addEventListener("change", (e) => {
    if (e.target.id === "work-from" || e.target.id === "work-to") { ui.from = $("work-from").value; ui.to = $("work-to").value; if (ui.from && ui.to) draw(); }
  });
  content.addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.target;
    if (form.id === "payroll-global") {
      const d = new FormData(form);
      const max = Math.floor(Number(d.get("maxBonus")) || 0);
      if (max <= 0) { alert("Вкажіть межу премії більше нуля."); return; }
      saveWs({ id: "payroll-global", kind: "global", office: "finance", maxBonus: max, currency: String(d.get("currency") || "$").trim().slice(0, 4) || "$" }, { user });
      return draw();
    }
    if (form.id === "ws-settings") {
      const d = new FormData(form);
      const num = (k) => Math.max(0, Number(d.get(k)) || 0);
      saveWs({ id: "settings-" + officeId, kind: "settings", office: officeId, weights: { report: num("report"), doc: num("doc"), appealReply: num("appealReply"), caseAction: num("caseAction") },
        mode: d.get("mode") === "rate" ? "rate" : "pool", pool: num("pool"), rate: num("rate"), currency: String(d.get("currency") || "$").trim().slice(0, 4) || "$" }, { user });
      return draw();
    }
    if (form.dataset.review) {
      const r = wsGet(form.dataset.review);
      const decision = e.submitter && e.submitter.dataset.decision;
      if (!r || !decision) return;
      const d = new FormData(form);
      const comment = String(d.get("comment") || "").trim();
      const pts = Math.max(0, Number(d.get("points")) || 0);
      if (decision !== "accepted" && !comment && !confirm("Без коментаря автор не знатиме, що виправити. Продовжити?")) return;
      const labels = { accepted: "Прийнято", returned: "Повернено на доопрацювання", rejected: "Відхилено" };
      saveWs(Object.assign({}, r, { status: decision, reviewer: user.login, reviewedAt: new Date().toISOString(), points: decision === "accepted" ? pts : 0 }),
        { user, event: { kind: "review", text: labels[decision] + (decision === "accepted" ? " (+" + pts + " б.)" : "") + (comment ? ": " + comment : ".") } });
      return draw();
    }
    if (form.id === "task-note") {
      const task = wsGet(ui.open);
      const text = String(new FormData(form).get("text") || "").trim();
      if (!task || (!text && !(noteFiles && noteFiles.files.length))) return;
      let attachments = [];
      if (noteFiles && noteFiles.files.length) {
        const up = await noteFiles.upload("ws:" + task.id);
        if (!up.ok) { alert(up.error); return; }
        attachments = up.list;
      }
      saveWs(task, { user, event: Object.assign({ kind: "note", text: text || "Додано файли." }, attachments.length ? { attachments } : {}) });
      return draw();
    }
  });
  content.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && e.target.matches("#task-note textarea")) { e.preventDefault(); e.target.form.requestSubmit(); }
  });

  /* ---------- Вікна ---------- */
  document.querySelectorAll(".modal-backdrop").forEach((m) => m.addEventListener("click", (e) => { if (e.target === m || e.target.closest("[data-close-modal]")) m.hidden = true; }));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") document.querySelectorAll(".modal-backdrop").forEach((m) => { m.hidden = true; }); });

  const reportForm = $("report-form");
  reportForm.type.innerHTML = WS_REPORT_TYPES.map((t) => `<option>${esc(t)}</option>`).join("");
  const reportFiles = attachPicker($("report-files"), $("report-files-list"));
  function openReport(r) {
    reportForm.reset(); reportFiles.clear();
    reportForm.id.value = r ? r.id : "";
    if (r) { reportForm.type.value = r.type; reportForm.title.value = r.title; reportForm.text.value = r.text; }
    $("report-modal-title").textContent = r ? "Доопрацювати рапорт" : "Новий рапорт";
    $("report-form-msg").textContent = "";
    $("report-modal").hidden = false;
  }
  reportForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const d = new FormData(reportForm);
    const id = reportForm.id.value || ("ws-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6));
    let attachments = [];
    if (reportFiles.files.length) {
      const up = await reportFiles.upload("ws:" + id);
      if (!up.ok) { $("report-form-msg").textContent = up.error; return; }
      attachments = up.list;
    }
    const prev = wsGet(id);
    saveWs(Object.assign({}, prev || {}, { id, kind: "report", office: officeId, author: (prev && prev.author) || user.login, type: d.get("type"),
      title: String(d.get("title") || "").trim(), text: String(d.get("text") || "").trim(), status: "submitted" }),
      { user, event: attachments.length ? { kind: "files", text: "Додано файли.", attachments } : { kind: "status", text: prev ? "Подано знову після доопрацювання." : "Рапорт подано." } });
    $("report-modal").hidden = true;
    ui.section = "reports"; if (!manager) ui.reportFilter = "mine"; ui.open = id;
    history.replaceState(null, "", "#reports");
    draw();
  });

  const taskForm = $("task-form");
  function openTask(t) {
    taskForm.reset();
    taskForm.assignee.innerHTML = officeMembers(officeId).map((u) => `<option value="${attr(u.login)}">${esc(u.name || u.login)} · ${esc(posOf(u))}</option>`).join("");
    taskForm.id.value = t ? t.id : "";
    if (t) { taskForm.title.value = t.title; taskForm.text.value = t.text || ""; taskForm.assignee.value = t.assignee || ""; taskForm.due.value = t.due || ""; taskForm.points.value = t.points || 0; }
    $("task-modal-title").textContent = t ? "Редагувати завдання" : "Нове завдання";
    $("task-modal").hidden = false;
  }
  taskForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const d = new FormData(taskForm);
    const prev = taskForm.id.value ? wsGet(taskForm.id.value) : null;
    const assignee = String(d.get("assignee") || "");
    const saved = saveWs(Object.assign({}, prev || {}, { kind: "task", office: officeId, title: String(d.get("title") || "").trim(), text: String(d.get("text") || "").trim(),
      assignee, due: d.get("due") || "", points: Math.max(0, Number(d.get("points")) || 0), status: prev ? prev.status : "new" }),
      { user, event: { kind: "status", text: prev ? "Завдання змінено." : "Поставлено завдання; виконавець — " + nameOf(assignee) + "." } });
    $("task-modal").hidden = true;
    ui.section = "tasks"; ui.open = saved.id;
    history.replaceState(null, "", "#tasks");
    draw();
  });

  const procForm = $("proc-form");
  procForm.kind.innerHTML = CASE_KINDS.map((k) => `<option${k === "Кримінальна" ? " selected" : ""}>${esc(k)}</option>`).join("");
  $("ws-people").innerHTML = allUsers().map((u) => `<option value="${attr(u.login)}">${esc(u.name || u.login)}</option>`).join("");
  function openProc() { procForm.reset(); procForm.kind.value = "Кримінальна"; $("proc-modal").hidden = false; }
  procForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const d = new FormData(procForm);
    const raw = String(d.get("defendant") || "").trim();
    const found = allUsers().find((x) => x.login === raw.toLowerCase() || (x.name || "").toLowerCase() === raw.toLowerCase());
    saveCase({ kind: d.get("kind"), title: String(d.get("title") || "").trim(), summary: String(d.get("summary") || "").trim(),
      plaintiff: { login: "", name: officeName }, defendant: found ? { login: found.login, name: found.name || found.login } : { login: "", name: raw },
      status: "new", createdBy: user.login }, { user, event: { kind: "opened", text: "Справу передано до суду: " + officeName + "." } });
    $("proc-modal").hidden = true;
    draw();
  });

  watchState(() => {
    // Судовий інтерфейс оновлюється сам — тут лише лічильники меню
    if (ui.section === "cases") { drawNav(); return; }
    if (document.activeElement && document.activeElement.closest && document.activeElement.closest("#ws-content form, .modal-backdrop")) return;
    draw();
  });
  draw();
});

function modalsHtml() {
  return `
  <div class="modal-backdrop" id="report-modal" hidden>
    <section class="modal-card appeal-modal" role="dialog" aria-modal="true" aria-labelledby="report-modal-title">
      <button class="modal-close" type="button" data-close-modal aria-label="Закрити">×</button>
      <h3 id="report-modal-title">Новий рапорт</h3>
      <form id="report-form">
        <input type="hidden" name="id">
        <div class="form-grid">
          <label>Вид<select name="type"></select></label>
          <label>Тема<input name="title" required maxlength="120" placeholder="Звіт за тиждень 23–29.09"></label>
        </div>
        <label>Зміст<textarea name="text" required rows="7" placeholder="Що зроблено, де, коли, хто брав участь, результати."></textarea></label>
        <div class="att-picker">
          <label class="btn ghost att-add">📎 Додати фото чи PDF<input type="file" id="report-files" accept="image/*,application/pdf" multiple hidden></label>
          <div class="att-chips" id="report-files-list" hidden></div>
        </div>
        <p class="lead" id="report-form-msg" style="color:#8a2b2b;margin:0"></p>
        <div class="modal-actions"><button class="btn gold" type="submit">Подати рапорт</button><button class="btn ghost" type="button" data-close-modal>Скасувати</button></div>
      </form>
    </section>
  </div>
  <div class="modal-backdrop" id="task-modal" hidden>
    <section class="modal-card appeal-modal" role="dialog" aria-modal="true" aria-labelledby="task-modal-title">
      <button class="modal-close" type="button" data-close-modal aria-label="Закрити">×</button>
      <h3 id="task-modal-title">Нове завдання</h3>
      <form id="task-form">
        <input type="hidden" name="id">
        <label>Завдання<input name="title" required maxlength="140" placeholder="Перевірити звітність"></label>
        <label>Опис<textarea name="text" rows="4" placeholder="Що саме зробити, критерії виконання."></textarea></label>
        <div class="form-grid">
          <label>Виконавець<select name="assignee" required></select></label>
          <label>Строк<input type="date" name="due"></label>
          <label>Бали за виконання<input type="number" name="points" min="0" max="100" value="3"></label>
        </div>
        <div class="modal-actions"><button class="btn gold" type="submit">Зберегти</button><button class="btn ghost" type="button" data-close-modal>Скасувати</button></div>
      </form>
    </section>
  </div>
  <div class="modal-backdrop" id="proc-modal" hidden>
    <section class="modal-card appeal-modal" role="dialog" aria-modal="true" aria-labelledby="proc-modal-title">
      <button class="modal-close" type="button" data-close-modal aria-label="Закрити">×</button>
      <h3 id="proc-modal-title">Передати справу до суду</h3>
      <form id="proc-form">
        <div class="form-grid">
          <label>Вид справи<select name="kind"></select></label>
          <label>Назва<input name="title" required maxlength="90" placeholder="Про розкрадання бюджетних коштів"></label>
        </div>
        <label>Обвинувачений / відповідач<input name="defendant" list="ws-people" placeholder="Ім'я або логін людини"></label>
        <label>Обставини й докази<textarea name="summary" rows="6" required placeholder="Фабула, кваліфікація, докази, вимоги до суду."></textarea></label>
        <p class="field-help">Справа надійде до Верховного Суду зі статусом «Подано».</p>
        <div class="modal-actions"><button class="btn gold" type="submit">Передати до суду</button><button class="btn ghost" type="button" data-close-modal>Скасувати</button></div>
      </form>
    </section>
  </div>
  <datalist id="ws-people"></datalist>`;
}
