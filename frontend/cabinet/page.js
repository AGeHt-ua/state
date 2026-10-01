/* Скрипт сторінки «cabinet». Запускається, коли дані порталу завантажені й сторінка готова. */
whenStateReady(async function () {
  const user = requireAuth();
  if (user) {
    const title = isCitizen(user) ? "Кабінет громадянина" : officeTitle(user);
    document.getElementById("top-office").textContent = title;
    document.getElementById("hdr-office").textContent = title;
    document.getElementById("f-name").textContent = user.username;
    document.getElementById("f-login").textContent = user.login;
    document.getElementById("f-office").textContent = title;
    document.getElementById("f-post").textContent = user.post || "не вказано";
    document.getElementById("f-stat").textContent = user.statId || "не вказано";
    document.getElementById("f-contact").textContent = user.contact || "не вказано";
    document.getElementById("profile-kind").textContent = isCitizen(user) ? "Громадянин штату" : "Посадовець";
    document.getElementById("profile-subtitle").textContent = isCitizen(user)
      ? "Звернення, позови та переписка з апаратами."
      : `${title} · ${user.post || "посада не вказана"}${isCongressMember(user) ? " · Конгресмен" : ""}`;
    const perms = userPermissions(user).map((p) => PERMISSION_LABELS[p] || p);
    document.getElementById("f-perms").innerHTML = perms.length
      ? `${isCongressMember(user) ? `<span class="pill">Конгресмен</span>` : ""}${perms.map((p) => `<span class="pill">${esc(p)}</span>`).join("")}`
      : `<span class="pill">${isCitizen(user) ? "Громадянин штату" : "Права не призначено"}</span>`;
    document.getElementById("m-review").textContent = reviewDocsFor(user).length;
    document.getElementById("m-docs").textContent = cabinetCreatedDocs().filter((d) =>
      d.ownerLogin === user.login || d.office === userOffice(user) || (user.roles || [])[0] === "governor"
    ).length;
    document.getElementById("m-people").textContent = allUsers().length;
    document.getElementById("m-my-appeals").textContent = citizenAppealsFor(user).length;
    if (isCitizen(user)) {
      document.querySelectorAll("[data-staff-nav]").forEach((el) => { el.style.display = "none"; });
      document.getElementById("m-review").parentElement.querySelector("span").textContent = "вхідних повідомлень";
      document.getElementById("m-review").textContent = appealsForUser(user).filter((a) => a.status === "answered").length;
      document.getElementById("m-docs").parentElement.querySelector("span").textContent = "моїх звернень";
      document.getElementById("m-docs").textContent = appealsForUser(user).length;
      document.getElementById("m-people").parentElement.style.display = "none";
      document.getElementById("m-my-appeals").parentElement.style.display = "none";
    }
    const pendingProfile = profileRequestsForUser(user).find((r) => r.status === "pending");
    document.getElementById("f-profile-status").textContent = pendingProfile ? "Очікує підтвердження" : "Підтверджено";
    const news = notificationsFor(user);
    document.getElementById("cabinet-news").innerHTML = news.length ? `
      <div class="section-head">
        <div>
          <h3>Новини кабінету</h3>
          <p class="muted">Що чекає вашої дії та що сталося з вашими документами і зверненнями.</p>
        </div>
        <a class="btn gold" href="inbox/">Усі повідомлення</a>
      </div>
      <div class="admin-list">
        ${news.slice(0, 5).map((item) => `
          <article class="admin-list-row${item.attention ? " is-attention" : ""}">
            <div class="admin-code">${item.attention ? "!" : "•"}</div>
            <div class="admin-row-main">
              <div class="admin-row-title"><b>${esc(item.title)}</b>${item.attention ? `<span class="badge draft">Потрібна увага</span>` : ""}</div>
              <div class="admin-row-meta"><span>${esc(item.text)}</span></div>
            </div>
            <div class="admin-row-actions"><a class="btn ghost" href="inbox/">Перейти</a></div>
          </article>
        `).join("")}
      </div>` : "";
    const img = document.getElementById("avatar");
    if (user.photo) img.src = user.photo;
    else img.outerHTML = `<div class="profile-photo large photo-placeholder" id="avatar" aria-label="Фото не завантажено">${esc(String(user.username || "?").charAt(0).toUpperCase())}</div>`;
    if (!canAdmin(user)) document.getElementById("nav-admin").style.display = "none";
    if (isCitizen(user)) document.getElementById("nav-admin").style.display = "none";
    let pendingPhoto = "";
    const modal = document.getElementById("profile-modal");
    const form = document.getElementById("profile-form");
    document.getElementById("btn-edit-profile").addEventListener("click", () => {
      form.name.value = user.username || "";
      form.post.value = user.post || "";
      form.statId.value = user.statId || "";
      form.contact.value = user.contact || "";
      document.getElementById("profile-post-wrap").style.display = isCitizen(user) ? "none" : "block";
      pendingPhoto = "";
      modal.hidden = false;
    });
    document.querySelectorAll("[data-close-modal]").forEach((btn) => btn.addEventListener("click", () => { modal.hidden = true; }));
    document.getElementById("profile-photo-input").addEventListener("change", (ev) => {
      const file = ev.target.files && ev.target.files[0];
      if (!file) return;
      shrinkImage(file, 256, (url) => {
        pendingPhoto = url;
        if (!url) alert("Не вдалося прочитати зображення. Оберіть інший файл (JPG або PNG).");
      });
    });
    form.addEventListener("submit", (ev) => {
      ev.preventDefault();
      const data = new FormData(form);
      saveProfileRequest({
        login: user.login,
        name: data.get("name"),
        post: data.get("post"),
        statId: data.get("statId"),
        contact: data.get("contact"),
        photo: pendingPhoto || user.photo || ""
      });
      modal.hidden = true;
      document.getElementById("f-profile-status").textContent = "Очікує підтвердження";
    });

    // Зміна пароля — розділ у вікні профілю; на відміну від профілю, діє одразу
    const pwForm = document.getElementById("password-form");
    const pwMsg = document.getElementById("password-msg");
    document.getElementById("btn-edit-profile").addEventListener("click", () => {
      pwForm.reset();
      pwMsg.textContent = "";
      document.getElementById("password-details").open = false;
    });
    // Прийшли з банера «змініть тимчасовий пароль» — одразу відкриваємо зміну пароля
    if (new URLSearchParams(location.search).get("changePassword") === "1") {
      document.getElementById("btn-edit-profile").click();
      document.getElementById("password-details").open = true;
      pwMsg.style.color = "#8a6300";
      pwMsg.textContent = "Введіть тимчасовий пароль, який вам видав адміністратор, і придумайте новий.";
    }
    pwForm.addEventListener("submit", (ev) => {
      ev.preventDefault();
      const data = new FormData(pwForm);
      pwMsg.style.color = "#8a2b2b";
      if (data.get("newPassword") !== data.get("repeatPassword")) { pwMsg.textContent = "Нові паролі не збігаються."; return; }
      if (data.get("newPassword") === data.get("oldPassword")) { pwMsg.textContent = "Новий пароль має відрізнятися від поточного."; return; }
      const res = changePassword(data.get("oldPassword"), data.get("newPassword"));
      if (!res.ok) { pwMsg.textContent = res.error; return; }
      pwForm.reset();
      pwMsg.style.color = "#2b6a3a";
      pwMsg.textContent = "Пароль змінено.";
      const banner = document.getElementById("must-change-banner");
      if (banner) banner.remove();
    });
  }
});
