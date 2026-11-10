/* «Хвіст» — тренажер ОРВ: негласне стеження за об'єктом у місті (вид згори, Canvas).
   Ведіть об'єкт, не засвітившись: тримайте дистанцію, ховайтеся в натовпі й за машинами, передавайте об'єкт напарнику,
   міняйте образ біля кіосків. Фотографуйте контакти й передачу, записуйте розмови — це докази для кейс-файлу ОРВ.
   Рейтинг — у ЄІС «Сова» (на бали підвищення й премії не впливає). */
(() => {
const S = window.SOVA;
const { esc, call, toast } = S;
const T = 24, P = 12, NX = 6, NY = 4, GW = NX * P + 4, GH = NY * P + 4, MW = GW * T, MH = GH * T;
const VW = 1024, VH = 640, TOP = 50, BOT = 66, FH = VH + TOP + BOT;
const WALK = 92, RUN = 165, LOST = 12;
const COL = { gold: "#c9a24d", tgt: "#e0645c", con: "#e8a33c", wat: "#b07fe0", mate: "#9cc3f0", ok: "#5fb37a" };

const LEVELS = [
  { name: "Кур'єр", code: "МОТИЛЬ", seed: 1307, nodes: 9, meets: 2, watchers: 0, check: .3, speed: 46, film: 24, mult: .7,
    target: "кур'єр збройового угруповання «Мотиль»",
    brief: "Кур'єр розвозить «замовлення» покупцям. Встановіть усіх, з ким він зустрінеться, і зафіксуйте передачу. Контрспостереження не очікується.",
    charges: [["ст. 263 КК", "незаконне поводження зі зброєю"], ["ст. 27 КК", "співучасть: постачальник і покупці"]] },
  { name: "Чиновник", code: "КЛЕРК", seed: 2903, nodes: 12, meets: 3, watchers: 1, check: .45, speed: 50, film: 24, mult: .9,
    target: "посадовець міськради «Клерк»",
    brief: "Посадовець збирає «відкати» з підрядників. Задокументуйте зустрічі й передачу грошей. За ним іде охоронець, що перевіряє, чи немає «хвоста».",
    charges: [["ст. 368 КК", "одержання неправомірної вигоди"], ["ст. 369 КК", "надання неправомірної вигоди (підрядники)"], ["ст. 364 КК", "зловживання службовим становищем"]] },
  { name: "Резидент", code: "ГРАФ", seed: 4441, nodes: 15, meets: 4, watchers: 2, check: .55, speed: 54, film: 20, mult: 1.05, back: true,
    target: "резидент іноземної розвідки «Граф»",
    brief: "Резидент проводить зустрічі з агентурою. Досвідчений: часто перевіряється, повертається назад, його супроводжують двоє контрспостерігачів. Встановіть агентурну мережу.",
    charges: [["ст. 111 КК", "державна зрада (агентурна мережа)"], ["ст. 328 КК", "розголошення державної таємниці"], ["ст. 27 КК", "співучасть"]] },
];
const LAW = [
  ["ст. 12 ПК", "ОРВ і АТЦ на негласних заходах фіксують усе прихованими мікрокамерами без інформування оточуючих"],
  ["ст. 10 ПК", "Фото-, аудіо- й відеоматеріали санкціонованих негласних дій — допустимі докази, якщо долучені до справи"],
  ["ст. 34.1 ПК", "Негласні заходи й впровадження — лише за постановою керівника органу (Голови СБУ)"],
  ["п. 1.7 Правил", "Боді-камера не обов'язкова на погоджених негласних заходах (фіксація — мікрокамерою)"],
  ["п. 1.52 Правил", "Під час погоджених негласних заходів співробітник СБУ посвідчення не пред'являє"],
];
const NAMES = ["«Шрам»", "«Бухгалтер»", "«Лисий»", "«Студент»", "«Кравець»", "«Моряк»", "«Тихий»", "«Сивий»", "«Доцент»", "«Ґудзик»", "«Пасічник»", "«Фармацевт»"];
const st = { lvl: null, g: null, raf: 0, best: {}, board: null, people: null, mate: null };

// ---------------------------------------------------------------- генератор міста
const rng = (seed) => () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const hash = (x, y, s = 0) => { let h = (x * 374761393 + y * 668265263 + s * 982451653) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const mk = (w, h) => Object.assign(document.createElement("canvas"), { width: w, height: h });
const node = (i, j, sx = .5, sy = .5) => ({ x: (i * P + sx) * T, y: (j * P + sy) * T });
const nbrs = (i, j) => [[i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]].filter(([a, b]) => a >= 0 && b >= 0 && a <= NX && b <= NY);
const SOLID = "btk";

function city(seed) {
  const R = rng(seed), grid = [], blds = [], kinds = {};
  for (let y = 0; y < GH; y++) {
    const row = [];
    for (let x = 0; x < GW; x++) {
      const bx = x % P, by = y % P, v = bx < 4, h = by < 4;
      row.push(v || h ? ((v && (bx === 1 || bx === 2)) || (h && (by === 1 || by === 2)) ? "r" : "s") : "b");
    }
    grid.push(row);
  }
  const all = []; for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) all.push([i, j]);
  for (let n = all.length - 1; n > 0; n--) { const m = Math.floor(R() * (n + 1)); [all[n], all[m]] = [all[m], all[n]]; }
  all.forEach(([i, j], n) => { kinds[i + "," + j] = n < 3 ? "plaza" : n < 6 ? "park" : "bld"; });
  for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
    const x0 = i * P + 4, y0 = j * P + 4, k = kinds[i + "," + j];
    const put = (x, y, c) => { grid[y][x] = c; };
    if (k === "bld") {
      const split = R(), cut = 3 + Math.floor(R() * 3);
      const rects = split < .45 ? [[0, 0, cut, 8], [cut + 1, 0, 8 - cut - 1, 8]] : split < .85 ? [[0, 0, 8, cut], [0, cut + 1, 8, 8 - cut - 1]] : [[0, 0, 8, 8]];
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) put(x0 + x, y0 + y, "a");
      for (const [rx, ry, rw, rh] of rects) {
        blds.push({ x: x0 + rx, y: y0 + ry, w: rw, h: rh, c: Math.floor(R() * 5), s: Math.floor(R() * 1000) });
        for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) put(x0 + rx + x, y0 + ry + y, "b");
      }
    } else if (k === "park") {
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) put(x0 + x, y0 + y, x === 3 || x === 4 || y === 3 || y === 4 ? "w" : "p");
      for (let n = 0; n < 9; n++) { const x = Math.floor(R() * 8), y = Math.floor(R() * 8); if (grid[y0 + y][x0 + x] === "p") put(x0 + x, y0 + y, "t"); }
    } else {
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) put(x0 + x, y0 + y, "q");
      put(x0 + 2, y0 + 2, "k"); put(x0 + 5, y0 + 5, "k");
    }
  }
  return { grid, blds, kinds };
}

// маршрут об'єкта: вузли-перехрестя, зустрічі, укриття (двері будинку на останньому відрізку)
function route(L, cityo, R) {
  for (let tries = 0; tries < 200; tries++) {
    let cur = [1 + Math.floor(R() * (NX - 1)), 1 + Math.floor(R() * (NY - 1))], prev = null;
    const nodes = [cur];
    while (nodes.length < L.nodes) {
      let opts = nbrs(...cur).filter((n) => !prev || n[0] !== prev[0] || n[1] !== prev[1]);
      if (L.back && prev && nodes.length > 2 && R() < .1) opts = [prev];
      const nx = opts[Math.floor(R() * opts.length)];
      prev = cur; cur = nx; nodes.push(cur);
    }
    const [a, b] = [nodes[nodes.length - 2], nodes[nodes.length - 1]];
    let door = null;
    if (a[1] === b[1] && b[1] >= 1) {               // горизонтальний відрізок: будинок над верхнім тротуаром
      const i = Math.min(a[0], b[0]), j = b[1];
      if (i < NX && cityo.kinds[i + "," + (j - 1)] === "bld") door = { x: (i * P + 4 + 4) * T, y: j * P * T + 2, a: -Math.PI / 2 };
    } else if (a[0] === b[0] && b[0] >= 1) {        // вертикальний: будинок ліворуч
      const j = Math.min(a[1], b[1]), i = b[0];
      if (j < NY && cityo.kinds[(i - 1) + "," + j] === "bld") door = { x: i * P * T + 2, y: (j * P + 4 + 4) * T, a: Math.PI };
    }
    if (!door) continue;
    // двері мають вести в будинок, а не в провулок
    const tx = Math.floor((door.x + Math.cos(door.a) * 14) / T), ty = Math.floor((door.y + Math.sin(door.a) * 14) / T);
    if (cityo.grid[ty][tx] !== "b") continue;
    const meets = [];
    for (let k = 1; k <= L.meets; k++) meets.push(Math.round(k * (L.nodes - 1) / (L.meets + 1)));
    return { nodes, door, meets };
  }
  return null;
}

function weekly() {
  const seed = (st.board && st.board.seed) || 1, base = LEVELS[seed % 3];
  return { ...base, name: "Операція тижня · " + base.name, seed: 9000 + seed * 7, nodes: 13, meets: 3, watchers: 2, check: .5, speed: 52, film: 22, mult: 1, back: true,
    brief: "Новий маршрут і місто щотижня — однакові для всіх. Двоє контрспостерігачів. Окремий рейтинг тижня.", law: seed % 3 };
}

