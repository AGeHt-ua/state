/* Скрипт сторінки «cabinet/portal». Запускається, коли дані порталу завантажені й сторінка готова. */
whenStateReady(async function () {
  // Повернення з Discord: одноразовий код або причина відмови в адресі після #
  const hash = new URLSearchParams(location.hash.slice(1));
  if (hash.has("discord_code") || hash.has("discord_error")) {
    history.replaceState(null, "", location.pathname + location.search);
    if (hash.has("discord_code")) {
      const user = loginWithDiscordCode(hash.get("discord_code"));
      if (user) {
        location.href = isCabinetUser(user) ? pathTo("cabinet/") : pathTo("cabinet/pending/");
        return;
      }
      document.getElementById("login-error").textContent = REMOTE.lastError || "Не вдалося увійти через Discord.";
    } else {
      document.getElementById("login-error").textContent = DISCORD_ERRORS[hash.get("discord_error")] || "Не вдалося увійти через Discord.";
    }
  }
  discordConfig().then((cfg) => {
    const btn = document.getElementById("discord-login");
    if (!cfg.enabled) return;
    btn.href = discordStartUrl("login");
    btn.hidden = false;
  });

  const existing = currentUser();
  if (existing && isCabinetUser(existing)) {
    document.getElementById("portal-login").hidden = true;
    document.getElementById("portal-authorized").hidden = false;
    document.getElementById("portal-auth-title").textContent = "Ви авторизовані";
    document.getElementById("portal-user-line").textContent = (existing.username || existing.login) + " · " + (isStaff(existing) ? "посадовець і громадянин" : "громадянин штату");
  }
  document.getElementById("portal-login").addEventListener("submit", (e) => {
    e.preventDefault();
    const data = new FormData(e.target);
    const user = loginWithPassword(data.get("login"), data.get("password"));
    if (!user) {
      document.getElementById("login-error").textContent = (typeof REMOTE !== "undefined" && REMOTE.lastError) || "Невірний логін або пароль.";
      return;
    }
    location.href = isCabinetUser(user) ? pathTo("cabinet/") : pathTo("cabinet/pending/");
  });
});
