/* Скрипт сторінки «acts/const-sa-01». Запускається, коли дані порталу завантажені й сторінка готова. */
whenStateReady(async function () {
  const root = document.getElementById("root");
  root.innerHTML = `
    <p class="const-kicker">Основний закон штату · КС-01 · чинний</p>
    <h2 class="const-title">Конституція Штату San Andreas</h2>
    <table class="meta-table">
      <tr><th>Вид</th><td>Конституція штату</td></tr>
      <tr><th>Номер</th><td>КС-01</td></tr>
      <tr><th>Статус</th><td><span class="badge ok">Чинний</span></td></tr>
      <tr><th>Суб’єкт ухвалення</th><td>Народ штату San Andreas (Ukraine GTA 5 RP)</td></tr>
    </table>
  ` + formatConstitution(CONSTITUTION_SRC);
  if (location.hash) {
    const el = document.querySelector(location.hash);
    if (el) el.scrollIntoView();
  }
});