// ---------------------------------------------------------------- світ
function build(i) {
  const L = i === 3 ? weekly() : { ...LEVELS[i], law: i };
  let R, C, rt = null;
  for (let k = 0; !rt; k++) { R = rng(L.seed + k * 101); C = city(L.seed + k * 101); rt = route(L, C, R); }
  const wp = rt.nodes.map(([a, b]) => node(a, b));
  wp[wp.length - 1] = { x: rt.door.x, y: rt.door.y };
  const g = { i, L, grid: C.grid, blds: C.blds, kinds: C.kinds, rt, wp, t: 0, susp: 0, maxSusp: 0, quiet: 0, lostT: 0, ev: [], msgs: [], fx: [], banner: null,
    film: L.film, disguise: 2, swaps: 0, keys: {}, mx: VW / 2, my: VH / 2, cam: { x: 0, y: 0 }, trail: [], over: null, seenBy: [] };
  // об'єкт
  g.tgt = { k: "tgt", x: wp[0].x, y: wp[0].y, a: 0, wi: 1, st: "wait", tm: 2.5, walk: 0, alpha: 1, look: 7 };
  // зустрічі й контакти
  const names = [...NAMES]; for (let n = names.length - 1; n > 0; n--) { const m = Math.floor(R() * (n + 1)); [names[n], names[m]] = [names[m], names[n]]; }
  g.cons = rt.meets.map((mi, n) => {
    const [a, b] = rt.nodes[mi], inc = rt.nodes[mi - 1], out = rt.nodes[mi + 1];
    const side = nbrs(a, b).filter((q) => !(inc && q[0] === inc[0] && q[1] === inc[1]) && !(out && q[0] === out[0] && q[1] === out[1]));
    const s = side[Math.floor(R() * side.length)] || out, A = node(a, b), B = node(s[0], s[1]);
    const from = { x: A.x + (B.x - A.x) * .42, y: A.y + (B.y - A.y) * .42 };
    return { k: "con", mi, name: names[n], x: from.x, y: from.y, home: from, a: Math.atan2(A.y - from.y, A.x - from.x), st: "idle", tm: 0, walk: 0, look: 3 + (n % 3), audio: 0, alpha: 1 };
  });
  // контрспостерігачі: ідуть за об'єктом зі зсувом і оглядаються
  g.wats = Array.from({ length: L.watchers }, (_, n) => ({ k: "wat", n, x: wp[0].x, y: wp[0].y, a: 0, walk: 0, lag: 1.7 + n * 1.3, look: 6, photo: false, alpha: 1 }));
  // оперативники: ви — позаду об'єкта, напарник — біля першої зустрічі через дорогу
  const back = nbrs(...rt.nodes[0]).find((q) => !(q[0] === rt.nodes[1][0] && q[1] === rt.nodes[1][1]));
  const A0 = node(...rt.nodes[0]), B0 = node(...back);
  const me = (st.people || {}).me;
  g.ag = [{ k: "me", x: A0.x + (B0.x - A0.x) * .72, y: A0.y + (B0.y - A0.y) * .72, a: 0, fam: 0, walk: 0, look: 0, who: me }];
  if (st.mate) {
    const m0 = rt.nodes[Math.max(1, rt.meets[0] - 1)], m1 = rt.nodes[rt.meets[0]], p = node(m0[0], m0[1], 3.5, 3.5), q = node(m1[0], m1[1], 3.5, 3.5);
    g.ag.push({ k: "mate", x: (p.x + q.x) / 2, y: (p.y + q.y) / 2, a: 0, fam: 0, walk: 0, look: 1, who: st.mate });
  }
  g.act = 0;
  // перехожі
  g.civ = [];
  for (let n = 0; n < 52; n++) {
    const a = Math.floor(R() * (NX + 1)), b = Math.floor(R() * (NY + 1)), sx = R() < .5 ? .5 : 3.5, sy = R() < .5 ? .5 : 3.5, p = node(a, b, sx, sy);
    const nb = nbrs(a, b), to = nb[Math.floor(R() * nb.length)];
    g.civ.push({ k: "civ", x: p.x, y: p.y, n: [a, b], to, sx, sy, sp: 30 + R() * 24, a: 0, walk: R() * 50, look: 2 + Math.floor(R() * 4), alpha: 1, p: R() });
  }
  for (const k of Object.keys(C.kinds).filter((k) => C.kinds[k] !== "bld")) {          // люди на площах і в парках
    const [bi, bj] = k.split(",").map(Number);
    for (let n = 0; n < 4; n++) {
      const x = (bi * P + 4 + .5 + R() * 7) * T, y = (bj * P + 4 + .5 + R() * 7) * T;
      if (!SOLID.includes(tile(g, Math.floor(x / T), Math.floor(y / T)))) g.civ.push({ k: "civ", idle: true, x, y, a: R() * 6.28, walk: 0, look: 2 + Math.floor(R() * 4), alpha: 1, p: R() });
    }
  }
  // машини
  g.cars = [];
  const lanes = [];
  for (let j = 0; j <= NY; j++) { lanes.push({ h: 1, c: (j * P + 1.5) * T, d: -1 }); lanes.push({ h: 1, c: (j * P + 2.5) * T, d: 1 }); }
  for (let i = 0; i <= NX; i++) { lanes.push({ h: 0, c: (i * P + 1.5) * T, d: 1 }); lanes.push({ h: 0, c: (i * P + 2.5) * T, d: -1 }); }
  for (const ln of lanes) for (let n = 0; n < 1 + (R() < .5); n++) g.cars.push({ ...ln, s: R() * (ln.h ? MW : MH), v: 100 + R() * 70, col: Math.floor(R() * 6) });
  g.bg = prerender(g);
  return g;
}
const tile = (g, x, y) => (g.grid[y] || [])[x] || "b";
const solidAt = (g, x, y) => SOLID.includes(tile(g, Math.floor(x / T), Math.floor(y / T)));
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const angDiff = (a, b) => { let d = (b - a) % 6.2832; if (d > 3.1416) d -= 6.2832; if (d < -3.1416) d += 6.2832; return d; };
const carRect = (c) => c.h ? [c.s - 22, c.c - 10, c.s + 22, c.c + 10] : [c.c - 10, c.s - 22, c.c + 10, c.s + 22];

// пряма видимість: будинки, дерева, кіоски й машини закривають огляд
function los(g, a, b) {
  const d = dist(a, b), n = Math.ceil(d / 10);
  for (let k = 1; k < n; k++) { const x = a.x + (b.x - a.x) * k / n, y = a.y + (b.y - a.y) * k / n; if (solidAt(g, x, y)) return false; }
  for (const c of g.cars) {
    const [x0, y0, x1, y1] = carRect(c);
    if (Math.max(a.x, b.x) < x0 || Math.min(a.x, b.x) > x1 || Math.max(a.y, b.y) < y0 || Math.min(a.y, b.y) > y1) continue;
    for (let k = 1; k < n; k++) { const x = a.x + (b.x - a.x) * k / n, y = a.y + (b.y - a.y) * k / n; if (x > x0 && x < x1 && y > y0 && y < y1) return false; }
  }
  return true;
}
// чи бачить спостерігач O агента A (0 — ні, до 1 — близько)
function sees(g, O, A, fov, range) {
  const d = dist(O, A);
  if (d > range || (O.alpha ?? 1) < .5) return 0;
  if (Math.abs(angDiff(O.a, Math.atan2(A.y - O.y, A.x - O.x))) > fov / 2) return 0;
  return los(g, O, A) ? 1 - d / range : 0;
}
const tgtView = (g) => g.tgt.st === "check" && !g.tgt.turn ? [1.9, 270] : g.tgt.st === "meet" ? [1.4, 220] : [1.15, 200];

function say(g, x, y, text, col = "#e9d9a8") { g.msgs.push({ x, y, text, col, t: 1.8 }); }
function evidence(g, k, text, pts) { g.ev.push({ k, text, pts }); g.banner = { text: "📎 " + text, t: 2.6 }; }

function stepTo(o, to, sp, dt) {
  const d = dist(o, to);
  if (d < 1) return true;
  const s = Math.min(d, sp * dt);
  o.a = Math.atan2(to.y - o.y, to.x - o.x); o.x += Math.cos(o.a) * s; o.y += Math.sin(o.a) * s; o.walk = (o.walk || 0) + s * .35;
  return s >= d;
}

