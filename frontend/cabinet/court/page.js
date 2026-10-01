/* Скрипт сторінки «cabinet/court» — «Мої справи» для сторін (позивач, відповідач, прокурор, що передав справу).
   Суд і повні адміністратори ведуть справи на сайті кабінету суду (office/court/, «Судові справи») — їх перенаправляємо туди. */
whenStateReady(function () {
  const user = requireAuth();
  if (!user) return;
  const id = decodeURIComponent(location.hash.slice(1));
  if (canManageCases(user)) {
    location.replace(officeUrl("court") + (id ? "#case=" + encodeURIComponent(id) : "#cases"));
    return;
  }
  document.getElementById("top-office").textContent = isCitizen(user) ? "Кабінет громадянина" : officeTitle(user);
  mountCourtUI(document.getElementById("court-root"), { selected: id });
});
