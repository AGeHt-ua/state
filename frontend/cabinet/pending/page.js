/* Скрипт сторінки «cabinet/pending». Запускається, коли дані порталу завантажені й сторінка готова. */
whenStateReady(async function () {
  const user = currentUser();
  if (!user) location.href = pathTo("cabinet/portal/");
  else if (isCabinetUser(user)) location.href = pathTo("cabinet/");
  else document.getElementById("who").textContent = user.username + " · " + user.login;
});
