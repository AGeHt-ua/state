/* «Штурм» — тактичний тренажер ЦСО «Альфа» (вид згори, Canvas).
   Видно лише те, що в полі зору оперативника. Стадії сили (ст. 35 ПК): спершу вимога здатися (F), зброя — лише проти озброєних (ст. 37).
   Затриманий без пострілу — більше балів; поранений цивільний чи заручник — великий штраф. Рейтинг — у ЄІС «Сова». */
(() => {
const S = window.SOVA;
const { esc, call, toast } = S;
const T = 32, GW = 32, GH = 20, CW = GW * T, CH = GH * T;
const FOV = 58 * Math.PI / 180, VIEW = 520, NEAR = 72;

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

const st = { lvl: null, g: null, raf: 0, best: {}, board: null };

// ---------------------------------------------------------------- світ
function build(i) {
  const L = LEVELS[i], g = { i, L, grid: L.map.map((r) => r.split("")), doors: {}, ents: [], shots: [], fx: [], nades: [], msgs: [], t: 0,
    stats: { fired: 0, hits: 0, kills: 0, arrests: 0, hostages: 0, civHit: 0, hostHit: 0, shoutOk: 0 }, over: null, keys: {}, mx: CW / 2, my: CH / 2, down: false };
  g.grid.forEach((row, y) => row.forEach((c, x) => {
    const cx = x * T + T / 2, cy = y * T + T / 2;
    if (c === "P") { g.p = { x: cx, y: cy, a: 0, hp: 100, mag: 30, ammo: 90, flash: L.flash, reload: 0, cd: 0, shout: 0, blind: 0 }; row[x] = "."; }
    if (c === "E") { g.ents.push({ k: "foe", x: cx, y: cy, a: Math.random() * 6.28, hp: 100, st: "idle", seen: 0, cd: 0, stun: 0, last: null, sweep: (Math.random() - .5) * .6 }); row[x] = "."; }
    if (c === "C") { g.ents.push({ k: "civ", x: cx, y: cy, a: Math.random() * 6.28, st: "idle", stun: 0 }); row[x] = "."; }
    if (c === "H") { g.ents.push({ k: "host", x: cx, y: cy, a: 0, st: "tied", stun: 0 }); row[x] = "."; }
    if (c === "D") g.doors[x + "," + y] = false;
  }));
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
  g.shots.push({ x1: p.x + dx * 14, y1: p.y + dy * 14, x2: p.x + dx * hd, y2: p.y + dy * hd, t: .08 });
  noise(g, p.x, p.y, 430);
  if (!hit) return;
  g.stats.hits++;
  if (hit.k === "foe") {
    if (hit.st === "surr" || hit.st === "cuffed") { g.stats.civHit++; say(g, hit.x, hit.y - 18, "Вогонь по тому, хто здався! (ст. 365 КК)", "#d4605a"); }
    hit.hp -= 55;
    if (hit.hp <= 0) { hit.st = "down"; g.stats.kills++; say(g, hit.x, hit.y - 18, "Нейтралізовано", "#e9d9a8"); }
    else { hit.st = "alert"; hit.last = { x: p.x, y: p.y }; }
  } else if (hit.k === "civ") { hit.st = "down"; g.stats.civHit++; say(g, hit.x, hit.y - 18, "Поранено цивільного! ст. 37 ПК", "#d4605a"); }
  else if (hit.k === "host") { hit.st = "down"; g.stats.hostHit++; say(g, hit.x, hit.y - 18, "Поранено заручника!", "#d4605a"); }
}
function reload(g) { const p = g.p; if (p.reload > 0 || p.mag === 30 || p.ammo <= 0) return; p.reload = 1.5; say(g, p.x, p.y - 20, "Перезаряджаю"); }
function interact(g) {
  const p = g.p;
  // двері
  const tx = Math.floor(p.x / T), ty = Math.floor(p.y / T);
  for (let y = ty - 1; y <= ty + 1; y++) for (let x = tx - 1; x <= tx + 1; x++) {
    const k = x + "," + y;
    if (k in g.doors && Math.hypot(x * T + T / 2 - p.x, y * T + T / 2 - p.y) < 46) { g.doors[k] = !g.doors[k]; return; }
  }
  for (const e of g.ents) {
    if (dist(e, p) > 34) continue;
    if (e.k === "foe" && e.st === "surr") { e.st = "cuffed"; g.stats.arrests++; say(g, e.x, e.y - 18, "Затримано · кайданки", "#5fb37a"); return; }
    if (e.k === "host" && e.st === "tied") { e.st = "safe"; g.stats.hostages++; say(g, e.x, e.y - 18, "Заручника звільнено", "#5fb37a"); return; }
  }
}
function shout(g) {
  const p = g.p;
  if (p.shout > 0) return;
  p.shout = 1.4;
  say(g, p.x, p.y - 22, "СБУ! Зброю на землю! Руки вгору!", "#9cc3f0");
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
  p.flash--;
  const a = angTo(p, { x: g.mx, y: g.my }), want = Math.min(260, Math.hypot(g.mx - p.x, g.my - p.y));
  const d = Math.max(10, Math.min(want, ray(g, p.x, p.y, a, want) - 8));
  g.nades.push({ x: p.x, y: p.y, tx: p.x + Math.cos(a) * d, ty: p.y + Math.sin(a) * d, t: 0 });
}
function explode(g, n) {
  g.fx.push({ k: "flash", x: n.tx, y: n.ty, t: .5 });
  const pt = { x: n.tx, y: n.ty };
  for (const e of g.ents) if (e.st !== "down" && e.st !== "cuffed" && dist(e, pt) < 175 && los(g, pt, e)) { if (e.k === "foe" && e.st !== "surr") e.st = "stun"; e.stun = 3.6; }
  if (dist(g.p, pt) < 130 && los(g, pt, g.p) && Math.abs(adiff(g.p.a, angTo(g.p, pt))) < 1.2) g.p.blind = 1.6;
  noise(g, n.tx, n.ty, 500);
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
  for (const key of ["cd", "shout", "blind"]) p[key] = Math.max(0, p[key] - dt);
  if (p.reload > 0) { p.reload -= dt; if (p.reload <= 0) { const n = Math.min(30 - p.mag, p.ammo); p.mag += n; p.ammo -= n; } }
  if (g.down) shoot(g);

  for (const e of g.ents) {
    if (e.stun > 0) { e.stun -= dt; if (e.stun <= 0 && e.k === "foe" && e.st === "stun") { e.st = "alert"; e.last = { x: p.x, y: p.y }; } continue; }
    if (e.k !== "foe" || ["down", "cuffed", "surr"].includes(e.st)) continue;
    const d = dist(e, p), toP = angTo(e, p);
    const sees = d < 470 && (e.st === "alert" || Math.abs(adiff(e.a, toP)) < FOV) && los(g, e, p);
    if (sees) {
      e.st = "alert"; e.last = { x: p.x, y: p.y };
      e.a += Math.max(-4 * dt, Math.min(4 * dt, adiff(e.a, toP)));
      e.seen += dt; e.cd -= dt;
      if (e.seen > g.L.react / 1000 && e.cd <= 0 && Math.abs(adiff(e.a, toP)) < .25) {
        e.cd = .7 + Math.random() * .35;
        const still = !(k.KeyW || k.KeyA || k.KeyS || k.KeyD);
        const chance = Math.max(.12, .62 - d / 1100 + (still ? .12 : 0));
        const miss = Math.random() > chance;
        const aa = toP + (miss ? (Math.random() - .5) * .35 : 0), hd = miss ? ray(g, e.x, e.y, aa, 700) : d;
        g.shots.push({ x1: e.x, y1: e.y, x2: e.x + Math.cos(aa) * hd, y2: e.y + Math.sin(aa) * hd, t: .08, foe: true });
        if (!miss) { p.hp -= 18; g.fx.push({ k: "hurt", t: .25 }); }
        noise(g, e.x, e.y, 300);
      }
    } else {
      e.seen = Math.max(0, e.seen - dt * .5);
      if (e.st === "alert" && e.last) {
        const la = angTo(e, e.last);
        e.a += Math.max(-2.5 * dt, Math.min(2.5 * dt, adiff(e.a, la)));
        if (dist(e, e.last) > 40) move(g, e, Math.cos(la) * 55 * dt, Math.sin(la) * 55 * dt);
      } else e.a += Math.sin(g.t * .7 + e.x) * e.sweep * dt;  // огляд на посту
    }
  }
  for (const s of g.shots) s.t -= dt;
  g.shots = g.shots.filter((s) => s.t > 0);
  for (const f of g.fx) f.t -= dt;
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

// ---------------------------------------------------------------- малювання
const COL = { floor: "#141922", carpet: "#1d1a22", wall: "#2b333f", wallTop: "#3a4555", door: "#8a6038", gold: "#c9a24d", foe: "#d4605a", civ: "#9cc3f0", host: "#5fb37a" };
function visible(g, e) {
  const p = g.p, d = dist(p, e);
  if (d > VIEW) return false;
  if (d > NEAR && Math.abs(adiff(p.a, angTo(p, e))) > FOV) return false;
  return los(g, p, e);
}
function draw(g, ctx) {
  const p = g.p;
  // підлога, стіни, двері
  for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
    const c = g.grid[y][x], X = x * T, Y = y * T;
    ctx.fillStyle = c === "," ? COL.carpet : COL.floor; ctx.fillRect(X, Y, T, T);
    if (c === "#") { ctx.fillStyle = COL.wall; ctx.fillRect(X, Y, T, T); ctx.fillStyle = COL.wallTop; ctx.fillRect(X, Y, T, 5); }
    else if (c === "B") { ctx.fillStyle = "#4a3a26"; ctx.fillRect(X + 2, Y + 2, T - 4, T - 4); ctx.strokeStyle = "#6b5233"; ctx.strokeRect(X + 5, Y + 5, T - 10, T - 10); }
    else if (c === "D") {
      const open = g.doors[x + "," + y], vert = tile(g, x, y - 1) === "#" || tile(g, x, y + 1) === "#";
      ctx.fillStyle = COL.door;
      if (!open) ctx.fillRect(vert ? X + 11 : X, vert ? Y : Y + 11, vert ? 10 : T, vert ? T : 10);
      else ctx.fillRect(vert ? X + 11 : X, vert ? Y : Y + 11, vert ? 10 : 6, vert ? 6 : 10);
    } else { ctx.strokeStyle = "rgba(255,255,255,.025)"; ctx.strokeRect(X + .5, Y + .5, T, T); }
  }
  // туман: усе поза полем зору — темне (план приміщень лишається ледь видимим)
  const fog = g.fog || (g.fog = Object.assign(document.createElement("canvas"), { width: CW, height: CH }));
  const f = fog.getContext("2d");
  f.globalCompositeOperation = "source-over"; f.fillStyle = "rgba(5,7,11,.86)"; f.fillRect(0, 0, CW, CH);
  f.globalCompositeOperation = "destination-out";
  f.beginPath(); f.moveTo(p.x, p.y);
  for (let a = -FOV; a <= FOV; a += .012) { const d = ray(g, p.x, p.y, p.a + a, VIEW); f.lineTo(p.x + Math.cos(p.a + a) * d, p.y + Math.sin(p.a + a) * d); }
  f.closePath(); f.fill();
  f.beginPath();
  for (let a = 0; a <= 6.3; a += .08) { const d = ray(g, p.x, p.y, a, NEAR); f.lineTo(p.x + Math.cos(a) * d, p.y + Math.sin(a) * d); }
  f.closePath(); f.fill();
  ctx.drawImage(fog, 0, 0);
  // люди (лише видимі)
  for (const e of g.ents) if (visible(g, e) || e.st === "safe" || e.st === "cuffed") drawPerson(ctx, e, g);
  // гравець
  drawPerson(ctx, { k: "me", x: p.x, y: p.y, a: p.a, st: "me" }, g);
  // постріли, гранати, ефекти
  for (const s of g.shots) { ctx.strokeStyle = s.foe ? "rgba(255,120,90,.9)" : "rgba(255,230,150,.95)"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(s.x1, s.y1); ctx.lineTo(s.x2, s.y2); ctx.stroke(); }
  for (const n of g.nades) { const k = Math.min(1, n.t / .5); ctx.fillStyle = "#cfd6df"; ctx.beginPath(); ctx.arc(n.x + (n.tx - n.x) * k, n.y + (n.ty - n.y) * k, 4, 0, 7); ctx.fill(); }
  for (const fx of g.fx) if (fx.k === "flash") { ctx.fillStyle = `rgba(255,255,240,${fx.t * 1.6})`; ctx.beginPath(); ctx.arc(fx.x, fx.y, 175 * (1 - fx.t), 0, 7); ctx.fill(); }
  ctx.font = "bold 12px 'Inter', sans-serif"; ctx.textAlign = "center";
  for (const m of g.msgs) { ctx.globalAlpha = Math.min(1, m.t); ctx.fillStyle = "#000"; ctx.fillText(m.text, m.x + 1, m.y + 1); ctx.fillStyle = m.col; ctx.fillText(m.text, m.x, m.y); }
  ctx.globalAlpha = 1;
  // приціл
  ctx.strokeStyle = COL.gold; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(g.mx, g.my, 9, 0, 7); ctx.moveTo(g.mx - 14, g.my); ctx.lineTo(g.mx - 5, g.my); ctx.moveTo(g.mx + 5, g.my); ctx.lineTo(g.mx + 14, g.my);
  ctx.moveTo(g.mx, g.my - 14); ctx.lineTo(g.mx, g.my - 5); ctx.moveTo(g.mx, g.my + 5); ctx.lineTo(g.mx, g.my + 14); ctx.stroke();
  hud(g, ctx);
  if (g.fx.some((f) => f.k === "hurt")) { ctx.fillStyle = "rgba(180,20,20,.25)"; ctx.fillRect(0, 0, CW, CH); }
  if (p.blind > 0) { ctx.fillStyle = `rgba(255,255,250,${Math.min(1, p.blind)})`; ctx.fillRect(0, 0, CW, CH); }
}
function drawPerson(ctx, e, g) {
  const col = e.k === "me" ? COL.gold : e.k === "foe" ? COL.foe : e.k === "civ" ? COL.civ : COL.host;
  ctx.save(); ctx.translate(e.x, e.y);
  if (e.st === "down") { ctx.globalAlpha = .45; ctx.fillStyle = col; ctx.beginPath(); ctx.ellipse(0, 0, 13, 7, e.a, 0, 7); ctx.fill(); ctx.restore(); return; }
  ctx.rotate(e.a);
  if (e.k === "me" || (e.k === "foe" && !["surr", "cuffed"].includes(e.st))) { ctx.fillStyle = "#1a1d22"; ctx.fillRect(4, -2.5, 17, 5); }   // зброя
  ctx.fillStyle = col; ctx.strokeStyle = "rgba(0,0,0,.7)"; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(0, 0, e.st === "cower" ? 8 : 10, 0, 7); ctx.fill(); ctx.stroke();
  if (e.k === "me") { ctx.fillStyle = "#1a1d22"; ctx.font = "bold 9px sans-serif"; ctx.textAlign = "center"; ctx.rotate(-e.a); ctx.fillText("А", 0, 3); }
  ctx.restore();
  ctx.font = "bold 13px sans-serif"; ctx.textAlign = "center";
  if (e.st === "surr") { ctx.fillStyle = "#e9d9a8"; ctx.fillText("✋ E", e.x, e.y - 15); }
  if (e.st === "cuffed") { ctx.fillStyle = "#9aa7b8"; ctx.fillText("⛓", e.x, e.y - 14); }
  if (e.st === "alert" && e.k === "foe") { ctx.fillStyle = COL.foe; ctx.fillText("!", e.x, e.y - 14); }
  if (e.stun > 0) { ctx.fillStyle = "#fff"; ctx.fillText("✦", e.x, e.y - 14); }
  if (e.k === "host") { ctx.fillStyle = e.st === "safe" ? COL.host : "#e9d9a8"; ctx.fillText(e.st === "safe" ? "✔" : "E", e.x, e.y - 14); }
}
function hud(g, ctx) {
  const p = g.p, foes = g.ents.filter((e) => e.k === "foe"), hosts = g.ents.filter((e) => e.k === "host");
  ctx.fillStyle = "rgba(6,8,12,.78)"; ctx.fillRect(0, 0, CW, 30);
  ctx.font = "bold 13px 'Inter', sans-serif"; ctx.textAlign = "left";
  ctx.fillStyle = COL.gold; ctx.fillText(`ЦСО «А» · ${g.L.name}`, 12, 20);
  ctx.textAlign = "right"; ctx.fillStyle = "#e9e4d6";
  const left = foes.filter((e) => !["down", "cuffed"].includes(e.st)).length, safe = hosts.filter((e) => e.st === "safe").length;
  ctx.fillText(`Ціль: ${left}   Заручники: ${safe}/${hosts.length}   ⏱ ${g.t.toFixed(1)} с`, CW - 12, 20);
  // нижня панель
  ctx.fillStyle = "rgba(6,8,12,.78)"; ctx.fillRect(0, CH - 34, CW, 34);
  ctx.fillStyle = "#3a1414"; ctx.fillRect(12, CH - 22, 160, 10); ctx.fillStyle = p.hp > 40 ? "#5fb37a" : "#d4605a"; ctx.fillRect(12, CH - 22, 1.6 * Math.max(0, p.hp), 10);
  ctx.textAlign = "left"; ctx.fillStyle = "#e9e4d6"; ctx.font = "bold 13px 'Inter', sans-serif";
  ctx.fillText(p.reload > 0 ? "Перезаряджаю…" : `Набої ${p.mag}/${p.ammo}`, 186, CH - 12);
  ctx.fillText(`Світлошумові ${p.flash}`, 330, CH - 12);
  ctx.fillStyle = "#8a93a3"; ctx.font = "12px 'Inter', sans-serif";
  ctx.fillText("WASD рух · Shift тихо · ЛКМ вогонь · R перезарядка · E двері/кайданки/заручник · F «Руки вгору!» · G граната · Esc пауза", 470, CH - 12);
}

// ---------------------------------------------------------------- підсумок
function score(g, ok) {
  const s = g.stats, acc = s.fired ? s.hits / s.fired : 1;
  if (!ok) return { total: 0, acc };
  const parts = [["Затримано без вогню", s.arrests * 320], ["Нейтралізовано", s.kills * 140], ["Звільнено заручників", s.hostages * 260],
    ["Поранено цивільних / тих, хто здався", -s.civHit * 650], ["Поранено заручників", -s.hostHit * 900],
    ["Час", Math.max(0, Math.round((240 - g.t) * 3))], ["Влучність", Math.round(acc * 300)], ["Стан оперативника", Math.max(0, g.p.hp) * 2]];
  return { total: Math.max(0, parts.reduce((a, [, v]) => a + v, 0)), parts, acc };
}
function finish(g, ok, why) {
  g.over = { ok, why, sc: score(g, ok) };
  g.down = false;
  const r = g.over.sc.total, grade = !ok ? "—" : g.stats.civHit || g.stats.hostHit ? "C" : r > 2600 + g.i * 900 ? "S" : r > 1900 + g.i * 700 ? "A" : "B";
  g.over.grade = grade;
  if (ok) call("/api/game/score", { json: { game: "assault", level: g.i, score: r, ms: Math.round(g.t * 1000), data: g.stats } })
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
      <li>Влучність: ${Math.round(sc.acc * 100)}% · пострілів ${s.fired} · час ${g.t.toFixed(1)} с</li></ul>
    <div class="acts"><button class="btn" data-a="gmmenu">До меню</button><button class="btn gold" data-a="gmplay" data-l="${g.i}">Ще раз</button>
      ${ok && g.i < LEVELS.length - 1 ? `<button class="btn ok" data-a="gmplay" data-l="${g.i + 1}">Наступна операція →</button>` : ""}</div></div>`;
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
  document.getElementById("gm-over").hidden = true;
  const pos = (e) => { const r = cv.getBoundingClientRect(); g.mx = (e.clientX - r.left) * CW / r.width; g.my = (e.clientY - r.top) * CH / r.height; };
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
    if (g.paused) { ctx.fillStyle = "rgba(0,0,0,.6)"; ctx.fillRect(0, 0, CW, CH); ctx.fillStyle = COL.gold; ctx.font = "bold 28px 'Inter', sans-serif"; ctx.textAlign = "center"; ctx.fillText("ПАУЗА · Esc", CW / 2, CH / 2); }
    st.raf = requestAnimationFrame(loop);
  };
  st.raf = requestAnimationFrame(loop);
  cv.focus();
}

// ---------------------------------------------------------------- сторінка
async function view() {
  stop();
  const b = await call("/api/game/assault").catch(() => ({ levels: [], mine: {}, week: [] }));
  st.board = b; st.best = b.mine || {};
  if (st.lvl !== null) {
    const L = LEVELS[st.lvl];
    setTimeout(() => start(st.lvl), 30);
    return `<div class="gm-bar"><button class="btn" data-a="gmmenu">← Операції</button><b>${esc(L.name)}</b><span class="muted small">${esc(L.brief)}</span></div>
      <div class="gm-wrap"><canvas id="gm-canvas" width="${CW}" height="${CH}" tabindex="0"></canvas><div class="gm-over" id="gm-over" hidden></div></div>
      <p class="muted small">Порада: зайдіть з флангу й крикніть «Руки вгору!» (F) — затримання без пострілу дає найбільше балів. Світлошумова (G) оглушує й майже гарантує здачу.</p>`;
  }
  const lb = (rows) => rows.length ? `<ol class="gm-lb">${rows.map((r, n) => `<li class="${r.sid === S.ME().me.sid ? "me" : ""}"><b>${n + 1}</b><span>${esc(r.name)} <i class="muted">№${r.sid}</i></span><em>${r.score}</em></li>`).join("")}</ol>` : '<p class="muted small">Ще ніхто не пройшов.</p>';
  return `<div class="gm-hero"><div><div class="eyebrow">Тренажер ЦСО «Альфа» · ЄІС «Сова»</div><h2>ШТУРМ</h2>
      <p>Тактичний штурм будівлі з видом згори. Ви бачите лише те, що в полі зору. Спершу — <b>вимога здатися</b>, вогонь — лише по озброєних. За поранених цивільних — штраф і перевірка ВВБ.</p>
      <div class="gm-keys"><span><b>WASD</b> рух</span><span><b>Shift</b> тихо</span><span><b>ЛКМ</b> вогонь</span><span><b>R</b> перезарядка</span><span><b>E</b> двері · кайданки · заручник</span><span><b>F</b> «Руки вгору!»</span><span><b>G</b> світлошумова</span><span><b>Esc</b> пауза</span></div>
      <p class="muted small">Результати не впливають на бали підвищення й премії. Потрібні клавіатура й миша.</p></div>
      <div class="gm-legend"><span class="c-me">●</span> ви <span class="c-foe">●</span> озброєний <span class="c-civ">●</span> цивільний <span class="c-host">●</span> заручник</div></div>
    <div class="gm-levels">${LEVELS.map((L, i) => `<button class="gm-lvl" data-a="gmplay" data-l="${i}"><span class="eyebrow">Операція ${i + 1} · ${["легка", "середня", "складна"][i]}</span><b>${esc(L.name)}</b><p>${esc(L.brief)}</p>
      <span class="gm-best">Ваш рекорд: <b>${st.best[i] || "—"}</b></span></button>`).join("")}</div>
    <div class="grid2"><div class="card"><header><h3>🏆 Рейтинг тижня</h3><span class="muted small">сума найкращих результатів</span></header>${lb(b.week || [])}</div>
      <div class="card"><header><h3>⭐ Найкращі за весь час</h3></header>${lb(b.all || [])}</div></div>`;
}
S.views.game = view;
Object.assign(S.actions, {
  gmplay: (b) => { st.lvl = +b.dataset.l; S.render(); },
  gmmenu: () => { stop(); st.lvl = null; S.render(); },
});
})();
