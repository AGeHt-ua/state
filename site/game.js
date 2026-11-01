/* «Штурм» — тактичний тренажер ЦСО «Альфа» (вид згори, Canvas).
   Видно лише те, що в полі зору оперативника. Стадії сили (ст. 35 ПК): спершу вимога здатися (F), зброя — лише проти озброєних (ст. 37).
   Затриманий без пострілу — більше балів; поранений цивільний чи заручник — великий штраф. Рейтинг — у ЄІС «Сова». */
(() => {
const S = window.SOVA;
const { esc, call, toast } = S;
const T = 32, GW = 32, GH = 20, CW = GW * T, CH = GH * T;
const FOV = 58 * Math.PI / 180, VIEW = 520, NEAR = 72;
const TOP = 50, BOT = 66, FH = CH + TOP + BOT;   // смуги HUD над і під картою

// # стіна · . підлога · , килим · D двері · P старт · E озброєний · C цивільний · H заручник · B ящик (укриття, прозорий для погляду)
const LEVELS = [
  { name: "Склад на Пристані", brief: "Угруповання тримає заручника на складі контрабанди. 5 озброєних, у будівлі — працівники складу.", flash: 2, react: 650, map: [
    "################################",
    "#P.............#...............#",
    "#..............#.......E.......#",
    "#....BB..BB....D...BB.....BB...#",
    "#....BB..BB....#...BB.....BB...#",
    "#..............#...............#",
    "#######D########.......C.......#",
    "#..............#...............#",
    "#..E...........#####D#####.....#",
    "#....BB..BB....#.........#.....#",
    "#....BB..BB....#....H....#..E..#",
    "#..............#....E....#.....#",
    "#.....C........#.........#.....#",
    "#..............###########.....#",
    "#.......BB.....................#",
    "#.......BB.......BB....BB......#",
    "#..E.............BB....BB......#",
    "#..........................C...#",
    "#..............................#",
    "################################"] },
  { name: "Офіс «Нова Логістика»", brief: "Фінансовий осередок терористів в офісі. 8 озброєних, 2 заручники, у кабінетах — працівники.", flash: 2, react: 520, map: [
    "################################",
    "#P....#,,,,,,,,,#,,,,,,,,,,#...#",
    "#.....#,,,,E,,,,#,,,,C,,,,,#.E.#",
    "#.....D,,,,,,,,,D,,,,,,,,,,D...#",
    "#.....#,,,,,,,,,#,,,,,,,,,,#...#",
    "###D###########D######D#####...#",
    "#..............................#",
    "#.......BB.............BB......#",
    "###D#######D##########D#####D###",
    "#,,,,,#,,,,,,,,,#..........#...#",
    "#,,E,,#,,,,H,,,,#....E.....#...#",
    "#,,,,,#,,,,E,,,,D..........#.C.#",
    "#,,,,,D,,,,,,,,,#....C.....D...#",
    "#,,,,,#,,,,,,,,,#..........#.E.#",
    "###D###################D########",
    "#..............................#",
    "#...C.....E..........H.........#",
    "#......BB.....BB.....BB....E...#",
    "#..............................#",
    "################################"] },
  { name: "Особняк лідера угруповання", brief: "Лідер ОЗУ з охороною. 11 озброєних, 3 заручники, прислуга. Охорона реагує швидко.", flash: 3, react: 430, map: [
    "################################",
    "#P......#,,,,,,,,,,#...........#",
    "#.......#,,,,E,,,,,#.....H.....#",
    "#.......D,,,,,,,,,,D.....E.....#",
    "#.......#,,,,,,,,,,#...........#",
    "####D####...####...#####D#######",
    "#.........E.#,,#...............#",
    "#...........DC,#.......E.......#",
    "#..BB.......####...............#",
    "#..BB..............###D###.....#",
    "#.......E..........#,,,,,#..C..#",
    "####D#######D######D,,H,,#.....#",
    "#,,,,,,,#..........#,,E,,#.....#",
    "#,,C,,,,#....E.....#######..E..#",
    "#,,,,,,,D..........D...........#",
    "#,,,,,,,#..........#....BB.....#",
    "###D#####...H......#....BB..E..#",
    "#.......#..........#...........#",
    "#..E....#....C.....D.....E.....#",
    "################################"] },
];

const st = { lvl: null, g: null, raf: 0, best: {}, board: null, people: null, mate: null };

// правова база операцій (статті — із законодавчої бази NG у ЄІС «Сова»)
const LAW = {
  base: [["ст. 46 ПК", "Спеціальна операція: силове затримання, звільнення заручників"],
    ["ст. 31 ПК", "Підслідність СБУ: тероризм, незаконні збройні формування, організовані злочинні синдикати"],
    ["ст. 35 ПК", "Стадії сили: усна вимога → фізична сила → спецзасоби → вогнепальна зброя"],
    ["ст. 37 ПК", "Зброя — лише проти збройного нападу, озброєної особи, що загрожує життю, для звільнення заручників"],
    ["ст. 15 ПК", "Після затримання: представитися, оголосити підстави, роз'яснити права (Міранда), огляд, протокол"]],
  charges: [[["ст. 146 КК", "захоплення заручників"], ["ст. 263 КК", "незаконне поводження зі зброєю"]],
    [["ст. 258 КК", "терористичний акт (підготовка, фінансування осередку)"], ["ст. 146 КК", "захоплення заручників"], ["ст. 263 КК", "зброя"]],
    [["ст. 260 КК", "незаконне збройне формування"], ["ст. 146 КК", "захоплення заручників"], ["ст. 263 КК", "зброя"]]],
};
const TIPS = {
  shout: ["ст. 35 ПК", "Перша стадія сили — усна законна вимога й попередження про застосування сили."],
  cuff: ["ст. 15 ПК", "Затримано: представтеся, оголосіть підстави й статті, роз'ясніть права (правило Міранди), огляньте на зброю."],
  host: ["ст. 146 КК", "Захоплення заручників. Застава за цією статтею заборонена (ст. 16.1 ПК)."],
  flash: ["ст. 35 ПК", "Світлошумова — спецзасіб, третя стадія сили: якщо вимога й фізична сила не дали результату."],
  kill: ["ст. 37 ПК", "Вогнепальна зброя — винятковий захід: лише проти озброєної особи, що загрожує життю."],
  civ: ["ст. 365 КК", "Перевищення меж сили — кримінальна відповідальність; кожен випадок перевіряє ВВБ (Інструкція з порядку затримання, р. V)."],
  mate: ["ст. 8 ПК", "Обов'язок службовця — захищати життя людей і колег під час виконання завдання."],
};
function tip(g, k) { if (!g.tips || g.tips[k] || !TIPS[k]) return; g.tips[k] = 1; g.tipNow = { law: TIPS[k][0], text: TIPS[k][1], t: 7 }; }

// операція тижня: одна з трьох будівель із новою розстановкою (однаковою для всіх цього тижня)
function weekly() {
  const seed = (st.board && st.board.seed) || 0, bi = seed % 3, base = LEVELS[bi];
  let z = seed % 233280;
  const rnd = () => (z = (z * 9301 + 49297) % 233280) / 233280;
  const rows = base.map.map((r) => r.replace(/[ECH]/g, ".").split(""));
  const free = [];
  rows.forEach((r, y) => r.forEach((c, x) => { if ((c === "." || c === ",") && Math.hypot(x - 1, y - 1) > 7) free.push([x, y]); }));
  const cnt = (ch) => base.map.join("").split(ch).length - 1;
  for (const [ch, n] of [["E", cnt("E") + 2], ["C", cnt("C")], ["H", cnt("H")]]) for (let i = 0; i < n && free.length; i++) {
    const [x, y] = free.splice(Math.floor(rnd() * free.length), 1)[0]; rows[y][x] = ch;
  }
  return { name: "Операція тижня · " + base.name, brief: "Нова розстановка щотижня — однакова для всіх. Окремий рейтинг тижня.", flash: 3, react: 470,
    map: rows.map((r) => r.join("")), law: bi };
}

// ---------------------------------------------------------------- світ
function build(i) {
  const L = i === 3 ? weekly() : { ...LEVELS[i], law: i }, g = { i, L, tips: {}, rescued: [], grid: L.map.map((r) => r.split("")), doors: {}, ents: [], shots: [], fx: [], nades: [], msgs: [], t: 0,
    stats: { fired: 0, hits: 0, kills: 0, arrests: 0, hostages: 0, civHit: 0, hostHit: 0, shoutOk: 0 }, decals: [], shake: 0, over: null, keys: {}, mx: CW / 2, my: CH / 2, down: false };
  g.grid.forEach((row, y) => row.forEach((c, x) => {
    const cx = x * T + T / 2, cy = y * T + T / 2;
    if (c === "P") { g.p = { x: cx, y: cy, a: 0, hp: 100, mag: 30, ammo: 90, flash: L.flash, reload: 0, cd: 0, shout: 0, blind: 0 }; row[x] = "."; }
    if (c === "E") { g.ents.push({ k: "foe", x: cx, y: cy, a: Math.random() * 6.28, hp: 100, st: "idle", seen: 0, cd: 0, stun: 0, last: null, sweep: (Math.random() - .5) * .6 }); row[x] = "."; }
    if (c === "C") { g.ents.push({ k: "civ", x: cx, y: cy, a: Math.random() * 6.28, st: "idle", stun: 0 }); row[x] = "."; }
    if (c === "H") { g.ents.push({ k: "host", x: cx, y: cy, a: 0, st: "tied", stun: 0 }); row[x] = "."; }
    if (c === "D") g.doors[x + "," + y] = false;
  }));
  const ppl = st.people || {};
  g.ents.filter((e) => e.k === "host").forEach((e, n) => { e.who = (ppl.hostages || [])[n] || null; });
  if (st.mate) g.mate = { k: "mate", x: g.p.x + 30, y: g.p.y, a: 0, hp: 100, cd: 0, st: "ok", walk: 0, who: st.mate };
  return g;
}
const tile = (g, x, y) => (g.grid[y] || [])[x] || "#";
const solid = (g, tx, ty) => { const c = tile(g, tx, ty); return c === "#" || c === "B" || (c === "D" && !g.doors[tx + "," + ty]); };
const opaque = (g, tx, ty) => { const c = tile(g, tx, ty); return c === "#" || (c === "D" && !g.doors[tx + "," + ty]); };

// промінь по сітці (DDA): відстань до першої непрозорої клітинки
function ray(g, x, y, a, max, test = opaque) {
  const dx = Math.cos(a), dy = Math.sin(a);
  let tx = Math.floor(x / T), ty = Math.floor(y / T);
  const sx = dx > 0 ? 1 : -1, sy = dy > 0 ? 1 : -1;
  const ddx = Math.abs(T / (dx || 1e-9)), ddy = Math.abs(T / (dy || 1e-9));
  let mx = dx > 0 ? ((tx + 1) * T - x) / dx : (x - tx * T) / -(dx || -1e-9);
  let my = dy > 0 ? ((ty + 1) * T - y) / dy : (y - ty * T) / -(dy || -1e-9);
  mx = Math.abs(mx); my = Math.abs(my);
  for (let n = 0; n < 200; n++) {
    let d;
    if (mx < my) { d = mx; mx += ddx; tx += sx; } else { d = my; my += ddy; ty += sy; }
    if (d > max) return max;
    if (test(g, tx, ty)) return d;
  }
  return max;
}
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const angTo = (a, b) => Math.atan2(b.y - a.y, b.x - a.x);
const adiff = (a, b) => { let d = (b - a) % (2 * Math.PI); if (d > Math.PI) d -= 2 * Math.PI; if (d < -Math.PI) d += 2 * Math.PI; return d; };
const los = (g, a, b) => ray(g, a.x, a.y, angTo(a, b), dist(a, b)) >= dist(a, b) - 2;

function move(g, o, vx, vy, r = 10) {
  const tryAxis = (nx, ny) => {
    for (const [ox, oy] of [[-r, -r], [r, -r], [-r, r], [r, r]]) if (solid(g, Math.floor((nx + ox) / T), Math.floor((ny + oy) / T))) return false;
    return true;
  };
  if (tryAxis(o.x + vx, o.y)) o.x += vx;
  if (tryAxis(o.x, o.y + vy)) o.y += vy;
}
function say(g, x, y, text, col = "#e9d9a8") { g.msgs.push({ x, y, text, col, t: 1.6 }); }
function noise(g, x, y, r) {
  for (const e of g.ents) if (e.k === "foe" && e.st !== "down" && e.st !== "cuffed" && e.st !== "surr" && Math.hypot(e.x - x, e.y - y) < r) {
    e.st = e.st === "stun" ? e.st : "alert"; e.last = { x: g.p.x, y: g.p.y };
  }
  for (const e of g.ents) if (e.k === "civ" && Math.hypot(e.x - x, e.y - y) < r) e.st = "cower";
}

// ---------------------------------------------------------------- дії гравця
function shoot(g) {
  const p = g.p;
  if (p.reload > 0 || p.cd > 0) return;
  if (p.mag <= 0) { say(g, p.x, p.y - 20, "Порожньо — R", "#d4605a"); p.cd = .3; return; }
  p.mag--; p.cd = .11; g.stats.fired++;
  const moving = g.keys.KeyW || g.keys.KeyA || g.keys.KeyS || g.keys.KeyD;
  const a = p.a + (Math.random() - .5) * (moving ? .09 : .035);
  const wd = ray(g, p.x, p.y, a, 900);
  let hit = null, hd = wd;
  const dx = Math.cos(a), dy = Math.sin(a);
  for (const e of g.ents) {
    if (e.st === "down") continue;
    const ex = e.x - p.x, ey = e.y - p.y, along = ex * dx + ey * dy;
    if (along < 0 || along > hd) continue;
    if (Math.abs(ex * dy - ey * dx) < 11) { hit = e; hd = along; }
  }
  fxShot(g, p, a, hd, !!hit, false);
  noise(g, p.x, p.y, 430);
  if (!hit) return;
  g.stats.hits++;
  if (hit.k === "foe") {
    if (hit.st === "surr" || hit.st === "cuffed") { g.stats.civHit++; say(g, hit.x, hit.y - 18, "Вогонь по тому, хто здався! (ст. 365 КК)", "#d4605a"); }
    hit.hp -= 55;
    if (hit.hp <= 0) { hit.st = "down"; g.stats.kills++; say(g, hit.x, hit.y - 18, "Нейтралізовано", "#e9d9a8"); tip(g, "kill"); }
    else { hit.st = "alert"; hit.last = { x: p.x, y: p.y }; }
  } else if (hit.k === "civ") { hit.st = "down"; g.stats.civHit++; tip(g, "civ"); say(g, hit.x, hit.y - 18, "Поранено цивільного! ст. 37 ПК", "#d4605a"); }
  else if (hit.k === "host") { hit.st = "down"; g.stats.hostHit++; tip(g, "civ"); say(g, hit.x, hit.y - 18, hit.who ? `Поранено заручника: ${hit.who.name}!` : "Поранено заручника!", "#d4605a"); }
  if (hit.st === "down" && !hit.bled) { hit.bled = 1; blood(g, hit); }
}
function reload(g) { const p = g.p; if (p.reload > 0 || p.mag === 30 || p.ammo <= 0) return; p.reload = 1.5; say(g, p.x, p.y - 20, "Перезаряджаю"); }
function interact(g) {
  const p = g.p;
  // двері
  const tx = Math.floor(p.x / T), ty = Math.floor(p.y / T);
  for (let y = ty - 1; y <= ty + 1; y++) for (let x = tx - 1; x <= tx + 1; x++) {
    const k = x + "," + y;
    if (k in g.doors && Math.hypot(x * T + T / 2 - p.x, y * T + T / 2 - p.y) < 46) {
      if (g.doors[k] && Math.floor(p.x / T) === x && Math.floor(p.y / T) === y) return;  // не зачиняти двері, стоячи в проході
      g.doors[k] = !g.doors[k]; return;
    }
  }
  for (const e of g.ents) {
    if (dist(e, p) > 34) continue;
    if (e.k === "foe" && e.st === "surr") { e.st = "cuffed"; g.stats.arrests++; say(g, e.x, e.y - 18, "Затримано · кайданки", "#5fb37a"); tip(g, "cuff"); return; }
    if (e.k === "host" && e.st === "tied") {
      e.st = "safe"; g.stats.hostages++; if (e.who) g.rescued.push(e.who.sid);
      say(g, e.x, e.y - 18, e.who ? `Звільнено: ${e.who.rankShort} ${e.who.name}` : "Заручника звільнено", "#5fb37a"); tip(g, "host"); return;
    }
  }
}
function shout(g) {
  const p = g.p;
  if (p.shout > 0) return;
  p.shout = 1.4;
  say(g, p.x, p.y - 22, "СБУ! Зброю на землю! Руки вгору!", "#9cc3f0"); tip(g, "shout");
  for (const e of g.ents) {
    if (e.k === "civ" && dist(e, p) < 260) e.st = "cower";
    if (e.k !== "foe" || ["down", "cuffed", "surr", "stun"].includes(e.st) && e.st !== "stun") continue;
    if (dist(e, p) > 240 || !los(g, p, e)) continue;
    const flank = Math.abs(adiff(e.a, angTo(e, p))) > FOV;      // зайшли з флангу — шанс вищий
    const firing = e.seen > g.L.react / 1000;
    const chance = e.st === "stun" ? .95 : flank ? .85 : firing ? .2 : .6;
    if (Math.random() < chance) { e.st = "surr"; g.stats.shoutOk++; say(g, e.x, e.y - 18, "Здаюсь!", "#5fb37a"); }
    else { e.st = "alert"; e.last = { x: p.x, y: p.y }; e.seen = Math.max(e.seen, g.L.react / 1000 * .7); say(g, e.x, e.y - 18, "Ніколи!", "#d4605a"); }
  }
}
function throwFlash(g) {
  const p = g.p;
  if (p.flash <= 0) return;
  p.flash--; tip(g, "flash");
  const a = angTo(p, { x: g.mx, y: g.my }), want = Math.min(260, Math.hypot(g.mx - p.x, g.my - p.y));
  const d = Math.max(10, Math.min(want, ray(g, p.x, p.y, a, want) - 8));
  g.nades.push({ x: p.x, y: p.y, tx: p.x + Math.cos(a) * d, ty: p.y + Math.sin(a) * d, t: 0 });
}
function explode(g, n) {
  g.fx.push({ k: "flash", x: n.tx, y: n.ty, t: .5 });
  g.shake = 9;
  const pt = { x: n.tx, y: n.ty };
  for (const e of g.ents) if (e.st !== "down" && e.st !== "cuffed" && dist(e, pt) < 175 && los(g, pt, e)) { if (e.k === "foe" && e.st !== "surr") e.st = "stun"; e.stun = 3.6; }
  if (dist(g.p, pt) < 130 && los(g, pt, g.p) && Math.abs(adiff(g.p.a, angTo(g.p, pt))) < 1.2) g.p.blind = 1.6;
  noise(g, n.tx, n.ty, 500);
}

// ---------------------------------------------------------------- напарник
function target(g, e) {
  const m = g.mate;
  return m && m.st !== "down" && dist(e, m) < dist(e, g.p) && los(g, e, m) ? m : g.p;
}
function mateUpdate(g, dt) {
  const m = g.mate, p = g.p;
  if (!m || m.st === "down") return;
  m.cd = Math.max(0, m.cd - dt);
  for (const e of g.ents) if (e.k === "foe" && e.st === "surr" && dist(m, e) < 38) { e.st = "cuffed"; g.stats.arrests++; say(g, e.x, e.y - 18, `${m.who.name}: кайданки`, "#5fb37a"); }
  let foe = null, fd = 1e9;   // вогонь лише по тих, хто вже чинить збройний опір (ст. 37 ПК)
  for (const e of g.ents) if (e.k === "foe" && e.st === "alert" && e.seen > 0 && dist(m, e) < 430 && dist(m, e) < fd && los(g, m, e)) { foe = e; fd = dist(m, e); }
  if (foe) {
    const a = angTo(m, foe);
    m.a += Math.max(-5 * dt, Math.min(5 * dt, adiff(m.a, a)));
    if (m.cd <= 0 && Math.abs(adiff(m.a, a)) < .2) {
      m.cd = .75 + Math.random() * .35;
      const ok = Math.random() < .5, aa = a + (ok ? 0 : (Math.random() - .5) * .3);
      fxShot(g, m, aa, ok ? fd : ray(g, m.x, m.y, aa, 700), ok, false);
      noise(g, m.x, m.y, 300);
      if (ok) { foe.hp -= 55; if (foe.hp <= 0) { foe.st = "down"; g.stats.kills++; blood(g, foe); say(g, foe.x, foe.y - 18, `Нейтралізовано · ${m.who.name}`); } else foe.st = "alert"; }
    }
  } else m.a += Math.max(-4 * dt, Math.min(4 * dt, adiff(m.a, p.a)));
  const tx = p.x - Math.cos(p.a) * 34 + Math.cos(p.a + 1.57) * 14, ty = p.y - Math.sin(p.a) * 34 + Math.sin(p.a + 1.57) * 14;
  const dd = Math.hypot(tx - m.x, ty - m.y);
  if (dist(m, p) > 260 || (dist(m, p) > 110 && !los(g, m, p))) { m.x = p.x; m.y = p.y; }   // відстав за дверима — підтягується
  else if (dd > 8 && !foe) { const sp = Math.min(dd, 150 * dt), a = Math.atan2(ty - m.y, tx - m.x); move(g, m, Math.cos(a) * sp, Math.sin(a) * sp); m.walk += sp; }
}

// ---------------------------------------------------------------- оновлення
function update(g, dt) {
  if (g.over) return;
  g.t += dt;
  const p = g.p, k = g.keys;
  p.a = angTo(p, { x: g.mx, y: g.my });
  const sp = (k.ShiftLeft || k.ShiftRight ? 75 : 145) * dt;
  let vx = (k.KeyD ? 1 : 0) - (k.KeyA ? 1 : 0), vy = (k.KeyS ? 1 : 0) - (k.KeyW ? 1 : 0);
  if (vx && vy) { vx *= .707; vy *= .707; }
  move(g, p, vx * sp, vy * sp);
  p.walk = (p.walk || 0) + Math.hypot(vx, vy) * sp;
  g.shake = Math.max(0, (g.shake || 0) - dt * 14);
  for (const key of ["cd", "shout", "blind"]) p[key] = Math.max(0, p[key] - dt);
  if (p.reload > 0) { p.reload -= dt; if (p.reload <= 0) { const n = Math.min(30 - p.mag, p.ammo); p.mag += n; p.ammo -= n; } }
  if (g.down) shoot(g);

  for (const e of g.ents) {
    if (e.stun > 0) { e.stun -= dt; if (e.stun <= 0 && e.k === "foe" && e.st === "stun") { e.st = "alert"; e.last = { x: p.x, y: p.y }; } continue; }
    if (e.k !== "foe" || ["down", "cuffed", "surr"].includes(e.st)) continue;
    const tgt = target(g, e), d = dist(e, tgt), toP = angTo(e, tgt);
    const sees = d < 470 && (e.st === "alert" || Math.abs(adiff(e.a, toP)) < FOV) && los(g, e, tgt);
    if (sees) {
      e.st = "alert"; e.last = { x: tgt.x, y: tgt.y };
      e.a += Math.max(-4 * dt, Math.min(4 * dt, adiff(e.a, toP)));
      e.seen += dt; e.cd -= dt;
      if (e.seen > g.L.react / 1000 && e.cd <= 0 && Math.abs(adiff(e.a, toP)) < .25) {
        e.cd = .7 + Math.random() * .35;
        const still = tgt === p && !(k.KeyW || k.KeyA || k.KeyS || k.KeyD);
        const chance = Math.max(.12, .62 - d / 1100 + (still ? .12 : 0));
        const miss = Math.random() > chance;
        const aa = toP + (miss ? (Math.random() - .5) * .35 : 0), hd = miss ? ray(g, e.x, e.y, aa, 700) : d;
        fxShot(g, e, aa, hd, !miss, true);
        if (!miss && tgt === p) { p.hp -= 18; g.fx.push({ k: "hurt", t: .25 }); }
        else if (!miss) { tgt.hp -= 18; if (tgt.hp <= 0) { tgt.st = "down"; g.stats.partnerHit = 1; blood(g, tgt); tip(g, "mate"); say(g, tgt.x, tgt.y - 18, `Напарника поранено: ${tgt.who.name}!`, "#d4605a"); } }
        noise(g, e.x, e.y, 300);
      }
    } else {
      e.seen = Math.max(0, e.seen - dt * .5);
      if (e.st === "alert" && e.last) {
        const la = angTo(e, e.last);
        e.a += Math.max(-2.5 * dt, Math.min(2.5 * dt, adiff(e.a, la)));
        if (dist(e, e.last) > 40) { move(g, e, Math.cos(la) * 55 * dt, Math.sin(la) * 55 * dt); e.walk = (e.walk || 0) + 55 * dt; }
      } else e.a += Math.sin(g.t * .7 + e.x) * e.sweep * dt;  // огляд на посту
    }
  }
  mateUpdate(g, dt);
  if (g.tipNow) { g.tipNow.t -= dt; if (g.tipNow.t <= 0) g.tipNow = null; }
  for (const s of g.shots) s.t -= dt;
  g.shots = g.shots.filter((s) => s.t > 0);
  for (const f of g.fx) { f.t -= dt; if (f.vx !== undefined) { f.x += f.vx * dt; f.y += f.vy * dt; f.vx *= .9; f.vy *= .9; if (f.r !== undefined) f.r += dt * 14; } }
  g.fx = g.fx.filter((f) => f.t > 0);
  for (const m of g.msgs) { m.t -= dt; m.y -= 14 * dt; }
  g.msgs = g.msgs.filter((m) => m.t > 0);
  for (const n of g.nades) { n.t += dt; if (n.t >= .8 && !n.done) { n.done = true; explode(g, n); } }
  g.nades = g.nades.filter((n) => n.t < .9);

  if (p.hp <= 0) return finish(g, false, "Оперативника поранено — операцію зірвано.");
  const foesLeft = g.ents.filter((e) => e.k === "foe" && !["down", "cuffed"].includes(e.st)).length;
  const hostLeft = g.ents.filter((e) => e.k === "host" && e.st === "tied").length;
  if (!foesLeft && !hostLeft) finish(g, true);
}

// ---------------------------------------------------------------- малювання (процедурна графіка: текстури, світло, анімація, ефекти)
const COL = { gold: "#c9a24d", foe: "#d4605a", civ: "#9cc3f0", host: "#5fb37a" };
const hash = (x, y, s = 0) => { let h = (x * 374761393 + y * 668265263 + s * 982451653) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const mk = (w, h) => Object.assign(document.createElement("canvas"), { width: w, height: h });

// статичний шар рівня: підлога з текстурою, стіни з об'ємом, ящики, тіні біля стін — малюється один раз
function prerender(g) {
  const c = mk(CW, CH), x2 = c.getContext("2d"), kind = ["concrete", "office", "parquet"][g.i] || "concrete";
  const wall = (x, y) => tile(g, x, y) === "#";
  for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
    const ch = g.grid[y][x], X = x * T, Y = y * T;
    if (ch === "#") continue;
    if (ch === ",") {                                  // килим: глибокий колір + дрібний візерунок
      x2.fillStyle = g.i === 2 ? "#3a1c22" : "#1e2633"; x2.fillRect(X, Y, T, T);
      for (let i = 0; i < 14; i++) { x2.fillStyle = `rgba(255,255,255,${.015 + hash(x, y, i) * .03})`; x2.fillRect(X + hash(x, y, i + 9) * T, Y + hash(x, y, i + 20) * T, 1.5, 1.5); }
      if ((x + y) % 2 === 0) { x2.strokeStyle = "rgba(201,162,77,.06)"; x2.strokeRect(X + 8, Y + 8, 16, 16); }
    } else if (kind === "concrete") {                  // бетон складу: плями, шви, жовта розмітка
      const v = 40 + hash(x, y) * 8; x2.fillStyle = `rgb(${v},${v + 2},${v + 5})`; x2.fillRect(X, Y, T, T);
      for (let i = 0; i < 22; i++) { const s = hash(x, y, i); x2.fillStyle = `rgba(${s > .5 ? "255,255,255" : "0,0,0"},${.03 + s * .04})`; x2.fillRect(X + hash(x, y, i + 3) * T, Y + hash(x, y, i + 5) * T, 2, 2); }
      if (hash(x, y, 77) > .93) { const gr = x2.createRadialGradient(X + 16, Y + 16, 1, X + 16, Y + 16, 18); gr.addColorStop(0, "rgba(10,10,8,.35)"); gr.addColorStop(1, "rgba(10,10,8,0)"); x2.fillStyle = gr; x2.fillRect(X - 4, Y - 4, T + 8, T + 8); }
      if (x % 4 === 0) { x2.fillStyle = "rgba(0,0,0,.18)"; x2.fillRect(X, Y, 1, T); }
      if (y % 4 === 0) { x2.fillStyle = "rgba(0,0,0,.18)"; x2.fillRect(X, Y, T, 1); }
    } else if (kind === "office") {                    // офісна плитка
      for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) { const v = 52 + hash(x * 2 + i, y * 2 + j) * 7; x2.fillStyle = `rgb(${v},${v + 4},${v + 10})`; x2.fillRect(X + i * 16, Y + j * 16, 16, 16); }
      x2.fillStyle = "rgba(0,0,0,.28)"; x2.fillRect(X, Y, T, 1); x2.fillRect(X, Y, 1, T); x2.fillRect(X + 16, Y, 1, T); x2.fillRect(X, Y + 16, T, 1);
      x2.fillStyle = "rgba(255,255,255,.035)"; x2.fillRect(X + 1, Y + 1, 15, 1);
    } else {                                           // паркет особняка: дошки з текстурою
      for (let i = 0; i < 4; i++) {
        const v = hash(x, y * 4 + i); x2.fillStyle = `rgb(${78 + v * 22},${50 + v * 14},${30 + v * 8})`; x2.fillRect(X, Y + i * 8, T, 8);
        x2.fillStyle = "rgba(0,0,0,.35)"; x2.fillRect(X, Y + i * 8 + 7, T, 1);
        x2.fillRect(X + ((x + i) % 2 ? 10 : 24), Y + i * 8, 1, 8);
        x2.strokeStyle = "rgba(0,0,0,.08)"; x2.beginPath(); x2.moveTo(X, Y + i * 8 + 3 + v * 2); x2.bezierCurveTo(X + 10, Y + i * 8 + 2, X + 22, Y + i * 8 + 5, X + T, Y + i * 8 + 3); x2.stroke();
      }
    }
    // м'яка тінь біля стін (ambient occlusion)
    const ao = (cond, x0, y0, x1, y1) => { if (!cond) return; const gr = x2.createLinearGradient(x0, y0, x1, y1); gr.addColorStop(0, "rgba(0,0,0,.45)"); gr.addColorStop(1, "rgba(0,0,0,0)"); x2.fillStyle = gr; x2.fillRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0) || T, Math.abs(y1 - y0) || T); };
    ao(wall(x, y - 1), X, Y, X, Y + 12); ao(wall(x - 1, y), X, Y, X + 10, Y); ao(wall(x + 1, y), X + T, Y, X + T - 7, Y); ao(wall(x, y + 1), X, Y + T, X, Y + T - 6);
    if (ch === "B") {                                  // дерев'яний ящик з тінню
      x2.fillStyle = "rgba(0,0,0,.4)"; x2.fillRect(X + 5, Y + 6, T - 6, T - 6);
      const gr = x2.createLinearGradient(X, Y, X + T, Y + T); gr.addColorStop(0, "#8a6a40"); gr.addColorStop(1, "#5a4126"); x2.fillStyle = gr; x2.fillRect(X + 2, Y + 2, T - 6, T - 6);
      x2.strokeStyle = "#3d2b17"; x2.lineWidth = 2; x2.strokeRect(X + 3, Y + 3, T - 8, T - 8);
      x2.strokeStyle = "rgba(61,43,23,.8)"; x2.lineWidth = 1.5; x2.beginPath(); x2.moveTo(X + 4, Y + 4); x2.lineTo(X + T - 6, Y + T - 6); x2.moveTo(X + T - 6, Y + 4); x2.lineTo(X + 4, Y + T - 6); x2.stroke();
      x2.fillStyle = "rgba(255,240,200,.12)"; x2.fillRect(X + 3, Y + 3, T - 8, 2); x2.lineWidth = 1;
    }
  }
  // стіни: тінь, «тіло», світла верхня грань
  for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) if (wall(x, y)) {
    const X = x * T, Y = y * T;
    x2.fillStyle = "#1b2027"; x2.fillRect(X, Y, T, T);
    x2.fillStyle = "#2e3641"; x2.fillRect(X + 1, Y + 1, T - 2, T - 6);
    if (!wall(x, y - 1)) { x2.fillStyle = "#4a5565"; x2.fillRect(X, Y, T, 2); }
    if (!wall(x - 1, y)) { x2.fillStyle = "#3d4755"; x2.fillRect(X, Y, 2, T); }
    if (!wall(x, y + 1)) { x2.fillStyle = "#12161b"; x2.fillRect(X, Y + T - 5, T, 5); }
    x2.fillStyle = `rgba(255,255,255,${.015 + hash(x, y, 4) * .02})`; x2.fillRect(X + 4, Y + 6, T - 10, 1);
  }
  return c;
}