// ---------------------------------------------------------------- оновлення
function update(g, dt) {
  g.t += dt;
  const A = g.ag[g.act], tg = g.tgt, L = g.L;
  // рух оперативника
  const run = g.keys.ShiftLeft || g.keys.ShiftRight;
  let vx = (g.keys.KeyD ? 1 : 0) - (g.keys.KeyA ? 1 : 0), vy = (g.keys.KeyS ? 1 : 0) - (g.keys.KeyW ? 1 : 0);
  A.run = false;
  if (vx || vy) {
    const l = Math.hypot(vx, vy), sp = (run ? RUN : WALK) * dt;
    vx = vx / l * sp; vy = vy / l * sp;
    const r = 8, ok = (x, y) => !solidAt(g, x - r, y - r) && !solidAt(g, x + r, y - r) && !solidAt(g, x - r, y + r) && !solidAt(g, x + r, y + r);
    if (ok(A.x + vx, A.y) && A.x + vx > 10 && A.x + vx < MW - 10) A.x += vx;
    if (ok(A.x, A.y + vy) && A.y + vy > 10 && A.y + vy < MH - 10) A.y += vy;
    A.walk += sp * .35; A.run = run;
  }
  A.a = Math.atan2(g.my + g.cam.y - A.y, g.mx + g.cam.x - A.x);
  // об'єкт
  const nervous = g.susp > 50;
  const sp = L.speed * (nervous ? 1.22 : 1);
  if (tg.st === "wait") { tg.tm -= dt; tg.a += Math.sin(g.t * 1.3) * dt * .8; if (tg.tm <= 0) tg.st = "walk"; }
  else if (tg.st === "walk") {
    const to = g.wp[tg.wi];
    if (stepTo(tg, to, sp, dt)) {
      const mi = g.cons.findIndex((c) => c.mi === tg.wi);
      if (tg.wi === g.wp.length - 1) { tg.st = "enter"; tg.tm = 1.6; tg.a = g.rt.door.a; }
      else if (mi >= 0) { const c = g.cons[mi]; tg.st = "meet"; tg.tm = 9; tg.con = c; }
      else {
        tg.wi++;
        if (Math.random() < L.check * (nervous ? 1.6 : 1)) { tg.st = "check"; tg.tm = 3.4; tg.base = Math.atan2(g.wp[tg.wi - 2].y - tg.y, g.wp[tg.wi - 2].x - tg.x); }
      }
    } else if (nervous && Math.random() < dt / 8) { tg.st = "check"; tg.tm = 3; tg.base = tg.a + Math.PI; }
  } else if (tg.st === "check") {
    // спершу зупиняється (≈0,8 с — час сховатися), потім обертається й оглядає вулицю позаду
    tg.tm -= dt; tg.turn = tg.tm > 2.6;
    if (!tg.turn) tg.a += angDiff(tg.a, tg.base + Math.sin(g.t * 2.2) * .55) * Math.min(1, dt * 6);
    if (tg.tm <= 0) { tg.st = "walk"; tg.turn = false; }
  } else if (tg.st === "meet") {
    const c = tg.con;
    tg.tm -= dt;
    if (c.st === "meet") tg.a = Math.atan2(c.y - tg.y, c.x - tg.x) + Math.sin(g.t * .9) * .9;
    if (tg.tm <= 0) { tg.st = "walk"; tg.wi++; c.st = "leave"; }
  } else if (tg.st === "enter") {
    tg.tm -= dt; tg.x += Math.cos(tg.a) * 14 * dt; tg.y += Math.sin(tg.a) * 14 * dt; tg.alpha = Math.max(0, tg.tm / 1.6);
    if (tg.tm <= 0 && !g.over) return finish(g, true);
  }
  tg.x = Math.max(4, Math.min(MW - 4, tg.x)); tg.y = Math.max(4, Math.min(MH - 4, tg.y));
  if (!g.trail.length || g.t - g.trail[g.trail.length - 1].t > .1) { g.trail.push({ x: tg.x, y: tg.y, t: g.t }); if (g.trail.length > 400) g.trail.shift(); }
  // контакти: виходять назустріч, коли об'єкт підходить
  for (const c of g.cons) {
    const mp = g.wp[c.mi];
    if (c.st === "idle") { c.a += Math.sin(g.t + c.mi) * dt * .4; if (tg.wi === c.mi && dist(tg, mp) < 170) c.st = "go"; }
    else if (c.st === "go") { const to = { x: mp.x + Math.cos(Math.atan2(c.home.y - mp.y, c.home.x - mp.x)) * 20, y: mp.y + Math.sin(Math.atan2(c.home.y - mp.y, c.home.x - mp.x)) * 20 }; if (stepTo(c, to, 44, dt)) c.st = "wait"; }
    else if (c.st === "wait") { c.a = Math.atan2(tg.y - c.y, tg.x - c.x); if (tg.st === "meet" && tg.con === c) { c.st = "meet"; c.tm = 0; } }
    else if (c.st === "meet") { c.tm += dt; c.a = Math.atan2(tg.y - c.y, tg.x - c.x); c.xchg = c.tm > 3.4 && c.tm < 6.6; }
    else if (c.st === "leave") { c.xchg = false; if (stepTo(c, c.home, 46, dt)) { c.st = "gone"; } }
    else if (c.st === "gone") c.alpha = Math.max(0, c.alpha - dt * .6);
  }
  // контрспостерігачі
  for (const w of g.wats) {
    let to = null;
    for (let k = g.trail.length - 1; k >= 0; k--) if (g.t - g.trail[k].t >= w.lag) { to = g.trail[k]; break; }
    const moving = tg.st === "walk" && to && dist(w, to) > 6;
    if (moving) { stepTo(w, to, L.speed * 1.35, dt); w.head = w.a; }
    // здебільшого дивиться вперед і вбік; раз на кілька секунд — коротко озирається назад (перед тим зупиняється)
    w.cd = (w.cd ?? 5 + w.n * 3) - dt;
    if (w.cd <= 0 && !w.back) { w.back = 2.2; w.cd = 7 + Math.random() * 5; }
    if (w.back) { w.back = Math.max(0, w.back - dt); w.turn = w.back > 1.5; }
    const aim = w.back && !w.turn ? (w.head ?? w.a) + Math.PI + Math.sin(g.t * 2) * .4 : (w.head ?? w.a) + Math.sin(g.t * .8 + w.n * 2) * (moving ? .8 : 1.6);
    w.a += angDiff(w.a, aim) * Math.min(1, dt * 5);
  }
  // перехожі
  for (const c of g.civ) {
    if (c.idle) { if (Math.random() < dt * .2) c.a += (Math.random() - .5) * 2; continue; }
    const to = node(c.to[0], c.to[1], c.sx, c.sy);
    if (stepTo(c, to, c.sp, dt)) { const nb = nbrs(...c.to).filter((q) => q[0] !== c.n[0] || q[1] !== c.n[1]); c.n = c.to; c.to = nb[Math.floor(Math.random() * nb.length)]; }
  }
  for (const c of g.cars) { c.s += c.d * c.v * dt; const lim = c.h ? MW : MH; if (c.s > lim + 40) c.s = -40; if (c.s < -40) c.s = lim + 40; }
  // підозра: хто й наскільки бачить оперативників
  let rate = 0; g.seenBy = [];
  if (g.t < 3) { g.ag.forEach((ag) => { ag.hot = false; ag.cover = false; }); g.lostT = 0; return camera(g, A, dt); }
  const [tf, tr] = tgtView(g);
  for (const ag of g.ag) {
    let r = 0;
    const ft = tg.st === "enter" ? 0 : sees(g, tg, ag, tf, tr);
    if (ft) { r += (4 + 18 * ft) * (tg.st === "check" ? 1.2 : 1); ag.fam += dt; g.seenBy.push(tg); }
    for (const w of g.wats) { const f = sees(g, w, ag, 1.3, 200); if (f) { r += 4 + 12 * f; g.seenBy.push(w); } }
    for (const c of g.cons) if (c.st === "meet" || c.st === "wait") { const f = sees(g, c, ag, 1.3, 170); if (f) { r += 3 + 10 * f; g.seenBy.push(c); } }
    const crowd = g.civ.filter((c) => Math.abs(c.x - ag.x) < 50 && Math.abs(c.y - ag.y) < 50 && dist(c, ag) < 50).length;
    const cover = crowd >= 2 ? .4 : crowd === 1 ? .62 : 1;
    if (dist(ag, tg) < 60 && tg.st !== "enter") r += 7;
    r *= cover * (ag.run ? 1.8 : 1) * (1 + ag.fam / 8);
    ag.cover = cover < 1; ag.hot = r > 0;
    rate += r;
  }
  rate *= L.mult;
  if (rate > 0) { g.susp += rate * dt; g.quiet = 0; } else { g.quiet += dt; if (g.quiet > 1.5) g.susp = Math.max(0, g.susp - 4 * dt); }
  g.maxSusp = Math.max(g.maxSusp, g.susp);
  if (g.susp >= 100) return finish(g, false, "Об'єкт помітив стеження: змінив маршрут і зник. Операцію провалено — повторна розробка займе тижні.");
  // запис розмови: мікрофон поруч із зустріччю, поки вас не бачать
  for (const c of g.cons) if (c.st === "meet" && !c.audioDone) {
    if (dist(A, c) < 95 && !A.hot) { c.audio += dt; if (c.audio >= 3.5) { c.audioDone = true; evidence(g, "audio", `Запис розмови з ${c.name}`, 350); } }
  }
  // контакт із об'єктом
  const vis = g.ag.some((ag) => dist(ag, tg) < 380 && los(g, ag, tg));
  if (vis || tg.st === "enter") g.lostT = 0; else g.lostT += dt;
  if (g.lostT > LOST) return finish(g, false, "Об'єкт втрачено: жоден оперативник не бачив його понад " + LOST + " секунд.");
  camera(g, A, dt);
}
function camera(g, A, dt) {
  const cx = Math.max(0, Math.min(MW - VW, A.x - VW / 2)), cy = Math.max(0, Math.min(MH - VH, A.y - VH / 2));
  g.cam.x += (cx - g.cam.x) * Math.min(1, dt * 6); g.cam.y += (cy - g.cam.y) * Math.min(1, dt * 6);
  for (const m of g.msgs) { m.t -= dt; m.y -= dt * 14; }
  g.msgs = g.msgs.filter((m) => m.t > 0);
  for (const f of g.fx) f.t -= dt;
  g.fx = g.fx.filter((f) => f.t > 0);
  if (g.banner && (g.banner.t -= dt) <= 0) g.banner = null;
}

