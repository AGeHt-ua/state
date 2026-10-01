/* Стара адреса робочого простору — тепер кожен кабінет має власний сайт office/<id>/ */
whenStateReady(function () {
  const user = requireAuth();
  if (!user) return;
  const o = new URLSearchParams(location.search).get("o") || userOffice(user);
  location.replace(officeUrl(o) + location.hash);
});
