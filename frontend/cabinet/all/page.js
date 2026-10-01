/* Скрипт сторінки «cabinet/all». Запускається, коли дані порталу завантажені й сторінка готова. */
whenStateReady(async function () {
  const user = requireAuth();
  if (!user) return;
  if (isCitizen(user)) location.href = "../appeals/";
  const isAdmin = canManageDocs(user);
  const canEditAll = (user.roles || [])[0] === "governor" || hasPermission(user, "editAllDocs");
  const form = document.getElementById("registry-filter");
  const params = new URLSearchParams(location.search);
  document.getElementById("top-office").textContent = officeTitle(user);
  const navAdmin = document.getElementById("nav-admin");
  if (navAdmin && !canAdmin(user)) navAdmin.style.display = "none";
  // Дії з документами — лише кнопками з підтвердженням (раніше спрацьовували від самого відкриття адреси)
  document.getElementById("registry-list").addEventListener("click", (e) => {
    const b = e.target.closest("[data-doc-action]");
    if (!b) return;
    const doc = getDoc(b.dataset.id);
    if (!doc) return;
    const a = b.dataset.docAction;
    if (a === "publish" && confirm("Опублікувати «" + doc.title + "» одразу, без погодження?")) forcePublishDoc(doc.id, user);
    if (a === "repeal" && confirm("Документ «" + doc.title + "» втрачає чинність і переходить в архів. Продовжити?")) setDocValidity(doc.id, user, false);
    if (a === "reinstate") setDocValidity(doc.id, user, true);
    if (!isAdmin) return drawRegistry();
    if (a === "trash" && confirm("Перенести «" + doc.title + "» у кошик?")) trashDoc(doc.id, user);
    if (a === "restore") restoreDoc(doc.id, user);
    if (a === "delete" && confirm("Видалити «" + doc.title + "» остаточно?\nЦю дію не можна скасувати.")) deleteDoc(doc.id);
    drawRegistry();
  });
  DOC_TYPES.concat(["Кодекс","Наказ","Указ","Розпорядження","Постанова","Доручення","Ордер","Повістка","Ухвала суду","Наказ Голови ВС"], customDocTypes().map((t) => t.label)).filter((v, i, a) => a.indexOf(v) === i).forEach((type) => {
    const option = document.createElement("option");
    option.value = type;
    option.textContent = type;
    form.type.appendChild(option);
  });
  form.status.value = params.get("status") || "all";
  form.type.value = params.get("type") || "all";
  form.q.value = params.get("q") || "";
  function canEdit(doc) {
    return canEditAll || !doc.ownerLogin || doc.ownerLogin === user.login;
  }
  function visibleDocs() {
    const q = form.q.value.trim().toLowerCase();
    return allDocs().filter((doc) => {
      if (form.status.value !== "trash" && doc.status === "trash" && !q) return false;
      if (!isAdmin && !canEditAll && !hasPermission(user, "approveAnyDocs") && doc.ownerLogin && doc.ownerLogin !== user.login && doc.office !== userOffice(user)) return false;
      if (form.status.value === "mine") { if (doc.ownerLogin !== user.login) return false; }
      else if (form.status.value !== "all" && doc.status !== form.status.value) return false;
      if (form.type.value !== "all" && doc.type !== form.type.value) return false;
      return docMatches(doc, q);
    });
  }
  function drawRegistry() {
    const docs = visibleDocs();
    const counts = docs.reduce((acc, doc) => {
      acc[doc.status] = (acc[doc.status] || 0) + 1;
      return acc;
    }, {});
    document.getElementById("registry-title").textContent = `Документи: ${docs.length}`;
    document.getElementById("registry-note").innerHTML = Object.keys(counts).length
      ? Object.keys(counts).map((status) => `<span class="pill">${esc(DOC_STATUSES[status] || status)}: ${counts[status]}</span>`).join(" ")
      : "За цим фільтром документів немає.";
    document.getElementById("registry-list").innerHTML = docs.length ? docs.map((doc) => `
      <article class="act-row">
        <div class="act-num">${esc(formatDocWhen(doc))}</div>
        <div>
          <h3><a href="${attr(docHref(doc))}">${esc(doc.title)}</a></h3>
          <div class="act-meta">${esc(doc.type)} · ${esc(doc.number)} · ${esc(officeName(doc.office) !== "—" ? officeName(doc.office) : (doc.body || ""))}</div>
          ${doc.status === "review" || doc.status === "congress" ? approvalPathHtml(doc, { compact: true }) : ""}
          <div class="route-line">
            ${esc(doc._versions != null ? doc._versions : (doc.versions || []).length)} версій · ${esc(doc._history != null ? doc._history : (doc.history || []).length)} записів журналу
          </div>
        </div>
        <span>
          <span class="badge ${attr(badgeClass(doc.status))}">${esc(DOC_STATUSES[doc.status] || doc.status)}</span>
          ${canEdit(doc) && doc.status !== "trash" && !doc.seeded ? `<a class="btn ghost" href="../create/?id=${encodeURIComponent(doc.id)}">Редагувати</a>` : ""}
          ${canForcePublish(doc, user) ? `<button type="button" class="btn gold" data-doc-action="publish" data-id="${attr(doc.id)}">Опублікувати</button>` : ""}
          ${isAdmin && doc.status === "ok" ? `<button type="button" class="btn ghost" data-doc-action="repeal" data-id="${attr(doc.id)}">Скасувати чинність</button>` : ""}
          ${isAdmin && doc.status === "dead" ? `<button type="button" class="btn ghost" data-doc-action="reinstate" data-id="${attr(doc.id)}">Відновити чинність</button>` : ""}
          ${isAdmin && doc.status !== "trash" ? `<button type="button" class="btn ghost danger" data-doc-action="trash" data-id="${attr(doc.id)}">У кошик</button>` : ""}
          ${isAdmin && doc.status === "trash" ? `<button type="button" class="btn ghost" data-doc-action="restore" data-id="${attr(doc.id)}">Відновити</button>` : ""}
          ${isAdmin && doc.status === "trash" ? `<button type="button" class="btn ghost danger" data-doc-action="delete" data-id="${attr(doc.id)}">Видалити остаточно</button>` : ""}
        </span>
      </article>
    `).join("") : "<p class='lead'>Документів за цим фільтром немає.</p>";
  }
  window.drawRegistry = drawRegistry;
  form.addEventListener("input", drawRegistry);
  form.addEventListener("change", drawRegistry);
  drawRegistry();
});