// фото: кадр у напрямку миші (кут 34°, до 340 px)
function photo(g) {
  const A = g.ag[g.act];
  if (g.film <= 0) { say(g, A.x, A.y - 24, "Плівка закінчилась", COL.tgt); return; }
  g.film--;
  g.fx.push({ k: "shot", x: A.x, y: A.y, a: A.a, t: .35 });
  const inFrame = (e) => dist(A, e) < 340 && Math.abs(angDiff(A.a, Math.atan2(e.y - A.y, e.x - A.x))) < .3 && (e.alpha ?? 1) > .3 && los(g, A, e);
  let got = 0;
  for (const c of g.cons) if (inFrame(c)) {
    if (c.st === "meet" && !c.photo) { c.photo = true; got++; evidence(g, "con", `Фото контакту ${c.name}`, 300); }
    if (c.xchg && !c.photoX) { c.photoX = true; got++; evidence(g, "xchg", `Фото передачі: об'єкт і ${c.name}`, 450); }
  }
  for (const w of g.wats) if (inFrame(w) && !w.photo) { w.photo = true; got++; evidence(g, "wat", "Встановлено контрспостерігача", 250); }
  if (inFrame(g.tgt)) {
    if (!g.tgtPhoto) { g.tgtPhoto = true; got++; evidence(g, "tgt", "Фото об'єкта", 100); }
    if (!g.doorPhoto && (g.tgt.st === "enter" || (g.tgt.wi === g.wp.length - 1 && dist(g.tgt, g.rt.door) < 70))) { g.doorPhoto = true; got++; evidence(g, "door", "Фіксація входу в укриття", 200); }
  }
  if (!got) say(g, A.x, A.y - 24, "Нічого суттєвого в кадрі", "#8a93a3");
  // камеру помітили
  const [tf, tr] = tgtView(g);
  if ([[g.tgt, tf, tr], ...g.wats.map((w) => [w, 1.3, 200])].some(([o, f, r]) => dist(o, A) < 230 && sees(g, o, A, f, r))) { g.susp += 15; say(g, A.x, A.y - 40, "Камеру помітили!", COL.tgt); }
}
function disguise(g) {
  const A = g.ag[g.act];
  const near = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]].some(([dx, dy]) => tile(g, Math.floor(A.x / T) + dx, Math.floor(A.y / T) + dy) === "k");
  if (!near) { say(g, A.x, A.y - 24, "Змінити образ можна біля кіоску", "#8a93a3"); return; }
  if (g.disguise <= 0) { say(g, A.x, A.y - 24, "Запасного одягу більше немає", COL.tgt); return; }
  g.disguise--; A.fam = 0; A.look = (A.look + 2) % 6; say(g, A.x, A.y - 24, "Новий образ: кепка, куртка", COL.ok);
}
function swap(g) {
  if (g.ag.length < 2) { const A = g.ag[0]; say(g, A.x, A.y - 24, "Без напарника — оберіть його в меню", "#8a93a3"); return; }
  g.act = 1 - g.act; g.swaps++;
  const A = g.ag[g.act]; say(g, A.x, A.y - 24, "Об'єкт веде " + (A.who ? (A.who.callsign || A.who.name) : "напарник"), COL.mate);
}

// ---------------------------------------------------------------- малювання
const ROOF = [["#474c55", "#3a3f47"], ["#55504a", "#46423d"], ["#3e4952", "#323b43"], ["#5a4e44", "#4a4038"], ["#4a525a", "#3c434a"]];
function prerender(g) {
  const c = mk(MW, MH), x2 = c.getContext("2d");
  for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
    const ch = g.grid[y][x], X = x * T, Y = y * T;
    if (ch === "r") {
      const v = 34 + hash(x, y) * 5; x2.fillStyle = `rgb(${v},${v + 2},${v + 5})`; x2.fillRect(X, Y, T, T);
      for (let i = 0; i < 10; i++) { x2.fillStyle = `rgba(255,255,255,${.02 + hash(x, y, i) * .03})`; x2.fillRect(X + hash(x, y, i + 3) * T, Y + hash(x, y, i + 7) * T, 1.5, 1.5); }
    } else if (ch === "s") {
      const v = 66 + hash(x, y) * 8; x2.fillStyle = `rgb(${v},${v + 1},${v + 3})`; x2.fillRect(X, Y, T, T);
      x2.fillStyle = "rgba(0,0,0,.22)"; x2.fillRect(X, Y, T, 1); x2.fillRect(X, Y, 1, T); x2.fillRect(X + 12, Y, 1, T);
    } else if (ch === "a") {
      x2.fillStyle = "#24272c"; x2.fillRect(X, Y, T, T);
      if (hash(x, y, 5) > .8) { x2.fillStyle = "#3b4a3a"; x2.fillRect(X + 4, Y + 5, 14, 10); x2.fillStyle = "#2c372c"; x2.fillRect(X + 4, Y + 5, 14, 2); }
    } else if (ch === "p" || ch === "t") {
      const v = hash(x, y); x2.fillStyle = `rgb(${38 + v * 10},${66 + v * 14},${40 + v * 8})`; x2.fillRect(X, Y, T, T);
      for (let i = 0; i < 12; i++) { x2.fillStyle = `rgba(${hash(x, y, i) > .5 ? "150,200,120" : "10,30,10"},.12)`; x2.fillRect(X + hash(x, y, i + 3) * T, Y + hash(x, y, i + 7) * T, 2, 2); }
    } else if (ch === "w") {
      const v = 82 + hash(x, y) * 8; x2.fillStyle = `rgb(${v},${v - 6},${v - 18})`; x2.fillRect(X, Y, T, T);
    } else if (ch === "q" || ch === "k") {
      const v = 74 + ((x + y) % 2) * 6 + hash(x, y) * 4; x2.fillStyle = `rgb(${v},${v - 3},${v - 9})`; x2.fillRect(X, Y, T, T);
      x2.fillStyle = "rgba(0,0,0,.18)"; x2.fillRect(X, Y, T, 1); x2.fillRect(X, Y, 1, T);
    }
  }
  // розмітка: смуги між зустрічними рядами й переходи біля перехресть
  x2.fillStyle = "rgba(230,225,200,.35)";
  for (let j = 0; j <= NY; j++) for (let x = 0; x < GW; x++) if (x % P >= 4) for (let k = 0; k < 2; k++) x2.fillRect(x * T + k * 12 + 2, (j * P + 2) * T - 1, 7, 2);
  for (let i = 0; i <= NX; i++) for (let y = 0; y < GH; y++) if (y % P >= 4) for (let k = 0; k < 2; k++) x2.fillRect((i * P + 2) * T - 1, y * T + k * 12 + 2, 2, 7);
  x2.fillStyle = "rgba(235,232,215,.55)";
  for (let j = 0; j <= NY; j++) for (let i = 0; i <= NX; i++) {
    const X = i * P * T, Y = j * P * T;
    for (let k = 0; k < 6; k++) {
      if (i < NX) x2.fillRect(X + 4 * T + 3, Y + T + k * 8 + 1, T - 6, 4);       // перехід праворуч від перехрестя
      if (i > 0) x2.fillRect(X - T + 3, Y + T + k * 8 + 1, T - 6, 4);           // ліворуч
      if (j < NY) x2.fillRect(X + T + k * 8 + 1, Y + 4 * T + 3, 4, T - 6);       // знизу
      if (j > 0) x2.fillRect(X + T + k * 8 + 1, Y - T + 3, 4, T - 6);           // зверху
    }
  }
  // бордюри
  x2.fillStyle = "rgba(0,0,0,.45)";
  for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) if (g.grid[y][x] === "s") {
    const X = x * T, Y = y * T;
    if (tile(g, x + 1, y) === "r") x2.fillRect(X + T - 2, Y, 2, T);
    if (tile(g, x - 1, y) === "r") x2.fillRect(X, Y, 2, T);
    if (tile(g, x, y + 1) === "r") x2.fillRect(X, Y + T - 2, T, 2);
    if (tile(g, x, y - 1) === "r") x2.fillRect(X, Y, T, 2);
  }
  // будинки: тінь, дах із парапетом, кондиціонери й люки
  for (const b of g.blds) {
    const X = b.x * T, Y = b.y * T, W = b.w * T, H = b.h * T, [c1, c2] = ROOF[b.c];
    x2.fillStyle = "rgba(0,0,0,.42)"; x2.fillRect(X + 7, Y + 7, W, H);
    x2.fillStyle = c2; x2.fillRect(X, Y, W, H);
    x2.fillStyle = c1; x2.fillRect(X + 4, Y + 4, W - 8, H - 8);
    x2.strokeStyle = "rgba(255,255,255,.07)"; x2.lineWidth = 1; x2.strokeRect(X + 4.5, Y + 4.5, W - 9, H - 9);
    for (let n = 0; n < Math.max(2, (b.w * b.h) / 6); n++) {
      const px = X + 10 + hash(b.s, n) * (W - 34), py = Y + 10 + hash(b.s, n, 3) * (H - 30);
      if (hash(b.s, n, 9) > .5) { x2.fillStyle = "rgba(0,0,0,.35)"; x2.fillRect(px + 3, py + 3, 16, 12); x2.fillStyle = "#8a9099"; x2.fillRect(px, py, 16, 12); x2.fillStyle = "#5e646c"; x2.beginPath(); x2.arc(px + 8, py + 6, 4, 0, 7); x2.fill(); }
      else { x2.fillStyle = "rgba(0,0,0,.35)"; x2.fillRect(px, py, 12, 12); x2.fillStyle = c2; x2.fillRect(px + 2, py + 2, 8, 8); }
    }
  }
  // дерева й кіоски
  for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
    const ch = g.grid[y][x], X = x * T + T / 2, Y = y * T + T / 2;
    if (ch === "t") {
      x2.fillStyle = "rgba(0,0,0,.4)"; x2.beginPath(); x2.arc(X + 5, Y + 5, 15, 0, 7); x2.fill();
      const gr = x2.createRadialGradient(X - 4, Y - 4, 2, X, Y, 16); gr.addColorStop(0, "#4f7d43"); gr.addColorStop(1, "#264a25");
      x2.fillStyle = gr; x2.beginPath(); x2.arc(X, Y, 15, 0, 7); x2.fill();
      for (let i = 0; i < 5; i++) { x2.fillStyle = "rgba(120,170,90,.18)"; x2.beginPath(); x2.arc(X - 8 + hash(x, y, i) * 16, Y - 8 + hash(x, y, i + 4) * 16, 4, 0, 7); x2.fill(); }
    }
    if (ch === "k") {
      x2.fillStyle = "rgba(0,0,0,.4)"; x2.fillRect(X - 10, Y - 8, 26, 22);
      x2.fillStyle = "#3a4048"; x2.fillRect(X - 12, Y - 11, 24, 22);
      x2.fillStyle = (x + y) % 2 ? "#c9a24d" : "#3d6d9a"; for (let i = 0; i < 4; i++) x2.fillRect(X - 12 + i * 6, Y - 11, 3, 8);
      x2.fillStyle = "#e9e3d0"; x2.font = "bold 6px Inter, sans-serif"; x2.textAlign = "center"; x2.fillText((x + y) % 2 ? "КАВА" : "ПРЕСА", X, Y + 6);
    }
  }
  // ліхтарі на розі перехресть: теплі плями світла
  for (let j = 0; j <= NY; j++) for (let i = 0; i <= NX; i++) for (const [sx, sy] of [[.2, .2], [3.8, 3.8]]) {
    const X = (i * P + sx) * T, Y = (j * P + sy) * T, gr = x2.createRadialGradient(X, Y, 2, X, Y, 70);
    gr.addColorStop(0, "rgba(255,214,140,.16)"); gr.addColorStop(1, "rgba(255,214,140,0)"); x2.fillStyle = gr; x2.fillRect(X - 70, Y - 70, 140, 140);
    x2.fillStyle = "#e8d7a8"; x2.beginPath(); x2.arc(X, Y, 2.2, 0, 7); x2.fill();
  }
  return c;
}

