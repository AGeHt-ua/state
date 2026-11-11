/* «Перевірка» — тренажер ВВБ: службове розслідування всередині СБУ.
   Сигнал → записи боді-камер співробітників (позначки порушень на таймлайні) → службові журнали (доступ до кейс-файлів,
   транзакції, збройова кімната, наряди) → висновок: хто порушив, що саме, яке стягнення за положеннями СБУ.
   Підозрювані — випадкові співробітники з бази «Сови»: це навчальна легенда, не звинувачення. Хибне звинувачення — провал. */
(() => {
const S = window.SOVA;
const { esc, call, toast } = S;
const CW = 640, CH = 360;

// порушення й стягнення — за Внутрішнім статутом СБУ (р. VII), Положеннями про боді-камеру та про службову інформацію
const V = {
  noid: { n: "Не представився, не пред'явив жетон", law: "п. 1.52 Правил; Положення про форму й жетон", s: ["written"] },
  nomir: { n: "Не роз'яснив права (правило Міранди)", law: "ст. 15 ПК; порядок затримання", s: ["written"] },
  insult: { n: "Приниження честі й гідності затриманого", law: "Статут СБУ, р. VII, 7.1", s: ["written", "strict"] },
  force: { n: "Сила до особи в кайданках", law: "Статут СБУ, р. VII, 7.2", s: ["fireDBR"] },
  camoff: { n: "Служба з вимкненою (закритою) боді-камерою", law: "Положення про боді-камеру, 5.1", s: ["written"] },
  cash: { n: "Привласнення платежів в обхід казни", law: "Статут СБУ, р. VII, 7.1; ст. 210 КК", s: ["fireBL"] },
  leak: { n: "Розголошення деталей спецоперації", law: "Положення про службову інформацію, 5.1; ст. 328 КК", s: ["firePros"] },
  weapon: { n: "Продаж або передача табельної зброї", law: "Статут СБУ, р. VII, 7.1", s: ["fireBL"] },
  dbq: { n: "Пошук у відомчих базах без службової потреби", law: "Положення про службову інформацію, 5.5", s: ["fine10"] },
};
const SANCT = { oral: "Усне зауваження", written: "Письмова догана", strict: "Сувора догана", fine10: "Дисциплінарний штраф $10 000",
  fire: "Звільнення зі служби", fireDBR: "Звільнення + матеріали до ДБР", firePros: "Звільнення + матеріали до прокуратури (ст. 328 КК)", fireBL: "Звільнення + подання до Чорного списку" };
const SEV = ["force", "leak", "weapon", "cash", "insult", "dbq", "camoff", "noid", "nomir"];   // від найтяжчого
const CIV = ["Марко Литвин", "Оксана Дудка", "Тарас Гнатюк", "Ярослав Кобзар", "Ірина Білик", "Денис Мельник", "Роман Ткач", "Віктор Савчук"];
const PLACES = ["мерії", "Центрального ринку", "автовокзалу", "порту", "лікарні", "стадіону"];
const OPS = ["СВІТАНОК", "ГРАНІТ", "КРИГА", "ПЕРЕВАЛ", "ЯСТРУБ", "МЕРИДІАН"];

const LEVELS = [
  { name: "Скарга", tpl: "arrest", brief: "Громадянин скаржиться на затримання. Перегляньте запис боді-камери, позначте порушення порядку затримання й оберіть стягнення." },
  { name: "Блокпост", tpl: "checkpoint", brief: "Анонім повідомляє: на блокпосту беруть гроші «без протоколу». Двоє співробітників на зміні — з'ясуйте, хто з них." },
  { name: "Кріт", tpl: "mole", brief: "Спецоперацію зірвано: фігуранти зникли за 20 хвилин до штурму. Троє мали стосунок до справи. Знайдіть джерело витоку." },
];
const st = { lvl: null, c: null, raf: 0, best: {}, board: null, people: null, clip: 0, tab: "cam", marking: false, final: false, over: null };

const rng = (seed) => () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pick = (R, a) => a[Math.floor(R() * a.length)];
const shuffle = (R, a) => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const tm = (h, m) => `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
const who = (p) => `${p.rankShort} ${p.name}`;

// ---------------------------------------------------------------- записи боді-камер (сцени)
// сцена: фон, учасники з ключовими кадрами [t, x, y], субтитри (аудіо), відрізки без зображення, події-порушення
function scene(bg, dur) { return { bg, dur, actors: [], subs: [], off: [], ev: [], decoy: [], hits: [], cuff: null }; }
const sub = (s, t, w, text, d = 4) => s.subs.push({ t, w, text, d });

function clipArrest(p, R, viols, civ) {
  const s = scene("street", 52), has = (v) => viols.includes(v);
  s.actors.push({ id: "me", k: "me", kf: [[0, 120, 250], [7, 330, 250], [40, 330, 250], [52, 520, 262]] });
  s.actors.push({ id: "det", k: "det", look: 5, kf: [[0, 430, 236], [7, 362, 250], [40, 362, 250], [52, 552, 262]] });
  s.actors.push({ id: "car", k: "car", kf: [[0, 600, 300]] });
  sub(s, 5, "Співробітник", has("noid") ? "Стояти! Руки на капот, швидко!" : `Добрий день. Служба безпеки, ${p.rankName} ${p.name}. Ось мій жетон.`);
  if (has("noid")) s.ev.push({ t: 6, v: "noid" });
  sub(s, 10, civ, "А що сталося?", 3);
  if (!has("force") && R() < .6) {             // законна сила: затриманий чинить опір ДО кайданок
    sub(s, 13, civ, "*виривається й штовхає співробітника*", 3);
    sub(s, 15, "Співробітник", "*заламує руку — опір затриманню*", 3);
    s.hits.push(15); s.decoy.push({ t: 15, v: "force", why: "Сила до кайданок у відповідь на активний опір — законна (ст. 35 ПК)." });
  }
  sub(s, 18, "Співробітник", "Ви затримані за підозрою за ст. 263 КК — незаконне поводження зі зброєю.");
  sub(s, 22, "Співробітник", "*одягає кайданки*", 3); s.cuff = 22;
  sub(s, 26, "Співробітник", has("nomir") ? "Мовчи й сідай у машину." : "Ви маєте право зберігати мовчання. Усе сказане може бути використано проти вас. Маєте право на адвоката.", 5);
  if (has("nomir")) s.ev.push({ t: 26, v: "nomir" });
  sub(s, 31, civ, "Я хочу подзвонити адвокату.", 3);
  if (has("insult")) { sub(s, 34, "Співробітник", "Сиди тихо, нікчемо. Ти тут ніхто.", 3); s.ev.push({ t: 34, v: "insult" }); }
  else sub(s, 34, "Співробітник", "Адвоката викличемо у відділі, це ваше право.", 3);
  if (has("force")) { sub(s, 38, "Співробітник", "*б'є затриманого в кайданках*", 3); sub(s, 39.5, civ, "Ай! За що?! Я ж у кайданках!", 3); s.hits.push(38); s.ev.push({ t: 38, v: "force" }); }
  if (has("camoff")) { s.off.push([42, 48, false]); s.ev.push({ t: 42, v: "camoff" }); sub(s, 48.2, "Співробітник", "…так, запис іде.", 3); }
  sub(s, 49, "Співробітник", "*веде до службового авто*", 3);
  return s;
}
function clipCheckpoint(p, R, guilty, driver) {
  const s = scene("street", 40);
  s.actors.push({ id: "me", k: "me", kf: [[0, 300, 200], [6, 300, 200], [9, 370, 218], [34, 370, 218], [40, 300, 200]] });
  s.actors.push({ id: "car", k: "car", kf: [[0, -80, 262], [6, 400, 262], [34, 400, 262], [40, 900, 262]] });
  s.actors.push({ id: "drv", k: "civ", look: 4, kf: [[0, -80, 262], [6, 392, 238], [34, 392, 238], [40, 900, 262]], hide: true });
  const noid = guilty && R() < .5;
  sub(s, 9, "Співробітник", noid ? "Документи." : `Добрий день, Служба безпеки, ${p.rankName} ${p.name}. Документи, будь ласка.`);
  if (noid) s.ev.push({ t: 9, v: "noid" });
  sub(s, 13, driver, "Тримайте.", 2);
  sub(s, 16, "Співробітник", "Перевищення швидкості в зоні блокпоста. Штраф — 5 000.");
  if (guilty) {
    if (R() < .6) { s.off.push([19, 27, true]); s.ev.push({ t: 19, v: "camoff" }); }
    sub(s, 21, "Співробітник", "Можна без протоколу. Готівкою — і їдьте.", 4); s.ev.push({ t: 22.5, v: "cash", key: true, tol: 5 });
    sub(s, 25, driver, "*передає готівку через вікно*", 3);
  } else {
    sub(s, 21, "Співробітник", "Ось квитанція. Оплатити через казну протягом доби, інакше — подвійний штраф.", 5);
    sub(s, 26, driver, "Добре, оплачу сьогодні.", 3);
  }
  sub(s, 31, "Співробітник", "Щасливої дороги.", 3);
  return s;
}
function clipMole(p, R, role, op, order) {
  if (role === "guilty") {
    const s = scene("alley", 40);
    s.actors.push({ id: "me", k: "me", kf: [[0, 200, 250], [12, 200, 250], [16, 420, 230], [32, 420, 230], [40, 220, 250]] });
    s.actors.push({ id: "col", k: "col", look: 1, kf: [[0, 240, 262]] });
    sub(s, 6, "Співробітник", "Відійду на хвилину, подзвоню додому.", 3);
    s.off.push([17, 31, true]); s.ev.push({ t: 17, v: "camoff" });
    sub(s, 19, "Співробітник", `(тихо, телефоном) Завтра о шостій. Склад на Пристані — вас будуть брати. Забирайте товар.`, 6);
    s.ev.push({ t: 20, v: "leak", key: true, tol: 5 });
    sub(s, 26, "Співробітник", "(телефоном) Гроші — як домовлялись. Все, відбій.", 4);
    sub(s, 34, "Співробітник", "Все, пішли далі.", 3);
    return s;
  }
  if (role === "order") {                       // законно вимкнена камера: погоджений негласний захід
    const s = scene("office", 36);
    s.actors.push({ id: "me", k: "me", kf: [[0, 260, 240], [8, 320, 240], [30, 320, 240], [36, 260, 240]] });
    s.actors.push({ id: "col", k: "col", look: 1, kf: [[0, 380, 230]] });
    sub(s, 5, "Співробітник", `Переходжу в негласний режим за наказом № ${order}, камеру вимикаю.`, 5);
    s.off.push([11, 29, false]); s.decoy.push({ t: 11, v: "camoff", why: `Камеру вимкнено на погоджений негласний захід (наказ № ${order}) — п. 1.7 Правил.` });
    sub(s, 30, "Співробітник", "Захід завершено, камеру увімкнено.", 3);
    return s;
  }
  const s = scene("street", 34);                // звичайне патрулювання
  s.actors.push({ id: "me", k: "me", kf: [[0, 140, 210], [14, 330, 210], [24, 330, 210], [34, 520, 210]] });
  s.actors.push({ id: "civ", k: "civ", look: 3, kf: [[0, 380, 190], [14, 352, 206], [24, 352, 206], [34, 300, 150]] });
  sub(s, 15, "Громадянка", "Підкажіть, як пройти до мерії?", 3);
  sub(s, 18, "Співробітник", "Прямо два квартали й ліворуч. Гарного дня.", 3);
  sub(s, 27, "Співробітник", "(телефоном) Так, мамо, сьогодні буду пізно — зміна.", 4);
  return s;
}
function clipWeapon(p, R, role, serial, duty) {
  if (role === "guilty") {
    const s = scene("alley", 36);
    s.actors.push({ id: "me", k: "me", kf: [[0, 150, 250], [10, 360, 250], [28, 360, 250], [36, 160, 250]] });
    s.actors.push({ id: "buy", k: "civ", look: 6, kf: [[0, 520, 240], [10, 400, 248], [28, 400, 248], [36, 560, 230]] });
    sub(s, 11, "Невідомий", "Приніс?", 2);
    sub(s, 13, "Співробітник", "Як домовлялись. Номер збитий, не відстежать.", 4);
    sub(s, 17, "Співробітник", "*передає довгу спортивну сумку*", 3); s.ev.push({ t: 16, v: "weapon", key: true, tol: 5 });
    sub(s, 21, "Невідомий", "*передає конверт* Тут усе.", 3);
    return s;
  }
  const s = scene("armory", 30);
  s.actors.push({ id: "me", k: "me", kf: [[0, 180, 260], [8, 330, 240], [24, 330, 240], [30, 180, 260]] });
  s.actors.push({ id: "duty", k: "col", look: 1, kf: [[0, 400, 220]] });
  sub(s, 9, "Співробітник", role === "ok" ? `Здаю автомат ${serial}, прийміть.` : "Здаю автомат і спецзасоби після зміни.", 3);
  sub(s, 13, duty, "Прийнято. Номер звірив, розпишіться в журналі.", 4);
  return s;
}

// ---------------------------------------------------------------- генерація справи
function makeCase(i) {
  const seed = i === 3 ? 7000 + ((st.board && st.board.seed) || 1) * 13 : Math.floor(Math.random() * 1e9);
  const R = rng(seed), tpl = i === 3 ? ["arrest", "checkpoint", "mole", "weapon"][((st.board && st.board.seed) || 1) % 4] : LEVELS[i].tpl;
  // підозрювані — випадкові співробітники з бази (навчальна легенда)
  const pool = shuffle(Math.random, ((st.people || {}).hostages || []).filter((p) => p.sid !== ((st.people || {}).me || {}).sid && p.dept !== "lead"));
  const fallback = [{ sid: 0, name: "Олег Панченко", rankShort: "Ст. оп.", rankName: "Старший оперуповноважений", deptS: "ОРВ" },
    { sid: 0, name: "Андрій Кравець", rankShort: "Оп.", rankName: "Оперуповноважений", deptS: "АТЦ" }, { sid: 0, name: "Ігор Бондар", rankShort: "Сп.", rankName: "Співробітник", deptS: "ДЕБ" }];
  const people = [...pool, ...fallback];
  const n = tpl === "arrest" ? 1 : tpl === "checkpoint" ? 2 : 3;
  const sus = people.slice(0, n), g = Math.floor(R() * n), place = pick(R, PLACES), civ = pick(R, CIV);
  const c = { i, tpl, seed, sus, g, clips: [], docs: [], marks: [], pins: {}, t0: performance.now(), title: "", signal: "" };
  const day = "10.11";
  if (tpl === "arrest") {
    const viols = shuffle(R, ["noid", "nomir", "insult", "force", "camoff"]).slice(0, 2);
    c.title = "Скарга на затримання"; c.signal = `Громадянин ${civ} скаржиться на дії співробітника під час затримання біля ${place}.`;
    c.clips.push(clipArrest(sus[0], R, viols, civ));
    c.answer = { v: SEV.find((v) => viols.includes(v)) };
    c.docs.push({ k: "arrests", n: "Журнал затримань", cols: ["Час", "Співробітник", "Затриманий", "Підстава"],
      rows: [{ c: [tm(16, 12), who(sus[0]), civ, "ст. 263 КК"] }, { c: [tm(17, 40), "інший наряд", pick(R, CIV), "ст. 309 КК"] }] });
  } else if (tpl === "checkpoint") {
    c.title = "Гроші «без протоколу»"; c.signal = `Анонімне повідомлення: на блокпосту біля ${place} беруть штрафи готівкою «без протоколу». На зміні були двоє.`;
    sus.forEach((p, k) => c.clips.push(clipCheckpoint(p, R, k === g, pick(R, CIV))));
    c.answer = { v: "cash" };
    const ord = 100 + Math.floor(R() * 800), inn = sus[1 - g];
    c.docs.push({ k: "money", n: "Транзакції", cols: ["Час", "Рахунок", "Операція", "Сума"], rows: shuffle(R, [
      { c: [`${day} ${tm(14, 52)}`, who(sus[g]), "Внесення готівки на особистий рахунок", "+5 000"], key: true },
      { c: [`${day} ${tm(15, 30)}`, "Казна штату", `Оплата штрафу, квитанція № ${4000 + ord}`, "+5 000"] },
      { c: [`${day} ${tm(12, 0)}`, who(inn), `Премія СБУ за тиждень (наказ № ${ord})`, "+12 000"] },
      { c: [`${day} ${tm(9, 15)}`, who(sus[g]), "Оплата пального", "−900"] }]) });
    c.docs.push({ k: "duty", n: "Графік нарядів", cols: ["Співробітник", "Наряд", "Час"], rows: sus.map((p) => ({ c: [who(p), `Блокпост біля ${place}`, "14:00–18:00"] })) });
  } else if (tpl === "mole") {
    const op = pick(R, OPS), kf = 100 + Math.floor(R() * 900), order = 300 + Math.floor(R() * 600);
    const roles = sus.map((_, k) => k === g ? "guilty" : null); const rest = [0, 1, 2].filter((k) => k !== g); roles[rest[0]] = "order"; roles[rest[1]] = "plain";
    c.title = `Витік: операція «${op}»`; c.signal = `Спецоперацію «${op}» (КФ-${kf}) зірвано: фігуранти покинули склад на Пристані за 20 хвилин до штурму. Доступ до справи мали троє.`;
    sus.forEach((p, k) => c.clips.push(clipMole(p, R, roles[k], op, order)));
    c.answer = { v: "leak" };
    c.docs.push({ k: "access", n: "Журнал доступу до КФ", cols: ["Час", "Співробітник", "Дія", "Примітка"], rows: shuffle(R, [
      { c: [`09.11 ${tm(23, 47)}`, who(sus[g]), `Відкрито КФ-${kf} «${op}»: план штурму`, "не входить до групи операції"], key: true },
      { c: [`09.11 ${tm(18, 2)}`, who(sus[rest[0]]), `Відкрито КФ-${kf} «${op}»`, "у складі групи"] },
      { c: [`09.11 ${tm(19, 10)}`, who(sus[rest[1]]), `Додано донесення до КФ-${kf}`, "у складі групи"] }]) });
    c.docs.push({ k: "money", n: "Транзакції", cols: ["Час", "Рахунок", "Операція", "Сума"], rows: shuffle(R, [
      { c: [`10.11 ${tm(8, 20)}`, who(sus[g]), "Переказ від ТОВ «Ріверсайд Логістик»", "+40 000"], key: true },
      { c: [`10.11 ${tm(12, 0)}`, who(sus[rest[1]]), `Премія СБУ (наказ № ${order + 7})`, "+15 000"] },
      { c: [`10.11 ${tm(10, 5)}`, who(sus[rest[0]]), "Оплата оренди житла", "−6 000"] }]) });
    c.docs.push({ k: "duty", n: "Наряди й накази", cols: ["Співробітник", "Наряд", "Підстава"], rows: [
      { c: [who(sus[rest[0]]), "20:00–20:40 негласний захід, камера вимкнена", `наказ № ${order}, погоджено начальником відділу`] },
      { c: [who(sus[g]), "Патрулювання району порту", "графік відділу"] }, { c: [who(sus[rest[1]]), "Патрулювання центру", "графік відділу"] }] });
  } else {
    const serial = "АК-" + (1000 + Math.floor(R() * 8999)), duty = pick(R, CIV);
    const roles = sus.map((_, k) => k === g ? "guilty" : "ok");
    c.title = `Зникла зброя: ${serial}`; c.signal = `Під час звірки в збройовій кімнаті не виявлено автомата ${serial}. Того дня зброю отримували троє.`;
    sus.forEach((p, k) => c.clips.push(clipWeapon(p, R, roles[k], k === g ? serial : "АК-" + (1000 + Math.floor(R() * 8999)), duty)));
    c.answer = { v: "weapon" };
    c.docs.push({ k: "armory", n: "Журнал збройової кімнати", cols: ["Співробітник", "Видано", "Повернення", "Хто прийняв"], rows: shuffle(R, sus.map((p, k) => k === g
      ? { c: [who(p), `${serial} · 14:02`, "«повернуто» 18:20", "запис вніс сам, без підпису чергового"], key: true }
      : { c: [who(p), `АК · ${tm(13, 40 + k * 7)}`, `повернуто ${tm(17, 30 + k * 9)}`, `черговий ${duty}`] })) });
    c.docs.push({ k: "money", n: "Транзакції", cols: ["Час", "Рахунок", "Операція", "Сума"], rows: shuffle(R, [
      { c: [`10.11 ${tm(21, 5)}`, who(sus[g]), "Внесення готівки", "+30 000"], key: true },
      ...sus.filter((_, k) => k !== g).map((p) => ({ c: [`10.11 ${tm(12, 0)}`, who(p), "Заробітна плата СБУ", "+8 000"] }))]) });
  }
  c.answer.s = V[c.answer.v].s;
  c.name = i === 3 ? "Операція тижня · " + c.title : LEVELS[i].name;
  return c;
}

// ---------------------------------------------------------------- програвач боді-камери
const pos = (a, t) => { const k = a.kf; if (t <= k[0][0]) return { x: k[0][1], y: k[0][2] }; for (let n = 1; n < k.length; n++) if (t <= k[n][0]) { const [t0, x0, y0] = k[n - 1], [t1, x1, y1] = k[n], f = (t - t0) / (t1 - t0 || 1); return { x: x0 + (x1 - x0) * f, y: y0 + (y1 - y0) * f, mv: Math.hypot(x1 - x0, y1 - y0) > 1 }; } const l = k[k.length - 1]; return { x: l[1], y: l[2] }; };
const LOOK = [["#2f3b33", "#1e2622", "#3a2a1e"], ["#2c3a3f", "#1b2529", "#4a3524"], ["#5b4a3a", "#3c3127", "#2b2018"], ["#3d6d9a", "#29496a", "#5a3b22"], ["#c9c4b6", "#8f8a7d", "#2b2018"], ["#6a2f2b", "#45201d", "#1c1c1c"], ["#24262b", "#15171a", "#2b2018"]];
function person(ctx, x, y, a, look, walk, opt = {}) {
  const [t1, t2, hd] = LOOK[look % LOOK.length], w = Math.sin(walk * .25) * 3.5;
  ctx.save(); ctx.translate(x, y);
  ctx.fillStyle = "rgba(0,0,0,.35)"; ctx.beginPath(); ctx.ellipse(3, 4, 12, 9, 0, 0, 7); ctx.fill();
  ctx.rotate(a);
  ctx.fillStyle = "#15181c"; ctx.beginPath(); ctx.ellipse(w, -5, 5, 3, 0, 0, 7); ctx.fill(); ctx.beginPath(); ctx.ellipse(-w, 5, 5, 3, 0, 0, 7); ctx.fill();
  const gr = ctx.createLinearGradient(-8, -10, 8, 10); gr.addColorStop(0, t1); gr.addColorStop(1, t2);
  ctx.fillStyle = gr; ctx.strokeStyle = "rgba(0,0,0,.6)"; ctx.lineWidth = 1.3; ctx.beginPath(); ctx.ellipse(0, 0, 8, 12, 0, 0, 7); ctx.fill(); ctx.stroke();
  if (opt.cuffed) { ctx.fillStyle = "#c99a74"; ctx.beginPath(); ctx.arc(-9, -4, 3, 0, 7); ctx.arc(-9, 4, 3, 0, 7); ctx.fill(); ctx.strokeStyle = "#cfd6df"; ctx.beginPath(); ctx.moveTo(-9, -4); ctx.lineTo(-9, 4); ctx.stroke(); }
  else { ctx.fillStyle = t2; ctx.beginPath(); ctx.arc(1, -11, 3, 0, 7); ctx.arc(1, 11, 3, 0, 7); ctx.fill(); }
  if (opt.badge) { ctx.fillStyle = "#c9a24d"; ctx.fillRect(-6, -8, 3, 16); }
  ctx.fillStyle = hd; ctx.beginPath(); ctx.arc(1, 0, 6, 0, 7); ctx.fill(); ctx.stroke();
  ctx.restore();
}
function drawBg(ctx, bg) {
  if (bg === "street") {
    ctx.fillStyle = "#3e4248"; ctx.fillRect(-400, -300, 1700, 1000);
    ctx.fillStyle = "#2a2d32"; ctx.fillRect(-400, 235, 1700, 70);
    ctx.fillStyle = "rgba(230,225,200,.35)"; for (let x = -400; x < 1300; x += 40) ctx.fillRect(x, 268, 22, 3);
    ctx.fillStyle = "#4a4f58"; for (let x = -400; x < 1300; x += 190) { ctx.fillRect(x, 20, 160, 150); ctx.fillRect(x + 20, 360, 150, 160); }
    ctx.fillStyle = "rgba(0,0,0,.3)"; for (let x = -400; x < 1300; x += 190) ctx.fillRect(x + 6, 170, 160, 8);
  } else if (bg === "alley") {
    ctx.fillStyle = "#24272c"; ctx.fillRect(-400, -300, 1700, 1000);
    ctx.fillStyle = "#3a3f47"; ctx.fillRect(-400, 60, 1700, 120); ctx.fillRect(-400, 320, 1700, 160);
    ctx.fillStyle = "#3b4a3a"; ctx.fillRect(470, 290, 40, 26); ctx.fillRect(120, 186, 34, 22);
    const gl = ctx.createRadialGradient(420, 240, 10, 420, 240, 160); gl.addColorStop(0, "rgba(255,214,140,.14)"); gl.addColorStop(1, "rgba(255,214,140,0)"); ctx.fillStyle = gl; ctx.fillRect(260, 80, 320, 320);
  } else {
    ctx.fillStyle = "#1b2027"; ctx.fillRect(-400, -300, 1700, 1000);
    for (let x = 60; x < 620; x += 32) for (let y = 120; y < 380; y += 32) { ctx.fillStyle = (x + y) % 64 ? "#3a3f47" : "#353a42"; ctx.fillRect(x, y, 32, 32); }
    ctx.strokeStyle = "#4a5565"; ctx.lineWidth = 4; ctx.strokeRect(60, 120, 560, 260);
    if (bg === "armory") { ctx.fillStyle = "#5a4126"; ctx.fillRect(420, 140, 160, 24); ctx.fillStyle = "#101215"; for (let x = 428; x < 575; x += 14) ctx.fillRect(x, 130, 5, 36); ctx.fillStyle = "#6b5a3a"; ctx.fillRect(360, 200, 80, 34); }
    else { ctx.fillStyle = "#4b3a2a"; ctx.fillRect(340, 190, 110, 50); ctx.fillStyle = "#20262c"; ctx.fillRect(360, 200, 30, 20); }
  }
}
function drawClip(ctx, c, k, t) {
  const s = c.clips[k], p = c.sus[k];
  const off = s.off.find(([a, b]) => t >= a && t < b);
  ctx.fillStyle = "#000"; ctx.fillRect(0, 0, CW, CH);
  if (!off) {
    const me = s.actors.find((a) => a.id === "me"), mp = pos(me, t);
    const hit = s.hits.some((h) => t > h && t < h + .5), sh = hit ? (Math.random() - .5) * 8 : 0;
    ctx.save(); ctx.translate(CW / 2 - mp.x + sh, CH / 2 - mp.y + 20 + sh);
    drawBg(ctx, s.bg);
    for (const a of s.actors) {
      const q = pos(a, t), q2 = pos(a, t + .2);
      if (a.k === "car") { ctx.fillStyle = "rgba(0,0,0,.4)"; ctx.fillRect(q.x - 26, q.y - 9, 56, 26); ctx.fillStyle = a.id === "car" && s.bg === "street" && c.tpl === "arrest" ? "#e9e3d0" : "#2f4f7a"; ctx.beginPath(); ctx.roundRect(q.x - 30, q.y - 13, 60, 26, 6); ctx.fill(); ctx.fillStyle = "rgba(20,28,38,.85)"; ctx.fillRect(q.x + 8, q.y - 10, 12, 20); ctx.fillRect(q.x - 22, q.y - 9, 10, 18); if (c.tpl === "arrest") { ctx.fillStyle = "#2f6fd0"; ctx.fillRect(q.x - 4, q.y - 13, 4, 4); ctx.fillStyle = "#d4605a"; ctx.fillRect(q.x, q.y - 13, 4, 4); } continue; }
      if (a.hide && q.x < 0) continue;
      const others = s.actors.filter((b) => b !== a && b.k !== "car"), near = others.map((b) => pos(b, t)).sort((m, n) => Math.hypot(m.x - q.x, m.y - q.y) - Math.hypot(n.x - q.x, n.y - q.y))[0];
      const ang = q2.mv || Math.hypot(q2.x - q.x, q2.y - q.y) > .5 ? Math.atan2(q2.y - q.y, q2.x - q.x) : near ? Math.atan2(near.y - q.y, near.x - q.x) : 0;
      person(ctx, q.x, q.y, ang, a.k === "me" ? 0 : a.k === "col" ? 1 : (a.look ?? 3), t * 30 * (q.mv ? 1 : 0), { cuffed: a.k === "det" && s.cuff !== null && t >= s.cuff, badge: a.k === "me" || a.k === "col" });
    }
    ctx.restore();
    // «риб'яче око» камери
    const vg = ctx.createRadialGradient(CW / 2, CH / 2, CH * .3, CW / 2, CH / 2, CW * .62); vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(1, "rgba(0,0,0,.75)");
    ctx.fillStyle = vg; ctx.fillRect(0, 0, CW, CH);
    ctx.fillStyle = "rgba(255,255,255,.025)"; for (let y = 0; y < CH; y += 3) ctx.fillRect(0, y, CW, 1);
  } else {
    ctx.fillStyle = "#07090c"; ctx.fillRect(0, 0, CW, CH);
    ctx.fillStyle = "#8a93a3"; ctx.font = "bold 18px 'JetBrains Mono', monospace"; ctx.textAlign = "center";
    ctx.fillText(off[2] ? "ЗОБРАЖЕННЯ НЕМАЄ · ОБ'ЄКТИВ ЗАКРИТО" : "КАМЕРУ ВИМКНЕНО", CW / 2, CH / 2 - 6);
    ctx.font = "12px 'JetBrains Mono', monospace"; ctx.fillText(off[2] ? "аудіозапис триває" : "запис не ведеться", CW / 2, CH / 2 + 16);
  }
  // накладки: номер камери, час, REC
  const sec = 16 * 3600 + 10 * 60 + Math.floor(t) + k * 1800;
  ctx.textAlign = "left"; ctx.font = "bold 12px 'JetBrains Mono', monospace"; ctx.fillStyle = "#e9e3d0";
  ctx.fillText(`БК-${String(p.sid || 7).padStart(4, "0")} · ${who(p).toUpperCase()}`, 12, 20);
  ctx.textAlign = "right"; ctx.fillText(`10.11.2026 ${tm(Math.floor(sec / 3600), Math.floor(sec / 60) % 60)}:${String(sec % 60).padStart(2, "0")}`, CW - 12, 20);
  if (!off || off[2]) { ctx.fillStyle = Math.floor(t * 2) % 2 ? "#e0453c" : "rgba(224,69,60,.3)"; ctx.beginPath(); ctx.arc(CW - 18, 36, 5, 0, 7); ctx.fill(); ctx.fillStyle = "#e9e3d0"; ctx.fillText("REC", CW - 28, 40); }
  // субтитри (аудіо)
  const now = s.subs.filter((x) => t >= x.t && t < x.t + x.d).slice(-2);
  ctx.textAlign = "center"; ctx.font = "15px 'Inter', sans-serif";
  now.forEach((x, n) => {
    const line = `${x.w}: ${x.text}`, y = CH - 18 - (now.length - 1 - n) * 26, w = Math.min(CW - 20, ctx.measureText(line).width + 20);
    ctx.fillStyle = "rgba(0,0,0,.72)"; ctx.fillRect(CW / 2 - w / 2, y - 17, w, 24);
    ctx.fillStyle = x.w === "Співробітник" ? "#f0dc9c" : "#e8edf4"; ctx.fillText(line, CW / 2, y, CW - 30);
  });
}

function loop() {
  cancelAnimationFrame(st.raf);
  let last = performance.now();
  const f = (now) => {
    const cv = document.getElementById("au-cv"), c = st.c;
    if (!cv || !c) { st.raf = 0; return; }
    const dt = Math.min(.1, (now - last) / 1000); last = now;
    const s = c.clips[st.clip];
    if (c.playing) { c.t = Math.min(s.dur, c.t + dt * c.speed); if (c.t >= s.dur) c.playing = false; }
    drawClip(cv.getContext("2d"), c, st.clip, c.t);
    const r = document.getElementById("au-seek"); if (r && document.activeElement !== r) r.value = c.t;
    const tl = document.getElementById("au-time"); if (tl) tl.textContent = `${c.t.toFixed(1)} / ${s.dur} с`;
    const pl = document.getElementById("au-play"); if (pl) pl.textContent = c.playing ? "⏸" : "▶";
    const el = document.getElementById("au-clock"); if (el) { const sec = Math.floor((performance.now() - c.t0) / 1000); el.textContent = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`; }
    st.raf = requestAnimationFrame(f);
  };
  st.raf = requestAnimationFrame(f);
}
function stop() { cancelAnimationFrame(st.raf); st.raf = 0; window.removeEventListener("keydown", onKey); }
function onKey(e) {
  if (!document.getElementById("au-cv") || !st.c || st.over) return;
  if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
  if (e.code === "Space") { e.preventDefault(); S.actions.auplay(); }
  if (e.code === "KeyM") { e.preventDefault(); S.actions.aumark(); }
  if (e.code === "ArrowLeft") { st.c.t = Math.max(0, st.c.t - 2); }
  if (e.code === "ArrowRight") { st.c.t = Math.min(st.c.clips[st.clip].dur, st.c.t + 2); }
}