function visible(g, e) {
  const p = g.p, d = dist(p, e);
  if (d > VIEW) return false;
  if (d > NEAR && Math.abs(adiff(p.a, angTo(p, e))) > FOV) return false;
  return los(g, p, e);
}
function conePath(g, c, a0, a1, step, max) {
  const p = g.p;
  c.beginPath(); c.moveTo(p.x, p.y);
  for (let a = a0; a <= a1; a += step) { const d = Math.min(max, ray(g, p.x, p.y, p.a + a, max) + 12); c.lineTo(p.x + Math.cos(p.a + a) * d, p.y + Math.sin(p.a + a) * d); }
  c.closePath();
}
function nearPath(g, c) {
  const p = g.p; c.beginPath();
  for (let a = 0; a <= 6.3; a += .07) { const d = ray(g, p.x, p.y, a, NEAR) + 12; c.lineTo(p.x + Math.cos(a) * d, p.y + Math.sin(a) * d); }
  c.closePath();
}

function drawDoor(ctx, g, x, y) {
  const X = x * T, Y = y * T, open = g.doors[x + "," + y], vert = tile(g, x, y - 1) === "#" || tile(g, x, y + 1) === "#";
  ctx.save(); ctx.translate(X + T / 2, Y + T / 2); if (vert) ctx.rotate(Math.PI / 2);
  ctx.fillStyle = "#14181d"; ctx.fillRect(-T / 2, -6, 4, 12); ctx.fillRect(T / 2 - 4, -6, 4, 12);      // одвірки
  if (!open) {
    const gr = ctx.createLinearGradient(0, -5, 0, 5); gr.addColorStop(0, "#9a6f42"); gr.addColorStop(1, "#5e4024");
    ctx.fillStyle = gr; ctx.fillRect(-T / 2 + 4, -4, T - 8, 8); ctx.fillStyle = "#d8b56a"; ctx.fillRect(T / 2 - 10, -1.5, 3, 3);
  } else {
    ctx.fillStyle = "#7a5634"; ctx.save(); ctx.translate(-T / 2 + 4, 0); ctx.rotate(-1.35); ctx.fillRect(0, -3, T - 8, 6); ctx.restore();
  }
  ctx.restore();
}

