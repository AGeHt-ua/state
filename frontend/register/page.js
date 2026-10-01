/* Скрипт сторінки «register». Запускається, коли дані порталу завантажені й сторінка готова. */
whenStateReady(async function () {
  // Усі реєструються громадянами; посадовцям апарат і посаду призначає адміністратор
  const type = "citizen";
  const citizen = true;
  discordConfig().then((cfg) => {
    if (!cfg.enabled) return;
    document.getElementById("reg-discord-btn").href = discordStartUrl("login");
    document.getElementById("reg-discord").hidden = false;
    // Сервер приймає реєстрацію лише через Discord — форму з паролем ховаємо
    if (cfg.required) {
      document.getElementById("reg-form").hidden = true;
      document.getElementById("reg-discord-note").textContent = "Реєстрація на порталі — через Discord: так ми знаємо, що за кожним акаунтом стоїть реальна людина з нашого сервера.";
    }
  });
  document.getElementById("reg-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const data = new FormData(e.target);
    const res = registerUser({
      name: data.get("name"),
      statId: data.get("statId"),
      contact: data.get("contact"),
      login: data.get("login"),
      password: data.get("password"),
      accountType: type
    });
    const box = document.getElementById("reg-msg");
    if (!res.ok) {
      box.style.color = "#8a2b2b";
      box.textContent = res.error;
      return;
    }
    loginWithPassword(String(data.get("login")).trim().toLowerCase(), data.get("password"));
    location.href = citizen ? pathTo("cabinet/") : pathTo("cabinet/pending/");
  });
});
