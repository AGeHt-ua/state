/* Скрипт сторінки «cabinet/portal». Запускається, коли дані порталу завантажені й сторінка готова. */
whenStateReady(async function () {
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
