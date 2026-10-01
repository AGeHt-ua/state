/* Скрипт сторінки «cabinet/court». Судові справи: список (вкладки, статус, пошук) і картка справи з діями судді та матеріалами.
   Судова влада й повні адміністратори ведуть справи; сторони бачать свої й додають матеріали. Посилання …/court/#<id>. */
whenStateReady(async function () {
  const user = requireAuth();
  if (!user) return;
  const $ = (id) => document.getElementById(id);
  const manager = canManageCases(user);
  const staff = isStaff(user);
  $("top-office").textContent = isCitizen(user) ? "Кабінет громадянина" : officeTitle(user);
  if (isCitizen(user)) document.querySelectorAll("[data-staff-nav]").forEach((el) => { el.style.display = "none"; });
  const navAdmin = $("nav-admin");
  if (navAdmin && !canAdmin(user)) navAdmin.style.display = "none";
  if (!manager && !casesForUser(user).length && !staff) {
    $("court-list").innerHTML = "";
  }
  $("court-lead").textContent = manager
    ? "Ведіть справи: відкрийте провадження, призначте суддю й засідання, створіть повістку, винесіть рішення."
    : "Ваші судові справи: хід справи, засідання, матеріали й рішення. Додавайте докази в матеріали справи.";
  $("case-new-btn").hidden = !staff;

  const ui = { tab: manager ? "all" : "mine", status: "all", q: "", selected: decodeURIComponent(location.hash.slice(1)) };
  const judges = () => allUsers().filter((u) => isStaff(u) && userOffice(u) === "court");
  const nameOf = (login) => { const u = allUsers().find((x) => x.login === login); return u ? u.name || u.login : login; };
  const party = (p) => p && (p.name || p.login) ? esc(p.name || p.login) + (p.login ? ` <small class="muted">@${esc(p.login)}</small>` : "") : `<span class="muted">не вказано</span>`;
  const ACTIVE = ["new", "open", "hearing"];

  function list() {
    const q = ui.q.trim().toLowerCase();
    let items = ui.tab === "judge" ? allCases().filter((c) => c.judge === user.login)
      : ui.tab === "all" && manager ? allCases() : casesForUser(user).filter((c) => !manager || isCaseParty(c, user));
    if (ui.status === "active") items = items.filter((c) => ACTIVE.includes(c.status));
    if (ui.status === "decided") items = items.filter((c) => c.status === "decided");
    if (ui.status === "done") items = items.filter((c) => c.status === "closed" || c.status === "rejected");
    if (q) items = items.filter((c) => [c.number, c.title, c.summary, c.kind, c.plaintiff && c.plaintiff.name, c.defendant && c.defendant.name, nameOf(c.judge)]
      .join(" ").toLowerCase().includes(q));
    return items;
  }

  function drawTabs() {
    const tabs = manager
      ? [{ id: "all", label: "Усі справи", n: allCases().length }, { id: "judge", label: "Я суддя", n: allCases().filter((c) => c.judge === user.login).length },
         { id: "mine", label: "Я сторона", n: allCases().filter((c) => isCaseParty(c, user)).length }]
      : [{ id: "mine", label: "Мої справи", n: casesForUser(user).length }];
    $("court-tabs").hidden = tabs.length < 2;
    $("court-tabs").innerHTML = tabs.map((t) => `<button type="button" role="tab" data-tab="${t.id}" class="${t.id === ui.tab ? "active" : ""}" aria-selected="${t.id === ui.tab}">${esc(t.label)} <span class="pill">${t.n}</span></button>`).join("");
    document.querySelectorAll("#court-status [data-st]").forEach((b) => b.classList.toggle("active", b.dataset.st === ui.status));
  }

  function drawList() {
    const items = list();
    $("court-list").innerHTML = items.length ? items.map((c) => `
      <button type="button" class="appeal-item${c.id === ui.selected ? " is-active" : ""}${manager && c.status === "new" ? " is-unread" : ""}" data-id="${attr(c.id)}" role="option" aria-selected="${c.id === ui.selected}">
        <span class="appeal-item-top"><b>${esc(c.number)} · ${esc(c.kind || "Справа")}</b><span class="badge ${caseStatusClass(c.status)}">${esc(CASE_STATUSES[c.status] || c.status)}</span></span>
        <span class="appeal-item-last">${esc(c.title || "Без назви")}</span>
        <span class="appeal-item-meta">${esc((c.plaintiff && c.plaintiff.name) || "—")} проти ${esc((c.defendant && c.defendant.name) || "—")}${c.hearing && c.hearing.at && ACTIVE.includes(c.status) ? " · засідання " + esc(formatHearing(c.hearing.at)) : ""}</span>
      </button>`).join("")
      : `<div class="admin-empty">${ui.q || ui.status !== "all" ? "За цим фільтром справ немає." : manager ? "Справ ще немає. Відкрийте справу з позову (розділ «Звернення») або натисніть «+ Нова справа»." : "У вас немає судових справ."}</div>`;
  }

  const EVENT_ICON = { opened: "📂", judge: "👤", hearing: "📅", decision: "🔨", closed: "🔒", rejected: "⛔", reopened: "🔓", parties: "✏️", doc: "📄" };
  function drawDetail() {
    const box = $("case-detail");
    const c = getCase(ui.selected);
    $("court-layout").classList.toggle("has-selection", !!c);
    if (!c) { box.innerHTML = `<div class="appeal-empty"><b>Оберіть справу</b><span>Тут з'являться сторони, засідання, матеріали й рішення.</span></div>`; return; }
    const draft = box.querySelector("#case-note textarea") ? box.querySelector("#case-note textarea").value : "";
    const docs = caseDocs(c);
    const appeal = c.appealId ? allAppeals().find((a) => a.id === c.appealId) : null;
    const h = c.hearing || {};
    const toLocal = (at) => String(at || "").slice(0, 16);
    const open = ACTIVE.includes(c.status);
    box.innerHTML = `
      <div class="appeal-detail-head">
        <button type="button" class="btn ghost appeal-back" data-back>← До списку</button>
        <div>
          <h3>${esc(c.number)} · ${esc(c.kind || "Справа")}</h3>
          <div class="admin-row-meta"><span>${esc(c.title || "")}</span><span>відкрито ${esc(formatDocWhen({ date: c.createdAt }))}</span></div>
        </div>
        <span class="badge ${caseStatusClass(c.status)}">${esc(CASE_STATUSES[c.status] || c.status)}</span>
      </div>
      <div class="case-body">
        <table class="meta-table case-meta">
          <tr><th>Позивач</th><td>${party(c.plaintiff)}</td></tr>
          <tr><th>Відповідач</th><td>${party(c.defendant)}</td></tr>
          <tr><th>Суддя</th><td>${c.judge ? esc(c.judgeName || nameOf(c.judge)) : `<span class="muted">не призначено</span>`}</td></tr>
          <tr><th>Засідання</th><td>${h.at ? `<b>${esc(formatHearing(h.at))}</b>${h.place ? " · " + esc(h.place) : ""}` : `<span class="muted">не призначено</span>`}</td></tr>
          ${c.decision && c.decision.result ? `<tr><th>Рішення</th><td><b>${esc(c.decision.result)}</b>${c.decision.text ? `<p class="case-decision">${esc(c.decision.text).replace(/\n/g, "<br>")}</p>` : ""}</td></tr>` : ""}
          ${appeal ? `<tr><th>Звернення</th><td><a href="../appeals/#${attr(encodeURIComponent(appeal.id))}">${esc(appeal.number)}</a></td></tr>` : ""}
          ${docs.length ? `<tr><th>Документи</th><td>${docs.map((d) => `<a href="${attr(docHref(d))}">${esc(d.title)}</a> <span class="badge ${badgeClass(d.status)}">${esc(DOC_STATUSES[d.status] || d.status)}</span>`).join("<br>")}</td></tr>` : ""}
        </table>
        ${c.summary ? `<details class="advanced case-summary"${c.events && c.events.length > 3 ? "" : " open"}><summary>Суть справи</summary><p>${esc(c.summary).replace(/\n/g, "<br>")}</p></details>` : ""}

        ${manager ? `
        <div class="case-actions">
          ${c.status === "new" ? `
            <div class="case-action-row"><b>Подана справа</b>
              <button type="button" class="btn gold" data-act="open">Відкрити провадження</button>
              <button type="button" class="btn ghost danger" data-act="reject">Відмовити у відкритті</button></div>` : ""}
          ${open && c.status !== "new" ? `
            <form class="case-action-row" data-form="judge"><b>Суддя</b>
              <select name="judge"><option value="">— оберіть —</option>${judges().map((j) => `<option value="${attr(j.login)}"${j.login === c.judge ? " selected" : ""}>${esc(j.name || j.login)}${j.post ? " · " + esc(j.post) : ""}</option>`).join("")}</select>
              <button type="submit" class="btn ghost">Призначити</button></form>
            <form class="case-action-row" data-form="hearing"><b>Засідання</b>
              <input type="datetime-local" name="at" required value="${attr(toLocal(h.at))}">
              <input name="place" placeholder="Місце: Верховний Суд, зала 1" value="${attr(h.place || "")}">
              <button type="submit" class="btn ghost">${h.at ? "Перенести" : "Призначити"}</button></form>
            <div class="case-action-row"><b>Документи</b>
              <a class="btn ghost" href="../create/?case=${attr(encodeURIComponent(c.id))}&type=summons">Створити повістку</a>
              <a class="btn ghost" href="../create/?case=${attr(encodeURIComponent(c.id))}&type=ruling">Створити ухвалу</a>
              <a class="btn ghost" href="../create/?case=${attr(encodeURIComponent(c.id))}&type=arrest">Ордер</a></div>
            <form class="case-action-row case-decide" data-form="decision"><b>Рішення</b>
              <select name="result" required><option value="">— результат —</option>${CASE_RESULTS.map((r) => `<option>${esc(r)}</option>`).join("")}</select>
              <textarea name="text" rows="3" placeholder="Резолютивна частина: що суд ухвалив, строки, покарання чи компенсація."></textarea>
              <button type="submit" class="btn gold">Винести рішення</button></form>
            <div class="case-action-row"><b>Справа</b>
              <button type="button" class="btn ghost" data-act="parties">Змінити сторони</button>
              <button type="button" class="btn ghost danger" data-act="close">Закрити без рішення</button></div>` : ""}
          ${c.status === "decided" ? `
            <div class="case-action-row"><b>Після рішення</b>
              <a class="btn ghost" href="../create/?case=${attr(encodeURIComponent(c.id))}&type=ruling">Оформити рішення документом</a>
              <button type="button" class="btn gold" data-act="close">Закрити справу</button>
              <button type="button" class="btn ghost" data-act="reopen">Поновити провадження</button></div>` : ""}
          ${c.status === "closed" || c.status === "rejected" ? `
            <div class="case-action-row"><b>Справа закрита</b><button type="button" class="btn ghost" data-act="reopen">Поновити провадження</button></div>` : ""}
        </div>` : ""}

        <h4 class="case-h">Хід справи й матеріали</h4>
        <div class="appeal-chat case-timeline" id="case-chat">
          ${(c.events || []).map((e) => e.kind === "note" ? `
            <div class="chat-msg ${e.by === user.login ? "is-own" : ""} ${isCaseParty(c, { login: e.by }) ? "from-owner" : "from-office"}">
              <span class="chat-who">${esc(e.by === user.login ? "Ви" : e.byName || "—")}</span>
              ${e.text ? `<p>${esc(e.text).replace(/\n/g, "<br>")}</p>` : ""}
              ${attachmentsHtml(e.attachments)}
              <time>${esc(formatDocWhen({ date: e.at }))}</time>
            </div>` : `
            <div class="case-event"><span>${EVENT_ICON[e.kind] || "•"}</span><div><b>${esc(e.text || "")}</b><small>${esc(e.byName || "")} · ${esc(formatDocWhen({ date: e.at }))}</small></div></div>`).join("") || `<p class="muted">Подій ще немає.</p>`}
        </div>
      </div>
      ${manager || isCaseParty(c, user) ? `
      <form class="appeal-reply" id="case-note">
        <textarea name="text" rows="2" placeholder="Матеріали, пояснення, докази… (Ctrl+Enter — додати)"></textarea>
        <div class="att-chips" id="case-files-list" hidden></div>
        <div class="form-actions">
          <label class="btn ghost att-add" title="Фото чи PDF, до 5 файлів">📎<input type="file" id="case-files" accept="image/*,application/pdf" multiple hidden></label>
          <button class="btn ghost" type="submit">Додати до матеріалів</button>
        </div>
      </form>` : ""}`;
    if (draft) box.querySelector("#case-note textarea").value = draft;
    const chat = $("case-chat");
    chat.scrollTop = chat.scrollHeight;
    hydrateAttachments(chat);
    noteFiles = $("case-files") ? attachPicker($("case-files"), $("case-files-list")) : null;
  }
  let noteFiles = null;

  function drawAll() {
    drawTabs();
    drawList();
    drawDetail();
    if (typeof enhanceCabinetNavigation === "function" && document.querySelector(".side-me")) enhanceCabinetNavigation();
  }
  function select(id) {
    ui.selected = id;
    history.replaceState(null, "", location.pathname + location.search + (id ? "#" + encodeURIComponent(id) : ""));
    drawList();
    drawDetail();
  }

  // Хід справи дублюється в зверненні-позові: позивач бачить його у своїй переписці
  function tellAppeal(c, text) {
    const a = c.appealId ? allAppeals().find((x) => x.id === c.appealId) : null;
    if (a && a.status !== "closed") saveAppeal(Object.assign({}, a, { status: "answered" }), { user, message: text });
  }
  function update(c, patch, event, appealText) {
    const next = saveCase(Object.assign({}, c, patch), { user, event });
    if (appealText) tellAppeal(next, appealText);
    drawAll();
    return next;
  }

  // Події
  $("court-tabs").addEventListener("click", (e) => {
    const b = e.target.closest("[data-tab]");
    if (!b) return;
    ui.tab = b.dataset.tab;
    drawAll();
  });
  $("court-status").addEventListener("click", (e) => {
    const b = e.target.closest("[data-st]");
    if (!b) return;
    ui.status = b.dataset.st;
    drawTabs();
    drawList();
  });
  $("court-q").addEventListener("input", (e) => { ui.q = e.target.value; drawList(); });
  $("court-list").addEventListener("click", (e) => { const b = e.target.closest("[data-id]"); if (b) select(b.dataset.id); });

  $("case-detail").addEventListener("click", (e) => {
    if (e.target.closest("[data-back]")) return select("");
    const b = e.target.closest("[data-act]");
    if (!b) return;
    const c = getCase(ui.selected);
    if (!c) return;
    const act = b.dataset.act;
    if (act === "open") update(c, { status: "open" }, { kind: "opened", text: "Відкрито провадження." }, "Суд відкрив провадження у справі " + c.number + ".");
    if (act === "reject") {
      const reason = prompt("Причина відмови у відкритті провадження:");
      if (reason === null) return;
      update(c, { status: "rejected" }, { kind: "rejected", text: "Відмовлено у відкритті провадження" + (reason.trim() ? ": " + reason.trim() : ".") },
        "Суд відмовив у відкритті провадження у справі " + c.number + (reason.trim() ? ": " + reason.trim() : "."));
    }
    if (act === "close" && confirm("Закрити справу " + c.number + "?")) update(c, { status: "closed" }, { kind: "closed", text: "Справу закрито." }, "Справу " + c.number + " закрито.");
    if (act === "reopen" && confirm("Поновити провадження у справі " + c.number + "?")) update(c, { status: "open" }, { kind: "reopened", text: "Провадження поновлено." }, "Провадження у справі " + c.number + " поновлено.");
    if (act === "parties") openCaseForm(c);
  });
  $("case-detail").addEventListener("submit", async (e) => {
    e.preventDefault();
    const c = getCase(ui.selected);
    if (!c) return;
    const form = e.target;
    const data = new FormData(form);
    if (form.dataset.form === "judge") {
      const j = data.get("judge");
      if (!j || j === c.judge) return;
      update(c, { judge: j, judgeName: nameOf(j) }, { kind: "judge", text: "Призначено суддю: " + nameOf(j) + "." }, "У справі " + c.number + " призначено суддю: " + nameOf(j) + ".");
    }
    if (form.dataset.form === "hearing") {
      const at = String(data.get("at") || "");
      const place = String(data.get("place") || "").trim();
      if (!at) return;
      const text = "Засідання: " + formatHearing(at) + (place ? ", " + place : "") + ".";
      update(c, { hearing: { at, place }, status: "hearing" }, { kind: "hearing", text: (c.hearing && c.hearing.at ? "Перенесено. " : "Призначено. ") + text },
        "У справі " + c.number + " " + (c.hearing && c.hearing.at ? "перенесено засідання" : "призначено засідання") + ": " + formatHearing(at) + (place ? ", " + place : "") + ". Явка сторін обов'язкова.");
    }
    if (form.dataset.form === "decision") {
      const result = String(data.get("result") || "");
      const text = String(data.get("text") || "").trim();
      if (!result || !confirm("Винести рішення «" + result + "» у справі " + c.number + "?")) return;
      update(c, { status: "decided", decision: { result, text, at: new Date().toISOString(), by: user.login } }, { kind: "decision", text: "Рішення: " + result + "." },
        "У справі " + c.number + " винесено рішення: " + result + "." + (text ? "\n" + text : ""));
    }
    if (form.id === "case-note") {
      const text = String(data.get("text") || "").trim();
      const hasFiles = noteFiles && noteFiles.files.length;
      if (!text && !hasFiles) return;
      const btn = form.querySelector("[type=submit]");
      let attachments = [];
      if (hasFiles) {
        btn.disabled = true; btn.textContent = "Завантаження файлів…";
        const up = await noteFiles.upload("case:" + c.id);
        btn.disabled = false; btn.textContent = "Додати до матеріалів";
        if (!up.ok) { alert(up.error); return; }
        attachments = up.list;
      }
      saveCase(c, { user, event: Object.assign({ kind: "note", text }, attachments.length ? { attachments } : {}) });
      drawAll();
    }
  });
  $("case-detail").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && e.target.matches("#case-note textarea")) { e.preventDefault(); e.target.form.requestSubmit(); }
  });

  // Нова справа / зміна сторін
  const modal = $("case-modal");
  const form = $("case-form");
  form.kind.innerHTML = CASE_KINDS.map((k) => `<option>${esc(k)}</option>`).join("");
  $("court-people").innerHTML = allUsers().map((u) => `<option value="${attr(u.login)}">${esc(u.name || u.login)}</option>`).join("");
  const toParty = (raw) => {
    const v = String(raw || "").trim();
    if (!v) return { login: "", name: "" };
    const u = allUsers().find((x) => x.login === v.toLowerCase() || (x.name || "").toLowerCase() === v.toLowerCase());
    return u ? { login: u.login, name: u.name || u.login } : { login: "", name: v };
  };
  function openCaseForm(c) {
    form.reset();
    form.id.value = c ? c.id : "";
    $("case-modal-title").textContent = c ? "Сторони справи " + c.number : "Нова справа";
    if (c) {
      form.kind.value = c.kind || CASE_KINDS[0];
      form.title.value = c.title || "";
      form.plaintiff.value = (c.plaintiff && (c.plaintiff.login || c.plaintiff.name)) || "";
      form.defendant.value = (c.defendant && (c.defendant.login || c.defendant.name)) || "";
      form.summary.value = c.summary || "";
    }
    $("case-form-msg").textContent = "";
    modal.hidden = false;
  }
  $("case-new-btn").addEventListener("click", () => openCaseForm(null));
  modal.addEventListener("click", (e) => { if (e.target === modal || e.target.closest("[data-close-modal]")) modal.hidden = true; });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") modal.hidden = true; });
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const data = new FormData(form);
    const fields = {
      kind: data.get("kind"),
      title: String(data.get("title") || "").trim(),
      plaintiff: toParty(data.get("plaintiff")),
      defendant: toParty(data.get("defendant")),
      summary: String(data.get("summary") || "").trim()
    };
    const existing = form.id.value ? getCase(form.id.value) : null;
    let saved;
    if (existing) {
      saved = saveCase(Object.assign({}, existing, fields), { user, event: { kind: "parties", text: "Оновлено сторони й опис справи." } });
    } else {
      // Суд одразу відкриває провадження; інший посадовець (напр. прокурор) подає справу на розгляд суду
      saved = saveCase(Object.assign(fields, { status: manager ? "open" : "new", createdBy: user.login }),
        { user, event: { kind: "opened", text: manager ? "Відкрито провадження." : "Справу подано до суду." } });
    }
    modal.hidden = true;
    ui.tab = manager ? "all" : "mine";
    drawAll();
    if (saved && saved.id) select(saved.id);
  });

  watchState(() => {
    // Не перебиваємо набір у формах дій
    if (document.activeElement && document.activeElement.closest && document.activeElement.closest("#case-detail form")) { drawTabs(); drawList(); return; }
    drawAll();
  });
  drawAll();
});
