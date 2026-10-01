/* Скрипт сторінки «cabinet/office» — робочий простір кабінету (?o=<id кабінету>).
   Вкладки: огляд, рапорти, завдання, (прокуратура — провадження, суд — судові справи), облік і премії.
   Заходять працівники кабінету й повні адміністратори; керують — керівник і заступники. Права перевіряє й сервер. */
whenStateReady(async function () {
  const user = requireAuth();
  if (!user) return;
  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const allowed = workspaceOffices().filter((o) => canEnterOffice(user, o.id));
  $("top-office").textContent = isCitizen(user) ? "Кабінет громадянина" : officeTitle(user);
  const navAdmin = $("nav-admin");
  if (navAdmin && !canAdmin(user)) navAdmin.style.display = "none";

  const officeId = params.get("o") || (allowed.find((o) => o.id === userOffice(user)) || allowed[0] || {}).id;
  const office = allOffices().find((o) => o.id === officeId);
  if (!office || !canEnterOffice(user, officeId)) {
    $("ws-title").textContent = "Немає доступу";
    $("ws-lead").textContent = "Робочий простір кабінету відкритий лише його працівникам. Якщо ви працюєте в цьому кабінеті — попросіть адміністратора призначити вас на посаду.";
    $("ws-tabs").hidden = true;
    return;
  }
  if (!params.get("o")) history.replaceState(null, "", "?o=" + encodeURIComponent(officeId) + location.hash);
  const manager = isOfficeManager(user, officeId);
  document.title = office.name + " — State";
  $("ws-kicker").textContent = (office.icon ? office.icon + " " : "") + "Робочий простір кабінету";
  $("ws-title").textContent = office.name;
  $("ws-lead").textContent = manager
    ? "Ви керуєте кабінетом: розглядайте рапорти, ставте завдання, ведіть облік роботи й затверджуйте премії."
    : "Подавайте рапорти, виконуйте завдання кабінету. Облік вашої роботи й премії — у вкладці «Облік і премії».";
  if (allowed.length > 1) {
    $("ws-switch").hidden = false;
    $("ws-office").innerHTML = allowed.map((o) => `<option value="${attr(o.id)}"${o.id === officeId ? " selected" : ""}>${esc(o.name)}</option>`).join("");
    $("ws-office").addEventListener("change", (e) => { location.href = "?o=" + encodeURIComponent(e.target.value); });
  }

  const nameOf = (login) => { const u = allUsers().find((x) => x.login === login); return u ? u.name || u.login : login || "—"; };
  const posOf = (u) => (positionById(u.positionId) || {}).title || u.post || "";
  const isManagerUser = (u) => { const p = positionById(u.positionId); return !!p && (p.level === "head" || p.manager === true); };
  const money = (n, cur) => (Number(n) || 0).toLocaleString("uk-UA") + " " + (cur || "$");
  const today = () => new Date().toISOString().slice(0, 10);

  const TABS = [
    { id: "overview", label: "Огляд" },
    { id: "reports", label: "Рапорти" },
    { id: "tasks", label: "Завдання" }
  ].concat(officeId === "prosecutor" ? [{ id: "proc", label: "Провадження" }] : [])
    .concat(officeId === "court" ? [{ id: "court", label: "Судові справи" }] : [])
    .concat([{ id: "work", label: "Облік і премії" }]);
  const ui = { tab: TABS.some((t) => t.id === location.hash.slice(1)) ? location.hash.slice(1) : "overview", reportFilter: manager ? "review" : "mine", period: "month", from: "", to: "", open: "" };

  /* ---------- Період обліку ---------- */
  function period() {
    const now = new Date();
    const d0 = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
    let from, to, label;
    if (ui.period === "week") {
      from = d0(now); from.setDate(from.getDate() - ((from.getDay() + 6) % 7));
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

  /* ---------- Огляд ---------- */
  function drawOverview() {
    const members = officeMembers(officeId);
    const reports = wsItems(officeId, "report");
    const tasks = wsItems(officeId, "task");
    const p = period();
    const stats = workStats(officeId, p.from, p.to);
    const pts = {};
    stats.rows.forEach((r) => { pts[r.login] = r.points; });
    const st = wsSettings(officeId);
    return `
      <div class="ws-cards">
        <div class="ws-card"><b>${members.length}</b><span>працівників</span></div>
        <div class="ws-card"><b>${reports.filter((r) => r.status === "submitted").length}</b><span>рапортів на розгляді</span></div>
        <div class="ws-card"><b>${tasks.filter((t) => ["new", "progress", "returned"].includes(t.status)).length}</b><span>завдань у роботі</span></div>
        <div class="ws-card"><b>${tasks.filter((t) => t.status === "done").length}</b><span>чекають перевірки</span></div>
      </div>
      <section class="card">
        <div class="section-head"><div><h3>Склад кабінету</h3><p class="muted">Бали за ${esc(p.label)} — за рапорти, завдання, документи, відповіді на звернення та дії у справах.</p></div></div>
        <div class="admin-list">
          ${members.length ? members.map((u) => `
            <article class="admin-list-row">
              ${u.photo ? `<img class="user-avatar" src="${attr(u.photo)}" alt="" style="object-fit:cover">` : `<div class="user-avatar">${esc(String(u.name || u.login).charAt(0).toUpperCase())}</div>`}
              <div class="admin-row-main">
                <div class="admin-row-title"><b>${esc(u.name || u.login)}</b>${isManagerUser(u) ? `<span class="badge ok">керівництво</span>` : ""}</div>
                <div class="admin-row-meta"><span>${esc(posOf(u) || "посада не вказана")}</span><span>@${esc(u.login)}</span></div>
              </div>
              <div class="ws-points"><b>${pts[u.login] || 0}</b><small>балів</small></div>
            </article>`).join("") : `<div class="admin-empty">У кабінеті ще немає працівників. Адміністратор призначає людей на посади в «Адмін-панель» → «Люди».</div>`}
        </div>
      </section>
      ${manager ? `
      <section class="card">
        <h3>Налаштування обліку</h3>
        <p class="muted">Скільки балів дає кожна дія і як рахувати премії. Бали за завдання ставите при створенні завдання, за рапорт — при прийнятті (або типові нижче).</p>
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
      </section>` : ""}`;
  }

  /* ---------- Рапорти ---------- */
  function drawReports() {
    let items = wsItems(officeId, "report");
    if (!manager) items = items.filter((r) => r.author === user.login);
    if (ui.reportFilter === "review") items = items.filter((r) => r.status === "submitted");
    if (ui.reportFilter === "mine") items = items.filter((r) => r.author === user.login);
    const statusCls = (s) => s === "accepted" ? "ok" : s === "submitted" ? "draft" : "dead";
    return `
      <div class="appeals-toolbar">
        <div class="seg" id="report-filter">
          ${manager ? `<button type="button" data-rf="review" class="${ui.reportFilter === "review" ? "active" : ""}">На розгляді</button>` : ""}
          <button type="button" data-rf="mine" class="${ui.reportFilter === "mine" ? "active" : ""}">Мої</button>
          ${manager ? `<button type="button" data-rf="all" class="${ui.reportFilter === "all" ? "active" : ""}">Усі</button>` : ""}
        </div>
        <button class="btn gold" type="button" data-new-report>+ Подати рапорт</button>
      </div>
      <div class="ws-list">
        ${items.length ? items.map((r) => `
          <article class="ws-item${ui.open === r.id ? " is-open" : ""}">
            <button type="button" class="ws-item-head" data-open="${attr(r.id)}">
              <span><b>${esc(r.title || "Рапорт")}</b><small>${esc(r.type || "")} · ${esc(nameOf(r.author))} · ${esc(formatDocWhen({ date: r.createdAt || r.updatedAt }))}</small></span>
              <span class="ws-item-side">${r.status === "accepted" ? `<span class="pill">+${esc(r.points != null && r.points !== "" ? r.points : wsSettings(officeId).weights.report)} б.</span>` : ""}<span class="badge ${statusCls(r.status)}">${esc(WS_REPORT_STATUSES[r.status] || r.status)}</span></span>
            </button>
            ${ui.open === r.id ? `
            <div class="ws-item-body">
              <p class="ws-text">${esc(r.text || "").replace(/\n/g, "<br>")}</p>
              ${attachmentsHtml((r.events || []).filter((e) => e.kind === "files").flatMap((e) => e.attachments || []))}
              ${(r.events || []).filter((e) => e.kind === "review").map((e) => `<p class="notice">${esc(e.text)} <small class="muted">— ${esc(e.byName || "")}, ${esc(formatDocWhen({ date: e.at }))}</small></p>`).join("")}
              ${manager && r.status === "submitted" ? `
                <form class="case-action-row" data-review="${attr(r.id)}">
                  <b>Рішення</b>
                  <label class="muted">Бали <input type="number" name="points" min="0" max="100" value="${attr(wsSettings(officeId).weights.report)}" style="width:80px"></label>
                  <input name="comment" placeholder="Коментар (необов'язково)">
                  <button type="submit" class="btn gold" data-decision="accepted">Прийняти</button>
                  <button type="submit" class="btn ghost" data-decision="returned">Повернути</button>
                  <button type="submit" class="btn ghost danger" data-decision="rejected">Відхилити</button>
                </form>` : ""}
              ${r.author === user.login && r.status === "returned" ? `<button type="button" class="btn ghost" data-edit-report="${attr(r.id)}">Доопрацювати й подати знову</button>` : ""}
            </div>` : ""}
          </article>`).join("") : `<div class="admin-empty">${ui.reportFilter === "review" ? "Рапортів на розгляді немає." : "Рапортів ще немає."}</div>`}
      </div>`;
  }

  /* ---------- Завдання ---------- */
  function drawTasks() {
    let tasks = wsItems(officeId, "task");
    if (!manager) tasks = tasks.filter((t) => t.assignee === user.login);
    const cols = [
      { id: "todo", label: "Нові й повернені", match: (t) => t.status === "new" || t.status === "returned" },
      { id: "progress", label: "У роботі", match: (t) => t.status === "progress" },
      { id: "done", label: "На перевірці", match: (t) => t.status === "done" },
      { id: "accepted", label: "Прийнято", match: (t) => t.status === "accepted" }
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
      <div class="appeals-toolbar">
        <p class="muted" style="margin:0">${manager ? "Ставте завдання працівникам і приймайте виконані — бали підуть в облік." : "Ваші завдання: візьміть у роботу й позначте виконаним — керівник перевірить."}</p>
        ${manager ? `<button class="btn gold" type="button" data-new-task>+ Нове завдання</button>` : ""}
      </div>
      <div class="ws-board">
        ${cols.map((c) => {
          const list = tasks.filter(c.match);
          const shown = c.id === "accepted" ? list.slice(0, 8) : list;
          return `<div class="ws-col"><h4>${esc(c.label)} <small class="muted">${list.length}</small></h4>${shown.map(card).join("") || `<p class="muted ws-empty">—</p>`}</div>`;
        }).join("")}
      </div>
      ${t ? `
      <section class="card ws-task-detail">
        <div class="section-head">
          <div><h3>${esc(t.title)}</h3><p class="muted">${esc(WS_TASK_STATUSES[t.status] || t.status)} · виконавець: ${esc(nameOf(t.assignee))}${t.due ? " · строк " + esc(t.due.split("-").reverse().join(".")) : ""} · ${esc(t.points || 0)} б.</p></div>
          <button type="button" class="btn ghost" data-close-task>Закрити</button>
        </div>
        ${t.text ? `<p class="ws-text">${esc(t.text).replace(/\n/g, "<br>")}</p>` : ""}
        <div class="case-timeline appeal-chat" id="task-chat">
          ${(t.events || []).map((e) => `<div class="case-event"><span>•</span><div><b>${esc(e.text || "")}</b>${attachmentsHtml(e.attachments)}<small>${esc(e.byName || "")} · ${esc(formatDocWhen({ date: e.at }))}</small></div></div>`).join("")}
        </div>
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
  function drawProc() {
    const mine = allCases().filter((c) => officeMembers("prosecutor").some((m) => m.login === c.createdBy) || c.createdBy === user.login);
    return `
      <div class="appeals-toolbar">
        <p class="muted" style="margin:0">Сформуйте справу й передайте її до Верховного Суду. Суд відкриє провадження, призначить засідання й винесе рішення — усе видно тут і на сторінці «Суд».</p>
        <button class="btn gold" type="button" data-new-proc>+ Передати справу до суду</button>
      </div>
      <div class="ws-list">
        ${mine.length ? mine.map((c) => `
          <a class="ws-item ws-item-head ws-link" href="../court/#${attr(encodeURIComponent(c.id))}">
            <span><b>${esc(c.number)} · ${esc(c.title || "")}</b><small>${esc(c.kind || "")} · проти ${esc((c.defendant && c.defendant.name) || "—")} · передав ${esc(nameOf(c.createdBy))}</small></span>
            <span class="badge ${caseStatusClass(c.status)}">${esc(CASE_STATUSES[c.status] || c.status)}</span>
          </a>`).join("") : `<div class="admin-empty">Прокуратура ще не передавала справ до суду.</div>`}
      </div>`;
  }

  /* ---------- Суд: справи ---------- */
  function drawCourt() {
    const cases = allCases();
    const by = (s) => cases.filter((c) => c.status === s);
    return `
      <div class="ws-cards">
        <div class="ws-card"><b>${by("new").length}</b><span>подано, чекають рішення про відкриття</span></div>
        <div class="ws-card"><b>${by("open").length + by("hearing").length}</b><span>у провадженні</span></div>
        <div class="ws-card"><b>${by("hearing").length}</b><span>призначено засідань</span></div>
        <div class="ws-card"><b>${by("decided").length}</b><span>з рішенням</span></div>
      </div>
      <section class="card">
        <div class="section-head"><div><h3>Нові справи</h3><p class="muted">Позови громадян і справи, передані прокуратурою.</p></div><a class="btn gold" href="../court/">Відкрити розділ «Суд»</a></div>
        <div class="ws-list">
          ${by("new").length ? by("new").map((c) => `
            <a class="ws-item ws-item-head ws-link" href="../court/#${attr(encodeURIComponent(c.id))}">
              <span><b>${esc(c.number)} · ${esc(c.title || "")}</b><small>${esc(c.kind || "")} · ${esc((c.plaintiff && c.plaintiff.name) || "—")} проти ${esc((c.defendant && c.defendant.name) || "—")}</small></span>
              <span class="badge draft">Подано</span>
            </a>`).join("") : `<div class="admin-empty">Нових справ немає.</div>`}
        </div>
      </section>`;
  }

  /* ---------- Облік і премії ---------- */
  function drawWork() {
    const p = period();
    const stats = workStats(officeId, p.from, p.to);
    const cur = stats.settings.currency;
    const rows = manager ? stats.rows : stats.rows.filter((r) => r.login === user.login);
    const bonuses = wsItems(officeId, "bonus");
    return `
      <div class="appeals-toolbar">
        <div class="seg" id="work-period">
          <button type="button" data-p="week" class="${ui.period === "week" ? "active" : ""}">Цей тиждень</button>
          <button type="button" data-p="month" class="${ui.period === "month" ? "active" : ""}">Цей місяць</button>
          <button type="button" data-p="prev" class="${ui.period === "prev" ? "active" : ""}">Минулий місяць</button>
          <button type="button" data-p="custom" class="${ui.period === "custom" ? "active" : ""}">Період…</button>
        </div>
        ${ui.period === "custom" ? `<span class="ws-range"><input type="date" id="work-from" value="${attr(ui.from)}"> — <input type="date" id="work-to" value="${attr(ui.to)}"></span>` : ""}
      </div>
      <section class="card">
        <div class="section-head"><div><h3>Облік роботи: ${esc(p.label)}</h3>
          <p class="muted">${stats.settings.mode === "rate" ? "Премія = бали × " + esc(money(stats.settings.rate, cur)) : "Фонд " + esc(money(stats.settings.pool, cur)) + " ділиться пропорційно балам"} · усього балів у кабінеті: ${stats.total}</p></div></div>
        <div class="table-scroll">
          <table class="ws-table">
            <thead><tr><th>Працівник</th><th>Рапорти</th><th>Завдання</th><th>Документи</th><th>Відповіді</th><th>Справи</th><th>Бали</th><th>Премія</th></tr></thead>
            <tbody>${rows.map((r) => `<tr>
              <td><b>${esc(r.name)}</b><small>${esc(r.post)}</small></td>
              <td>${r.reports}${r.reportPoints ? ` <small>(${r.reportPoints} б.)</small>` : ""}</td>
              <td>${r.tasks}${r.taskPoints ? ` <small>(${r.taskPoints} б.)</small>` : ""}</td>
              <td>${r.docs}</td><td>${r.appealReplies}</td><td>${r.caseActions}</td>
              <td><b>${r.points}</b></td><td><b>${esc(money(r.amount, cur))}</b></td></tr>`).join("") || `<tr><td colspan="8" class="muted">У кабінеті ще немає працівників.</td></tr>`}</tbody>
          </table>
        </div>
        ${manager && stats.rows.length ? `<div class="form-actions"><button class="btn gold" type="button" data-approve-bonus>Затвердити премії за ${esc(p.label)}</button><span class="muted">Затверджена відомість зберігається в історії нижче; працівники бачать свої суми.</span></div>` : ""}
      </section>
      <section class="card">
        <h3>Затверджені премії</h3>
        <div class="ws-list">
          ${bonuses.length ? bonuses.map((b) => {
            const mineRow = (b.rows || []).find((r) => r.login === user.login);
            return `<details class="ws-bonus">
              <summary><b>${esc(b.period && b.period.label || "")}</b> · ${esc(money(b.totalAmount, b.currency))} · затвердив ${esc(nameOf(b.approvedBy))}, ${esc(formatDocWhen({ date: b.createdAt || b.updatedAt }))}${mineRow ? ` · <b>ваша премія: ${esc(money(mineRow.amount, b.currency))}</b>` : ""}</summary>
              ${manager ? `<table class="ws-table"><tbody>${(b.rows || []).map((r) => `<tr><td>${esc(r.name)}</td><td>${r.points} б.</td><td><b>${esc(money(r.amount, b.currency))}</b></td></tr>`).join("")}</tbody></table>` : ""}
            </details>`;
          }).join("") : `<div class="admin-empty">Премії ще не затверджувались.</div>`}
        </div>
      </section>`;
  }

  /* ---------- Малювання ---------- */
  let noteFiles = null;
  function draw() {
    $("ws-tabs").innerHTML = TABS.map((t) => {
      const n = t.id === "reports" && manager ? wsItems(officeId, "report").filter((r) => r.status === "submitted").length
        : t.id === "tasks" ? wsItems(officeId, "task").filter((x) => (manager ? x.status === "done" : x.assignee === user.login && ["new", "returned"].includes(x.status))).length
        : t.id === "court" ? allCases().filter((c) => c.status === "new").length : 0;
      return `<button type="button" role="tab" data-tab="${t.id}" class="${t.id === ui.tab ? "active" : ""}" aria-selected="${t.id === ui.tab}">${esc(t.label)}${n ? `<span class="nav-badge">${n}</span>` : ""}</button>`;
    }).join("");
    const html = { overview: drawOverview, reports: drawReports, tasks: drawTasks, proc: drawProc, court: drawCourt, work: drawWork }[ui.tab]();
    $("ws-body").innerHTML = html;
    hydrateAttachments($("ws-body"));
    noteFiles = $("task-files") ? attachPicker($("task-files"), $("task-files-list")) : null;
    if (typeof enhanceCabinetNavigation === "function" && document.querySelector(".side-me")) enhanceCabinetNavigation();
  }

  /* ---------- Дії ---------- */
  $("ws-tabs").addEventListener("click", (e) => {
    const b = e.target.closest("[data-tab]");
    if (!b) return;
    ui.tab = b.dataset.tab; ui.open = "";
    history.replaceState(null, "", "?o=" + encodeURIComponent(officeId) + "#" + ui.tab);
    draw();
  });
  const body = $("ws-body");
  body.addEventListener("click", (e) => {
    const t = e.target;
    const pick = (sel) => t.closest(sel);
    let b;
    if ((b = pick("[data-rf]"))) { ui.reportFilter = b.dataset.rf; ui.open = ""; return draw(); }
    if ((b = pick("[data-p]"))) {
      ui.period = b.dataset.p;
      if (ui.period === "custom" && !ui.from) { const n = new Date(); ui.from = new Date(n.getFullYear(), n.getMonth(), 1).toISOString().slice(0, 10); ui.to = today(); }
      return draw();
    }
    if ((b = pick("[data-open]"))) { ui.open = ui.open === b.dataset.open ? "" : b.dataset.open; return draw(); }
    if (pick("[data-close-task]")) { ui.open = ""; return draw(); }
    if (pick("[data-new-report]")) return openReport(null);
    if ((b = pick("[data-edit-report]"))) return openReport(wsGet(b.dataset.editReport));
    if (pick("[data-new-task]")) return openTask(null);
    if ((b = pick("[data-edit-task]"))) return openTask(wsGet(b.dataset.editTask));
    if (pick("[data-new-proc]")) return openProc();
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
      const others = workspaceOffices().filter((o) => o.id !== officeId);
      const list = others.map((o, i) => (i + 1) + ". " + o.name).join("\n");
      const ans = prompt("Передати «" + task.title + "» в кабінет (введіть номер):\n" + list);
      const target = others[Number(ans) - 1];
      if (!target) return;
      saveWs(Object.assign({}, task, { office: target.id, status: "new", assignee: "", transferredFrom: officeId }), { user, event: { kind: "status", text: "Передано з кабінету «" + office.name + "» до «" + target.name + "»." } });
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
        rows: stats.rows.map((r) => ({ login: r.login, name: r.name, points: r.points, amount: r.amount })), approvedBy: user.login },
        { user, event: { kind: "status", text: "Премії затверджено." } });
      return draw();
    }
  });
  body.addEventListener("change", (e) => {
    if (e.target.id === "work-from" || e.target.id === "work-to") {
      ui.from = $("work-from").value; ui.to = $("work-to").value;
      if (ui.from && ui.to) draw();
    }
  });
  body.addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.target;
    if (form.id === "ws-settings") {
      const d = new FormData(form);
      const num = (k) => Math.max(0, Number(d.get(k)) || 0);
      saveWs({ id: "settings-" + officeId, kind: "settings", office: officeId,
        weights: { report: num("report"), doc: num("doc"), appealReply: num("appealReply"), caseAction: num("caseAction") },
        mode: d.get("mode") === "rate" ? "rate" : "pool", pool: num("pool"), rate: num("rate"), currency: String(d.get("currency") || "$").trim().slice(0, 4) || "$" }, { user });
      return draw();
    }
    if (form.dataset.review) {
      const r = wsGet(form.dataset.review);
      const decision = e.submitter && e.submitter.dataset.decision;
      if (!r || !decision) return;
      const d = new FormData(form);
      const comment = String(d.get("comment") || "").trim();
      if (decision !== "accepted" && !comment && !confirm("Без коментаря автор не знатиме, що виправити. Продовжити?")) return;
      const labels = { accepted: "Прийнято", returned: "Повернено на доопрацювання", rejected: "Відхилено" };
      saveWs(Object.assign({}, r, { status: decision, reviewer: user.login, reviewedAt: new Date().toISOString(), points: decision === "accepted" ? Math.max(0, Number(d.get("points")) || 0) : 0 }),
        { user, event: { kind: "review", text: labels[decision] + (decision === "accepted" ? " (+" + (Math.max(0, Number(d.get("points")) || 0)) + " б.)" : "") + (comment ? ": " + comment : ".") } });
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
  body.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && e.target.matches("#task-note textarea")) { e.preventDefault(); e.target.form.requestSubmit(); }
  });

  /* ---------- Вікна ---------- */
  document.querySelectorAll(".modal-backdrop").forEach((m) => m.addEventListener("click", (e) => {
    if (e.target === m || e.target.closest("[data-close-modal]")) m.hidden = true;
  }));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") document.querySelectorAll(".modal-backdrop").forEach((m) => { m.hidden = true; }); });

  const reportForm = $("report-form");
  reportForm.type.innerHTML = WS_REPORT_TYPES.map((t) => `<option>${esc(t)}</option>`).join("");
  const reportFiles = attachPicker($("report-files"), $("report-files-list"));
  function openReport(r) {
    reportForm.reset();
    reportFiles.clear();
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
    ui.tab = "reports"; ui.reportFilter = manager ? ui.reportFilter : "mine"; ui.open = id;
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
    ui.tab = "tasks"; ui.open = saved.id;
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
      plaintiff: { login: "", name: office.name }, defendant: found ? { login: found.login, name: found.name || found.login } : { login: "", name: raw },
      status: "new", createdBy: user.login }, { user, event: { kind: "opened", text: "Справу передано до суду: " + office.name + "." } });
    $("proc-modal").hidden = true;
    draw();
  });

  // Посилання …#tasks / #work на цій же сторінці — перемикають вкладку без перезавантаження
  window.addEventListener("hashchange", () => {
    const t = location.hash.slice(1);
    if (TABS.some((x) => x.id === t) && t !== ui.tab) { ui.tab = t; ui.open = ""; draw(); }
  });
  watchState(() => {
    if (document.activeElement && document.activeElement.closest && document.activeElement.closest("#ws-body form, .modal-backdrop")) return;
    draw();
  });
  draw();
});