// людина згори: тінь, ноги (анімація кроку), торс, руки, зброя, голова
const LOOK = {
  me: { torso: "#2f3b33", torso2: "#1e2622", head: "#2b3328", accent: "#c9a24d" },
  mate: { torso: "#2c3a3f", torso2: "#1b2529", head: "#26302f", accent: "#9cc3f0" },
  foe: { torso: "#7c2b26", torso2: "#4a1714", head: "#1c1c1c", accent: "#d4605a" },
  civ: [{ torso: "#3d6d9a", torso2: "#29496a", head: "#5a3b22" }, { torso: "#c9c4b6", torso2: "#8f8a7d", head: "#2b2018" }, { torso: "#3a8a86", torso2: "#245a57", head: "#b58b4c" }],
  host: { torso: "#6c7480", torso2: "#4a5059", head: "#3a2a1e" },
};
function drawPerson(ctx, e, g) {
  const look = e.k === "me" ? LOOK.me : e.k === "mate" ? LOOK.mate : e.k === "foe" ? LOOK.foe : e.k === "host" ? LOOK.host : LOOK.civ[Math.floor(hash(Math.round(e.x), Math.round(e.y)) * 3)];
  if (e.st === "down") {                             // лежить
    ctx.save(); ctx.translate(e.x, e.y); ctx.rotate(e.a + 1.2);
    ctx.fillStyle = look.torso2; ctx.beginPath(); ctx.ellipse(0, 0, 14, 7, 0, 0, 7); ctx.fill();
    ctx.fillStyle = look.head; ctx.beginPath(); ctx.arc(15, 2, 5.5, 0, 7); ctx.fill(); ctx.restore(); return;
  }
  const armed = e.k === "me" || e.k === "mate" || (e.k === "foe" && !["surr", "cuffed"].includes(e.st));
  const walk = Math.sin((e.walk || 0) * .22) * 4, small = e.st === "cower" || e.k === "host";
  ctx.save(); ctx.translate(e.x, e.y);
  ctx.fillStyle = "rgba(0,0,0,.38)"; ctx.beginPath(); ctx.ellipse(3, 4, 13, 10, 0, 0, 7); ctx.fill();          // тінь
  if (e.k === "foe" || e.k === "host" || e.k === "civ") {                                                          // кільце-ідентифікатор
    ctx.strokeStyle = e.k === "foe" ? "rgba(212,96,90,.55)" : e.k === "host" ? "rgba(95,179,122,.6)" : "rgba(156,195,240,.45)";
    ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(0, 0, 15, 0, 7); ctx.stroke();
  }
  ctx.rotate(e.a); if (small) ctx.scale(.85, .85);
  ctx.fillStyle = "#15181c";                                                                                         // ноги
  ctx.beginPath(); ctx.ellipse(walk, -5, 5, 3, 0, 0, 7); ctx.fill(); ctx.beginPath(); ctx.ellipse(-walk, 5, 5, 3, 0, 0, 7); ctx.fill();
  const gr = ctx.createLinearGradient(-8, -10, 8, 10); gr.addColorStop(0, look.torso); gr.addColorStop(1, look.torso2);
  ctx.fillStyle = gr; ctx.strokeStyle = "rgba(0,0,0,.65)"; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.ellipse(0, 0, 8, 12, 0, 0, 7); ctx.fill(); ctx.stroke();                                   // торс
  if (e.k === "me" || e.k === "mate") { ctx.fillStyle = look.accent; ctx.fillRect(-6, -9, 3, 18); }                                   // нашивка «Альфа»
  if (armed) {                                                                                                      // руки й автомат
    ctx.fillStyle = "#101215"; ctx.fillRect(4, -2.5, 22, 5); ctx.fillStyle = "#2a2e34"; ctx.fillRect(6, -1.5, 10, 3);
    ctx.fillStyle = "#3a3f46"; ctx.fillRect(22, -1.5, 5, 3);
    ctx.fillStyle = look.torso; ctx.beginPath(); ctx.arc(8, 6, 3.5, 0, 7); ctx.arc(17, 2.5, 3.2, 0, 7); ctx.fill();
  } else if (e.st === "surr") {                                                                                      // руки вгору
    ctx.fillStyle = "#c99a74"; ctx.beginPath(); ctx.arc(3, -12, 3.2, 0, 7); ctx.arc(3, 12, 3.2, 0, 7); ctx.fill();
  } else if (e.st === "cuffed") {                                                                                    // руки за спиною в кайданках
    ctx.fillStyle = "#c99a74"; ctx.beginPath(); ctx.arc(-9, -4, 3, 0, 7); ctx.arc(-9, 4, 3, 0, 7); ctx.fill();
    ctx.strokeStyle = "#cfd6df"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(-9, -4); ctx.lineTo(-9, 4); ctx.stroke();
  } else {                                                                                                           // руки вздовж тіла
    ctx.fillStyle = look.torso2; ctx.beginPath(); ctx.arc(1, -11, 3, 0, 7); ctx.arc(1, 11, 3, 0, 7); ctx.fill();
  }
  // голова
  ctx.fillStyle = look.head; ctx.strokeStyle = "rgba(0,0,0,.6)"; ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.arc(1, 0, e.k === "me" || e.k === "mate" ? 6.8 : 6, 0, 7); ctx.fill(); ctx.stroke();
  if (e.k === "me" || e.k === "mate") { ctx.fillStyle = look.accent; ctx.fillRect(-2, -1, 7, 2); }                                     // шолом із золотою смугою
  if (e.k === "foe") { ctx.fillStyle = "rgba(212,96,90,.8)"; ctx.fillRect(-1, -6, 2, 12); }                          // балаклава
  if (e.k === "host") { ctx.fillStyle = "#e8e2d4"; ctx.fillRect(3, -6, 2, 12); ctx.strokeStyle = "#b08a52"; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(0, 0, 9, 13, 0, 0, 7); ctx.stroke(); }
  ctx.restore();
  // позначки над головою
  ctx.font = "bold 12px 'Inter', sans-serif"; ctx.textAlign = "center";
  const tag = (t, c) => { ctx.fillStyle = "rgba(0,0,0,.6)"; ctx.beginPath(); ctx.roundRect(e.x - 13, e.y - 32, 26, 15, 4); ctx.fill(); ctx.fillStyle = c; ctx.fillText(t, e.x, e.y - 21); };
  if (e.st === "surr") tag("E ⛓", "#e9d9a8");
  else if (e.st === "cuffed") tag("⛓", "#9aa7b8");
  else if (e.k === "host") tag(e.st === "safe" ? "✔" : "E", e.st === "safe" ? COL.host : "#e9d9a8");
  else if (e.k === "foe" && e.st === "alert") tag("!", COL.foe);
  const nm = e.who && (e.k === "host" || e.k === "mate") ? `${e.who.rankShort} ${e.who.callsign || e.who.name}` : null;
  if (nm) {
    ctx.font = "bold 10px 'Inter', sans-serif"; const w = ctx.measureText(nm).width + 10;
    ctx.fillStyle = "rgba(0,0,0,.65)"; ctx.beginPath(); ctx.roundRect(e.x - w / 2, e.y + 16, w, 14, 4); ctx.fill();
    ctx.fillStyle = e.k === "mate" ? "#9cc3f0" : "#bfe6c9"; ctx.fillText(nm, e.x, e.y + 26);
  }
  if (e.stun > 0) { for (let i = 0; i < 3; i++) { const a = g.t * 5 + i * 2.1; ctx.fillStyle = "#fff6c8"; ctx.fillText("✦", e.x + Math.cos(a) * 11, e.y - 14 + Math.sin(a) * 4); } }
}