// ---------------------------------------------------------------- підсумок
function judge(c, f) {
  const parts = [], notes = [];
  let found = 0, keyFound = 0, falseMarks = 0;
  const allEv = c.clips.flatMap((s, k) => s.ev.map((e) => ({ ...e, k })));
  const used = new Set();
  for (const m of c.marks) {
    const hit = allEv.find((e, n) => !used.has(n) && e.k === m.k && e.v === m.v && Math.abs(e.t - m.t) <= (e.tol || 4) && used.add(n) !== undefined);
    if (hit) { found++; if (hit.key) keyFound++; m.ok = true; }
    else {
      falseMarks++; m.ok = false;
      const d = c.clips[m.k].decoy.find((x) => x.v === m.v && Math.abs(x.t - m.t) <= 5);
      m.why = d ? d.why : "На цьому відрізку такого порушення немає.";
    }
  }
  const keys = c.docs.flatMap((d) => d.rows.map((r, n) => ({ d: d.k, n, key: r.key })));
  const pinned = keys.filter((x) => c.pins[x.d + ":" + x.n]), pinKey = pinned.filter((x) => x.key).length, pinBad = pinned.length - pinKey, allKey = keys.filter((x) => x.key).length;
  const right = f.who === c.g, falseAccuse = f.who >= 0 && f.who !== c.g;
  const vOk = right && f.v === c.answer.v, sOk = vOk && c.answer.s.includes(f.s);
  const sec = (performance.now() - c.t0) / 1000;
  // висновок без жодного доказу проти порушника (позначки на його записі або ключові рядки журналів) — необґрунтований
  const proof = c.marks.some((m) => m.ok && m.k === c.g) || pinKey > 0, grounded = right && proof;
  parts.push(["Порушення на записах", found * 250], ["Хибні позначки", -falseMarks * 150], ["Докази з журналів", pinKey * 150 - pinBad * 50],
    ["Встановлено порушника", grounded ? 1000 : right ? 200 : falseAccuse ? -1000 : 0], ["Кваліфікація", vOk ? 500 : 0], ["Стягнення", sOk ? 400 : 0],
    ["Час", grounded ? Math.max(0, Math.round((480 - sec) * 1.5)) : 0]);
  const total = Math.max(0, parts.reduce((a, [, v]) => a + v, 0));
  const missed = allEv.length - found;
  const grade = falseAccuse || !grounded ? "C" : sOk && !falseMarks && !missed && pinKey === allKey ? "S" : vOk ? "A" : "B";
  return { parts, total, grade, found, missed, falseMarks, falseAccuse, right, grounded, vOk, sOk, pinKey, pinBad, allKey, sec, allEv };
}
function finish(f) {
  const c = st.c, r = judge(c, f);
  st.over = r; stop();
  call("/api/game/score", { json: { game: "audit", level: c.i, score: r.total, ms: Math.max(8000, Math.round(r.sec * 1000)),
    data: { right: r.right, falseAccuse: r.falseAccuse, found: r.found, missed: r.missed, falseMarks: r.falseMarks, pins: r.pinKey, grade: r.grade, tpl: c.tpl, qual: r.vOk, sanct: r.sOk } } })
    .then((x) => { st.best[c.i] = Math.max(st.best[c.i] || 0, r.total); if (x && x.record) toast("Новий особистий рекорд!"); }).catch(() => {});
  paint();
}

