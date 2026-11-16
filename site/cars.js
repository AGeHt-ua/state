/* База даних → «Особистий транспорт»: реєстр авто співробітників (ОТ-0001…). Заявка з фото → затвердження
   Начальником управління, Заступником Голови або Головою СБУ → свідоцтво. Підстави: п. 1.28 Заборон СБУ
   (патрулювання на особистому авто — лише після затвердження), ст. 20 Дорожнього кодексу, р. VII Внутрішнього статуту.
   Підключається після kb.js. */
(() => {
const S = window.SOVA;
const { esc, call, toast, fmtDT } = S;
const st = { id: null, edit: null, doc: null, meta: null, q: "", f: "reg" };
const CHIP = { wait: "wait", ok: "ok", rej: "bad", revoked: "mute" };
const LAW = [
  ["Заборони СБУ, п. 1.28", "Патрулювати на особистому автотранспорті без офіційного затвердження заборонено — усне зауваження або письмова догана."],
  ["Дорожній кодекс, ст. 20", "На приватних авто заборонені стробоскопи, маячки, приховані сирени й символіка оперативних служб."],
  ["Внутрішній статут СБУ, р. VII", "Зберігати табельне майно в особистому транспорті заборонено — сувора догана зі стягненням вартості."],
  ["Закон про Державні документи, ст. 16–17", "Керувати можна лише з посвідченням водія відповідної категорії (A, B, C / D)."],
];

// фото з Discord: посилання беремо окремим запитом і пам'ятаємо на сеанс
const urls = new Map();
async function loadImgs() {
  for (const img of document.querySelectorAll("img.car-img[data-fid]:not([src])")) {
    const fid = img.dataset.fid;
    img.src = "data:image/gif;base64,R0lGODlhAQABAAAAACw=";  // позначка «вже вантажиться»
    try {
      if (!urls.has(fid)) urls.set(fid, (await call(`/api/files/${encodeURIComponent(fid)}/url`)).url);
      img.src = urls.get(fid);
    } catch (e) { img.closest(".car-pic")?.classList.add("none"); }
  }
}
new MutationObserver(() => { if (document.querySelector("img.car-img[data-fid]:not([src])")) loadImgs(); })
  .observe(document.body, { childList: true, subtree: true });

const pic = (fid, cls = "") => `<div class="car-pic ${cls}${fid ? "" : " none"}">${fid ? `<img class="car-img" data-fid="${esc(fid)}" alt="">` : ""}<span>🚗</span></div>`;
const plate = (p) => `<span class="car-plate"><i>NG</i>${esc(p || "—")}</span>`;
const who = (u) => u ? `${esc(u.rankName)} ${esc(u.name)} · №${u.sid}` : "—";

async function load() {
  st.meta = await call("/api/cars");
  return st.meta;
}

async function listView() {
  const r = await load(), R = r.rights, me = S.ME().me;
  const by = { reg: (c) => c.status === "ok", mine: (c) => c.owner === me.sid, wait: (c) => c.status === "wait", arch: (c) => c.status === "rej" || c.status === "revoked" };
  const n = (k) => r.items.filter(by[k]).length;
  const tabs = [["reg", "Реєстр", n("reg")], ["mine", "Мої", n("mine")], R.approve && ["wait", "На затвердженні", n("wait")], (R.approve || n("arch")) && ["arch", "Відмови й анульовані", n("arch")]].filter(Boolean);
  if (!tabs.some((t) => t[0] === st.f)) st.f = "reg";
  const items = r.items.filter(by[st.f]), q = st.q.toLowerCase();
  return `<div class="fin-head car-head"><div><div class="eyebrow">База даних СБУ · реєстр ЄІС «Сова»</div><b>Особистий транспорт</b></div>
      <input class="i prot-q" id="car-q" placeholder="Пошук: номер, марка, колір, власник, жетон…" value="${esc(st.q)}">
      ${R.submit ? '<button class="btn gold" data-a="carnew">+ Зареєструвати авто</button>' : ""}</div>
    <p class="note">Особистий автомобіль можна використовувати на службі (патрулювання, виїзди, негласні заходи) лише після затвердження
      Начальником управління, Заступником Голови або Головою СБУ (п. 1.28 Заборон СБУ). Зареєстровані авто бачать усі співробітники.</p>
    <div class="car-filter">${tabs.map(([k, l, c]) => `<button class="${st.f === k ? "on" : ""}" data-a="carf" data-v="${k}">${l}${c ? `<em>${c}</em>` : ""}</button>`).join("")}</div>
    ${items.length ? `<div class="car-grid" id="car-list">${items.map((c) => { const x = c.data, o = c.ownerUser || {};
      const key = [c.no, x.plate, x.model, x.color, o.name, c.owner, o.callsign].join(" ").toLowerCase();
      return `<article class="car-card st-${c.status}" data-a="caropen" data-id="${c.id}" data-q="${esc(key)}"${q && !key.includes(q) ? " hidden" : ""}>
        ${pic(x.photo)}
        <div class="car-body"><div class="car-top">${plate(x.plate)}<span class="chip ${CHIP[c.status] || "mute"}">${esc(c.statusName)}</span></div>
          <h4>${esc(x.model)}${x.year ? ` <small>${esc(x.year)}</small>` : ""}</h4>
          <div class="car-line"><span class="car-dot" style="--c:${esc(colorCss(x.color))}"></span>${esc(x.color || "—")} · ${esc((r.kind || {})[x.kind] || "")}</div>
          <div class="car-own">${who(o)}${o.deptName ? ` · ${esc(o.deptName)}` : ""}</div>
          <div class="car-no">${esc(c.no)}</div></div></article>`; }).join("")}</div>`
      : `<div class="empty">${st.f === "wait" ? "Заявок на затвердженні немає." : st.f === "mine" ? "Ви ще не реєстрували особистий транспорт." : "Записів немає."}</div>`}`;
}

// колір-крапка: назва кольору українською → CSS (для прикраси; невідоме — сіре)
const COLORS = { чорн: "#111", біл: "#eee", сір: "#888", срібл: "#c0c4c8", червон: "#c62828", бордов: "#7b1d2a", син: "#1e4fa8", блакит: "#5aa9e6",
  зелен: "#2e7d32", жовт: "#e6c200", помаран: "#e57c1f", коричн: "#6d4c2f", беж: "#d8c3a0", фіолет: "#6a3fa0", рожев: "#e07aa5", золот: "#c9a05a", графіт: "#3a3f45" };
const colorCss = (n) => { const s = String(n || "").toLowerCase(); for (const [k, v] of Object.entries(COLORS)) if (s.includes(k)) return v; return "#5f6a7a"; };

function cert(c) {
  const x = c.data, o = c.ownerUser || {}, M = st.meta || {}, a = c.approverUser;
  const row = (k, v) => `<tr><th>${k}</th><td>${v || "—"}</td></tr>`;
  const stamp = { ok: ["ЗАРЕЄСТРОВАНО", "ok"], wait: ["НА ЗАТВЕРДЖЕННІ", "wait"], rej: ["ВІДМОВЛЕНО", "bad"], revoked: ["АНУЛЬОВАНО", "bad"] }[c.status];
  const last = (c.history || []).slice(-1)[0] || {};
  return `<div class="blank car-cert${c.status === "revoked" || c.status === "rej" ? " void" : ""}">
    <div class="prot-head"><div>СЛУЖБА БЕЗПЕКИ ШТАТУ NG<br><small>Реєстр особистого транспорту співробітників</small></div><div class="prot-no">№ ${esc(c.status === "ok" || c.status === "revoked" ? c.no : "ОТ-____")}</div></div>
    <div class="blank-title">СВІДОЦТВО ПРО РЕЄСТРАЦІЮ</div><div class="prot-sub">особистого транспортного засобу для службового використання · п. 1.28 Заборон СБУ</div>
    <div class="car-cert-top">${pic(x.photo, "big")}<div class="car-cert-id">${plate(x.plate)}<b>${esc(x.model)}</b><span>${esc(x.color || "")}${x.year ? ` · ${esc(x.year)} р.` : ""}</span></div></div>
    <table class="prot-t">
      ${row("1. Власник", `<b>${esc(o.rankName || "")} ${esc(o.name || "")}</b>, жетон № ${c.owner}${o.deptName ? ` · ${esc(o.deptName)}` : ""}`)}
      ${row("2. Тип транспорту", esc((M.kind || {})[x.kind] || ""))}
      ${row("3. Категорія посвідчення", esc((M.category || {})[x.category] || ""))}
      ${row("4. Мета використання", (x.purpose || []).map((p) => esc((M.purpose || {})[p] || p)).join("; "))}
      ${row("5. Тонування", x.tint ? "так" : "ні")}
      ${row("6. Зміни та обладнання", esc(x.mods) || "без змін")}
      ${row("7. Зобов'язання власника", `${x.license ? "✔" : "✖"} має посвідчення водія відповідної категорії<br>${x.noSignals ? "✔" : "✖"} без спецсигналів і символіки служб (ст. 20 ДК)<br>${x.noGear ? "✔" : "✖"} не зберігає табельне майно в авто (р. VII Статуту)`)}
      ${x.note ? row("8. Примітка", esc(x.note).replace(/\n/g, "<br>")) : ""}
      ${(x.photos || []).length ? row("Додаткові фото", `<div class="car-thumbs">${x.photos.map((f) => pic(f, "sm")).join("")}</div>`) : ""}
    </table>
    ${c.status === "rej" || c.status === "revoked" ? `<div class="rej-note"><b>${c.status === "rej" ? "Причина відмови" : "Причина анулювання"}:</b> ${esc(last.note || "—")}</div>` : ""}
    <div class="prot-sign"><span>Затвердив: ${a && c.status !== "wait" ? `${esc(a.rankName)} ${esc(a.name)}` : "—"}</span><span class="kf-sign">${a && c.status === "ok" ? esc(a.name) : ""}</span><span>${c.decided ? fmtDT(c.decided) : "очікує рішення"}</span></div>
    ${stamp ? `<div class="prot-stamp ${stamp[1] === "ok" ? "ok" : ""}">${stamp[0]}</div>` : ""}</div>`;
}

async function docView(id) {
  if (!st.meta) await load();
  const c = await call(`/api/cars/${id}`);
  st.doc = c;
  const me = S.ME().me, mine = c.owner === me.sid, R = st.meta.rights;
  const btn = [
    c.status === "wait" && R.approve && `<button class="btn ok" data-a="carx" data-x="approve">✔ Затвердити</button><button class="btn bad" data-a="carx" data-x="reject">✖ Відмовити…</button>`,
    mine && (c.status === "wait" || c.status === "rej") && `<button class="btn" data-a="caredit">${c.status === "rej" ? "Виправити й подати знову" : "Редагувати"}</button>`,
    c.status === "ok" && (mine || R.approve) && `<button class="btn bad" data-a="carx" data-x="revoke">Анулювати…</button>`,
    ((mine && c.status !== "ok") || R.approve) && `<button class="btn bad" data-a="carx" data-x="delete">🗑</button>`,
  ].filter(Boolean).join("");
  const W = { create: "Подано заявку", edit: "Заявку змінено", resubmit: "Виправлено й подано знову", approve: "Затверджено", reject: "Відмовлено", revoke: "Анульовано", delete: "Видалено" };
  return `<div class="kd-bar"><button class="btn" data-a="carback">← До реєстру</button><span class="chip ${CHIP[c.status] || "mute"}">${esc(c.statusName)}</span><span class="sp"></span>${btn}</div>
    <div class="fin-page"><div>${cert(c)}</div>
    <aside class="card"><header><h3>Рух запису</h3></header><div class="aud">${c.history.slice().reverse().map((h) => `<div class="aud-it k-${["reject", "revoke", "delete"].includes(h.action) ? "down" : "in"}"><i></i>
      <div class="aud-when"><b>${new Date(h.t).toLocaleDateString("uk-UA", { day: "2-digit", month: "2-digit" })}</b><span>${new Date(h.t).toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit" })}</span></div>
      <div class="aud-body"><div class="aud-act">${W[h.action] || h.action}</div><div class="aud-who"><b>${esc(h.name)}</b> · ${esc(h.rank || "")}${h.note ? ` · «${esc(h.note)}»` : ""}</div></div></div>`).join("")}</div></aside></div>`;
}

function editView() {
  const e = st.edit, x = e.data, M = st.meta, me = S.ME().me;
  const opt = (o, v) => Object.entries(o).map(([k, l]) => `<option value="${k}" ${v === k ? "selected" : ""}>${esc(l)}</option>`).join("");
  const chk = (k, l) => `<label class="chk"><input type="checkbox" data-cx="${k}" ${x[k] ? "checked" : ""}> ${l}</label>`;
  return `<div class="kd-bar"><button class="btn" data-a="carback">← До реєстру</button><span class="sp"></span>
      <button class="btn gold" data-a="carsave">📨 ${e.id ? "Зберегти й подати" : "Подати на затвердження"}</button></div>
    <div class="grid2 rap-wrap prot-wrap"><form class="card form-grid" onsubmit="return false"><header class="wide"><h3>Заявка на реєстрацію особистого транспорту</h3>
        <div class="muted small">Подає ${esc(me.rankName)} ${esc(me.name)} · жетон № ${me.sid}</div></header>
      <div class="f wide"><span>Фотографія автомобіля (обов'язково; видно номерний знак)</span>
        <div class="car-up">${pic(x.photo, "big")}<div><input class="i" id="car-photo" type="file" accept="image/png,image/jpeg,image/webp">
          <p class="muted small">JPG, PNG або WEBP. Найкраще — збоку чи спереду під кутом, щоб було видно номер.</p></div></div></div>
      <label class="f"><span>Марка й модель</span><input class="i" data-cx="model" value="${esc(x.model)}" placeholder="Напр. Ubermacht Oracle" maxlength="60"></label>
      <label class="f"><span>Номерний знак</span><input class="i mono car-plate-in" data-cx="plate" value="${esc(x.plate)}" placeholder="SBU256" maxlength="8"></label>
      <label class="f"><span>Колір</span><input class="i" data-cx="color" value="${esc(x.color)}" placeholder="Чорний матовий" maxlength="40"></label>
      <label class="f"><span>Рік випуску (необов'язково)</span><input class="i mono" data-cx="year" value="${esc(x.year)}" placeholder="2024" maxlength="4" inputmode="numeric"></label>
      <label class="f"><span>Тип транспорту</span><select class="i" data-cx="kind">${opt(M.kind, x.kind)}</select></label>
      <label class="f"><span>Категорія посвідчення водія</span><select class="i" data-cx="category">${opt(M.category, x.category)}</select></label>
      <div class="f wide car-checks"><span>Мета використання на службі</span>${Object.entries(M.purpose).map(([k, l]) => `<label class="chk"><input type="checkbox" data-cp="${k}" ${x.purpose.includes(k) ? "checked" : ""}> ${esc(l)}</label>`).join("")}</div>
      <div class="f wide">${chk("tint", "Тоноване скло")}</div>
      <label class="f wide"><span>Зміни та додаткове обладнання (тюнінг, рація, сейф тощо)</span><input class="i" data-cx="mods" value="${esc(x.mods)}" maxlength="300"></label>
      <label class="f wide"><span>Примітка для керівництва (необов'язково)</span><textarea class="i" data-cx="note" maxlength="600">${esc(x.note)}</textarea></label>
      <label class="f wide"><span>Додаткові фото (до 4) ${(x.photos || []).length ? `· уже додано ${x.photos.length}` : ""}</span><input class="i" id="car-photos" type="file" multiple accept="image/png,image/jpeg,image/webp"></label>
      <div class="f wide car-checks car-oath"><span>Зобов'язання власника</span>
        ${chk("license", "Маю посвідчення водія відповідної категорії (ст. 16–17 Закону про Державні документи)")}
        ${chk("noSignals", "На авто немає стробоскопів, маячків, сирен і символіки служб (ст. 20 Дорожнього кодексу)")}
        ${chk("noGear", "Не зберігатиму табельне майно в особистому авто (Внутрішній статут СБУ, р. VII)")}</div>
    </form>
    <div class="prot-side"><div class="prot-hints"><div class="eyebrow">Законодавство штату NG</div>
      ${LAW.map(([t, d]) => `<p class="note"><b>${esc(t)}.</b> ${esc(d)}</p>`).join("")}
      <p class="note warn">⚠ Затверджують Начальник управління, Заступник Голови або Голова СБУ. До затвердження патрулювати на цьому авто не можна.</p></div></div></div>`;
}

S.carsView = async () => st.edit ? editView() : st.id ? docView(st.id) : listView();

const read = () => {
  const x = st.edit.data;
  document.querySelectorAll("[data-cx]").forEach((el) => { x[el.dataset.cx] = el.type === "checkbox" ? el.checked : el.value; });
  x.purpose = [...document.querySelectorAll("[data-cp]:checked")].map((el) => el.dataset.cp);
  x.plate = String(x.plate || "").toUpperCase().replace(/[^0-9A-ZА-ЯІЇЄҐ]/gi, "").slice(0, 8);
};
document.addEventListener("input", (e) => {
  if (e.target.id === "car-q") {
    st.q = e.target.value; const q = st.q.toLowerCase();
    document.querySelectorAll("#car-list .car-card").forEach((d) => { d.hidden = q && !d.dataset.q.includes(q); });
  }
  if (e.target.matches?.(".car-plate-in")) { const p = e.target.selectionStart; e.target.value = e.target.value.toUpperCase().replace(/[^0-9A-ZА-ЯІЇЄҐ]/gi, ""); e.target.setSelectionRange(p, p); }
});
document.addEventListener("change", (e) => {
  if (e.target.id !== "car-photo" || !e.target.files[0]) return;
  const box = e.target.closest(".car-up")?.querySelector(".car-pic");
  if (box) { box.classList.remove("none"); box.innerHTML = `<img src="${URL.createObjectURL(e.target.files[0])}" alt=""><span>🚗</span>`; }
});

const run = async (b, fn) => { if (b) b.disabled = true; try { await fn(); } catch (e) { toast(e.message, 1); } if (b) b.disabled = false; };
const fresh = () => ({ model: "", plate: "", color: "", year: "", kind: "sedan", category: "B", purpose: ["patrol"], tint: false, mods: "", note: "",
  photo: "", photos: [], license: false, noSignals: false, noGear: false });
Object.assign(S.actions, {
  carf: (b) => { st.f = b.dataset.v; S.render(); },
  carnew: () => { st.edit = { data: fresh() }; S.render(); scrollTo(0, 0); },
  caropen: (b) => { st.id = +b.dataset.id; st.edit = null; S.render(); scrollTo(0, 0); },
  carback: () => { if (st.edit) { st.id = st.edit.id || null; st.edit = null; } else st.id = null; S.render(); },
  caredit: () => { const c = st.doc; st.edit = { id: c.id, data: { ...fresh(), ...JSON.parse(JSON.stringify(c.data)) } }; S.render(); scrollTo(0, 0); },
  carsave: (b) => run(b, async () => {
    read();
    const e = st.edit, f = document.getElementById("car-photo"), fs = document.getElementById("car-photos");
    if (!e.data.photo && !(f && f.files.length)) throw new Error("Додайте фотографію автомобіля.");
    if (f && f.files.length) e.data.photo = (await S.uploadFiles(f))[0] || e.data.photo;
    if (fs && fs.files.length) e.data.photos = [...(e.data.photos || []), ...(await S.uploadFiles(fs))].slice(0, 4);
    const c = await call("/api/cars", { json: { id: e.id, data: e.data } });
    st.edit = null; st.id = c.id;
    toast("Заявку подано на затвердження");
    await S.refreshMe?.();
    S.render();
  }),
  carx: (b) => run(b, async () => {
    const x = b.dataset.x, body = {}, c = st.doc, mine = c.owner === S.ME().me.sid;
    if (x === "reject" || (x === "revoke" && !mine)) {
      const n = prompt(x === "reject" ? "Причина відмови — власник побачить її на сайті й у Discord:" : "Причина анулювання реєстрації:", "");
      if (n === null) return;
      if (n.trim().length < 3) throw new Error("Вкажіть причину (хоча б кілька слів).");
      body.note = n.trim();
    }
    if (x === "revoke" && mine && !confirm("Анулювати реєстрацію свого авто? Користуватися ним на службі вже не можна буде.")) return;
    if (x === "approve" && !confirm(`Затвердити реєстрацію ${c.data.model} · ${c.data.plate}?`)) return;
    if (x === "delete" && !confirm("Видалити запис з реєстру?")) return;
    await call(`/api/cars/${c.id}/${x}`, { json: body });
    toast({ approve: "Транспорт зареєстровано", reject: "У реєстрації відмовлено", revoke: "Реєстрацію анульовано", delete: "Запис видалено" }[x]);
    if (x === "delete") st.id = null;
    await S.refreshMe?.();
    S.render();
  }),
});
// адреса: #/kb/cars · #/kb/cars/12 · #/kb/cars/12/edit · #/kb/cars/new
const isId = (x) => /^\d+$/.test(x || "");
S.carsRoute = {
  get: () => st.edit ? [st.edit.id || "new", st.edit.id ? "edit" : null].filter(Boolean) : st.id ? [st.id] : [],
  set: (p) => { st.id = isId(p[0]) ? +p[0] : null; st.edit = p[0] === "new" ? { data: fresh() } : null; },
};
})();