// ефекти пострілу: спалах, трасер, гільза, іскри, тремтіння
function fxShot(g, src, a, len, hit, foe) {
  const x1 = src.x + Math.cos(a) * 24, y1 = src.y + Math.sin(a) * 24, x2 = src.x + Math.cos(a) * len, y2 = src.y + Math.sin(a) * len;
  g.shots.push({ x1, y1, x2, y2, t: .07, foe });
  g.fx.push({ k: "muzzle", x: x1, y: y1, a, t: .05 });
  const side = a + Math.PI / 2;
  g.fx.push({ k: "casing", x: src.x + Math.cos(a) * 10, y: src.y + Math.sin(a) * 10, vx: Math.cos(side) * (60 + Math.random() * 40), vy: Math.sin(side) * (60 + Math.random() * 40), r: Math.random() * 6, t: .5 });
  if (!hit) {
    for (let i = 0; i < 5; i++) { const b = a + Math.PI + (Math.random() - .5) * 1.6, s = 60 + Math.random() * 120; g.fx.push({ k: "spark", x: x2, y: y2, vx: Math.cos(b) * s, vy: Math.sin(b) * s, t: .18 + Math.random() * .12 }); }
    g.decals.push({ k: "hole", x: x2 - Math.cos(a) * 2, y: y2 - Math.sin(a) * 2 }); if (g.decals.length > 200) g.decals.shift();
  }
  g.shake = Math.max(g.shake || 0, foe ? 1.5 : 2.6);
}
function blood(g, e) { g.decals.push({ k: "blood", x: e.x, y: e.y, s: Math.random() * 1000 }); }

