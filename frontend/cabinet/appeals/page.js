/* Скрипт сторінки «cabinet/appeals». Запускається, коли дані порталу завантажені й сторінка готова.
   Зліва — список (вкладки «Мої» / «До мого апарату», фільтр статусу, пошук), справа — переписка як у чаті.
   Посилання …/appeals/#<id> одразу відкриває потрібне звернення. */
whenStateReady(async function () {
  const user = requireAuth();
  if (!user) return;
  document.getElementById("top-office").textContent = isCitizen(user) ? "Кабінет громадянина" : officeTitle(user);
  const staff = isStaff(user);
  if (isCitizen(user)) document.querySelectorAll("[data-staff-nav]").forEach((el) => { el.style.display = "none"; });
  const navAdmin = document.getElementById("nav-admin");
  if (navAdmin && !canAdmin(user)) navAdmin.style.display = "none";
  if (staff) document.getElementById("appeals-lead").textContent = "Відповідайте громадянам у вкладці «До мого апарату». Свої звернення як громадянин — у вкладці «Мої».";

  const $ = (id) => document.getElementById(id);
  const ui = { tab: "mine", status: "all", q: "", selected: "" };
  const lastAt = (a) => {
    const t = a.thread || [];
    return (t.length && t[t.length - 1].at) || a.updatedAt || a.createdAt || "";
  };
  const byRecent = (a, b) => String(lastAt(b)).localeCompare(String(lastAt(a)));
  const mine = () => citizenAppealsFor(user).slice().sort(byRecent);
  const office = () => staff ? officeAppealsFor(user).filter((a) => a.ownerLogin !== user.login).sort(byRecent) : [];
  // Потребує уваги: громадянину — отримана відповідь; апарату — очікує відповіді
  const needsMe = (a, tab) => tab === "office" ? a.status === "waiting" : a.status === "answered";
  const statusCls = (s) => s === "answered" ? "ok" : s === "closed" ? "dead" : "draft";
  const messages = (a) => {
    const t = (a.thread || []).slice();
    if (!t.length || String(t[0].text || "").trim() !== String(a.text || "").trim()) {
      t.unshift({ by: a.ownerLogin, byName: a.name, at: a.createdAt, text: a.text });
    }
    return t;
  };

  // Звернення з посилання (#id) — потрібна вкладка
  const fromHash = decodeURIComponent(location.hash.slice(1));
  if (fromHash && office().some((a) => a.id === fromHash)) ui.tab = "office";
  else if (!fromHash && staff && office().some((a) => a.status === "waiting")) ui.tab = "office";
  if (fromHash) ui.selected = fromHash;

  function list() {
    const q = ui.q.trim().toLowerCase();
    return (ui.tab === "office" ? office() : mine()).filter((a) => {
      if (ui.status !== "all" && a.status !== ui.status) return false;
      if (!q) return true;
      return [a.number, a.kind, a.text, a.name, a.statId, officeName(a.office)].concat((a.thread || []).map((m) => m.text))
        .join(" ").toLowerCase().includes(q);
    });
  }

  function drawTabs() {
    const tabs = [{ id: "mine", label: "Мої", items: mine() }];
    if (staff) tabs.push({ id: "office", label: "До мого апарату", items: office() });
    $("appeals-tabs").hidden = tabs.length < 2;
    $("appeals-tabs").innerHTML = tabs.map((t) => {
      const attention = t.items.filter((a) => needsMe(a, t.id)).length;
      return `<button type="button" role="tab" data-tab="${t.id}" class="${t.id === ui.tab ? "active" : ""}" aria-selected="${t.id === ui.tab}">${esc(t.label)}
        <span class="pill">${t.items.length}</span>${attention ? `<span class="nav-badge" title="${t.id === "office" ? "Очікують відповіді" : "Є нові відповіді"}">${attention}</span>` : ""}</button>`;
    }).join("");
    document.querySelectorAll("#appeals-status [data-st]").forEach((b) => b.classList.toggle("active", b.dataset.st === ui.status));
  }

  function drawList() {
    const items = list();
    if (ui.selected && !items.some((a) => a.id === ui.selected) && !(ui.tab === "office" ? office() : mine()).some((a) => a.id === ui.selected)) ui.selected = "";
    $("appeals-list").innerHTML = items.length ? items.map((a) => {
      const msgs = messages(a);
      const last = msgs[msgs.length - 1] || {};
      const from = last.by === user.login ? "Ви: " : (last.byName ? last.byName + ": " : "");
      return `
        <button type="button" class="appeal-item${a.id === ui.selected ? " is-active" : ""}${needsMe(a, ui.tab) ? " is-unread" : ""}" data-id="${attr(a.id)}" role="option" aria-selected="${a.id === ui.selected}">
          <span class="appeal-item-top">
            <b>${esc(a.number)} · ${esc(a.kind || "Звернення")}</b>
            <span class="badge ${statusCls(a.status)}">${esc(appealStatusLabel(a.status))}</span>
          </span>
          <span class="appeal-item-meta">${esc(ui.tab === "office" ? (a.name || "") + (a.statId ? " · " + a.statId : "") : officeName(a.office))} · ${esc(formatDocWhen({ date: lastAt(a) }))}</span>
          <span class="appeal-item-last">${esc(from + String(last.text || "").slice(0, 140))}</span>
        </button>`;
    }).join("") : `<div class="admin-empty">${ui.q || ui.status !== "all" ? "За цим фільтром звернень немає."
      : ui.tab === "office" ? "До вашого апарату ще немає звернень." : "Ви ще не подавали звернень. Натисніть «+ Нове звернення»."}</div>`;
  }

  function drawDetail(keepDraft) {
    const box = $("appeal-detail");
    const a = allAppeals().find((x) => x.id === ui.selected);
    $("appeals-layout").classList.toggle("has-selection", !!a);
    if (!a) {
      box.innerHTML = `<div class="appeal-empty"><b>Оберіть звернення</b><span>Тут з'явиться вся переписка й відповідь.</span></div>`;
      return;
    }
    const draft = keepDraft && box.querySelector("textarea") ? box.querySelector("textarea").value : "";
    const asOffice = ui.tab === "office";
    box.innerHTML = `
      <div class="appeal-detail-head">
        <button type="button" class="btn ghost appeal-back" data-back>← До списку</button>
        <div>
          <h3>${esc(a.number)} · ${esc(a.kind || "Звернення")}</h3>
          <div class="admin-row-meta">
            <span>${esc(officeName(a.office))}</span>
            <span>подано ${esc(formatDocWhen({ date: a.createdAt }))}</span>
            ${asOffice ? `<span>${esc(a.name || "")}${a.statId ? " · Stat ID " + esc(a.statId) : ""}${a.contact ? " · " + esc(a.contact) : ""}</span>` : ""}
          </div>
        </div>
        <span class="badge ${statusCls(a.status)}">${esc(appealStatusLabel(a.status))}</span>
      </div>
      <div class="appeal-chat" id="appeal-chat">
        ${messages(a).map((m) => {
          const own = m.by === user.login;
          const fromOwner = m.by === a.ownerLogin;
          return `<div class="chat-msg ${own ? "is-own" : ""} ${fromOwner ? "from-owner" : "from-office"}">
            <span class="chat-who">${esc(own ? "Ви" : m.byName || "—")}${!fromOwner ? ` <small>· ${esc(officeName(a.office))}</small>` : ""}</span>
            <p>${esc(m.text || "").replace(/\n/g, "<br>")}</p>
            <time>${esc(formatDocWhen({ date: m.at }))}</time>
          </div>`;
        }).join("")}
      </div>
      ${a.status === "closed" ? `<p class="muted appeal-closed">Звернення закрито${a.closedByName ? " · " + esc(a.closedByName) : ""}. Писати в ньому вже не можна — за потреби подайте нове.</p>` : `
      <form class="appeal-reply" id="appeal-reply">
        <textarea name="message" required rows="3" placeholder="${asOffice ? "Відповідь громадянину…" : "Уточнення до звернення…"}  (Ctrl+Enter — надіслати)"></textarea>
        <div class="form-actions">
          <button class="btn ${asOffice ? "gold" : "ghost"}" type="submit">${asOffice ? "Надати відповідь" : "Надіслати"}</button>
          <button class="btn ghost" type="button" data-close-appeal-id="${attr(a.id)}">Закрити звернення</button>
        </div>
      </form>`}`;
    if (draft) box.querySelector("textarea").value = draft;
    const chat = $("appeal-chat");
    chat.scrollTop = chat.scrollHeight;
  }

  function drawAll(keepDraft) {
    drawTabs();
    drawList();
    drawDetail(keepDraft);
    if (typeof enhanceCabinetNavigation === "function" && document.querySelector(".side-me")) enhanceCabinetNavigation();
  }

  function select(id) {
    ui.selected = id;
    history.replaceState(null, "", location.pathname + location.search + (id ? "#" + encodeURIComponent(id) : ""));
    drawList();
    drawDetail(false);
    if (id && window.matchMedia("(max-width: 900px)").matches) $("appeal-detail").scrollIntoView({ block: "start" });
  }

  // Події
  $("appeals-tabs").addEventListener("click", (e) => {
    const b = e.target.closest("[data-tab]");
    if (!b || b.dataset.tab === ui.tab) return;
    ui.tab = b.dataset.tab;
    ui.selected = "";
    history.replaceState(null, "", location.pathname + location.search);
    drawAll(false);
  });
  $("appeals-status").addEventListener("click", (e) => {
    const b = e.target.closest("[data-st]");
    if (!b) return;
    ui.status = b.dataset.st;
    drawTabs();
    drawList();
  });
  $("appeals-q").addEventListener("input", (e) => { ui.q = e.target.value; drawList(); });
  $("appeals-list").addEventListener("click", (e) => {
    const b = e.target.closest("[data-id]");
    if (b) select(b.dataset.id);
  });
  $("appeal-detail").addEventListener("click", (e) => {
    if (e.target.closest("[data-back]")) return select("");
    const c = e.target.closest("[data-close-appeal-id]");
    if (!c) return;
    const appeal = allAppeals().find((x) => x.id === c.dataset.closeAppealId);
    if (!appeal || !confirm("Закрити звернення " + appeal.number + "? Після цього в ньому не можна буде писати.")) return;
    saveAppeal(Object.assign({}, appeal, { status: "closed", closedAt: new Date().toISOString(), closedBy: user.login, closedByName: actorName(user) }), { user, message: "Звернення закрито." });
    drawAll(false);
  });
  $("appeal-detail").addEventListener("submit", (e) => {
    if (e.target.id !== "appeal-reply") return;
    e.preventDefault();
    const appeal = allAppeals().find((x) => x.id === ui.selected);
    const message = String(new FormData(e.target).get("message") || "").trim();
    if (!appeal || !message) return;
    saveAppeal(Object.assign({}, appeal, { status: ui.tab === "office" ? "answered" : "waiting" }), { user, message });
    drawAll(false);
  });
  $("appeal-detail").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && e.target.matches("#appeal-reply textarea")) {
      e.preventDefault();
      e.target.form.requestSubmit();
    }
  });

  // Нове звернення — у вікні; дані людини беруться з профілю
  const modal = $("appeal-modal");
  const form = $("appeal-form");
  form.office.innerHTML = allOffices().map((o) => `<option value="${attr(o.id)}">${esc(o.name)}</option>`).join("");
  function fillMe() {
    form.name.value = user.username || "";
    form.statId.value = user.statId || "";
    form.contact.value = user.contact || "";
    const missing = !form.name.value || !form.statId.value || !form.contact.value;
    $("appeal-me").open = missing;
    $("appeal-me-line").textContent = missing ? "заповніть, щоб апарат міг з вами зв'язатися" : [form.name.value, form.statId.value, form.contact.value].join(" · ");
  }
  $("appeal-new-btn").addEventListener("click", () => {
    form.reset();
    fillMe();
    $("appeal-form-msg").textContent = "";
    modal.hidden = false;
    form.text.focus();
  });
  modal.addEventListener("click", (e) => { if (e.target === modal || e.target.closest("[data-close-appeal]")) modal.hidden = true; });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") modal.hidden = true; });
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const data = new FormData(form);
    const text = String(data.get("text") || "").trim();
    if (text.length < 10) { $("appeal-form-msg").textContent = "Опишіть суть детальніше (хоча б кілька слів)."; return; }
    const saved = saveAppeal({
      ownerLogin: user.login,
      name: data.get("name"),
      statId: data.get("statId"),
      contact: data.get("contact"),
      kind: data.get("kind"),
      office: data.get("office"),
      text,
      status: "waiting"
    }, { user, message: text });
    modal.hidden = true;
    ui.tab = "mine";
    ui.status = "all";
    drawAll(false);
    if (saved && saved.id) select(saved.id);
  });

  // Нові повідомлення приходять наживо; набраний текст відповіді не губиться
  watchState(() => drawAll(true));
  drawAll(false);
});