const LOOKS = [
  { torso: "#2f3b33", torso2: "#1e2622", head: "#3a2a1e", cap: "#c9a24d" },       // оперативник
  { torso: "#2c3a3f", torso2: "#1b2529", head: "#4a3524", cap: "#9cc3f0" },       // напарник
  { torso: "#5b4a3a", torso2: "#3c3127", head: "#2b2018", cap: "#20262c" },       // образ 2
  { torso: "#3d6d9a", torso2: "#29496a", head: "#5a3b22" },
  { torso: "#c9c4b6", torso2: "#8f8a7d", head: "#2b2018" },
  { torso: "#3a8a86", torso2: "#245a57", head: "#b58b4c" },
  { torso: "#24262b", torso2: "#15171a", head: "#2b2018" },                       // контрспостерігач: темне пальто
  { torso: "#6a2f2b", torso2: "#45201d", head: "#1c1c1c" },                       // об'єкт
];
function drawPerson(ctx, e, g) {
  const L0 = e.k === "me" ? (e.look ? LOOKS[2 + (e.look % 4)] : LOOKS[0]) : e.k === "mate" ? (e.look > 1 ? LOOKS[2 + (e.look % 4)] : LOOKS[1]) : LOOKS[e.look % LOOKS.length];
  const walk = Math.sin((e.walk || 0) * .22) * 3.5;
  ctx.save(); ctx.globalAlpha = e.alpha ?? 1; ctx.translate(e.x, e.y);
  ctx.fillStyle = "rgba(0,0,0,.35)"; ctx.beginPath(); ctx.ellipse(3, 4, 11, 8, 0, 0, 7); ctx.fill();
  const ring = e.k === "tgt" ? COL.tgt : e.k === "con" && (e.st === "meet" || e.photo) ? COL.con : e.k === "wat" && e.photo ? COL.wat : null;
  if (ring) { ctx.strokeStyle = ring; ctx.lineWidth = 1.6; ctx.setLineDash(e.k === "tgt" ? [] : [4, 3]); ctx.beginPath(); ctx.arc(0, 0, 14, 0, 7); ctx.stroke(); ctx.setLineDash([]); }
  ctx.rotate(e.a);
  ctx.fillStyle = "#15181c"; ctx.beginPath(); ctx.ellipse(walk, -4, 4.5, 2.6, 0, 0, 7); ctx.fill(); ctx.beginPath(); ctx.ellipse(-walk, 4, 4.5, 2.6, 0, 0, 7); ctx.fill();
  const gr = ctx.createLinearGradient(-7, -9, 7, 9); gr.addColorStop(0, L0.torso); gr.addColorStop(1, L0.torso2);
  ctx.fillStyle = gr; ctx.strokeStyle = "rgba(0,0,0,.6)"; ctx.lineWidth = 1.3; ctx.beginPath(); ctx.ellipse(0, 0, 7, 10.5, 0, 0, 7); ctx.fill(); ctx.stroke();
  ctx.fillStyle = L0.torso2; ctx.beginPath(); ctx.arc(1, -9.5, 2.7, 0, 7); ctx.arc(1, 9.5, 2.7, 0, 7); ctx.fill();
  if (e.k === "con" && e.xchg) { ctx.fillStyle = "#d9c08a"; ctx.fillRect(7, -4, 8, 8); ctx.strokeStyle = "#6b5530"; ctx.strokeRect(7, -4, 8, 8); }
  if (e.k === "me" || e.k === "mate") { ctx.fillStyle = "#101215"; ctx.fillRect(5, -2, 6, 4); }      // мікрокамера в руці
  ctx.fillStyle = L0.head; ctx.strokeStyle = "rgba(0,0,0,.55)"; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(1, 0, 5.5, 0, 7); ctx.fill(); ctx.stroke();
  if (L0.cap) { ctx.fillStyle = L0.cap; ctx.beginPath(); ctx.arc(1, 0, 5.6, -1.2, 1.2); ctx.fill(); ctx.fillRect(4, -3, 4, 6); }
  ctx.restore();
  ctx.globalAlpha = e.alpha ?? 1;
  const label = (t, c, dy = 24) => { ctx.font = "bold 10px 'Inter', sans-serif"; ctx.textAlign = "center"; const w = ctx.measureText(t).width + 10; ctx.fillStyle = "rgba(0,0,0,.65)"; ctx.beginPath(); ctx.roundRect(e.x - w / 2, e.y + dy - 10, w, 14, 4); ctx.fill(); ctx.fillStyle = c; ctx.fillText(t, e.x, e.y + dy); };
  if (e.k === "tgt") label(`ОБ'ЄКТ «${g.L.code}»`, COL.tgt, 26);
  if (e.k === "wat" && e.turn) { ctx.font = "bold 13px 'Inter', sans-serif"; ctx.textAlign = "center"; ctx.fillStyle = COL.wat; ctx.fillText("⟲", e.x, e.y - 18); }
  if (e.k === "tgt" && e.turn) { ctx.font = "bold 16px 'Inter', sans-serif"; ctx.textAlign = "center"; ctx.fillStyle = COL.tgt; ctx.fillText("⟲ оглядається", e.x, e.y - 20); }
  if (e.k === "con" && (e.st === "meet" || e.photo)) label(e.name, COL.con, 26);
  if (e.k === "wat" && e.photo) label("контрспостерігач", COL.wat, 26);
  if ((e.k === "me" || e.k === "mate") && e.who) label(`${e.who.rankShort} ${e.who.callsign || e.who.name}`, e.k === "me" ? "#e9d9a8" : COL.mate, 26);
  if (g.seenBy.includes(e)) { ctx.font = "15px sans-serif"; ctx.textAlign = "center"; ctx.fillText("👁", e.x, e.y - 18); }
  ctx.globalAlpha = 1;
}
function cone(ctx, g, o, fov, range, col) {
  const step = .06, pts = [];
  for (let a = o.a - fov / 2; a <= o.a + fov / 2 + 1e-6; a += step) {
    let d = 8;
    for (; d < range; d += 8) { if (solidAt(g, o.x + Math.cos(a) * d, o.y + Math.sin(a) * d)) break; }
    pts.push([o.x + Math.cos(a) * d, o.y + Math.sin(a) * d]);
  }
  const gr = ctx.createRadialGradient(o.x, o.y, 6, o.x, o.y, range);
  gr.addColorStop(0, col.replace("A", ".22")); gr.addColorStop(1, col.replace("A", "0"));
  ctx.fillStyle = gr; ctx.beginPath(); ctx.moveTo(o.x, o.y); for (const [x, y] of pts) ctx.lineTo(x, y); ctx.closePath(); ctx.fill();
}
function drawCar(ctx, c) {
  const [x0, y0, x1, y1] = carRect(c), w = x1 - x0, h = y1 - y0;
  const body = ["#7b2d2a", "#2f4f7a", "#c9c4b6", "#2d2f33", "#3f6b3d", "#8a6a2c"][c.col];
  ctx.fillStyle = "rgba(0,0,0,.4)"; ctx.fillRect(x0 + 4, y0 + 4, w, h);
  ctx.fillStyle = body; ctx.beginPath(); ctx.roundRect(x0, y0, w, h, 5); ctx.fill();
  ctx.fillStyle = "rgba(20,28,38,.85)";
  if (c.h) { const f = c.d > 0 ? x1 - 16 : x0 + 6; ctx.fillRect(f, y0 + 3, 10, h - 6); ctx.fillRect(c.d > 0 ? x0 + 5 : x1 - 13, y0 + 4, 8, h - 8); }
  else { const f = c.d > 0 ? y1 - 16 : y0 + 6; ctx.fillRect(x0 + 3, f, w - 6, 10); ctx.fillRect(x0 + 4, c.d > 0 ? y0 + 5 : y1 - 13, w - 8, 8); }
  ctx.fillStyle = "rgba(255,240,190,.9)";
  const hx = c.h ? (c.d > 0 ? x1 : x0) : null, hy = c.h ? null : (c.d > 0 ? y1 : y0);
  if (c.h) { ctx.fillRect(hx - 2, y0 + 3, 2, 3); ctx.fillRect(hx - 2, y1 - 6, 2, 3); } else { ctx.fillRect(x0 + 3, hy - 2, 3, 2); ctx.fillRect(x1 - 6, hy - 2, 3, 2); }
  const gx = c.h ? hx + c.d * 40 : (x0 + x1) / 2, gy = c.h ? (y0 + y1) / 2 : hy + c.d * 40, lg = ctx.createRadialGradient(gx, gy, 4, gx, gy, 42);
  lg.addColorStop(0, "rgba(255,236,170,.14)"); lg.addColorStop(1, "rgba(255,236,170,0)"); ctx.fillStyle = lg; ctx.fillRect(gx - 42, gy - 42, 84, 84);
}
function panel(ctx, x, y, w, h) { ctx.fillStyle = "rgba(8,11,16,.8)"; ctx.strokeStyle = "rgba(201,162,77,.35)"; ctx.lineWidth = 1; ctx.beginPath(); ctx.roundRect(x, y, w, h, 6); ctx.fill(); ctx.stroke(); }