function draw(g, ctx) {
  const p = g.p;
  if (!g.bg) g.bg = prerender(g);
  if (!g.mem) g.mem = mk(CW, CH);
  ctx.fillStyle = "#07090d"; ctx.fillRect(0, 0, CW, FH);
  ctx.save(); ctx.translate(0, TOP); ctx.beginPath(); ctx.rect(0, 0, CW, CH); ctx.clip();
  ctx.save();
  if (g.shake > .1) ctx.translate((Math.random() - .5) * g.shake * 2, (Math.random() - .5) * g.shake * 2);
  ctx.drawImage(g.bg, 0, 0);
  // сліди: кров, отвори від куль
  for (const d of g.decals) {
    if (d.k === "hole") { ctx.fillStyle = "rgba(0,0,0,.7)"; ctx.beginPath(); ctx.arc(d.x, d.y, 1.6, 0, 7); ctx.fill(); continue; }
    ctx.fillStyle = "rgba(110,14,14,.55)";
    for (let i = 0; i < 6; i++) { ctx.beginPath(); ctx.arc(d.x + (hash(d.s, i) - .5) * 22, d.y + (hash(d.s, i + 7) - .5) * 22, 3 + hash(d.s, i + 3) * 7, 0, 7); ctx.fill(); }
  }
  for (const k in g.doors) { const [x, y] = k.split(",").map(Number); drawDoor(ctx, g, x, y); }
  // пам'ять розвіданого + світло ліхтаря
  const mem = g.mem.getContext("2d");
  mem.fillStyle = "#fff"; conePath(g, mem, -FOV, FOV, .02, VIEW); mem.fill(); nearPath(g, mem); mem.fill();
  const fog = g.fog || (g.fog = mk(CW, CH)), f = fog.getContext("2d");
  f.globalCompositeOperation = "source-over"; f.fillStyle = "rgba(3,5,9,.9)"; f.fillRect(0, 0, CW, CH);
  f.globalCompositeOperation = "destination-out";
  f.globalAlpha = .38; f.drawImage(g.mem, 0, 0); f.globalAlpha = 1;                       // розвідане — ледь видно
  const lg = f.createRadialGradient(p.x, p.y, 20, p.x, p.y, VIEW);
  lg.addColorStop(0, "rgba(0,0,0,1)"); lg.addColorStop(.55, "rgba(0,0,0,.92)"); lg.addColorStop(1, "rgba(0,0,0,.45)");
  f.fillStyle = lg; conePath(g, f, -FOV, FOV, .012, VIEW); f.fill();
  const ng = f.createRadialGradient(p.x, p.y, 10, p.x, p.y, NEAR); ng.addColorStop(0, "rgba(0,0,0,1)"); ng.addColorStop(1, "rgba(0,0,0,.55)");
  f.fillStyle = ng; nearPath(g, f); f.fill();
  ctx.drawImage(fog, 0, 0);
  // теплий відблиск ліхтаря
  ctx.save(); ctx.globalCompositeOperation = "lighter";
  const wg = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, VIEW * .8); wg.addColorStop(0, "rgba(255,236,190,.10)"); wg.addColorStop(1, "rgba(255,236,190,0)");
  ctx.fillStyle = wg; conePath(g, ctx, -FOV, FOV, .03, VIEW); ctx.fill(); ctx.restore();
  // люди
  for (const e of g.ents) if (visible(g, e) || e.st === "safe" || e.st === "cuffed") drawPerson(ctx, e, g);
  if (g.mate) drawPerson(ctx, g.mate, g);
  drawPerson(ctx, { k: "me", x: p.x, y: p.y, a: p.a, st: "me", walk: p.walk }, g);
  // гранати
  for (const n of g.nades) {
    const k = Math.min(1, n.t / .5), x = n.x + (n.tx - n.x) * k, y = n.y + (n.ty - n.y) * k, h = Math.sin(k * Math.PI) * 14;
    ctx.fillStyle = "rgba(0,0,0,.35)"; ctx.beginPath(); ctx.arc(x + 2, y + 3, 4, 0, 7); ctx.fill();
    ctx.fillStyle = "#cfd6df"; ctx.beginPath(); ctx.arc(x, y - h, 4.5, 0, 7); ctx.fill(); ctx.fillStyle = "#c9a24d"; ctx.fillRect(x - 1, y - h - 6, 2, 3);
  }
  // трасери зі світінням
  ctx.save(); ctx.globalCompositeOperation = "lighter"; ctx.lineCap = "round";
  for (const s of g.shots) {
    ctx.strokeStyle = s.foe ? "rgba(255,90,60,.35)" : "rgba(255,210,120,.35)"; ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(s.x1, s.y1); ctx.lineTo(s.x2, s.y2); ctx.stroke();
    ctx.strokeStyle = s.foe ? "#ffb39a" : "#fff1c4"; ctx.lineWidth = 1.6; ctx.stroke();
  }
  for (const fx of g.fx) {
    if (fx.k === "muzzle") {
      const r = 16 * (fx.t / .05), mg = ctx.createRadialGradient(fx.x, fx.y, 0, fx.x, fx.y, r);
      mg.addColorStop(0, "rgba(255,250,220,1)"); mg.addColorStop(.4, "rgba(255,190,90,.8)"); mg.addColorStop(1, "rgba(255,120,40,0)");
      ctx.fillStyle = mg; ctx.beginPath(); ctx.arc(fx.x, fx.y, r, 0, 7); ctx.fill();
    } else if (fx.k === "spark") { ctx.fillStyle = `rgba(255,${180 + Math.random() * 60},90,${fx.t * 4})`; ctx.fillRect(fx.x, fx.y, 2, 2); }
    else if (fx.k === "flash") {
      const k = 1 - fx.t / .5, bg = ctx.createRadialGradient(fx.x, fx.y, 0, fx.x, fx.y, 40 + 180 * k);
      bg.addColorStop(0, `rgba(255,255,245,${1 - k})`); bg.addColorStop(1, "rgba(255,255,245,0)");
      ctx.fillStyle = bg; ctx.beginPath(); ctx.arc(fx.x, fx.y, 40 + 180 * k, 0, 7); ctx.fill();
      ctx.strokeStyle = `rgba(255,255,255,${(1 - k) * .8})`; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(fx.x, fx.y, 175 * k, 0, 7); ctx.stroke();
    }
  }
  ctx.restore();
  for (const fx of g.fx) if (fx.k === "casing") { ctx.save(); ctx.translate(fx.x, fx.y); ctx.rotate(fx.r); ctx.fillStyle = "#d8b56a"; ctx.fillRect(-2.5, -1, 5, 2); ctx.restore(); }
  // написи
  ctx.font = "bold 12px 'Inter', sans-serif"; ctx.textAlign = "center";
  for (const m of g.msgs) { ctx.globalAlpha = Math.min(1, m.t); ctx.fillStyle = "rgba(0,0,0,.75)"; ctx.fillText(m.text, m.x + 1, m.y + 1); ctx.fillStyle = m.col; ctx.fillText(m.text, m.x, m.y); }
  ctx.globalAlpha = 1;
  ctx.restore();
  // віньєтка
  const vg = ctx.createRadialGradient(CW / 2, CH / 2, CH * .35, CW / 2, CH / 2, CW * .7); vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(1, "rgba(0,0,0,.55)");
  ctx.fillStyle = vg; ctx.fillRect(0, 0, CW, CH);
  if (g.tipNow) {                                   // правова довідка під час операції
    const tp = g.tipNow, a = Math.min(1, tp.t);
    ctx.globalAlpha = a; ctx.font = "13px 'Inter', sans-serif";
    const lines = [], words = tp.text.split(" "); let ln = "";
    for (const w of words) { if (ctx.measureText(ln + " " + w).width > 380) { lines.push(ln); ln = w; } else ln = ln ? ln + " " + w : w; }
    lines.push(ln);
    const h = 30 + lines.length * 17;
    ctx.fillStyle = "rgba(8,11,16,.88)"; ctx.strokeStyle = "rgba(201,162,77,.6)"; ctx.beginPath(); ctx.roundRect(12, CH - h - 12, 410, h, 6); ctx.fill(); ctx.stroke();
    ctx.fillStyle = COL.gold; ctx.font = "bold 12px 'Inter', sans-serif"; ctx.textAlign = "left"; ctx.fillText("📖 " + tp.law, 24, CH - h + 8);
    ctx.fillStyle = "#e9e4d6"; ctx.font = "13px 'Inter', sans-serif"; lines.forEach((l, n) => ctx.fillText(l, 24, CH - h + 27 + n * 17));
    ctx.globalAlpha = 1;
  }
  // приціл: розкид залежить від руху
  const moving = g.keys.KeyW || g.keys.KeyA || g.keys.KeyS || g.keys.KeyD, sp = moving ? 13 : 7;
  ctx.strokeStyle = COL.gold; ctx.lineWidth = 1.6; ctx.shadowColor = "rgba(201,162,77,.8)"; ctx.shadowBlur = 6;
  ctx.beginPath();
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { ctx.moveTo(g.mx + dx * sp, g.my + dy * sp); ctx.lineTo(g.mx + dx * (sp + 8), g.my + dy * (sp + 8)); }
  ctx.stroke(); ctx.fillStyle = COL.gold; ctx.fillRect(g.mx - 1, g.my - 1, 2, 2); ctx.shadowBlur = 0;
  if (g.fx.some((f) => f.k === "hurt")) { const hg = ctx.createRadialGradient(CW / 2, CH / 2, CH * .3, CW / 2, CH / 2, CW * .65); hg.addColorStop(0, "rgba(180,20,20,0)"); hg.addColorStop(1, "rgba(180,20,20,.55)"); ctx.fillStyle = hg; ctx.fillRect(0, 0, CW, CH); }
  if (p.blind > 0) { ctx.fillStyle = `rgba(255,255,250,${Math.min(1, p.blind)})`; ctx.fillRect(0, 0, CW, CH); }
  ctx.restore();
  hud(g, ctx);
}

