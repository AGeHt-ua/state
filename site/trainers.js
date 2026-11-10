/* Вкладка «Тренажери СБУ»: картки ігор підрозділів (ЦСО «Альфа» — «Штурм», ОРВ — «Хвіст»).
   Кожна гра — окремий модуль (game.js, tail.js), що реєструється в SOVA.games. Рейтинги в іграх на бали й премії не впливають. */
(() => {
const S = window.SOVA;
const { esc, call } = S;
const GAMES = [
  { k: "assault", name: "Тренажер «Альфа»", game: "ШТУРМ", dept: "Центр спеціальних операцій «Альфа»", icon: "🎯", accent: "212,96,90",
    text: "Тактичний штурм будівлі з видом згори: спершу вимога здатися, вогонь — лише по озброєних. Заручники — колеги зі складу СБУ.",
    tags: ["3 операції + операція тижня", "напарник із відділу", "стадії сили за ПК"] },
  { k: "tail", name: "Тренажер ОРВ", game: "ХВІСТ", dept: "Оперативно-розшуковий відділ", icon: "🕵", accent: "176,127,224", fresh: true,
    text: "Негласне стеження в місті: ведіть об'єкт, не засвітившись, фотографуйте контакти й передачу, записуйте розмови — докази для кейс-файлу.",
    tags: ["3 розробки + операція тижня", "передача напарнику", "зміна образу"] },
];
let sel = null;
try { sel = sessionStorage.getItem("sova.trainer"); } catch (e) { /* без сховища — завжди з головної */ }
const setSel = (k) => { sel = k; try { if (k) sessionStorage.setItem("sova.trainer", k); else sessionStorage.removeItem("sova.trainer"); } catch (e) { /* нічого */ } };

async function view() {
  if (sel && S.games && S.games[sel]) return S.games[sel].view();
  for (const g of Object.values(S.games || {})) if (g.stop) g.stop();
  const h = await call("/api/game/hub").catch(() => ({ games: {}, badges: [] }));
  const me = S.ME().me;
  return `<div class="gm-hero tr-hero"><div><div class="eyebrow">ЄІС «Сова» · навчальні симуляції</div><h2>ТРЕНАЖЕРИ СБУ</h2>
      <p>Ігрові тренажери підрозділів: тактика, закон і робота в парі з колегами. У кожної гри — свої операції, рейтинг тижня, підрозділ тижня й нагороди на посвідченні.</p>
      ${(h.badges || []).length ? `<div class="gm-badges">${h.badges.map((x) => `<span title="${esc(x.t)}">${x.icon} ${esc(x.t)}</span>`).join("")}</div>` : ""}
      <p class="muted small">Результати не впливають на бали підвищення й премії. Потрібні клавіатура й миша.</p></div></div>
    <div class="tr-grid">${GAMES.map((G) => {
      const d = (h.games || {})[G.k] || {}, ld = d.leader;
      return `<article class="tr-card" style="--acc:${G.accent}">
        <div class="tr-top"><span class="tr-icon">${G.icon}</span><div><div class="eyebrow">${esc(G.dept)}</div><div class="tr-name">${esc(G.name)}</div></div>${G.fresh ? '<span class="tr-new">Новинка</span>' : ""}</div>
        <h3>${G.game}</h3><p>${esc(G.text)}</p>
        <div class="tr-tags">${G.tags.map((t) => `<span>${esc(t)}</span>`).join("")}</div>
        <div class="tr-stats"><div><i>Ваш рекорд</i><b>${d.mine || "—"}</b></div><div><i>Лідер тижня</i><b>${ld ? `${esc(ld.rankShort)} ${esc(ld.name)}${ld.sid === me.sid ? " (ви)" : ""} · ${ld.score}` : "—"}</b></div>
          <div><i>Учасників цього тижня</i><b>${d.players || 0}</b></div></div>
        <button class="btn gold" data-a="tropen" data-g="${G.k}">Відкрити тренажер →</button></article>`;
    }).join("")}
      <article class="tr-card tr-soon"><div class="tr-top"><span class="tr-icon">🛠</span><div><div class="eyebrow">Інші підрозділи</div><div class="tr-name">Незабаром</div></div></div>
        <p>Тренажери для АТЦ, ДЕБ, ВВБ та ВКПП — у розробці. Ідеї надсилайте керівництву.</p></article></div>`;
}
S.games = S.games || {};
S.views.game = view;
Object.assign(S.actions, {
  tropen: (b) => { setSel(b.dataset.g); S.render(); },
  trhub: () => { for (const g of Object.values(S.games || {})) if (g.stop) g.stop(); setSel(null); S.render(); },
});
})();