function draw(g, ctx) {
  const cam = g.cam, A = g.ag[g.act], tg = g.tgt;
  ctx.fillStyle = "#0b0e13"; ctx.fillRect(0, 0, VW, FH);
  ctx.save(); ctx.beginPath(); ctx.rect(0, TOP, VW, VH); ctx.clip(); ctx.translate(-Math.round(cam.x), TOP - Math.round(cam.y));
  ctx.drawImage(g.bg, Math.round(cam.x), Math.round(cam.y), VW, VH, Math.round(cam.x), Math.round(cam.y), VW, VH);
  const onScr = (e, m = 60) => e.x > cam.x - m && e.x < cam.x + VW + m && e.y > cam.y - m && e.y < cam.y + VH + m;
  // двері укриття (коли об'єкт іде до них)
  if (tg.wi === g.wp.length - 1) { const d = g.rt.door; ctx.fillStyle = "rgba(224,100,92,.25)"; ctx.beginPath(); ctx.arc(d.x, d.y, 18 + Math.sin(g.t * 4) * 3, 0, 7); ctx.fill(); ctx.fillStyle = "#e0645c"; ctx.font = "bold 10px Inter, sans-serif"; ctx.textAlign = "center"; ctx.fillText("УКРИТТЯ", d.x, d.y - 22); }
  // місця зустрічей: позначка запису, коли оперативник поруч
  for (const c of g.cons) if (c.st === "meet" && !c.audioDone && c.audio > 0) { ctx.strokeStyle = COL.ok; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(A.x, A.y, 20, -1.57, -1.57 + 6.283 * c.audio / 3.5); ctx.stroke(); }
  // зони огляду
  const [tf, tr] = tgtView(g);
  if (tg.alpha > .5) cone(ctx, g, tg, tf, tr, tg.st === "check" ? "rgba(240,90,80,A)" : "rgba(224,100,92,A)");
  for (const w of g.wats) if (w.photo) cone(ctx, g, w, 1.3, 200, "rgba(176,127,224,A)");
  for (const c of g.civ) if (onScr(c)) drawPerson(ctx, c, g);
  for (const c of g.cons) if (c.alpha > 0 && onScr(c)) drawPerson(ctx, c, g);
  for (const w of g.wats) if (onScr(w)) drawPerson(ctx, w, g);
  if (onScr(tg)) drawPerson(ctx, tg, g);
  g.ag.forEach((a, n) => { if (n !== g.act && onScr(a)) drawPerson(ctx, a, g); });
  drawPerson(ctx, A, g);
  for (const c of g.cars) if (onScr({ x: c.h ? c.s : c.c, y: c.h ? c.c : c.s }, 80)) drawCar(ctx, c);
  // кадр камери
  for (const f of g.fx) if (f.k === "shot") {
    ctx.fillStyle = `rgba(255,255,255,${f.t * .9})`; ctx.beginPath(); ctx.moveTo(f.x, f.y); ctx.arc(f.x, f.y, 340, f.a - .3, f.a + .3); ctx.closePath(); ctx.fill();
  }
  // приціл камери
  const mx = g.mx + cam.x, my = g.my + cam.y;
  ctx.strokeStyle = "rgba(233,217,168,.5)"; ctx.lineWidth = 1; ctx.setLineDash([3, 4]); ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(A.x + Math.cos(A.a - .3) * 340, A.y + Math.sin(A.a - .3) * 340); ctx.moveTo(A.x, A.y); ctx.lineTo(A.x + Math.cos(A.a + .3) * 340, A.y + Math.sin(A.a + .3) * 340); ctx.stroke(); ctx.setLineDash([]);
  ctx.strokeStyle = "#e9d9a8"; ctx.strokeRect(mx - 9, my - 7, 18, 14); ctx.beginPath(); ctx.arc(mx, my, 3, 0, 7); ctx.stroke();
  for (const m of g.msgs) { ctx.globalAlpha = Math.min(1, m.t); ctx.font = "bold 12px 'Inter', sans-serif"; ctx.textAlign = "center"; ctx.fillStyle = "rgba(0,0,0,.7)"; ctx.fillText(m.text, m.x + 1, m.y + 1); ctx.fillStyle = m.col; ctx.fillText(m.text, m.x, m.y); }
  ctx.globalAlpha = 1;
  ctx.restore();
  // вечір: віньєтка
  const vg = ctx.createRadialGradient(VW / 2, TOP + VH / 2, VH * .35, VW / 2, TOP + VH / 2, VW * .7);
  vg.addColorStop(0, "rgba(5,8,14,0)"); vg.addColorStop(1, "rgba(5,8,14,.55)"); ctx.fillStyle = vg; ctx.fillRect(0, TOP, VW, VH);
  // стрілка до об'єкта, якщо він поза екраном
  const sx = tg.x - cam.x, sy = tg.y - cam.y;
  if (tg.alpha > .3 && (sx < 0 || sx > VW || sy < 0 || sy > VH)) {
    const a = Math.atan2(sy - VH / 2, sx - VW / 2), ex = VW / 2 + Math.cos(a) * (VW / 2 - 30), ey = TOP + VH / 2 + Math.sin(a) * (VH / 2 - 30);
    const px = Math.max(24, Math.min(VW - 24, ex)), py = Math.max(TOP + 24, Math.min(TOP + VH - 24, ey));
    ctx.save(); ctx.translate(px, py); ctx.rotate(a); ctx.fillStyle = g.lostT > 0 ? "rgba(224,100,92,.5)" : COL.tgt; ctx.beginPath(); ctx.moveTo(14, 0); ctx.lineTo(-8, -9); ctx.lineTo(-8, 9); ctx.closePath(); ctx.fill(); ctx.restore();
  }
  if (g.lostT > 2) { ctx.fillStyle = "rgba(224,100,92,.9)"; ctx.font = "bold 18px 'Inter', sans-serif"; ctx.textAlign = "center"; ctx.fillText(`Об'єкт поза полем зору · ${Math.ceil(LOST - g.lostT)} с`, VW / 2, TOP + 34); }
  if (g.banner) { ctx.globalAlpha = Math.min(1, g.banner.t * 2); panel(ctx, VW / 2 - 200, TOP + VH - 56, 400, 36); ctx.fillStyle = "#bfe6c9"; ctx.font = "bold 14px 'Inter', sans-serif"; ctx.textAlign = "center"; ctx.fillText(g.banner.text, VW / 2, TOP + VH - 33); ctx.globalAlpha = 1; }
  hud(g, ctx);
}
function hud(g, ctx) {
  const A = g.ag[g.act];
  const bar = (y, h) => { const gr = ctx.createLinearGradient(0, y, 0, y + h); gr.addColorStop(0, "#0f131a"); gr.addColorStop(1, "#0a0d12"); ctx.fillStyle = gr; ctx.fillRect(0, y, VW, h); ctx.fillStyle = "rgba(201,162,77,.45)"; ctx.fillRect(0, y === 0 ? h - 1 : y, VW, 1); };
  bar(0, TOP); bar(TOP + VH, BOT);
  ctx.textAlign = "left"; ctx.fillStyle = COL.gold; ctx.font = "bold 10px 'Inter', sans-serif"; ctx.fillText("ОРВ СБУ · НЕГЛАСНЕ СПОСТЕРЕЖЕННЯ", 16, 19);
  ctx.fillStyle = "#ece6d6"; ctx.font = "bold 16px 'Inter', sans-serif"; ctx.fillText(`${g.L.name} · об'єкт «${g.L.code}»`, 16, 39);
  ctx.textAlign = "center"; ctx.font = "bold 20px 'JetBrains Mono', monospace"; ctx.fillText(`${Math.floor(g.t / 60)}:${String(Math.floor(g.t % 60)).padStart(2, "0")}`, 470, 33);
  // шкала підозри
  const x0 = 560, w = 230, s = Math.min(100, g.susp);
  ctx.textAlign = "left"; ctx.fillStyle = COL.gold; ctx.font = "bold 10px 'Inter', sans-serif"; ctx.fillText("ПІДОЗРА ОБ'ЄКТА", x0, 17);
  ctx.fillStyle = "rgba(255,255,255,.07)"; ctx.fillRect(x0, 23, w, 14);
  ctx.fillStyle = s > 70 ? "#e0645c" : s > 40 ? "#e8a33c" : "#5fb37a"; ctx.fillRect(x0, 23, w * s / 100, 14);
  ctx.fillStyle = "rgba(255,255,255,.35)"; ctx.fillRect(x0 + w * .5, 21, 1, 18);
  ctx.fillStyle = "#ece6d6"; ctx.font = "bold 11px 'JetBrains Mono', monospace"; ctx.fillText(s > 50 ? "НЕРВУЄ" : g.seenBy.length ? "ПОМІЧАЄ" : "спокійний", x0 + w + 8, 35);
  const met = g.cons.filter((c) => c.photo).length;
  ctx.textAlign = "right"; ctx.font = "bold 13px 'Inter', sans-serif"; ctx.fillStyle = COL.con; ctx.fillText(`Контакти ${met}/${g.cons.length}`, VW - 16, 22);
  ctx.fillStyle = "#bfe6c9"; ctx.fillText(`Докази ${g.ev.length}`, VW - 16, 41);
  // низ
  const y0 = TOP + VH;
  ctx.textAlign = "left"; ctx.fillStyle = COL.gold; ctx.font = "bold 10px 'Inter', sans-serif";
  ctx.fillText(A.who ? `${(A.who.callsign || A.who.name).toUpperCase()} · ${A.who.rankShort}` : "ОПЕРАТИВНИК", 16, y0 + 20);
  ctx.fillStyle = "#8a93a3"; ctx.font = "11px 'Inter', sans-serif"; ctx.fillText("Впізнаваність", 16, y0 + 38);
  ctx.fillStyle = "rgba(255,255,255,.07)"; ctx.fillRect(100, y0 + 29, 90, 10); ctx.fillStyle = "#e8a33c"; ctx.fillRect(100, y0 + 29, Math.min(90, A.fam * 9), 10);
  ctx.fillStyle = A.cover ? "#5fb37a" : "#5d6573"; ctx.fillText(A.cover ? "● у натовпі" : "○ відкрито", 16, y0 + 55);
  ctx.fillStyle = A.run ? "#e0645c" : "#5d6573"; ctx.fillText(A.run ? "● біжите" : "", 100, y0 + 55);
  ctx.fillStyle = COL.gold; ctx.font = "bold 10px 'Inter', sans-serif"; ctx.fillText("ПЛІВКА", 214, y0 + 20); ctx.fillText("ОБРАЗ", 304, y0 + 20);
  ctx.fillStyle = "#ece6d6"; ctx.font = "bold 16px 'JetBrains Mono', monospace"; ctx.fillText(`${g.film}`, 214, y0 + 44); ctx.fillText(`${g.disguise}`, 304, y0 + 44);
  if (g.ag.length > 1) { ctx.fillStyle = COL.gold; ctx.font = "bold 10px 'Inter', sans-serif"; ctx.fillText("НАПАРНИК", 360, y0 + 20); const m = g.ag[1 - g.act]; ctx.fillStyle = COL.mate; ctx.font = "12px 'Inter', sans-serif"; ctx.fillText(m.who ? (m.who.callsign || m.who.name) : "—", 360, y0 + 40); }
  ctx.fillStyle = "#8a93a3"; ctx.font = "12px 'Inter', sans-serif";
  ctx.fillText("WASD рух · Shift біг · ЛКМ фото · Q передати напарнику", 490, y0 + 27);
  ctx.fillText("E змінити образ біля кіоску · Esc пауза", 490, y0 + 45);
  // міні-карта
  const mw = 92, mh = 56, mx = VW - mw - 14, my = y0 + 5;
  ctx.drawImage(g.bg, mx, my, mw, mh); ctx.fillStyle = "rgba(5,8,14,.35)"; ctx.fillRect(mx, my, mw, mh); ctx.strokeStyle = "rgba(201,162,77,.5)"; ctx.strokeRect(mx - .5, my - .5, mw + 1, mh + 1);
  const dot = (e, c, r = 2.5) => { ctx.fillStyle = c; ctx.beginPath(); ctx.arc(mx + e.x / MW * mw, my + e.y / MH * mh, r, 0, 7); ctx.fill(); };
  dot(g.tgt, COL.tgt, 3); g.ag.forEach((a, n) => dot(a, n === g.act ? COL.gold : COL.mate));
  ctx.strokeStyle = "rgba(233,217,168,.6)"; ctx.strokeRect(mx + g.cam.x / MW * mw, my + g.cam.y / MH * mh, VW / MW * mw, VH / MH * mh);
}