function panel(ctx, x, y, w, h) {
  ctx.fillStyle = "rgba(8,11,16,.78)"; ctx.strokeStyle = "rgba(201,162,77,.35)"; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.roundRect(x, y, w, h, 6); ctx.fill(); ctx.stroke();
}
function hud(g, ctx) {
  const p = g.p, foes = g.ents.filter((e) => e.k === "foe"), hosts = g.ents.filter((e) => e.k === "host");
  const left = foes.filter((e) => !["down", "cuffed"].includes(e.st)).length, safe = hosts.filter((e) => e.st === "safe").length;
  const bar = (y, h) => { const gr = ctx.createLinearGradient(0, y, 0, y + h); gr.addColorStop(0, "#0f131a"); gr.addColorStop(1, "#0a0d12"); ctx.fillStyle = gr; ctx.fillRect(0, y, CW, h); ctx.fillStyle = "rgba(201,162,77,.45)"; ctx.fillRect(0, y === 0 ? h - 1 : y, CW, 1); };
  bar(0, TOP); bar(TOP + CH, BOT);
  // верх: операція · час · цілі
  ctx.textAlign = "left"; ctx.fillStyle = COL.gold; ctx.font = "bold 10px 'Inter', sans-serif"; ctx.fillText("ЦСО «АЛЬФА» · ТАКТИЧНИЙ ТРЕНАЖЕР", 16, 19);
  ctx.fillStyle = "#ece6d6"; ctx.font = "bold 16px 'Inter', sans-serif"; ctx.fillText(g.L.name, 16, 39);
  ctx.textAlign = "center"; ctx.font = "bold 20px 'JetBrains Mono', monospace"; ctx.fillStyle = "#ece6d6";
  ctx.fillText(`${Math.floor(g.t / 60)}:${String(Math.floor(g.t % 60)).padStart(2, "0")}`, CW / 2, 33);
  const chip = (x, txt, col) => { ctx.font = "bold 13px 'Inter', sans-serif"; const w = ctx.measureText(txt).width + 26; ctx.fillStyle = "rgba(255,255,255,.05)"; ctx.strokeStyle = col; ctx.beginPath(); ctx.roundRect(x - w, 12, w, 26, 13); ctx.fill(); ctx.stroke(); ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x - w + 12, 25, 4, 0, 7); ctx.fill(); ctx.fillStyle = "#ece6d6"; ctx.textAlign = "left"; ctx.fillText(txt, x - w + 20, 30); return x - w - 8; };
  const cx2 = chip(chip(CW - 14, `Заручники ${safe}/${hosts.length}`, COL.host), `Озброєні ${left}`, COL.foe);
  if (g.mate) chip(cx2, `Напарник ${g.mate.who.callsign || g.mate.who.name}${g.mate.st === "down" ? " ✚" : ""}`, g.mate.st === "down" ? COL.foe : "#9cc3f0");
  // низ: стан · набої · гранати · підказки · міні-карта
  const y0 = TOP + CH;
  ctx.textAlign = "left"; ctx.fillStyle = COL.gold; ctx.font = "bold 10px 'Inter', sans-serif"; const me = (st.people || {}).me; ctx.fillText(me ? `${(me.callsign || me.name).toUpperCase()} · ${me.rankShort} · №${me.sid}` : "АЛЬФА-1 · СТАН", 16, y0 + 20);
  for (let i = 0; i < 10; i++) { ctx.fillStyle = p.hp > i * 10 ? (p.hp > 40 ? "#5fb37a" : "#d4605a") : "rgba(255,255,255,.07)"; ctx.fillRect(16 + i * 14, y0 + 28, 12, 18); }
  ctx.fillStyle = COL.gold; ctx.fillText("НАБОЇ", 180, y0 + 20);
  for (let i = 0; i < 30; i++) { ctx.fillStyle = i < p.mag ? "#e9d9a8" : "rgba(255,255,255,.07)"; ctx.fillRect(180 + i * 5, y0 + 28, 3, 18); }
  ctx.fillStyle = "#ece6d6"; ctx.font = "bold 14px 'JetBrains Mono', monospace"; ctx.fillText(p.reload > 0 ? "RELOAD" : `${p.mag}/${p.ammo}`, 334, y0 + 43);
  ctx.fillStyle = COL.gold; ctx.font = "bold 10px 'Inter', sans-serif"; ctx.fillText("СВІТЛОШУМОВІ", 420, y0 + 20);
  for (let i = 0; i < 3; i++) { ctx.globalAlpha = i < p.flash ? 1 : .15; ctx.fillStyle = "#cfd6df"; ctx.beginPath(); ctx.arc(428 + i * 20, y0 + 37, 7, 0, 7); ctx.fill(); ctx.fillStyle = COL.gold; ctx.fillRect(426 + i * 20, y0 + 26, 4, 5); }
  ctx.globalAlpha = 1;
  ctx.fillStyle = "#8a93a3"; ctx.font = "12px 'Inter', sans-serif";
  ctx.fillText("E двері · кайданки · заручник     F «Руки вгору!»", 510, y0 + 27);
  ctx.fillText("G світлошумова     R перезарядка     Shift тихо     Esc пауза", 510, y0 + 45);
  // міні-карта розвіданого
  const mw = 88, mh = 55, mx = CW - mw - 14, my = y0 + 6;
  ctx.drawImage(g.bg, mx, my, mw, mh);
  const mm = g.mmask || (g.mmask = mk(mw, mh)), m2 = mm.getContext("2d");
  m2.globalCompositeOperation = "source-over"; m2.fillStyle = "#07090d"; m2.fillRect(0, 0, mw, mh);
  m2.globalCompositeOperation = "destination-out"; m2.drawImage(g.mem, 0, 0, mw, mh);
  ctx.drawImage(mm, mx, my); ctx.strokeStyle = "rgba(201,162,77,.5)"; ctx.strokeRect(mx - .5, my - .5, mw + 1, mh + 1);
  ctx.fillStyle = COL.gold; ctx.beginPath(); ctx.arc(mx + p.x / CW * mw, my + p.y / CH * mh, 2.5, 0, 7); ctx.fill();
}

