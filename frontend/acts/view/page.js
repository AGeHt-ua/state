/* Скрипт сторінки «acts/view». Запускається, коли дані порталу завантажені й сторінка готова. */
whenStateReady(async function () {
  const id = new URLSearchParams(location.search).get("id");
  // Зв'язки: що цей документ змінює / скасовує і які документи змінили / скасували його
  function linkRows() {
    const ref = (d) => `<a href="${attr(docHref(d))}">${esc(d.title)}</a>`;
    const byIds = (ids) => ids.map((x) => getDoc(x)).filter(Boolean);
    const own = docLinks(doc);
    const back = docBacklinks(doc.id);
    const rows = [
      ["Змінює", byIds(own.amends)],
      ["Скасовує", byIds(own.repeals)],
      ["Зміни внесено", back.amendedBy],
      [doc.status === "dead" ? "Скасовано" : "Скасовується", back.repealedBy.concat(doc.repealedBy && !back.repealedBy.some((d) => d.id === doc.repealedBy) ? byIds([doc.repealedBy]) : [])]
    ].filter(([, list]) => list.length);
    return rows.map(([label, list]) => `<tr><th>${label}</th><td>${list.map(ref).join("<br>")}</td></tr>`).join("");
  }
  // Список документів приходить скороченим — тут завантажуємо повний (з версіями й журналом)
  const doc = await loadFullDoc(id);
  // Конституція з початкових даних без тексту з редактора — показуємо її окрему сторінку
  if (doc && doc.id === "const-sa-01" && !doc.docHtml && !doc.html) { location.replace("../const-sa-01/"); return; }
  // Хтось проголосував чи погодив — оновлюємо картку, щоб було видно актуальний стан
  if (doc) watchState(() => { const fresh = getDoc(id); if (fresh && fresh._rev !== doc._rev) location.reload(); });
  const root = document.getElementById("doc-root");
  const viewer = currentUser();
  if (!doc || ((doc.status === "trash" || doc.status === "deleted") && !(viewer && isStaff(viewer)))) {
    root.innerHTML = "<h2 class='page-title'>Документ не знайдено</h2><p><a href='../'>До списку</a></p>";
    return;
  }

  const canSeeLifecycle = viewer && isStaff(viewer);
  const history = (doc.history || []).slice().reverse();
  const versions = (doc.versions || []).slice();
  function stepActorName(step) {
    const raw = String(step || "");
    if (raw === "congress") return "Конгрес штату";
    if (raw === "authorOffice") return officeName(doc.office);
    if (raw.startsWith("position:") || raw.startsWith("user:")) return routeStepName(raw, doc);
    return officeName(raw);
  }
  function stepActorOffice(step) {
    const raw = String(step || "");
    if (raw === "congress") return "Колегіальне голосування";
    if (raw.startsWith("position:")) {
      const position = positionById(raw.slice(9));
      return position ? officeName(position.office) : "Погодження документа";
    }
    if (raw.startsWith("user:")) {
      const member = allUsers().find((u) => u.login === raw.slice(5));
      return member ? officeName(member.office || userOffice(member)) : "Погодження документа";
    }
    return "Погодження документа";
  }
  // Підписанти: розробник проєкту + кожен крок маршруту з фактичним рішенням із doc.approvals
  const approvals = doc.approvals || [];
  const inRoute = doc.status === "review" || doc.status === "congress";
  const current = Number(doc.approvalIndex || 0);
  const author = allUsers().find((u) => u.login === doc.ownerLogin);
  const signer = docSigner(doc);
  // Публікація адміністратором без решти маршруту
  const adminPublish = doc.status !== "draft" && doc.status !== "rejected" ? approvals.filter((a) => a.step === "admin").slice(-1)[0] : null;
  const signerRows = [{
    role: "Розробник проєкту",
    name: doc.author || "—",
    office: (author && author.post ? author.post + " · " : "") + (doc.body || officeName(doc.office)),
    state: "Підготував проєкт", cls: "ok",
    at: (doc.history && doc.history[0] && doc.history[0].at) || doc.date
  }].concat((doc.approvalSteps || []).map((step, index) => {
    const done = approvals.filter((a) => a.step === step && a.decision === "approved").slice(-1)[0];
    const returned = approvals.filter((a) => a.step === step && a.decision !== "approved").slice(-1)[0];
    let state = "Очікує черги", cls = "muted";
    if (done && (index < current || doc.status === "ok" || doc.status === "adopted" || doc.status === "dead")) { state = "Погоджено"; cls = "ok"; }
    else if (adminPublish && !inRoute) { state = "Пропущено"; cls = "muted"; }
    else if (inRoute && index === current) {
      if (step === "congress") { const t = congressTally(doc); state = "Голосування: за " + t.pro + ", проти " + t.contra; }
      else state = "Очікує рішення";
      cls = "draft";
    } else if (returned && (doc.status === "draft" || doc.status === "rejected")) {
      state = returned.decision === "rejected" ? "Відхилено" : "Повернено"; cls = "dead";
    } else if (!inRoute && doc.status !== "ok") { state = "—"; cls = "muted"; }
    const actor = done || returned;
    const signs = signer && done && done.by === signer.login && state === "Погоджено";
    return {
      role: step === "congress" ? "Голосування Конгресу" : stepActorOffice(step),
      name: actor ? actor.byName + (actor.post ? " · " + actor.post : "") : stepActorName(step),
      office: actor && actor.comment ? "Коментар: " + actor.comment : "",
      state: signs ? "Погоджено й підписано" : state, cls,
      at: actor ? actor.at : ""
    };
  })).concat(adminPublish ? [{
    role: "Адміністратор",
    name: adminPublish.byName + (adminPublish.post ? " · " + adminPublish.post : ""),
    office: "Опубліковано без решти маршруту",
    state: signer && signer.login === adminPublish.by ? "Опубліковано й підписано" : "Опубліковано", cls: "ok",
    at: adminPublish.at
  }] : []);

  // Журнали: довгі — згорнуті до останніх записів, з кнопкою «Показати всі»
  const FOLD = 4;
  function foldList(items, render, empty, key) {
    if (!items.length) return `<p class='muted'>${empty}</p>`;
    const head = items.slice(0, FOLD).map(render).join("");
    const rest = items.slice(FOLD).map(render).join("");
    return head + (rest ? `
      <div class="fold-rest" id="fold-${key}" hidden>${rest}</div>
      <button type="button" class="btn ghost fold-btn" data-fold="${key}" data-more="Показати всі (${items.length})" aria-expanded="false">Показати всі (${items.length})</button>` : "");
  }
  // Редакції — від нової до старої; у кожної кнопки «Що змінилось» і «Переглянути»
  const versionItems = versions.map((v, i) => ({ v, i })).reverse();
  const renderVersion = ({ v, i }) => `
    <article class="timeline-item">
      <b>${esc(v.label || "Редакція")}${i === versions.length - 1 ? ' <span class="pill">поточна</span>' : ""}</b>
      <span>${esc(formatDocWhen({ date: v.at }))} · ${esc(v.byName || "Система")} · ${esc(DOC_STATUSES[v.status] || v.status || "")}</span>
      <div class="timeline-actions">
        ${i > 0 ? `<button type="button" class="link-btn" data-diff="${i}">Що змінилось</button>` : `<small class="muted">Перша редакція</small>`}
        <button type="button" class="link-btn" data-version="${i}">Переглянути редакцію</button>
      </div>
    </article>`;
  const renderHistory = (h) => `
    <article class="timeline-item">
      <b>${esc(h.action || "Оновлено")}</b>
      <span>${esc(formatDocWhen({ date: h.at }))} · ${esc(h.byName || "Система")}</span>
      ${h.summary ? `<p>${esc(h.summary)}</p>` : ""}
    </article>`;

  const paperHtml = doc.docHtml
    ? `<div class="published-paper"><article class="a4-page">${sanitizeDocHtml(signedDocHtml(doc))}</article></div>`
    : doc.html
      /* Документ з попередньої версії Канцелярії: лише текст аркуша, без полів сторінки */
      ? `<div class="published-paper"><article class="a4-page"><div class="ch-sheet" style="width:210mm;min-height:297mm;padding:20mm 15mm 20mm 30mm"><div class="doc-content">${sanitizeDocHtml(doc.html)}</div></div></article></div>`
      : `<div>${esc(doc.text || "").replace(/\n/g, "<br>")}</div>`;

  document.title = doc.title;
  root.innerHTML = `
    <div class="crumbs"><a href="../../">Головна</a> / <a href="../">Законодавча база</a> / ${esc(doc.number)}</div>
    ${doc.fundamental ? `<p class="const-kicker" style="text-align:left">Основний закон штату</p>` : ""}
    <h2 class="page-title">${esc(doc.title)}</h2>
    <table class="meta-table">
      <tr><th>Вид</th><td>${esc(doc.type)}</td></tr>
      <tr><th>Номер</th><td>${esc(doc.number)}</td></tr>
      <tr><th>Дата</th><td>${esc(formatDocWhen(doc))}</td></tr>
      <tr><th>Статус</th><td><span class="badge ${attr(badgeClass(doc.status))}">${esc(DOC_STATUSES[doc.status] || doc.status)}</span></td></tr>
      <tr><th>Орган</th><td>${esc(doc.body || "—")}</td></tr>
      <tr><th>Проєкт підготував</th><td>${esc(doc.author || "—")}</td></tr>
      ${signer ? `<tr><th>Підписав</th><td>${esc(signer.name)}${signer.post ? " · " + esc(signer.post) : ""}</td></tr>` : ""}
      ${(doc.approvalSteps || []).length && (viewer && isStaff(viewer) || doc.status === "review" || doc.status === "congress") ? `<tr><th>Погодження</th><td>${approvalPathHtml(doc, { compact: true })}</td></tr>` : ""}
      ${linkRows()}
    </table>
    <nav class="const-toc" id="zmist" hidden></nav>
    ${paperHtml}
    <section class="card lifecycle-card">
      <h3>Погодження та підписанти</h3>
      ${doc.status === "draft" && doc.returnedReason ? `<p class="notice">Повернено на доопрацювання${doc.returnedByName ? " (" + esc(doc.returnedByName) + ")" : ""}: ${esc(doc.returnedReason)}</p>` : ""}
      ${doc.status === "rejected" && doc.rejectedReason ? `<p class="notice danger">${esc(doc.rejectedReason)}</p>` : ""}
      <ol class="signer-list">
        ${signerRows.map((row) => `
          <li class="signer-row is-${attr(row.cls)}">
            <div>
              <small>${esc(row.role)}</small>
              <b>${esc(row.name)}</b>
              ${row.office ? `<span>${esc(row.office)}</span>` : ""}
            </div>
            <div class="signer-state">
              <span class="badge ${attr(row.cls === "muted" ? "dead" : row.cls)}">${esc(row.state)}</span>
              ${row.at ? `<small>${esc(formatDocWhen({ date: row.at }))}</small>` : ""}
            </div>
          </li>
        `).join("")}
      </ol>
    </section>
    ${canSeeLifecycle ? `
      <section class="card lifecycle-card">
        <h3>Життєвий цикл документа</h3>
        <div class="lifecycle-grid">
          <div>
            <h4>Редакції <small class="muted">${versions.length}</small></h4>
            ${foldList(versionItems, renderVersion, "Редакцій ще немає.", "versions")}
          </div>
          <div>
            <h4>Журнал змін <small class="muted">${history.length}</small></h4>
            ${foldList(history, renderHistory, "Записів журналу ще немає.", "history")}
          </div>
        </div>
      </section>
    ` : ""}
    <div class="modal-backdrop" id="version-modal" hidden>
      <section class="modal-card version-modal" role="dialog" aria-modal="true" aria-labelledby="version-title">
        <button class="modal-close" type="button" data-close-version aria-label="Закрити">×</button>
        <h3 id="version-title">Редакція</h3>
        <p class="muted" id="version-sub"></p>
        <div id="version-body"></div>
      </section>
    </div>
  `;

  // Основний закон: зміст із розділами й статтями, у кожної статті — власне посилання (#st-5)
  if (doc.fundamental) buildFundamentalToc();
  function buildFundamentalToc() {
    const content = root.querySelector(".published-paper .doc-content") || root.querySelector(".published-paper");
    if (!content) return;
    const toc = [];
    const articles = [];
    let sec = 0;
    content.querySelectorAll("h1, h2, h3, h4, p, li").forEach((el) => {
      const text = el.textContent.trim();
      if (!text || el.closest("table")) return;
      const head = text.slice(0, 12).toUpperCase();
      if (head.startsWith("ПРЕАМБУЛА") || head.startsWith("РОЗДІЛ") || head.startsWith("ГЛАВА") || head.startsWith("ЧАСТИНА")) {
        sec += 1;
        el.id = "roz-" + sec;
        el.classList.add("fund-anchor");
        toc.push({ id: el.id, title: text.length > 90 ? text.slice(0, 90) + "…" : text });
        return;
      }
      const m = text.match(/^Стаття\s+(\d+)/i);
      if (m && !document.getElementById("st-" + m[1])) {
        el.id = "st-" + m[1];
        el.classList.add("fund-anchor");
        articles.push(m[1]);
      }
    });
    if (!toc.length && !articles.length) return;
    const nav = document.getElementById("zmist");
    nav.innerHTML = `<h3>Зміст</h3>` +
      (toc.length ? `<ol>${toc.map((t) => `<li><a href="#${t.id}">${esc(t.title)}</a></li>`).join("")}</ol>` : "") +
      (articles.length ? `<p class="muted">Статті: ${articles.map((n) => `<a href="#st-${n}">${n}</a>`).join(" · ")}</p>` : "");
    nav.hidden = false;
    if (location.hash) { const el = document.querySelector(location.hash); if (el) el.scrollIntoView(); }
  }

  // Порівняння редакцій і перегляд старої редакції
  const modal = document.getElementById("version-modal");
  function versionHtml(i) {
    // docHtml зберігається лише коли вигляд змінився — беремо найближчий попередній
    for (let k = i; k >= 0; k--) if (versions[k] && versions[k].docHtml) return versions[k].docHtml;
    return "";
  }
  function openVersion(i, diff) {
    const v = versions[i];
    if (!v) return;
    document.getElementById("version-title").textContent = (diff ? "Що змінилось: " : "") + (v.label || "Редакція");
    document.getElementById("version-sub").textContent = formatDocWhen({ date: v.at }) + " · " + (v.byName || "Система") + " · " + (DOC_STATUSES[v.status] || v.status || "");
    const body = document.getElementById("version-body");
    if (diff) {
      const prev = versions[i - 1] || {};
      const meta = [["Назва", "title"], ["Номер", "number"], ["Дата", "date"], ["Статус", "status"]]
        .filter(([, k]) => String(prev[k] || "") !== String(v[k] || ""))
        .map(([label, k]) => {
          const show = (x) => k === "status" ? (DOC_STATUSES[x] || x || "—") : (x || "—");
          return `<li><b>${label}:</b> <del>${esc(show(prev[k]))}</del> → <ins>${esc(show(v[k]))}</ins></li>`;
        }).join("");
      const parts = diffWords(prev.text || "", v.text || "");
      const changed = parts.some((p) => p.t !== "same");
      body.innerHTML = (meta ? `<ul class="diff-meta">${meta}</ul>` : "") +
        (changed
          ? `<p class="muted diff-legend"><ins>додано</ins> <del>прибрано</del></p><div class="diff-text">${parts.map((p) => p.t === "same" ? esc(p.s) : p.t === "add" ? `<ins>${esc(p.s)}</ins>` : `<del>${esc(p.s)}</del>`).join("").replace(/\n/g, "<br>")}</div>`
          : `<p class="muted">Текст документа не змінювався${meta ? " — змінились лише реквізити вище" : " (змінились оформлення, статус чи маршрут)"}.</p>`);
    } else {
      const html = versionHtml(i);
      body.innerHTML = html
        ? `<div class="published-paper"><article class="a4-page">${sanitizeDocHtml(html)}</article></div>`
        : `<div class="diff-text">${esc(v.text || "Текст цієї редакції не збережено.").replace(/\n/g, "<br>")}</div>`;
    }
    modal.hidden = false;
  }
  root.addEventListener("click", (e) => {
    const fold = e.target.closest("[data-fold]");
    if (fold) {
      const rest = document.getElementById("fold-" + fold.dataset.fold);
      rest.hidden = !rest.hidden;
      fold.textContent = rest.hidden ? fold.dataset.more : "Згорнути";
      fold.setAttribute("aria-expanded", String(!rest.hidden));
      return;
    }
    const d = e.target.closest("[data-diff]");
    if (d) return openVersion(Number(d.dataset.diff), true);
    const v = e.target.closest("[data-version]");
    if (v) return openVersion(Number(v.dataset.version), false);
    if (e.target.closest("[data-close-version]") || e.target === modal) modal.hidden = true;
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") modal.hidden = true; });
});