// ---------------------------------------------------------------- сторінка розслідування
function casePage() {
  const c = st.c, s = c.clips[st.clip];
  const marks = c.marks.map((m, n) => ({ ...m, n })).filter((m) => m.k === st.clip);
  const docTab = c.docs.find((d) => d.k === st.tab);
  const pinsN = Object.values(c.pins).filter(Boolean).length;
  return `<div class="gm-bar"><button class="btn" data-a="aumenu">← Справи</button><b>${esc(c.name)}</b><span class="muted small">Навчальна легенда: співробітників обрано випадково</span>
      <span class="sp"></span><span class="au-clock">⏱ <b id="au-clock">0:00</b></span><button class="btn gold" data-a="aufinal">⚖ Висновок</button></div>
    <div class="au-grid">
      <aside class="au-side"><div class="au-sig"><div class="eyebrow">Підстава перевірки</div><p>${esc(c.signal)}</p></div>
        <div class="eyebrow">Співробітники, щодо яких перевірка</div>
        ${c.sus.map((p, k) => `<button class="au-sus ${st.clip === k ? "on" : ""}" data-a="auclip" data-k="${k}"><b>${esc(p.rankShort)} ${esc(p.name)}</b><span>${esc(p.deptS || "")} · БК-${String(p.sid || 7).padStart(4, "0")}</span>
          <i>${c.marks.filter((m) => m.k === k).length ? `⚑ ${c.marks.filter((m) => m.k === k).length}` : ""}</i></button>`).join("")}
        <div class="au-ev"><div class="eyebrow">Матеріали в справі</div>
          ${c.marks.length || pinsN ? `<ul>${c.marks.map((m) => `<li>⚑ ${esc(c.sus[m.k].name)} · ${m.t.toFixed(1)} с — ${esc(V[m.v].n)}</li>`).join("")}
            ${c.docs.flatMap((d) => d.rows.map((r, n) => c.pins[d.k + ":" + n] ? `<li>📌 ${esc(d.n)}: ${esc(r.c.join(" · "))}</li>` : "")).join("")}</ul>` : '<p class="muted small">Позначайте порушення на записах (⚑) і закріплюйте рядки журналів (📌).</p>'}</div></aside>
      <section class="au-main">
        <div class="au-tabs"><button class="${st.tab === "cam" ? "on" : ""}" data-a="autab" data-t="cam">🎥 Боді-камери</button>${c.docs.map((d) => `<button class="${st.tab === d.k ? "on" : ""}" data-a="autab" data-t="${d.k}">${esc(d.n)}</button>`).join("")}</div>
        ${st.tab === "cam" ? `<div class="au-player"><canvas id="au-cv" width="${CW}" height="${CH}"></canvas>
          <div class="au-ctl"><button class="btn sm" id="au-play" data-a="auplay">▶</button>
            <div class="au-seekw"><input type="range" id="au-seek" min="0" max="${s.dur}" step="0.1" value="${c.t}">
              <div class="au-flags">${marks.map((m) => `<span style="left:${m.t / s.dur * 100}%" title="${esc(V[m.v].n)}">⚑</span>`).join("")}</div></div>
            <span class="mono small" id="au-time"></span>
            <select class="i au-speed" id="au-speed">${[1, 2, 4].map((x) => `<option value="${x}" ${c.speed === x ? "selected" : ""}>${x}×</option>`).join("")}</select>
            <button class="btn sm gold" data-a="aumark">⚑ Позначити</button></div>
          ${st.marking ? `<div class="au-markbox"><span>Порушення на <b>${c.t.toFixed(1)} с</b>:</span><select class="i" id="au-mv">${Object.entries(V).map(([k, v]) => `<option value="${k}">${esc(v.n)}</option>`).join("")}</select>
            <button class="btn sm ok" data-a="aumarkok">Додати</button><button class="btn sm" data-a="aumarkx">Скасувати</button></div>` : ""}
          ${marks.length ? `<div class="au-marks">${marks.map((m) => `<span>⚑ ${m.t.toFixed(1)} с — ${esc(V[m.v].n)} <button data-a="aumarkdel" data-n="${m.n}" title="Прибрати">✕</button></span>`).join("")}</div>` : ""}
          <p class="muted small">Пробіл — пауза, ← → — на 2 с, M — позначити. Субтитри — це аудіо камери: воно пишеться, навіть коли об'єктив закрито.</p></div>`
        : `<table class="tbl au-doc"><thead><tr><th></th>${docTab.cols.map((x) => `<th>${esc(x)}</th>`).join("")}</tr></thead>
            <tbody>${docTab.rows.map((r, n) => `<tr class="${c.pins[docTab.k + ":" + n] ? "pin" : ""}"><td><button class="au-pin" data-a="aupin" data-id="${docTab.k}:${n}" title="Закріпити як доказ">📌</button></td>${r.c.map((x) => `<td>${esc(x)}</td>`).join("")}</tr>`).join("")}</tbody></table>
          <p class="muted small">Закріплюйте лише рядки, що доводять порушення: зайві «докази» знижують оцінку.</p>`}
      </section></div>
    ${st.final ? finalBox() : ""}`;
}
function finalBox() {
  const c = st.c, r = st.over;
  if (r) {
    const g = c.sus[c.g];
    return `<div class="au-modal"><div class="gm-card ${r.right ? "ok" : "bad"}"><div class="eyebrow">Висновок службової перевірки · ВВБ</div>
      <h3>${r.falseAccuse ? "Хибне звинувачення" : r.right ? "Перевірку завершено" : "Порушника не встановлено"}</h3>
      <div class="gm-grade g-${r.grade}">${r.grade}</div>
      <table class="gm-t">${r.parts.map(([n, v]) => `<tr><td>${esc(n)}</td><td class="${v < 0 ? "bad" : ""}">${v > 0 ? "+" : ""}${v}</td></tr>`).join("")}<tr class="sum"><td>Разом</td><td>${r.total}</td></tr></table>
      <ul class="gm-notes"><li class="${r.right ? "ok" : "bad"}">Порушник за легендою: <b>${esc(who(g))}</b> — ${esc(V[c.answer.v].n)} (${esc(V[c.answer.v].law)}).</li>
        <li>Стягнення за положенням: <b>${c.answer.s.map((x) => esc(SANCT[x])).join(" або ")}</b>${r.right && !r.sOk && r.vOk ? " — ви обрали інше" : ""}.</li>
        <li>Порушення на записах: знайдено ${r.found} з ${r.allEv.length}${r.missed ? ` — пропущено: ${r.allEv.filter((e) => !c.marks.some((m) => m.ok && m.k === e.k && m.v === e.v)).map((e) => `${esc(c.sus[e.k].name)}, ${e.t} с — ${esc(V[e.v].n)}`).join("; ")}` : ""}</li>
        ${c.marks.filter((m) => !m.ok).map((m) => `<li class="bad">Хибна позначка (${esc(c.sus[m.k].name)}, ${m.t.toFixed(1)} с): ${esc(m.why)}</li>`).join("")}
        ${r.allKey ? `<li>Ключові рядки журналів: закріплено ${r.pinKey} з ${r.allKey}${r.pinBad ? `, зайвих — ${r.pinBad}` : ""}</li>` : ""}
        ${r.right && !r.grounded ? `<li class="bad">Висновок не обґрунтовано: у справі немає жодного доказу проти порушника (позначки на його записі чи рядка журналу).</li>` : ""}
        ${r.falseAccuse ? `<li class="bad">Звинувачено невинного: у реальній перевірці це підстава для скарги й перевірки самого інспектора ВВБ.</li>` : ""}</ul>
      <div class="gm-law"><b>📖 Порядок</b><div>Висновок перевірки ВВБ подається керівництву; стягнення оформлюється наказом (Регламент «Дисциплінарні стягнення СБУ»). Якщо в діях є ознаки злочину — матеріали передаються ДБР або прокуратурі.</div>
        <div class="muted small">Навчальна легенда: співробітників обрано випадково з бази «Сови», жодних реальних звинувачень.</div></div>
      <div class="acts"><button class="btn" data-a="aumenu">До меню</button><button class="btn gold" data-a="auplaylvl" data-l="${c.i}">Нова справа</button>
        ${c.i < 2 ? `<button class="btn ok" data-a="auplaylvl" data-l="${c.i + 1}">Наступний рівень →</button>` : ""}</div></div></div>`;
  }
  return `<div class="au-modal"><form class="gm-card au-final" data-f="aufinal"><div class="eyebrow">Висновок службової перевірки</div><h3>${esc(c.title)}</h3>
    <label class="f"><span>Хто допустив порушення</span><select class="i" name="who">${c.sus.map((p, k) => `<option value="${k}">${esc(who(p))} · ${esc(p.deptS || "")}</option>`).join("")}<option value="-1">Порушень не виявлено</option></select></label>
    <label class="f"><span>Основне (найтяжче) порушення</span><select class="i" name="v">${Object.entries(V).map(([k, v]) => `<option value="${k}">${esc(v.n)}</option>`).join("")}</select></label>
    <label class="f"><span>Стягнення</span><select class="i" name="s">${Object.entries(SANCT).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join("")}</select></label>
    <p class="muted small">Хибне звинувачення невинного — провал перевірки. Якщо доказів бракує — поверніться до матеріалів.</p>
    <div class="acts"><button class="btn" type="button" data-a="aufinalx">Назад до матеріалів</button><button class="btn gold" type="submit">Подати висновок</button></div></form></div>`;
}
function paint() {
  const root = document.getElementById("au-root");
  if (!root) return;
  root.innerHTML = casePage();
  if (st.tab === "cam" && !st.over) loop();
  const seek = document.getElementById("au-seek");
  if (seek) seek.oninput = () => { st.c.t = +seek.value; st.c.playing = false; };
  const sp = document.getElementById("au-speed");
  if (sp) sp.onchange = () => { st.c.speed = +sp.value; };
}

// ---------------------------------------------------------------- меню
async function view() {
  stop();
  const [b, ppl] = await Promise.all([call("/api/game/audit").catch(() => ({ mine: {}, week: [], all: [], weekly: [], depts: [], badges: [] })),
    call("/api/game/people").catch(() => null)]);
  st.board = b; st.best = b.mine || {}; st.people = ppl;
  if (st.lvl !== null) {
    if (!st.c) { st.c = makeCase(st.lvl); st.c.t = 0; st.c.speed = 1; st.clip = 0; st.tab = "cam"; st.marking = false; st.final = false; st.over = null; }
    setTimeout(() => { paint(); window.addEventListener("keydown", onKey); }, 20);
    return `<div id="au-root"></div>`;
  }
  const me = S.ME().me;
  const lb = (rows) => rows.length ? `<ol class="gm-lb">${rows.map((r, n) => `<li class="${r.sid === me.sid ? "me" : ""}"><b>${n + 1}</b><span>${esc(r.rankShort || "")} ${esc(r.name)} <i class="muted">${esc(r.deptS || "")}</i></span><em>${r.score}</em></li>`).join("")}</ol>` : '<p class="muted small">Ще ніхто не пройшов.</p>';
  const dl = (rows) => rows.length ? `<ol class="gm-lb">${rows.map((r, n) => `<li class="${r.dept === me.dept ? "me" : ""}"><b>${n + 1}</b><span>${esc(r.n)} <i class="muted">учасників: ${r.players}</i></span><em>${r.avg}</em></li>`).join("")}</ol>` : '<p class="muted small">Ще немає результатів.</p>';
  const wk = ["Скарга", "Блокпост", "Кріт", "Зникла зброя"][((b.seed || 1) % 4)];
  return `<div class="gm-crumbs"><button class="btn sm" data-a="trhub">← Усі тренажери</button></div>
    <div class="gm-hero au-hero"><div><div class="eyebrow">Тренажер ВВБ · ЄІС «Сова»</div><h2>ПЕРЕВІРКА</h2>
      <p>Службове розслідування всередині СБУ. Переглядайте записи <b>боді-камер</b>, позначайте порушення, звіряйте журнали доступу, транзакції й наряди — і подайте висновок: хто, що саме, яке стягнення. <b>Хибне звинувачення — провал.</b></p>
      <div class="gm-keys"><span><b>Пробіл</b> пауза</span><span><b>← →</b> перемотка</span><span><b>M</b> позначити порушення</span><span><b>📌</b> закріпити рядок журналу</span><span><b>⚖</b> висновок</span></div>
      ${(b.badges || []).length ? `<div class="gm-badges">${b.badges.map((x) => `<span title="${esc(x.t)}">${x.icon} ${esc(x.t)}</span>`).join("")}</div>` : ""}
      <p class="muted small">Підозрювані щоразу — випадкові співробітники з бази «Сови». Це навчальна легенда, не звинувачення. Результати не впливають на бали й премії.</p></div></div>
    <div class="gm-levels">${LEVELS.map((L, i) => `<button class="gm-lvl" data-a="auplaylvl" data-l="${i}"><span class="eyebrow">Рівень ${i + 1} · ${["легкий", "середній", "складний"][i]}</span><b>${esc(L.name)}</b><p>${esc(L.brief)}</p>
      <span class="gm-best">Ваш рекорд: <b>${st.best[i] || "—"}</b></span></button>`).join("")}
      <button class="gm-lvl gm-weekly" data-a="auplaylvl" data-l="3"><span class="eyebrow">⚡ Справа тижня · однакова для всіх</span><b>${esc(wk)}</b><p>Сценарій тижня з трьома підозрюваними. Окремий рейтинг.</p>
      <span class="gm-best">Ваш результат тижня: <b>${st.best[3] || "—"}</b></span></button></div>
    <div class="grid2"><div class="card"><header><h3>🏆 Рейтинг тижня</h3><span class="muted small">сума найкращих результатів</span></header>${lb(b.week || [])}</div>
      <div class="card"><header><h3>🛡 Підрозділ тижня</h3><span class="muted small">середній результат учасників</span></header>${dl(b.depts || [])}</div>
      <div class="card"><header><h3>⚡ Справа тижня</h3></header>${lb(b.weekly || [])}</div>
      <div class="card"><header><h3>⭐ Найкращі за весь час</h3></header>${lb(b.all || [])}</div></div>
    <div class="card gm-law-card"><header><h3>📖 Довідка інспектора ВВБ</h3><span class="muted small">положення СБУ</span></header>
      <div class="gm-law">${Object.values(V).map((v) => `<span><i>${esc(v.law)}</i> ${esc(v.n)} — ${v.s.map((x) => esc(SANCT[x])).join(" або ")}</span>`).join("")}</div></div>`;
}
S.games = S.games || {};
S.games.audit = { view, stop };
Object.assign(S.actions, {
  auplaylvl: (b) => { stop(); st.lvl = +b.dataset.l; st.c = null; S.render(); },
  aumenu: () => { stop(); st.lvl = null; st.c = null; S.render(); },
  auclip: (b) => { st.clip = +b.dataset.k; st.c.t = 0; st.c.playing = false; st.tab = "cam"; st.marking = false; paint(); },
  autab: (b) => { st.tab = b.dataset.t; st.marking = false; if (st.c) st.c.playing = false; paint(); },
  auplay: () => { const c = st.c; if (!c) return; if (c.t >= c.clips[st.clip].dur) c.t = 0; c.playing = !c.playing; },
  aumark: () => { if (!st.c || st.tab !== "cam") return; st.c.playing = false; st.marking = true; paint(); },
  aumarkx: () => { st.marking = false; paint(); },
  aumarkok: () => { const v = document.getElementById("au-mv").value; st.c.marks.push({ k: st.clip, t: Math.round(st.c.t * 10) / 10, v }); st.marking = false; paint(); },
  aumarkdel: (b) => { st.c.marks.splice(+b.dataset.n, 1); paint(); },
  aupin: (b) => { const id = b.dataset.id; st.c.pins[id] = !st.c.pins[id]; paint(); },
  aufinal: () => { st.c.playing = false; st.final = true; paint(); },
  aufinalx: () => { st.final = false; paint(); },
});
Object.assign(S.forms, {
  aufinal: (f) => finish({ who: +f.who.value, v: f.v.value, s: f.s.value }),
});
})();