// ---------------------------------------------------------------- підсумок
function score(g, ok) {
  const s = g.stats, acc = s.fired ? s.hits / s.fired : 1;
  if (!ok) return { total: 0, acc };
  const parts = [["Затримано без вогню", s.arrests * 320], ["Нейтралізовано", s.kills * 140], ["Звільнено заручників", s.hostages * 260],
    ["Поранено цивільних / тих, хто здався", -s.civHit * 650], ["Поранено заручників", -s.hostHit * 900], ["Напарника поранено", s.partnerHit ? -400 : 0],
    ["Час", Math.max(0, Math.round((240 - g.t) * 3))], ["Влучність", Math.round(acc * 300)], ["Стан оперативника", Math.max(0, g.p.hp) * 2]];
  return { total: Math.max(0, parts.reduce((a, [, v]) => a + v, 0)), parts, acc };
}
function finish(g, ok, why) {
  g.over = { ok, why, sc: score(g, ok) };
  g.down = false;
  const r = g.over.sc.total, grade = !ok ? "—" : g.stats.civHit || g.stats.hostHit ? "C" : r > 2600 + g.i * 900 ? "S" : r > 1900 + g.i * 700 ? "A" : "B";
  g.over.grade = grade;
  if (ok) call("/api/game/score", { json: { game: "assault", level: g.i, score: r, ms: Math.round(g.t * 1000),
    data: { ...g.stats, grade, rescued: g.rescued, partner: g.mate ? g.mate.who.sid : null } } })
    .then((x) => { st.best[g.i] = Math.max(st.best[g.i] || 0, r); if (x && x.record) toast("Новий особистий рекорд!"); }).catch(() => {});
  const box = document.getElementById("gm-over");
  if (!box) return;
  const s = g.stats, sc = g.over.sc;
  box.innerHTML = `<div class="gm-card ${ok ? "ok" : "bad"}"><div class="eyebrow">Рапорт про операцію · ${esc(g.L.name)}</div>
    <h3>${ok ? "Операцію завершено" : "Операцію зірвано"}</h3>${why ? `<p class="muted">${esc(why)}</p>` : ""}
    ${ok ? `<div class="gm-grade g-${grade}">${grade}</div><table class="gm-t">${sc.parts.map(([n, v]) => `<tr><td>${esc(n)}</td><td class="${v < 0 ? "bad" : ""}">${v > 0 ? "+" : ""}${v}</td></tr>`).join("")}
      <tr class="sum"><td>Разом</td><td>${sc.total}</td></tr></table>` : ""}
    <ul class="gm-notes">
      ${s.arrests ? `<li class="ok">Затримано без вогню: ${s.arrests} — дотримано стадій застосування сили (ст. 35 ПК).</li>` : ""}
      ${s.civHit ? `<li class="bad">Поранено цивільних або тих, хто здався: ${s.civHit} — порушення ст. 37 ПК, ВВБ відкриє перевірку.</li>` : ""}
      ${s.hostHit ? `<li class="bad">Поранено заручників: ${s.hostHit}.</li>` : ""}
      <li>Влучність: ${Math.round(sc.acc * 100)}% · пострілів ${s.fired} · час ${g.t.toFixed(1)} с</li>
      ${g.mate ? `<li>Напарник: ${esc(g.mate.who.rankShort)} ${esc(g.mate.who.name)} (${esc(g.mate.who.deptS)})${s.partnerHit ? " — поранений" : " — без втрат"}</li>` : ""}
      ${g.ents.some((e) => e.k === "host" && e.who && e.st === "safe") ? `<li class="ok">Врятовано колег: ${g.ents.filter((e) => e.k === "host" && e.who && e.st === "safe").map((e) => esc(e.who.rankShort + " " + e.who.name + " (" + e.who.deptS + ")")).join(", ")}</li>` : ""}</ul>
    ${ok ? `<div class="gm-law"><b>📖 Правова кваліфікація</b>
      <div>Затриманим інкримінується: ${(LAW.charges[g.L.law] || []).map(([a, t]) => `<span><i>${a}</i> ${esc(t)}</span>`).join("")}</div>
      <div>Застава заборонена (ст. 16.1 ПК: зброя, захоплення заручників). Далі: протокол затримання (ст. 40–41 ПК), відео з боді-камери (ст. 12 ПК), матеріали — до кейс-файлу ОРВ.</div></div>` : ""}
    <div class="acts"><button class="btn" data-a="gmmenu">До меню</button><button class="btn gold" data-a="gmplay" data-l="${g.i}">Ще раз</button>
      ${ok && g.i < 2 ? `<button class="btn ok" data-a="gmplay" data-l="${g.i + 1}">Наступна операція →</button>` : ""}</div></div>`;
  box.hidden = false;
}

