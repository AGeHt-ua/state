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
    // Пункт «Адміністрування» — лише тим, хто має доступ (меню могло вже прибрати його саме)
    const navAdmin = document.getElementById("nav-admin");
    if (navAdmin && (!canAdmin(user) || isCitizen(user))) navAdmin.style.display = "none";
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
      showPhotoPreview(user.photo || "");
      photoMsg.textContent = "Фото теж піде на підтвердження разом із заявкою.";
      photoMsg.style.color = "";
      // Кнопка «Взяти аватар з Discord» — лише коли Discord прив'язано
      const dBtn = document.getElementById("profile-photo-discord");
      dBtn.hidden = true;
      discordConfig().then((cfg) => { if (cfg.enabled) dBtn.hidden = !discordStatus().linked; });
      modal.hidden = false;
    });
    const photoMsg = document.getElementById("profile-photo-msg");
    function showPhotoPreview(src) {
      const box = document.getElementById("profile-photo-preview");
      box.innerHTML = src ? `<img src="${attr(src)}" alt="">` : esc(String(user.username || "?").charAt(0).toUpperCase());
    }
    function photoChosen(url, note) {
      if (!url) { photoMsg.style.color = "#8a2b2b"; photoMsg.textContent = "Не вдалося прочитати зображення. Оберіть інший файл (JPG або PNG)."; return; }
      pendingPhoto = url;
      showPhotoPreview(url);
      photoMsg.style.color = "";
      photoMsg.textContent = note + " Натисніть «Подати на підтвердження», щоб зберегти.";
    }
    document.getElementById("profile-photo-discord").addEventListener("click", async (ev) => {
      const btn = ev.currentTarget;
      btn.disabled = true;
      photoMsg.style.color = "";
      photoMsg.textContent = "Отримуємо аватар з Discord…";
      const res = await fetchDiscordAvatar();
      btn.disabled = false;
      if (!res.ok && res.code === "refresh") {
        // Аватар ще не відомий серверу: один раз підтверджуємо Discord і повертаємось сюди — аватар підставиться сам
        if (!confirm("Discord попросить один раз підтвердити доступ — після цього аватар підставиться автоматично. Продовжити?")) { photoMsg.textContent = ""; return; }
        const link = discordLinkCode();
        if (!link.ok) { photoMsg.style.color = "#8a2b2b"; photoMsg.textContent = link.error; return; }
        try { localStorage.setItem("state_avatar_after_link", "1"); } catch { /* приватний режим */ }
        location.href = discordStartUrl("link", link.code);
        return;
      }
      if (!res.ok) { photoMsg.style.color = "#8a2b2b"; photoMsg.textContent = res.error; return; }
      shrinkImage(res.blob, 256, (url) => photoChosen(url, "Аватар з Discord підставлено."));
    });
    document.querySelectorAll("[data-close-modal]").forEach((btn) => btn.addEventListener("click", () => { modal.hidden = true; }));
    document.getElementById("profile-photo-input").addEventListener("change", (ev) => {
      const file = ev.target.files && ev.target.files[0];
      if (!file) return;
      shrinkImage(file, 256, (url) => photoChosen(url, "Фото обрано."));
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
    // Активні входи: завантажуються, коли розгортають розділ
    const sessionsBox = document.getElementById("sessions-list");
    const drawSessions = (res) => {
      if (!res.ok) { sessionsBox.innerHTML = `<p class="muted">${esc(res.error)}</p>`; return; }
      sessionsBox.innerHTML = res.items.map((s) => `
        <article class="admin-list-row">
          <div class="admin-row-main">
            <div class="admin-row-title"><b>${esc(s.device)}</b>${s.current ? ' <span class="badge ok">цей пристрій</span>' : ""}</div>
            <div class="admin-row-meta"><span>увійшли ${esc(s.created ? formatDocWhen({ date: new Date(s.created * 1000).toISOString() }) : "давно")}</span>
              <span>активність ${esc(s.lastSeen ? formatDocWhen({ date: new Date(s.lastSeen * 1000).toISOString() }) : "—")}</span></div>
          </div>
          ${s.current ? "" : `<div class="admin-row-actions"><button class="btn ghost danger" type="button" data-revoke-session="${attr(s.id)}">Завершити</button></div>`}
        </article>`).join("") || '<p class="muted">Немає активних входів.</p>';
    };
    document.getElementById("sessions-details").addEventListener("toggle", (e) => { if (e.target.open) drawSessions(loadSessions()); });
    sessionsBox.addEventListener("click", (e) => {
      const b = e.target.closest("[data-revoke-session]");
      if (b) drawSessions(revokeSessions(b.dataset.revokeSession));
    });
    document.getElementById("sessions-revoke-all").addEventListener("click", () => {
      if (confirm("Завершити всі входи, крім цього пристрою?")) drawSessions(revokeSessions("all"));
    });

    // Discord: прив'язка для входу без пароля (розділ видно, лише коли вхід через Discord налаштовано на сервері)
    const dDetails = document.getElementById("discord-details");
    const dMsg = document.getElementById("discord-msg");
    const drawDiscord = (st) => {
      if (!st.ok) { dMsg.textContent = st.error; return; }
      dDetails.hidden = !st.enabled && !st.linked;
      document.getElementById("discord-line").textContent = st.linked
        ? "Прив'язано: " + st.name + ". Можна входити кнопкою «Увійти через Discord»."
        : "Прив'яжіть Discord, щоб входити без пароля.";
      document.getElementById("discord-link").hidden = st.linked || !st.enabled;
      document.getElementById("discord-unlink").hidden = !st.linked;
    };
    discordConfig().then((cfg) => { if (cfg.enabled) drawDiscord(discordStatus()); });
    document.getElementById("discord-link").addEventListener("click", () => {
      const res = discordLinkCode();
      if (!res.ok) { dMsg.textContent = res.error; return; }
      location.href = discordStartUrl("link", res.code);
    });
    document.getElementById("discord-unlink").addEventListener("click", () => {
      if (confirm("Відв'язати Discord? Входити можна буде лише паролем.")) drawDiscord(discordUnlink());
    });
    // Щойно створений входом через Discord акаунт: пояснюємо, як не мати двох акаунтів
    let fresh = false;
    try { fresh = localStorage.getItem("state_discord_new") === "1"; localStorage.removeItem("state_discord_new"); } catch { /* приватний режим */ }
    if (fresh) {
      const note = document.createElement("div");
      note.className = "notice";
      note.setAttribute("role", "note");
      note.innerHTML = "<b>Для вас створено новий акаунт через Discord.</b> Якщо у вас уже є акаунт на порталі з паролем — вийдіть, увійдіть ним " +
        "і в «Редагувати профіль» → «Discord» натисніть «Прив'язати Discord». Цей новий акаунт тоді об'єднається автоматично, і дубля не буде.";
      document.querySelector("main").prepend(note);
    }
    // Повернення з Discord після прив'язки
    const back = new URLSearchParams(location.hash.slice(1));
    let avatarAfter = false;
    try { avatarAfter = localStorage.getItem("state_avatar_after_link") === "1"; localStorage.removeItem("state_avatar_after_link"); } catch { /* приватний режим */ }
    if (avatarAfter && back.has("discord")) {
      // Повернулись із підтвердження заради аватара — одразу підставляємо його у вікні профілю
      history.replaceState(null, "", location.pathname + location.search);
      document.getElementById("btn-edit-profile").click();
      document.getElementById("profile-photo-discord").click();
    } else if (back.has("discord") || back.has("discord_error")) {
      history.replaceState(null, "", location.pathname + location.search);
      document.getElementById("btn-edit-profile").click();
      dDetails.hidden = false;
      dDetails.open = true;
      dMsg.style.color = back.has("discord_error") ? "#8a2b2b" : "";
      dMsg.textContent = back.has("discord_error") ? (DISCORD_ERRORS[back.get("discord_error")] || "Не вдалося прив'язати Discord.")
        : back.get("discord") === "merged" ? "Discord прив'язано. Порожній акаунт, який раніше створив вхід через Discord, видалено — тепер Discord веде сюди."
        : "Discord прив'язано.";
      drawDiscord(discordStatus());
    }

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
