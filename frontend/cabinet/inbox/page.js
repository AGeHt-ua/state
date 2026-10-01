/* Скрипт сторінки «cabinet/inbox». Запускається, коли дані порталу завантажені й сторінка готова. */
whenStateReady(async function () {
  const user = requireAuth();
  if (!user) return;
  document.getElementById("top-office").textContent = isCitizen(user) ? "Кабінет громадянина" : officeTitle(user);
  if (isCitizen(user)) {
    document.querySelectorAll('a[href="../all/"], .create-doc-link').forEach((el) => { el.style.display = "none"; });
    document.getElementById("inbox-lead").textContent = "Відповіді та оновлення за вашими зверненнями.";
  }
  const navAdmin = document.getElementById("nav-admin");
  if (navAdmin && !canAdmin(user)) navAdmin.style.display = "none";
  // Рішення — тільки кнопками з перевіркою прав у store.js (canApproveDoc), без дій через адресу сторінки
  function decide(id, action) {
    const doc = getDoc(id);
    const allowed = action === "publish" ? canForcePublish(doc, user) : action === "return" ? canReturnDoc(doc, user) : canApproveDoc(doc, user);
    if (!doc || !allowed) { alert("Цей документ уже не чекає вашого рішення."); draw(); return; }
    if (action === "publish") {
      if (!confirm("Опублікувати «" + doc.title + "» одразу, без решти маршруту погодження?")) return;
      forcePublishDoc(id, user);
    } else if (action === "return") {
      const reason = prompt("Що треба доопрацювати? Автор побачить цей коментар.", "");
      if (reason === null) return;
      returnDoc(id, user, reason);
    } else if (action === "against") {
      if (!confirm("Проголосувати «проти» документа «" + doc.title + "»?")) return;
      voteDoc(id, user, "against");
    } else if (action === "for") {
      voteDoc(id, user, "for");
    } else {
      approveDoc(id, user);
    }
    draw();
    if (typeof enhanceCabinetNavigation === "function") enhanceCabinetNavigation();
  }
  // Адмінські дії над документом, що чекає не вас: погодити крок / повернути / опублікувати одразу
  function overrideActions(d) {
    return [
      canApproveDoc(d, user) ? `<button class="btn ghost" type="button" data-decide="approve" data-id="${attr(d.id)}">Погодити крок</button>` : "",
      canReturnDoc(d, user) ? `<button class="btn ghost" type="button" data-decide="return" data-id="${attr(d.id)}">Повернути</button>` : "",
      canForcePublish(d, user) ? `<button class="btn gold" type="button" data-decide="publish" data-id="${attr(d.id)}">Опублікувати одразу</button>` : ""
    ].join("");
  }
  // Скільки документ чекає на поточному кроці; понад добу — підсвічуємо
  function waitBadge(d) {
    const since = Date.parse(d.lastApprovedAt || d.updatedAt || d.publishedAt || d.date);
    if (!since) return "";
    const hours = Math.floor((Date.now() - since) / 3600000);
    if (hours < 1) return "";
    const label = hours < 24 ? "чекає " + hours + " год" : "чекає " + Math.floor(hours / 24) + " дн.";
    return ` <span class="badge ${hours >= 24 ? "warn" : "dead"}" title="Скільки документ чекає рішення на цьому кроці">${label}</span>`;
  }
  function docCard(d, override) {
    const congress = d.approverOffice === "congress";
    const t = congress ? congressTally(d) : null;
    return `
    <article class="act-row inbox-row${waitBadge(d).includes("warn") ? " is-overdue" : ""}">
      <div class="act-num">${esc(d.number || "б/н")}<br>${esc(formatDocWhen(d))}</div>
      <div>
        <h3><a href="${attr(docHref(d))}">${esc(d.title)}</a>${waitBadge(d)}</h3>
        <div class="act-meta">${esc(d.type)} · ${esc(officeName(d.office))} · автор: ${esc(d.author || "—")}</div>
        ${approvalPathHtml(d, { compact: true })}
        ${congress ? `<div class="vote-tally"><span class="pro">За: ${t.pro}</span><span class="contra">Проти: ${t.contra}</span><span>Потрібно ${t.needed} з ${t.members || 1}</span></div>` : ""}
      </div>
      <span class="row-actions">
        <a class="btn ghost" href="${attr(docHref(d))}">Переглянути</a>
        ${override ? overrideActions(d) : congress
          ? `<button class="btn gold" type="button" data-decide="for" data-id="${attr(d.id)}">За</button>
             <button class="btn ghost danger" type="button" data-decide="against" data-id="${attr(d.id)}">Проти</button>`
          : `<button class="btn gold" type="button" data-decide="approve" data-id="${attr(d.id)}">Погодити</button>
             <button class="btn ghost" type="button" data-decide="return" data-id="${attr(d.id)}">Повернути</button>`}
      </span>
    </article>`;
  }
  const KIND_ICON = { returned: "↩", rejected: "✕", published: "✓", progress: "…", appeal: "✉", answer: "✉", profile: "👤", people: "👥" };
  function noteRow(n) {
    const href = n.doc ? (n.kind === "returned" ? "../create/?id=" + encodeURIComponent(n.doc.id) : docHref(n.doc))
      : n.appeal ? "../appeals/" : "../admin/";
    const label = n.kind === "returned" ? "Доопрацювати" : n.doc ? "Відкрити" : "Перейти";
    return `
      <article class="admin-list-row${n.attention ? " is-attention" : ""}">
        <div class="admin-code note-${attr(n.kind)}">${KIND_ICON[n.kind] || "•"}</div>
        <div class="admin-row-main">
          <div class="admin-row-title"><b>${esc(n.title)}</b></div>
          <div class="admin-row-meta"><span>${esc(n.text)}</span>${n.at ? `<span>${esc(formatDocWhen({ date: n.at }))}</span>` : ""}</div>
        </div>
        <div class="admin-row-actions"><a class="btn ${n.attention ? "gold" : "ghost"}" href="${attr(href)}">${label}</a></div>
      </article>`;
  }
  // Мій документ: де він зараз (ланцюжок шляху), а для поверненого — причина й кнопка «Доопрацювати»
  function myDocCard(n) {
    const d = getDoc(n.doc.id) || n.doc;
    const returned = n.kind === "returned" || n.kind === "rejected";
    const reason = n.kind === "rejected" ? d.rejectedReason : d.returnedReason;
    return `
    <article class="act-row inbox-row${returned ? " is-attention" : ""}">
      <div class="act-num">${esc(d.number || "б/н")}<br>${esc(formatDocWhen({ date: n.at || d.updatedAt || d.date }))}</div>
      <div>
        <h3><a href="${attr(docHref(d))}">${esc(d.title)}</a></h3>
        <div class="act-meta">${esc(d.type)} · <span class="badge ${attr(badgeClass(d.status))}">${esc(DOC_STATUSES[d.status] || d.status)}</span></div>
        ${(d.approvalSteps || []).length ? approvalPathHtml(d, { compact: true }) : ""}
        ${returned && reason ? `<p class="notice${n.kind === "rejected" ? " danger" : ""}" style="margin:8px 0 0">${esc(n.title)}: ${esc(reason)}</p>` : ""}
      </div>
      <span class="row-actions">
        ${n.kind === "returned"
          ? `<a class="btn gold" href="../create/?id=${encodeURIComponent(d.id)}">Доопрацювати</a>`
          : `<a class="btn ghost" href="${attr(docHref(d))}">Відкрити</a>`}
      </span>
    </article>`;
  }

  /* Вкладки: кожна — окремий тип справ. Порожні службові вкладки не показуються. */
  function sections() {
    const review = isCitizen(user) ? [] : reviewDocsFor(user);
    const approve = review.filter((d) => d.approverOffice !== "congress");
    const vote = review.filter((d) => d.approverOffice === "congress");
    const others = isCitizen(user) ? [] : overrideDocsFor(user);
    const notes = notificationsFor(user).filter((n) => n.kind !== "approve" && n.kind !== "vote");
    const mine = notes.filter((n) => n.doc);
    const events = notes.filter((n) => !n.doc);
    const empty = (text) => `<p class="muted empty-note">${text}</p>`;
    if (isCitizen(user)) {
      return [{ id: "events", label: "Відповіді на звернення", items: events, badge: events.filter((n) => n.attention).length,
        html: () => events.length ? `<div class="admin-list">${events.map(noteRow).join("")}</div>` : empty("Нових відповідей немає.") }];
    }
    return [
      { id: "approve", label: "Погодити", items: approve, badge: approve.length,
        hint: "Документи, які чекають саме вашого рішення: погодьте — і документ піде далі шляхом, або поверніть автору з коментарем.",
        html: () => approve.length ? approve.map((d) => docCard(d)).join("") : empty("Нічого не чекає вашого погодження.") },
      { id: "vote", label: "Голосування Конгресу", items: vote, badge: vote.length, show: vote.length || isCongressMember(user),
        hint: "Документи на голосуванні Конгресу. Рішення — більшість голосів усіх конгресменів.",
        html: () => vote.length ? vote.map((d) => docCard(d)).join("") : empty("Зараз немає документів на голосуванні.") },
      { id: "mine", label: "Мої документи", items: mine, badge: mine.filter((n) => n.attention).length, neutral: mine.filter((n) => !n.attention).length,
        hint: "Ваші документи за останній тиждень: де вони зараз на шляху погодження, що опубліковано, що повернули на доопрацювання.",
        html: () => mine.length ? mine.map(myDocCard).join("") : empty("За останній тиждень змін у ваших документах немає.") },
      { id: "events", label: "Події", items: events, badge: events.filter((n) => n.attention).length, neutral: events.filter((n) => !n.attention).length,
        hint: "Звернення громадян до вашого апарату, заявки на зміну профілю та інші події кабінету.",
        html: () => events.length ? `<div class="admin-list">${events.map(noteRow).join("")}</div>` : empty("Нових подій немає.") },
      { id: "all", label: "Усі на погодженні", items: others, neutral: others.length, show: others.length > 0,
        hint: "Права адміністратора: можна погодити поточний крок за іншого посадовця, повернути документ автору або опублікувати одразу. Голосувати за Конгрес не можна — лише повернути або опублікувати.",
        html: () => others.map((d) => docCard(d, true)).join("") }
    ].filter((t) => t.show === undefined || t.show);
  }
  let current = (location.hash || "").slice(1);
  function draw() {
    const tabs = sections();
    // Без вибору відкриваємо те, що потребує дії, інакше — першу непорожню вкладку
    if (!tabs.some((t) => t.id === current)) current = (tabs.find((t) => t.badge) || tabs.find((t) => t.items.length) || tabs[0]).id;
    const tab = tabs.find((t) => t.id === current);
    document.getElementById("inbox-tabs").hidden = tabs.length < 2;
    document.getElementById("inbox-tabs").innerHTML = tabs.map((t) => `<button type="button" role="tab" data-inbox-tab="${t.id}" class="${t.id === current ? "active" : ""}" aria-selected="${t.id === current}">${esc(t.label)}${t.badge ? `<span class="nav-badge">${t.badge}</span>` : t.neutral ? `<span class="pill">${t.neutral}</span>` : ""}</button>`).join("");
    document.getElementById("inbox-hint").textContent = tab.hint || "";
    document.getElementById("inbox-hint").hidden = !tab.hint;
    document.getElementById("inbox-body").innerHTML = tab.html();
    document.querySelectorAll("[data-decide]").forEach((b) => b.addEventListener("click", () => decide(b.dataset.id, b.dataset.decide)));
  }
  document.getElementById("inbox-tabs").addEventListener("click", (e) => {
    const b = e.target.closest("[data-inbox-tab]");
    if (!b) return;
    current = b.dataset.inboxTab;
    history.replaceState(null, "", "#" + current);
    draw();
  });
  draw();
  // Голоси, погодження й нові документи підтягуються самі — без перезавантаження сторінки
  watchState(() => {
    draw();
    if (typeof ensureAccountActions === "function") ensureAccountActions();
    if (typeof enhanceCabinetNavigation === "function") enhanceCabinetNavigation();
  });
});