// ---------------------------------------------------------------- підсумок
function score(g, ok) {
  if (!ok) return { total: 0, parts: [] };
  const sum = (k) => g.ev.filter((e) => e.k === k).reduce((a, e) => a + e.pts, 0);
  const parts = [["Фото контактів", sum("con")], ["Фото передачі", sum("xchg")], ["Записи розмов", sum("audio")], ["Контрспостерігачі", sum("wat")],
    ["Фото об'єкта й укриття", sum("tgt") + sum("door")], ["Скритність", Math.max(0, Math.round((100 - g.maxSusp) * 8))], ["Зекономлена плівка", g.film * 5]];
  return { total: Math.max(0, parts.reduce((a, [, v]) => a + v, 0)), parts };
}
function finish(g, ok, why) {
  if (g.over) return;
  const sc = score(g, ok), met = g.cons.filter((c) => c.photo).length, xchg = g.cons.filter((c) => c.photoX).length, audio = g.cons.filter((c) => c.audioDone).length;
  const grade = !ok ? "—" : met === g.cons.length && xchg && g.maxSusp < 45 && sc.total > 1500 + g.cons.length * 700 ? "S" : met === g.cons.length ? "A" : met ? "B" : "C";
  g.over = { ok, why, sc, grade };
  g.keys = {};
  if (ok) call("/api/game/score", { json: { game: "tail", level: g.i, score: sc.total, ms: Math.round(g.t * 1000),
    data: { photos: g.L.film - g.film, contacts: met, exchange: xchg, audio, watchers: g.wats.filter((w) => w.photo).length, maxSusp: Math.round(g.maxSusp),
      swaps: g.swaps, disguise: 2 - g.disguise, grade, partner: st.mate ? st.mate.sid : null, film: g.film } } })
    .then((x) => { st.best[g.i] = Math.max(st.best[g.i] || 0, sc.total); if (x && x.record) toast("Новий особистий рекорд!"); }).catch(() => {});
  const box = document.getElementById("tl-over");
  if (!box) return;
  const L = g.L, charges = (LEVELS[L.law] || LEVELS[0]).charges;
  box.innerHTML = `<div class="gm-card ${ok ? "ok" : "bad"}"><div class="eyebrow">Довідка за результатами спостереження · об'єкт «${esc(L.code)}»</div>
    <h3>${ok ? "Спостереження завершено" : "Спостереження зірвано"}</h3>${why ? `<p class="muted">${esc(why)}</p>` : ""}
    ${ok ? `<div class="gm-grade g-${grade}">${grade}</div><table class="gm-t">${sc.parts.map(([n, v]) => `<tr><td>${esc(n)}</td><td>${v > 0 ? "+" : ""}${v}</td></tr>`).join("")}
      <tr class="sum"><td>Разом</td><td>${sc.total}</td></tr></table>` : ""}
    <ul class="gm-notes">
      <li class="${met === g.cons.length ? "ok" : met ? "" : "bad"}">Встановлено контактів: ${met} з ${g.cons.length}${g.cons.filter((c) => c.photo).length ? ` — ${g.cons.filter((c) => c.photo).map((c) => esc(c.name)).join(", ")}` : ""}</li>
      ${xchg ? `<li class="ok">Зафіксовано передачу: ${xchg}</li>` : ok ? `<li class="bad">Передачу не зафіксовано — без цього кадру зв'язок важко довести.</li>` : ""}
      ${audio ? `<li class="ok">Записів розмов: ${audio}</li>` : ""}
      ${g.wats.length ? `<li>Контрспостерігачів встановлено: ${g.wats.filter((w) => w.photo).length} з ${g.wats.length}</li>` : ""}
      <li>Найвища підозра: ${Math.round(g.maxSusp)}% · передач напарнику: ${g.swaps} · змін образу: ${2 - g.disguise} · кадрів: ${L.film - g.film}</li></ul>
    ${ok ? `<div class="gm-law"><b>📖 Що далі</b>
      <div>Матеріали фото- й аудіофіксації опечатати й долучити до кейс-файлу ОРВ (ст. 12 ПК) — вони допустимі докази (ст. 10 ПК).</div>
      <div>Кваліфікація: ${charges.map(([a, t]) => `<span><i>${a}</i> ${esc(t)}</span>`).join("")}</div>
      <div>${grade === "C" ? "Доказів недостатньо для клопотання — розробку доведеться продовжити." : "Клопотання: ордер на обшук укриття й повідомлення про підозру → погодження начальником відділу, НУ, Головою СБУ та Генпрокурором."}</div></div>` : ""}
    <div class="acts"><button class="btn" data-a="tlmenu">До меню</button><button class="btn gold" data-a="tlplay" data-l="${g.i}">Ще раз</button>
      ${ok && g.i < 2 ? `<button class="btn ok" data-a="tlplay" data-l="${g.i + 1}">Наступна розробка →</button>` : ""}</div></div>`;
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
  if (!g || !document.getElementById("tl-canvas")) return stop();
  if (["KeyW", "KeyA", "KeyS", "KeyD", "Space", "KeyQ", "KeyE"].includes(e.code) && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) e.preventDefault();
  const down = e.type === "keydown";
  g.keys[e.code] = down;
  if (!down || e.repeat || g.over || g.brief) return;
  if (e.code === "Escape") { g.paused = !g.paused; return; }
  if (g.paused) return;
  if (e.code === "KeyQ") swap(g);
  if (e.code === "KeyE") disguise(g);
  if (e.code === "Space") photo(g);
}
function start(i) {
  stop();
  const cv = document.getElementById("tl-canvas");
  if (!cv) return;
  const ctx = cv.getContext("2d"), g = st.g = build(i);
  g.paused = true; g.brief = true;
  g.cam.x = Math.max(0, Math.min(MW - VW, g.ag[0].x - VW / 2)); g.cam.y = Math.max(0, Math.min(MH - VH, g.ag[0].y - VH / 2));
  const box = document.getElementById("tl-over");
  box.innerHTML = `<div class="gm-card gm-brief"><div class="eyebrow">Завдання на спостереження · ОРВ СБУ · ${esc(g.L.name)}</div><h3>Об'єкт «${esc(g.L.code)}»</h3>
    <p>${esc(g.L.brief)}</p><p>Об'єкт: <b>${esc(g.L.target)}</b>. Очікуваних зустрічей: <b>${g.cons.length}</b>${g.wats.length ? `, контрспостерігачів: <b>${g.wats.length}</b> (ідуть позаду й оглядаються — їх теж варто сфотографувати)` : ""}.</p>
    ${g.ag[1] ? `<p>Напарник: <b>${esc(g.ag[1].who.rankShort)} ${esc(g.ag[1].who.name)}</b> (${esc(g.ag[1].who.deptS)}) чекає біля маршруту. Клавіша <b>Q</b> — передати йому об'єкт, щоб вас не запам'ятали.</p>` : `<p>Без напарника: доведеться частіше міняти образ (кіоски «ПРЕСА» й «КАВА» на площах).</p>`}
    <div class="gm-law"><b>📖 Правова підстава</b><span><i>Кейс-файл</i> Санкцію на негласне стеження та прослуховування надано</span>${LAW.slice(0, 3).map(([a, t]) => `<span><i>${a}</i> ${esc(t)}</span>`).join("")}</div>
    <div class="acts"><button class="btn" data-a="tlmenu">Скасувати</button><button class="btn gold" data-a="tlgo">Почати спостереження ▶</button></div></div>`;
  box.hidden = false;
  const pos = (e) => { const r = cv.getBoundingClientRect(); g.mx = (e.clientX - r.left) * VW / r.width; g.my = (e.clientY - r.top) * FH / r.height - TOP; };
  cv.onmousemove = pos;
  cv.onmousedown = (e) => { pos(e); if (e.button === 0 && !g.over && !g.paused) photo(g); };
  cv.oncontextmenu = (e) => e.preventDefault();
  window.addEventListener("keydown", onKey); window.addEventListener("keyup", onKey);
  let last = performance.now();
  const loop = (now) => {
    if (!document.getElementById("tl-canvas")) return stop();
    const dt = Math.min(.05, (now - last) / 1000); last = now;
    if (!g.paused && !g.over) update(g, dt);
    draw(g, ctx);
    if (g.paused && !g.brief) { ctx.fillStyle = "rgba(0,0,0,.6)"; ctx.fillRect(0, 0, VW, FH); ctx.fillStyle = COL.gold; ctx.font = "bold 28px 'Inter', sans-serif"; ctx.textAlign = "center"; ctx.fillText("ПАУЗА · Esc", VW / 2, FH / 2); }
    st.raf = requestAnimationFrame(loop);
  };
  st.raf = requestAnimationFrame(loop);
  cv.focus({ preventScroll: true });
  document.querySelector(".gm-wrap").scrollIntoView({ block: "start", behavior: "smooth" });
}

// ---------------------------------------------------------------- сторінка
async function view() {
  stop();
  const [b, ppl] = await Promise.all([call("/api/game/tail").catch(() => ({ mine: {}, week: [], all: [], weekly: [], depts: [], badges: [] })),
    st.people ? Promise.resolve(st.people) : call("/api/game/people").catch(() => null)]);
  st.board = b; st.best = b.mine || {}; st.people = ppl;
  if (st.lvl !== null) {
    const L = st.lvl === 3 ? weekly() : LEVELS[st.lvl];
    setTimeout(() => start(st.lvl), 30);
    return `<div class="gm-bar"><button class="btn" data-a="tlmenu">← Розробки</button><b>${esc(L.name)} · «${esc(L.code)}»</b><span class="muted small">${esc(L.brief)}</span>
        <span class="sp"></span><button class="btn" data-a="gmfs">⛶ На весь екран</button></div>
      <div class="gm-wrap"><canvas id="tl-canvas" width="${VW}" height="${FH}" tabindex="0"></canvas><div class="gm-over" id="tl-over" hidden></div></div>
      <p class="muted small">Порада: тримайтеся позаду й збоку, ховайтеся за машинами й у натовпі, не біжіть у полі зору. Коли об'єкт оглядається (червоний конус ширшає) — зупиніться за укриттям.</p>`;
  }
  const me = S.ME().me;
  const lb = (rows) => rows.length ? `<ol class="gm-lb">${rows.map((r, n) => `<li class="${r.sid === me.sid ? "me" : ""}"><b>${n + 1}</b><span>${esc(r.rankShort || "")} ${esc(r.name)} <i class="muted">${esc(r.deptS || "")}</i></span><em>${r.score}</em></li>`).join("")}</ol>` : '<p class="muted small">Ще ніхто не пройшов.</p>';
  const dl = (rows) => rows.length ? `<ol class="gm-lb">${rows.map((r, n) => `<li class="${r.dept === me.dept ? "me" : ""}"><b>${n + 1}</b><span>${esc(r.n)} <i class="muted">учасників: ${r.players}</i></span><em>${r.avg}</em></li>`).join("")}</ol>` : '<p class="muted small">Ще немає результатів.</p>';
  const team = (ppl && ppl.team) || [];
  return `<div class="gm-crumbs"><button class="btn sm" data-a="trhub">← Усі тренажери</button></div>
    <div class="gm-hero tl-hero"><div><div class="eyebrow">Тренажер ОРВ · ЄІС «Сова»</div><h2>ХВІСТ</h2>
      <p>Негласне стеження в місті. Ведіть об'єкт до укриття, <b>не засвітившись</b>: дистанція, натовп, машини, зміна образу й передача напарнику. Фотографуйте <b>контакти й передачу</b>, записуйте розмови — це докази для кейс-файлу.</p>
      <div class="gm-keys"><span><b>WASD</b> рух</span><span><b>Shift</b> біг (помітніше)</span><span><b>ЛКМ / Пробіл</b> фото</span><span><b>Q</b> передати напарнику</span><span><b>E</b> змінити образ біля кіоску</span><span><b>Esc</b> пауза</span></div>
      <label class="gm-mate">🤝 Напарник: <select class="i" id="tl-mate"><option value="">— без напарника —</option>${team.map((t) => `<option value="${t.sid}" ${st.mate && st.mate.sid === t.sid ? "selected" : ""}>${esc(t.rankShort)} ${esc(t.callsign || t.name)} · ${esc(t.deptS)}</option>`).join("")}</select></label>
      ${(b.badges || []).length ? `<div class="gm-badges">${b.badges.map((x) => `<span title="${esc(x.t)}">${x.icon} ${esc(x.t)}</span>`).join("")}</div>` : ""}
      <p class="muted small">Результати не впливають на бали підвищення й премії. Потрібні клавіатура й миша.</p></div>
      <div class="gm-legend"><span style="color:${COL.gold}">●</span><i>ви</i><span style="color:${COL.mate}">●</span><i>напарник</i><span style="color:${COL.tgt}">●</span><i>об'єкт і його огляд</i><span style="color:${COL.con}">●</span><i>контакт</i><span style="color:${COL.wat}">●</span><i>контрспостерігач</i><span>👁</span><i>вас бачать</i></div></div>
    <div class="gm-levels">${LEVELS.map((L, i) => `<button class="gm-lvl" data-a="tlplay" data-l="${i}"><span class="eyebrow">Розробка ${i + 1} · ${["легка", "середня", "складна"][i]}</span><b>${esc(L.name)} · «${esc(L.code)}»</b><p>${esc(L.brief)}</p>
      <span class="gm-best">Ваш рекорд: <b>${st.best[i] || "—"}</b></span></button>`).join("")}
      <button class="gm-lvl gm-weekly" data-a="tlplay" data-l="3"><span class="eyebrow">⚡ Операція тижня · нове місто й маршрут</span><b>${esc(weekly().name)}</b><p>Однакова для всіх цього тижня. Двоє контрспостерігачів, окремий рейтинг.</p>
      <span class="gm-best">Ваш результат тижня: <b>${st.best[3] || "—"}</b></span></button></div>
    <div class="grid2"><div class="card"><header><h3>🏆 Рейтинг тижня</h3><span class="muted small">сума найкращих результатів</span></header>${lb(b.week || [])}</div>
      <div class="card"><header><h3>🛡 Підрозділ тижня</h3><span class="muted small">середній результат учасників</span></header>${dl(b.depts || [])}</div>
      <div class="card"><header><h3>⚡ Операція тижня</h3></header>${lb(b.weekly || [])}</div>
      <div class="card"><header><h3>⭐ Найкращі за весь час</h3></header>${lb(b.all || [])}</div></div>
    <div class="card gm-law-card"><header><h3>📖 Довідка оперативника ОРВ</h3><span class="muted small">законодавча база NG</span></header>
      <div class="gm-law">${LAW.map(([a, t]) => `<span><i>${a}</i> ${esc(t)}</span>`).join("")}<span><i>ст. 328 КК</i> Розкриття особи негласного співробітника — тяжкі наслідки, до 8 років</span></div></div>`;
}
S.games = S.games || {};
S.games.tail = { view, stop };
Object.assign(S.actions, {
  tlplay: (b) => {
    const sel = document.getElementById("tl-mate");
    if (sel) st.mate = ((st.people || {}).team || []).find((t) => String(t.sid) === sel.value) || null;
    st.lvl = +b.dataset.l; S.render();
  },
  tlgo: () => { const g = st.g; if (!g) return; g.paused = false; g.brief = false; document.getElementById("tl-over").hidden = true; document.getElementById("tl-canvas").focus({ preventScroll: true }); },
  tlmenu: () => { stop(); st.lvl = null; S.render(); },
});
})();
