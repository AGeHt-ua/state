/* Скрипт сторінки «cabinet/appeals». Запускається, коли дані порталу завантажені й сторінка готова. */
whenStateReady(async function () {
  const user = requireAuth();
  if (!user) return;
  document.getElementById("top-office").textContent = isCitizen(user) ? "Кабінет громадянина" : officeTitle(user);
  const staff = isStaff(user);
  if (isCitizen(user)) {
    document.querySelectorAll("[data-staff-nav]").forEach((el) => { el.style.display = "none"; });
    document.getElementById("office-appeals-card").style.display = "none";
  } else {
    document.getElementById("appeals-lead").textContent = "Посадовець також може подавати звернення як громадянин штату.";
  }
  document.querySelector("input[name='name']").value = user.username || "";
  document.querySelector("input[name='statId']").value = user.statId || "";
  document.querySelector("input[name='contact']").value = user.contact || "";
  if (!canAdmin(user)) {
    const admin = document.getElementById("nav-admin");
    if (admin) admin.style.display = "none";
  }
  document.querySelector("select[name='office']").innerHTML = allOffices().map((office) =>
    `<option value="${attr(office.id)}">${esc(office.name)}</option>`
  ).join("");

  function drawAppeals() {
    const renderAppeal = (appeal, mode) => `
      <article class="appeal-card">
        <div class="admin-row-title">
          <b>${esc(appeal.number)} · ${esc(appeal.kind || "Звернення")}</b>
          <span class="badge ${appeal.status === "answered" ? "ok" : appeal.status === "closed" ? "dead" : "draft"}">${esc(appealStatusLabel(appeal.status))}</span>
        </div>
        <div class="admin-row-meta">
          <span>${esc(officeName(appeal.office))}</span>
          <span>${esc(formatDocWhen({ date: appeal.createdAt }))}</span>
          <span>${esc(appeal.name)} · ${esc(appeal.statId)}</span>
        </div>
        <p>${esc(appeal.text)}</p>
        <div class="appeal-thread">
          ${(appeal.thread || []).filter((m, i) => !(i === 0 && m.text === String(appeal.text || "").trim())).map((m) => `<div class="${m.by === appeal.ownerLogin ? "from-owner" : "from-office"}"><b>${esc(m.byName)}</b><span>${esc(formatDocWhen({ date: m.at }))}</span><p>${esc(m.text)}</p></div>`).join("")}
        </div>
        ${appeal.status === "closed" ? `<p class="muted">Звернення закрито${appeal.closedByName ? " · " + esc(appeal.closedByName) : ""}.</p>` : `
        <form data-appeal-reply="${attr(appeal.id)}" class="reply-form">
          <input type="hidden" name="mode" value="${attr(mode)}">
          <textarea name="message" required placeholder="${mode === "office" ? "Надати відповідь..." : "Додати уточнення..."}"></textarea>
          <div class="form-actions">
            <button class="btn ${mode === "office" ? "gold" : "ghost"}" type="submit">${mode === "office" ? "Надати відповідь" : "Додати повідомлення"}</button>
            <button class="btn ghost" type="button" data-appeal-close="${attr(appeal.id)}">Закрити звернення</button>
          </div>
        </form>`}
      </article>
    `;
    const own = citizenAppealsFor(user);
    document.getElementById("my-appeals-list").innerHTML = own.length
      ? own.map((appeal) => renderAppeal(appeal, "own")).join("")
      : "<p class='lead'>Ви ще не подавали звернень або позовів.</p>";
    if (staff) {
      const officeItems = officeAppealsFor(user).filter((appeal) => appeal.ownerLogin !== user.login);
      document.getElementById("office-appeals-list").innerHTML = officeItems.length
        ? officeItems.map((appeal) => renderAppeal(appeal, "office")).join("")
        : "<p class='lead'>До вашого апарату ще немає звернень.</p>";
    }
    document.querySelectorAll("[data-appeal-reply]").forEach((form) => {
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        const appeal = allAppeals().find((a) => a.id === form.dataset.appealReply);
        if (!appeal) return;
        const message = new FormData(form).get("message");
        const mode = new FormData(form).get("mode");
        saveAppeal(Object.assign({}, appeal, { status: mode === "office" ? "answered" : "waiting" }), { user, message });
        drawAppeals();
      });
    });
    document.querySelectorAll("[data-appeal-close]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const appeal = allAppeals().find((a) => a.id === btn.dataset.appealClose);
        if (!appeal || !confirm("Закрити звернення " + appeal.number + "? Після цього в ньому не можна буде писати.")) return;
        saveAppeal(Object.assign({}, appeal, { status: "closed", closedAt: new Date().toISOString(), closedBy: user.login, closedByName: actorName(user) }), { user, message: "Звернення закрито." });
        drawAppeals();
      });
    });
    if (typeof enhanceCabinetNavigation === "function" && document.querySelector(".side-me")) enhanceCabinetNavigation();
  }
  document.getElementById("appeal-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const data = new FormData(e.target);
    saveAppeal({
      ownerLogin: user.login,
      name: data.get("name"),
      statId: data.get("statId"),
      contact: data.get("contact"),
      kind: data.get("kind"),
      office: data.get("office"),
      text: data.get("text"),
      status: "waiting"
    }, { user, message: data.get("text") });
    e.target.reset();
    document.querySelector("input[name='name']").value = user.username || "";
    document.querySelector("input[name='statId']").value = user.statId || "";
    document.querySelector("input[name='contact']").value = user.contact || "";
    drawAppeals();
  });
  drawAppeals();
});
