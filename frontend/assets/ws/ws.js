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
      { id: "work", icon: "📊", label: "Облік і премії" }
    ]).concat(manager ? [{ id: "settings", icon: "⚙", label: "Налаштування" }] : []);

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
  const ui = { section: SECTIONS.some((s) => s.id === location.hash.slice(1)) ? location.hash.slice(1) : "home",
    reportFilter: manager ? "review" : "mine", period: "month", from: "", to: "", open: "", docStatus: "all" };
  let noteFiles = null;

  function counts() {
    const reports = wsItems(officeId, "report");
    const tasks = wsItems(officeId, "task");
    return {
      reports: manager ? reports.filter((r) => r.status === "submitted").length : reports.filter((r) => r.author === user.login && r.status === "returned").length,
      tasks: tasks.filter((t) => manager ? t.status === "done" : t.assignee === user.login && ["new", "returned"].includes(t.status)).length,
      cases: officeId === "court" ? allCases().filter((c) => c.status === "new").length : 0,
      appeals: allAppeals().filter((a) => a.office === officeId && a.status === "waiting").length
    };
  }

  function period() {
    const now = new Date();
    let from, to, label;
    if (ui.period === "week") {
      from = new Date(now.getFullYear(), now.getMonth(), now.getDate()); from.setDate(from.getDate() - ((from.getDay() + 6) % 7));
      to = new Date(from); to.setDate(to.getDate() + 7); label = "цей тиждень";
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

  /* ---------- Суд: справи ---------- */
  function secCases() {
    const cases = allCases();
    const by = (s) => cases.filter((c) => c.status === s);
    const row = (c) => `<a class="ws-item ws-item-head ws-link" href="${attr(pathTo("cabinet/court/#" + encodeURIComponent(c.id)))}">
      <span><b>${esc(c.number)} · ${esc(c.title || "")}</b><small>${esc(c.kind || "")} · ${esc((c.plaintiff && c.plaintiff.name) || "—")} проти ${esc((c.defendant && c.defendant.name) || "—")}${c.judge ? " · суддя " + esc(nameOf(c.judge)) : ""}</small></span>
      <span class="badge ${caseStatusClass(c.status)}">${esc(CASE_STATUSES[c.status] || c.status)}</span></a>`;
    return `
      <div class="ws-cards">
        <div class="ws-card"><b>${by("new").length}</b><span>подано</span></div>
        <div class="ws-card"><b>${by("open").length + by("hearing").length}</b><span>у провадженні</span></div>
        <div class="ws-card"><b>${by("hearing").length}</b><span>призначено засідань</span></div>
        <div class="ws-card"><b>${by("decided").length}</b><span>з рішенням</span></div>
      </div>
      <section class="card"><h3>Нові справи</h3><div class="ws-list">${by("new").map(row).join("") || `<div class="admin-empty">Нових справ немає.</div>`}</div></section>
      <section class="card"><h3>У провадженні</h3><div class="ws-list">${by("open").concat(by("hearing")).map(row).join("") || `<div class="admin-empty">Справ у провадженні немає.</div>`}</div></section>`;
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

  /* ---------- Облік і премії ---------- */
  function secWork() {
    const p = period();
    const stats = workStats(officeId, p.from, p.to);
    const cur = stats.settings.currency;
    const rows = manager ? stats.rows : stats.rows.filter((r) => r.login === user.login);
    const bonuses = wsItems(officeId, "bonus");
    return `
      <div class="appeals-toolbar">
        <div class="seg" id="work-period">
          ${[["week", "Цей тиждень"], ["month", "Цей місяць"], ["prev", "Минулий місяць"], ["custom", "Період…"]].map(([k, l]) => `<button type="button" data-p="${k}" class="${ui.period === k ? "active" : ""}">${l}</button>`).join("")}
        </div>
        ${ui.period === "custom" ? `<span class="ws-range"><input type="date" id="work-from" value="${attr(ui.from)}"> — <input type="date" id="work-to" value="${attr(ui.to)}"></span>` : ""}
      </div>
      <section class="card">
        <h3>Облік роботи: ${esc(p.label)}</h3>
        <p class="muted">${stats.settings.mode === "rate" ? "Премія = бали × " + esc(money(stats.settings.rate, cur)) : "Фонд " + esc(money(stats.settings.pool, cur)) + " ділиться пропорційно балам"} · усього балів: ${stats.total}</p>
        <div class="table-scroll"><table class="ws-table">
          <thead><tr><th>Працівник</th><th>Рапорти</th><th>Завдання</th><th>Документи</th><th>Відповіді</th><th>Справи</th><th>Бали</th><th>Премія</th></tr></thead>
          <tbody>${rows.map((r) => `<tr><td><b>${esc(r.name)}</b><small>${esc(r.post)}${r.post ? " · " : ""}@${esc(r.login)}</small></td>
            <td>${r.reports}${r.reportPoints ? ` <small>(${r.reportPoints} б.)</small>` : ""}</td><td>${r.tasks}${r.taskPoints ? ` <small>(${r.taskPoints} б.)</small>` : ""}</td>
            <td>${r.docs}</td><td>${r.appealReplies}</td><td>${r.caseActions}</td><td><b>${r.points}</b></td><td><b>${esc(money(r.amount, cur))}</b></td></tr>`).join("") || `<tr><td colspan="8" class="muted">У кабінеті ще немає працівників.</td></tr>`}</tbody>
        </table></div>
        ${manager && stats.rows.length ? `<div class="form-actions"><button class="btn gold" type="button" data-approve-bonus>Затвердити премії за ${esc(p.label)}</button><span class="muted">Відомість зберігається в історії; працівники бачать свої суми.</span></div>` : ""}
      </section>
      <section class="card">
        <h3>Затверджені премії</h3>
        <div class="ws-list">${bonuses.length ? bonuses.map((b) => {
          const mineRow = (b.rows || []).find((r) => r.login === user.login);
          return `<details class="ws-bonus"><summary><b>${esc(b.period && b.period.label || "")}</b> · ${esc(money(b.totalAmount, b.currency))} · затвердив ${esc(nameOf(b.approvedBy))}, ${esc(formatDocWhen({ date: b.createdAt || b.updatedAt }))}${mineRow ? ` · <b>ваша премія: ${esc(money(mineRow.amount, b.currency))}</b>` : ""}</summary>
            ${manager ? `<table class="ws-table"><tbody>${(b.rows || []).map((r) => `<tr><td>${esc(r.name)}</td><td>${r.points} б.</td><td><b>${esc(money(r.amount, b.currency))}</b></td></tr>`).join("")}</tbody></table>` : ""}</details>`;
        }).join("") : `<div class="admin-empty">Премії ще не затверджувались.</div>`}</div>
      </section>`;
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
      </section>`;
  }

  /* ---------- Малювання ---------- */
  const RENDER = { home: secHome, reports: secReports, tasks: secTasks, proc: secProc, cases: secCases, docs: secDocs, appeals: secAppeals, people: secPeople, work: secWork, settings: secSettings };
  const canCreateDocs = (user.roles || [])[0] === "governor" || hasPermission(user, "createDocs");
  function actions() {
    const s = ui.section;
    if (s === "reports" || s === "home") return `<button class="btn gold" type="button" data-new-report>+ Подати рапорт</button>`;
    if (s === "tasks" && manager) return `<button class="btn gold" type="button" data-new-task>+ Нове завдання</button>`;
    if (s === "proc") return `<button class="btn gold" type="button" data-new-proc>+ Передати справу до суду</button>`;
    if (s === "cases") return `<a class="btn gold" href="${attr(pathTo("cabinet/court/"))}">Вести справи</a>`;
    if (s === "docs" && canCreateDocs) return `<a class="btn gold" href="${attr(pathTo("cabinet/create/"))}">+ Створити документ</a>`;
    return "";
  }
  function draw() {
    const c = counts();
    const badge = { reports: c.reports, tasks: c.tasks, cases: c.cases, appeals: c.appeals };
    $("ws-nav").innerHTML = SECTIONS.map((s, i) => (s.id === "docs" ? `<div class="ws-nav-sep"></div>` : "") +
      `<a href="#${s.id}" class="${s.id === ui.section ? "active" : ""}"${s.id === ui.section ? ' aria-current="page"' : ""}><span class="ws-ico">${s.icon}</span><span>${esc(s.label)}</span>${badge[s.id] ? `<span class="ws-count">${badge[s.id]}</span>` : ""}</a>`).join("");
    $("ws-title").textContent = (SECTIONS.find((s) => s.id === ui.section) || SECTIONS[0]).label;
    $("ws-actions").innerHTML = actions();
    $("ws-content").innerHTML = RENDER[ui.section]();
    hydrateAttachments($("ws-content"));
    noteFiles = $("task-files") ? attachPicker($("task-files"), $("task-files-list")) : null;
  }
  window.addEventListener("hashchange", () => {
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
    if (pick("[data-approve-bonus]")) {
      const p = period();
      const stats = workStats(officeId, p.from, p.to);
      const total = stats.rows.reduce((s, r) => s + r.amount, 0);
      if (!confirm("Затвердити премії за " + p.label + "?\nУсього: " + money(total, stats.settings.currency) + ".")) return;
      saveWs({ kind: "bonus", office: officeId, period: { from: p.from, to: p.to, label: p.label }, currency: stats.settings.currency, totalAmount: total,
        rows: stats.rows.map((r) => ({ login: r.login, name: r.name, points: r.points, amount: r.amount })), approvedBy: user.login }, { user, event: { kind: "status", text: "Премії затверджено." } });
      return draw();
    }
  });
  content.addEventListener("change", (e) => {
    if (e.target.id === "work-from" || e.target.id === "work-to") { ui.from = $("work-from").value; ui.to = $("work-to").value; if (ui.from && ui.to) draw(); }
  });
  content.addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.target;
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