// ---------------------------------------------------------------- цикл і керування
function stop() {
  cancelAnimationFrame(st.raf); st.raf = 0;
  window.removeEventListener("keydown", onKey); window.removeEventListener("keyup", onKey);
  st.g = null;
}
function onKey(e) {
  const g = st.g;
  if (!g || !document.getElementById("gm-canvas")) return stop();
  if (["KeyW", "KeyA", "KeyS", "KeyD", "Space", "KeyG", "KeyF", "KeyE", "KeyR"].includes(e.code) && !/INPUT|TEXTAREA/.test(document.activeElement.tagName)) e.preventDefault();
  const down = e.type === "keydown";
  g.keys[e.code] = down;
  if (!down || e.repeat || g.over) return;
  if (g.brief) return;
  if (e.code === "Escape") { g.paused = !g.paused; return; }
  if (g.paused) return;
  if (e.code === "KeyR") reload(g);
  if (e.code === "KeyE") interact(g);
  if (e.code === "KeyF") shout(g);
  if (e.code === "KeyG") throwFlash(g);
}
function start(i) {
  stop();
  const cv = document.getElementById("gm-canvas");
  if (!cv) return;
  const ctx = cv.getContext("2d"), g = st.g = build(i);
  g.paused = true; g.brief = true;
  const box = document.getElementById("gm-over");
  box.innerHTML = `<div class="gm-card gm-brief"><div class="eyebrow">Брифінг · ЦСО «Альфа»</div><h3>${esc(g.L.name)}</h3><p>${esc(g.L.brief)}</p>
    ${g.mate ? `<p>Напарник: <b>${esc(g.mate.who.rankShort)} ${esc(g.mate.who.name)}</b> (${esc(g.mate.who.deptS)}) — іде за вами, стріляє лише у відповідь на збройний опір, одягає кайданки тим, хто здався.</p>` : ""}
    ${g.ents.some((e) => e.who) ? `<p>Заручники — наші колеги: ${g.ents.filter((e) => e.who).map((e) => `<b>${esc(e.who.rankShort)} ${esc(e.who.name)}</b>`).join(", ")}.</p>` : ""}
    <div class="gm-law"><b>📖 Правова підстава</b>${LAW.base.map(([a, t]) => `<span><i>${a}</i> ${esc(t)}</span>`).join("")}</div>
    <div class="acts"><button class="btn" data-a="gmmenu">Скасувати</button><button class="btn gold" data-a="gmgo">Почати операцію ▶</button></div></div>`;
  box.hidden = false;
  const pos = (e) => { const r = cv.getBoundingClientRect(); g.mx = (e.clientX - r.left) * CW / r.width; g.my = (e.clientY - r.top) * FH / r.height - TOP; };
  cv.onmousemove = pos;
  cv.onmousedown = (e) => { pos(e); if (e.button === 0 && !g.over && !g.paused) { g.down = true; shoot(g); } };
  window.onmouseup = () => { if (st.g) st.g.down = false; };
  cv.oncontextmenu = (e) => e.preventDefault();
  window.addEventListener("keydown", onKey); window.addEventListener("keyup", onKey);
  let last = performance.now();
  const loop = (now) => {
    if (!document.getElementById("gm-canvas")) return stop();
    const dt = Math.min(.05, (now - last) / 1000); last = now;
    if (!g.paused) update(g, dt);
    draw(g, ctx);
    if (g.paused && !g.brief) { ctx.fillStyle = "rgba(0,0,0,.6)"; ctx.fillRect(0, 0, CW, FH); ctx.fillStyle = COL.gold; ctx.font = "bold 28px 'Inter', sans-serif"; ctx.textAlign = "center"; ctx.fillText("ПАУЗА · Esc", CW / 2, FH / 2); }
    st.raf = requestAnimationFrame(loop);
  };
  st.raf = requestAnimationFrame(loop);
  cv.focus({ preventScroll: true });
  document.querySelector(".gm-wrap").scrollIntoView({ block: "start", behavior: "smooth" });
}

// ---------------------------------------------------------------- сторінка
async function view() {
  stop();
  const [b, ppl] = await Promise.all([call("/api/game/assault").catch(() => ({ mine: {}, week: [], all: [], weekly: [], depts: [], badges: [], rescues: [] })),
    st.people ? Promise.resolve(st.people) : call("/api/game/people").catch(() => null)]);
  st.board = b; st.best = b.mine || {}; st.people = ppl;
  if (st.lvl !== null) {
    const L = st.lvl === 3 ? weekly() : LEVELS[st.lvl];
    setTimeout(() => start(st.lvl), 30);
    return `<div class="gm-bar"><button class="btn" data-a="gmmenu">← Операції</button><b>${esc(L.name)}</b><span class="muted small">${esc(L.brief)}</span>
        <span class="sp"></span><button class="btn" data-a="gmfs">⛶ На весь екран</button></div>
      <div class="gm-wrap"><canvas id="gm-canvas" width="${CW}" height="${FH}" tabindex="0"></canvas><div class="gm-over" id="gm-over" hidden></div></div>
      <p class="muted small">Порада: зайдіть з флангу й крикніть «Руки вгору!» (F) — затримання без пострілу дає найбільше балів. Світлошумова (G) оглушує й майже гарантує здачу.</p>`;
  }
  const me = S.ME().me;
  const lb = (rows) => rows.length ? `<ol class="gm-lb">${rows.map((r, n) => `<li class="${r.sid === me.sid ? "me" : ""}"><b>${n + 1}</b><span>${esc(r.rankShort || "")} ${esc(r.name)} <i class="muted">${esc(r.deptS || "")}</i></span><em>${r.score}</em></li>`).join("")}</ol>` : '<p class="muted small">Ще ніхто не пройшов.</p>';
  const dl = (rows) => rows.length ? `<ol class="gm-lb">${rows.map((r, n) => `<li class="${r.dept === me.dept ? "me" : ""}"><b>${n + 1}</b><span>${esc(r.n)} <i class="muted">учасників: ${r.players}</i></span><em>${r.avg}</em></li>`).join("")}</ol>` : '<p class="muted small">Ще немає результатів.</p>';
  const team = (ppl && ppl.team) || [];
  return `<div class="gm-hero"><div><div class="eyebrow">Тренажер ЦСО «Альфа» · ЄІС «Сова»</div><h2>ШТУРМ</h2>
      <p>Тактичний штурм будівлі з видом згори. Ви бачите лише те, що в полі зору. Спершу — <b>вимога здатися</b>, вогонь — лише по озброєних. Заручники — <b>наші колеги</b> зі складу СБУ.</p>
      <div class="gm-keys"><span><b>WASD</b> рух</span><span><b>Shift</b> тихо</span><span><b>ЛКМ</b> вогонь</span><span><b>R</b> перезарядка</span><span><b>E</b> двері · кайданки · заручник</span><span><b>F</b> «Руки вгору!»</span><span><b>G</b> світлошумова</span><span><b>Esc</b> пауза</span></div>
      <label class="gm-mate">🤝 Напарник: <select class="i" id="gm-mate"><option value="">— без напарника —</option>${team.map((t) => `<option value="${t.sid}" ${st.mate && st.mate.sid === t.sid ? "selected" : ""}>${esc(t.rankShort)} ${esc(t.callsign || t.name)} · ${esc(t.deptS)}</option>`).join("")}</select></label>
      ${(b.badges || []).length ? `<div class="gm-badges">${b.badges.map((x) => `<span title="${esc(x.t)}">${x.icon} ${esc(x.t)}</span>`).join("")}</div>` : ""}
      <p class="muted small">Результати не впливають на бали підвищення й премії. Потрібні клавіатура й миша.</p></div>
      <div class="gm-legend"><span class="c-me">●</span><i>ви</i><span style="color:#9cc3f0">●</span><i>напарник</i><span class="c-foe">●</span><i>озброєний</i><span class="c-civ">●</span><i>цивільний</i><span class="c-host">●</span><i>заручник</i></div></div>
    ${(b.rescues || []).length ? `<div class="note">🛡 Вас урятували у «Штурмі»: ${b.rescues.map((r) => `<b>${esc(r.rankShort)} ${esc(r.name)}</b>`).join(", ")}.</div>` : ""}
    <div class="gm-levels">${LEVELS.map((L, i) => `<button class="gm-lvl" data-a="gmplay" data-l="${i}"><span class="eyebrow">Операція ${i + 1} · ${["легка", "середня", "складна"][i]}</span><b>${esc(L.name)}</b><p>${esc(L.brief)}</p>
      <span class="gm-best">Ваш рекорд: <b>${st.best[i] || "—"}</b></span></button>`).join("")}
      <button class="gm-lvl gm-weekly" data-a="gmplay" data-l="3"><span class="eyebrow">⚡ Операція тижня · нова розстановка</span><b>${esc(weekly().name)}</b><p>Однакова для всіх цього тижня. Більше озброєних, окремий рейтинг.</p>
      <span class="gm-best">Ваш результат тижня: <b>${st.best[3] || "—"}</b></span></button></div>
    <div class="grid2"><div class="card"><header><h3>🏆 Рейтинг тижня</h3><span class="muted small">сума найкращих результатів</span></header>${lb(b.week || [])}</div>
      <div class="card"><header><h3>🛡 Підрозділ тижня</h3><span class="muted small">середній результат учасників</span></header>${dl(b.depts || [])}</div>
      <div class="card"><header><h3>⚡ Операція тижня</h3></header>${lb(b.weekly || [])}</div>
      <div class="card"><header><h3>⭐ Найкращі за весь час</h3></header>${lb(b.all || [])}</div></div>
    <div class="card gm-law-card"><header><h3>📖 Довідка оперативника</h3><span class="muted small">законодавча база NG</span></header>
      <div class="gm-law">${LAW.base.map(([a, t]) => `<span><i>${a}</i> ${esc(t)}</span>`).join("")}<span><i>ст. 16.1 ПК</i> Застава заборонена: зброя, захоплення заручників, тероризм, НЗФ</span><span><i>ст. 40–41 ПК</i> Протокол затримання: дата, місце, учасники, підстава, вилучене</span></div></div>`;
}
S.views.game = view;
Object.assign(S.actions, {
  gmplay: (b) => {
    const sel = document.getElementById("gm-mate");
    if (sel) st.mate = ((st.people || {}).team || []).find((t) => String(t.sid) === sel.value) || null;
    st.lvl = +b.dataset.l; S.render();
  },
  gmgo: () => { const g = st.g; if (!g) return; g.paused = false; g.brief = false; document.getElementById("gm-over").hidden = true; document.getElementById("gm-canvas").focus({ preventScroll: true }); },
  gmfs: () => { const w = document.querySelector(".gm-wrap"); if (!w) return; if (document.fullscreenElement) document.exitFullscreen(); else w.requestFullscreen && w.requestFullscreen(); },
  gmmenu: () => { stop(); st.lvl = null; S.render(); },
});
})();
