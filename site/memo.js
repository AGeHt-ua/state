/* База даних → Пам'ятка (коротка підказка: порядок затримання й найчастіші статті; повний перелік статей таблицею, будується з законодавчої бази й оновлюється разом із нею)
   і Порядок затримання (процесуальні дії крок за кроком з посиланнями на статті). Підключається після kb.js. */
(() => {
const S = window.SOVA;
const { esc, call, toast, fmtDT } = S;
const st = { code: "criminal-code", q: "", sec: "", lic: false, edit: false, open: new Set(), form: null, detEdit: null, check: false, done: new Set() };
const run = async (b, fn) => { if (b) b.disabled = true; try { await fn(); } catch (e) { toast(e.message, 1); } if (b) b.disabled = false; };
const day = (t) => t ? new Date(t).toLocaleDateString("uk-UA") : "—";
const norm = (s) => String(s || "").toLowerCase().replace(/[’']/g, "'");

/* ---------------------------------------------------------------- пам'ятка */
let MEMO = null;
const matches = (r) => {
  const q = norm(st.q).replace(/^ст\.?\s*/, "").trim();
  if (st.lic && !r.lic) return false;
  if (!q) return true;
  if (/^\d+([.-]\d+)*$/.test(q)) return r.key === q || r.art === q || r.key.startsWith(q + ".") || r.art.startsWith(q + ".") || r.art.startsWith(q + "-");
  return norm(`${r.title} ${r.desc} ${r.pen} ${r.note || ""} ${r.full}`).includes(q);
};

function rowHtml(r, first) {
  const id = r.key, open = st.open.has(id), A = MEMO.abbr;
  const badges = [r.fresh ? `<span class="mm-b new" title="Стаття змінилась або з'явилась після звіряння бази">оновлено ${day(r.fresh)}</span>` : "",
    r.stale ? `<span class="mm-b warn" title="Рядок поправлено вручну, а текст закону відтоді змінився — перевірте">⚠ закон змінився</span>` : "",
    r.edited && !r.stale ? `<span class="mm-b ed" title="Поправлено вручну: ${esc(r.edited.by || "")}, ${day(r.edited.t)}">✎</span>` : "",
    r.hide ? `<span class="mm-b mute">приховано</span>` : ""].join("");
  const art = `<td class="mm-art">${first ? `<b>Ст. ${esc(r.art)}</b><small>${esc(r.title)}</small>` : ""}</td>`;
  const main = `<tr class="mm-row ${first ? "first" : ""} ${open ? "open" : ""} ${r.hide ? "hid" : ""}" data-a="mmrow" data-k="${esc(id)}">
    ${art}<td class="mm-part">${r.part ? `ч. ${esc(r.part)}` : "—"}</td>
    <td class="mm-desc">${esc(r.desc)}${badges ? `<div class="mm-bs">${badges}</div>` : ""}${r.note ? `<div class="mm-note">${esc(r.note)}</div>` : ""}</td>
    <td class="mm-pen">${esc(r.pen)}</td><td class="mm-lic">${r.lic ? "Так" : ""}</td></tr>`;
  if (!open) return main;
  const f = st.form && st.form.key === id ? st.form : null;
  const editor = f ? `<form class="mm-form" data-f="mmsave">
      <label>Опис у пам'ятці<textarea class="i" name="desc" rows="3" placeholder="${esc(r.auto ? r.auto.desc : r.desc)}">${esc(f.desc)}</textarea></label>
      <label>Покарання<input class="i" name="pen" value="${esc(f.pen)}" placeholder="${esc(r.auto ? r.auto.pen : r.pen)}"></label>
      <div class="mm-form-row"><label>Ліцензія<select class="i" name="lic"><option value="">як у законі (${(r.auto ? r.auto.lic : r.lic) ? "так" : "ні"})</option>
        <option value="1" ${f.lic === true ? "selected" : ""}>так</option><option value="0" ${f.lic === false ? "selected" : ""}>ні</option></select></label>
        <label class="mm-chk"><input type="checkbox" name="hide" ${f.hide ? "checked" : ""}> Не показувати в пам'ятці</label></div>
      <label>Примітка для співробітників<input class="i" name="note" value="${esc(f.note)}" placeholder="Напр.: застава заборонена, обов'язковий виклик прокурора…"></label>
      <div class="mm-form-row"><button class="btn gold sm" type="submit">Зберегти</button><button class="btn sm" type="button" data-a="mmcancel">Скасувати</button>
        ${r.edited ? `<button class="btn sm bad" type="button" data-a="mmreset" data-k="${esc(id)}" title="Прибрати ручну правку — рядок знову береться з закону">↺ Як у законі</button>` : ""}
        <span class="muted small">Порожнє поле — береться з закону й оновлюється разом із ним.</span></div></form>` : "";
  return main + `<tr class="mm-det"><td colspan="5"><div class="mm-det-in">
    <div class="mm-full"><div class="eyebrow">Текст закону · ${esc(A)} ст. ${esc(r.art)}${r.part ? ` ч. ${esc(r.part)}` : ""}</div><p>${esc(r.full)}</p>
      ${r.lawNote ? `<p class="mm-lawnote">${esc(r.lawNote)}</p>` : ""}${r.stale && r.auto ? `<p class="mm-auto"><b>Зараз у законі:</b> ${esc(r.auto.desc)} — <b>${esc(r.auto.pen)}</b></p>` : ""}</div>
    <div class="mm-det-btns"><button class="btn sm" data-a="kbopen" data-tab="law" data-v="${esc(MEMO.code)}" ${r.anchor ? `data-go="${esc(r.anchor)}"` : `data-find="${esc(r.find || "")}"`}>📖 Відкрити в законі</button>
      <button class="btn sm" data-a="mmcopy" data-k="${esc(id)}" title="Скопіювати для протоколу чи чату">⧉ Копіювати</button>
      ${MEMO.canEdit && !f ? `<button class="btn sm" data-a="mmedit" data-k="${esc(id)}">✎ Поправити рядок</button>` : ""}
      ${MEMO.canEdit && QUICK ? ((k) => { const on = QUICK.arts.some((a) => a.key === k);
        return `<button class="btn sm ${on ? "gold" : ""}" data-a="mqtoggle" data-k="${esc(k)}" ${on ? 'data-on="1"' : ""} title="Коротка пам'ятка: найчастіші статті">${on ? "★ У пам'ятці" : "☆ До пам'ятки"}</button>`; })(`${A} ${r.art}`) : ""}</div>
    ${editor}</div></td></tr>`;
}

function tableHtml() {
  let shown = 0;
  const body = MEMO.sections.filter((s) => !st.sec || s.title === st.sec).map((s) => {
    let lastArt = null;
    const rows = s.rows.filter((r) => (st.edit || !r.hide) && matches(r)).map((r) => { const h = rowHtml(r, r.art !== lastArt); lastArt = r.art; return h; });
    shown += rows.length;
    return rows.length ? `<tr class="mm-sec"><td colspan="5">${esc(s.title.replace(/^РОЗДІЛ\s+[IVXLC\d]+\.\s*/i, "") || "Інші статті")}</td></tr>${rows.join("")}` : "";
  }).join("");
  return shown ? `<table class="mm-t"><thead><tr><th>Стаття</th><th>Частина</th><th>Опис</th><th>Покарання</th><th>Ліцензія</th></tr></thead><tbody>${body}</tbody></table>`
    : `<div class="empty">Нічого не знайдено${st.q ? ` за «${esc(st.q)}»` : ""}.</div>`;
}

const fullView = async () => {
  try { MEMO = await call(`/api/memo?code=${encodeURIComponent(st.code)}`); }
  catch (e) { return `<div class="empty">${esc(e.message)}</div>`; }
  const all = MEMO.sections.flatMap((s) => s.rows);
  const fresh = all.filter((r) => r.fresh).length, stale = all.filter((r) => r.stale).length;
  return `<div class="mm">
    <div class="mm-head"><div><div class="eyebrow">Пам'ятка співробітника · ${esc(MEMO.abbr)}</div><h2>${esc(MEMO.title)}</h2>
      <span class="muted small">Складено автоматично з законодавчої бази · редакція від ${fmtDT(MEMO.updated)} · звірено з NG ${MEMO.checked ? fmtDT(MEMO.checked) : "—"} · ${all.length} складів</span></div>
      <div class="mm-codes">${MEMO.codes.map((c) => `<button class="btn sm ${c.slug === MEMO.code ? "gold" : ""}" data-a="mmcode" data-v="${esc(c.slug)}" title="${esc(c.title)}">${esc(c.abbr)}</button>`).join("")}</div></div>
    ${stale && MEMO.canEdit ? `<div class="mm-alert warn">⚠ ${stale} рядк. поправлено вручну, а закон відтоді змінився — відкрийте їх (позначка «закон змінився») і перевірте.</div>` : ""}
    ${fresh ? `<div class="mm-alert info">Після останніх змін законодавства оновлено ${fresh} рядк. (позначка «оновлено»).</div>` : ""}
    <div class="mm-bar">
      <input class="i" id="mm-q" type="search" placeholder="Пошук: номер статті (115, 185.3) або слово…" value="${esc(st.q)}" autocomplete="off">
      <select class="i" id="mm-sec"><option value="">Усі розділи</option>${MEMO.sections.map((s) => `<option ${st.sec === s.title ? "selected" : ""} value="${esc(s.title)}">${esc(s.title.replace(/^РОЗДІЛ\s+/i, ""))}</option>`).join("")}</select>
      <label class="mm-chk"><input type="checkbox" id="mm-lic" ${st.lic ? "checked" : ""}> Анулювання ліцензії</label>
      <span class="sp"></span>
      ${MEMO.canEdit ? `<button class="btn sm ${st.edit ? "gold" : ""}" data-a="mmeditmode" title="Показати приховані рядки й ручні правки">✎ ${st.edit ? "Вийти з редагування" : "Редагування"}</button>` : ""}
      <button class="btn sm" data-a="mmprint" title="Надрукувати або зберегти в PDF">⎙ Друк / PDF</button></div>
    <div class="mm-wrap" id="mm-table">${tableHtml()}</div>
    ${st.edit && MEMO.gone.length ? `<div class="card mm-gone"><header><h3>Ручні правки статей, яких уже немає в кодексі</h3></header>
      ${MEMO.gone.map((g) => `<div class="mm-gone-r"><b>ст. ${esc(g.key)}</b><span>${esc(g.desc || "—")}</span><button class="btn sm bad" data-a="mmdrop" data-k="${esc(g.key)}">Видалити</button></div>`).join("")}</div>` : ""}
    <p class="muted small">Натисніть на рядок — повний текст статті й перехід до закону. Пам'ятка оновлюється сама після кожного звіряння законодавчої бази
      (вкладка «Зміни законодавства»)${MEMO.canEdit ? "; ручні правки рядків бачать усі співробітники" : ""}.</p></div>`;
};

const redrawTable = () => { const t = document.getElementById("mm-table"); if (t && MEMO) t.innerHTML = tableHtml(); };
const findRow = (k) => MEMO && MEMO.sections.flatMap((s) => s.rows).find((r) => r.key === k);
const readForm = () => {
  const f = document.querySelector("form[data-f=mmsave]");
  if (!f || !st.form) return;
  st.form.desc = f.desc.value; st.form.pen = f.pen.value; st.form.note = f.note.value; st.form.hide = f.hide.checked;
  st.form.lic = f.lic.value === "" ? null : f.lic.value === "1";
};

document.addEventListener("input", (e) => {
  if (e.target.id === "mm-q") { st.q = e.target.value; redrawTable(); }
});
document.addEventListener("change", (e) => {
  if (e.target.id === "mm-sec") { st.sec = e.target.value; redrawTable(); }
  if (e.target.id === "mm-lic") { st.lic = e.target.checked; redrawTable(); }
});

S.forms.mmsave = (f) => run(f.querySelector("button[type=submit]"), async () => {
  readForm();
  const r = findRow(st.form.key);
  const same = (v, a) => !v.trim() || v.trim() === a;
  await call("/api/memo/row", { json: { code: MEMO.code, key: st.form.key,
    desc: same(st.form.desc, r.auto ? r.auto.desc : r.desc) ? "" : st.form.desc, pen: same(st.form.pen, r.auto ? r.auto.pen : r.pen) ? "" : st.form.pen,
    note: st.form.note, hide: st.form.hide, lic: st.form.lic } });
  st.form = null;
  toast("Рядок пам'ятки збережено");
  S.render();
});

Object.assign(S.actions, {
  mmcode: (b) => { st.code = b.dataset.v; st.sec = ""; st.open.clear(); st.form = null; S.render(); },
  mmrow: (b, e) => {
    if (e && e.target.closest("a,button,input,select,textarea,form")) return;
    const k = b.dataset.k;
    st.open.has(k) ? st.open.delete(k) : st.open.add(k);
    if (st.form && st.form.key === k && !st.open.has(k)) st.form = null;
    redrawTable();
  },
  mmeditmode: () => { st.edit = !st.edit; st.form = null; S.render(); },
  mmedit: (b) => {
    const r = findRow(b.dataset.k);
    const auto = r.auto || r;
    st.form = { key: r.key, desc: r.auto && r.desc !== auto.desc ? r.desc : "", pen: r.auto && r.pen !== auto.pen ? r.pen : "", note: r.note || "", hide: !!r.hide,
      lic: r.auto && r.lic !== auto.lic ? r.lic : null };
    redrawTable();
  },
  mmcancel: () => { st.form = null; redrawTable(); },
  mmreset: (b) => run(b, async () => {
    if (!confirm("Прибрати ручну правку? Рядок знову братиметься з тексту закону.")) return;
    await call("/api/memo/row", { json: { code: MEMO.code, key: b.dataset.k, reset: true } });
    st.form = null; toast("Повернуто текст закону"); S.render();
  }),
  mmdrop: (b) => run(b, async () => { await call("/api/memo/row", { json: { code: MEMO.code, key: b.dataset.k, drop: true } }); S.render(); }),
  mmcopy: async (b) => {
    const r = findRow(b.dataset.k);
    const txt = `${MEMO.abbr} ст. ${r.art}${r.part ? ` ч. ${r.part}` : ""} — ${r.desc}. Покарання: ${r.pen}${r.lic ? " (анулювання ліцензії)" : ""}`;
    try { await navigator.clipboard.writeText(txt); toast("Скопійовано"); } catch (e) { prompt("Скопіюйте:", txt); }
  },
  mmprint: () => { document.body.classList.add("mm-printing"); window.print(); setTimeout(() => document.body.classList.remove("mm-printing"), 500); },
});

/* ---------------------------------------------------------------- підказка: порядок затримання + найчастіші статті */
let QUICK = null;
const qs = { full: false, edit: false, steps: null };

function quickHtml() {
  const Q = QUICK, E = qs.edit && Q.canEdit;
  const steps = qs.steps ? `<form class="mq-sform" data-f="mqsteps">
      <p class="muted small">Кожен крок — з нового рядка: «Назва — пояснення».</p>
      <textarea class="i" name="steps" rows="14">${esc(qs.steps)}</textarea>
      <div class="mm-form-row"><button class="btn gold sm" type="submit">Зберегти</button><button class="btn sm" type="button" data-a="mqstepsoff">Скасувати</button>
        <span class="sp"></span>${Q.customSteps ? `<button class="btn sm bad" type="button" data-a="mqstepsdef">↺ Стандартні кроки</button>` : ""}</div></form>`
    : `<ol class="mq-ol">${Q.steps.map((s) => `<li><b>${esc(s.t)}</b>${s.d ? `<span>${esc(s.d)}</span>` : ""}</li>`).join("")}</ol>`;
  const card = (a) => `<article class="mq-art" data-a="kbopen" data-tab="law" data-v="${esc(a.code)}" ${a.anchor ? `data-go="${esc(a.anchor)}"` : `data-find="${esc(a.find)}"`} title="Відкрити статтю в законі">
      <header><span class="mq-no">${esc(a.abbr)} ${esc(a.art)}</span><span class="mq-tt">${esc(a.title)}</span>
        ${E ? `<button class="mq-x" data-a="mqunpin" data-k="${esc(a.key)}" title="Прибрати з пам'ятки">✕</button>` : a.pinned ? `<span class="mq-pin" title="Закріплено керівництвом">★</span>` : ""}</header>
      ${a.parts.map((p) => `<div class="mq-p">${p.part ? `<i>ч.${esc(p.part)}</i>` : "<i>—</i>"}<span class="mq-d" title="${esc(p.desc)}">${esc(p.desc)}</span>
        <b class="mq-pen">${esc(p.pen)}${p.lic ? `<em title="Анулювання ліцензії на зброю">ліц.</em>` : ""}</b></div>`).join("")}</article>`;
  return `<div class="mq">
    <header class="mq-head">
      <img src="sbu-logo.webp" alt="" class="mq-logo">
      <div class="mq-ttl"><div class="eyebrow">Служба безпеки України</div><h2>Пам'ятка співробітника</h2>
        <span class="muted small">Порядок затримання і статті, які найчастіше застосовують співробітники</span></div>
      <div class="mm-codes">
        ${Q.canEdit ? `<button class="btn sm ${E ? "gold" : ""}" data-a="mqedit">✎ ${E ? "Готово" : "Редагувати"}</button>` : ""}
        <button class="btn sm" data-a="mqfull" title="Усі статті кодексів таблицею">☰ Повний перелік</button>
        <button class="btn sm" data-a="mmprint">⎙ Друк</button></div></header>
    <div class="mq-grid">
      <section class="mq-box mq-steps">
        <div class="mq-h"><span class="mq-tag">I</span><h3>Порядок затримання</h3><span class="sp"></span>
          ${E && !qs.steps ? `<button class="btn sm" data-a="mqstepson">✎ Кроки</button>` : ""}<button class="btn sm" data-a="kbtab" data-v="detain" title="Кожен крок зі статтями закону">Детально →</button></div>
        ${steps}
        <div class="mq-mir"><div class="mq-mir-h"><b>Права затриманого</b><button class="btn sm" data-a="mqmir" title="Скопіювати текст">⧉ Копіювати</button></div>
          <q>${esc(Q.miranda)}</q></div>
      </section>
      <section class="mq-box mq-arts">
        <div class="mq-h"><span class="mq-tag">II</span><h3>Найчастіші статті</h3><span class="sp"></span>
          <span class="muted small" title="Рахується за звітами співробітників; керівництво може закріпити чи прибрати статтю">за звітами за ${Q.days} днів</span></div>
        ${E ? `<form class="mq-add" data-f="mqpin"><input class="i" name="key" placeholder="Додати статтю: КК 115, КУпАП 12…" autocomplete="off"><button class="btn sm gold" type="submit">★ Закріпити</button></form>
          ${Q.drops.length ? `<div class="mq-drops muted small">Прибрані: ${Q.drops.map((d) => `<button class="mq-chip" data-a="mqrestore" data-k="${esc(d)}" title="Повернути">${esc(d)} ↺</button>`).join("")}</div>` : ""}` : ""}
        <div class="mq-cards">${Q.arts.map(card).join("") || `<div class="empty">Ще немає звітів зі статтями — відкрийте «Повний перелік».</div>`}</div>
        <p class="muted small mq-foot">Натисніть статтю — відкриється текст закону. «ліц.» — анулювання ліцензії на зброю.</p>
      </section>
    </div></div>`;
}

const parseSteps = (txt) => txt.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
  const m = l.match(/^(.+?)\s+[—–-]\s+(.+)$/);
  return m ? { t: m[1].trim(), d: m[2].trim() } : { t: l, d: "" };
});
const saveQuick = (b, json, msg) => run(b, async () => { await call("/api/memo/quick", { json }); if (msg) toast(msg); S.render(); });

S.forms.mqsteps = (f) => run(f.querySelector("button[type=submit]"), async () => {
  await call("/api/memo/quick", { json: { steps: parseSteps(f.steps.value) } }); qs.steps = null; toast("Порядок затримання збережено"); S.render(); });
S.forms.mqpin = (f) => {
  const v = f.key.value.trim().replace(/\s+/g, " ").replace(/^(кк|купап|дк)\s*(?:ст\.?\s*)?/i, (m, c) => ({ кк: "КК", купап: "КУпАП", дк: "ДК" })[c.toLowerCase()] + " ");
  if (!/^(КК|КУпАП|ДК) \d+([.-]\d+)*$/.test(v)) return toast("Формат: «КК 115» або «КУпАП 12»", 1);
  return saveQuick(f.querySelector("button"), { pin: true, key: v }, `${v} закріплено в пам'ятці`);
};

Object.assign(S.actions, {
  mqfull: () => { qs.full = true; S.render(); },
  mqback: () => { qs.full = false; S.render(); },
  mqedit: () => { qs.edit = !qs.edit; qs.steps = null; S.render(); },
  mqstepson: () => { qs.steps = QUICK.steps.map((s) => s.d ? `${s.t} — ${s.d}` : s.t).join("\n"); S.render(); },
  mqstepsoff: () => { qs.steps = null; S.render(); },
  mqstepsdef: (b) => { if (!confirm("Повернути стандартні кроки?")) return;
    run(b, async () => { await call("/api/memo/quick", { json: { steps: null } }); qs.steps = null; toast("Повернуто стандартні кроки"); S.render(); }); },
  mqunpin: (b, e) => { if (e) e.stopPropagation(); saveQuick(b, { unpin: true, key: b.dataset.k }, `${b.dataset.k} прибрано з пам'ятки`); },
  mqrestore: (b) => saveQuick(b, { restore: true, key: b.dataset.k }),
  mqtoggle: (b) => saveQuick(b, { [b.dataset.on ? "unpin" : "pin"]: true, key: b.dataset.k }, b.dataset.on ? "Прибрано з пам'ятки" : "Додано в пам'ятку"),
  mqmir: async () => { try { await navigator.clipboard.writeText(QUICK.miranda); toast("Текст прав скопійовано"); } catch (e) { prompt("Скопіюйте:", QUICK.miranda); } },
});

S.memoView = async () => {
  if (qs.full) {
    QUICK = await call("/api/memo/quick").catch(() => QUICK);  // щоб у рядках таблиці показати «★ у пам'ятці»
    return `<div class="kd-bar"><button class="btn sm" data-a="mqback">← До пам'ятки</button></div>` + await fullView();
  }
  try { QUICK = await call("/api/memo/quick"); }
  catch (e) { return `<div class="empty">${esc(e.message)}</div>`; }
  return quickHtml();
};

/* ---------------------------------------------------------------- порядок затримання */
let DET = null;
const refLabel = (r) => r.replace(/^(\S+)\s+/, (m, c) => `${c} ${c === "ІСБУ" ? "п." : "ст."} `);  // ІСБУ — пункти Інструкції СБУ

function stepView(s, i) {
  const changed = s.links.filter((l) => l.changed);
  return `<li class="dt-step ${st.check && st.done.has(i) ? "done" : ""}">
    <div class="dt-n">${st.check ? `<input type="checkbox" data-dtcheck="${i}" ${st.done.has(i) ? "checked" : ""} aria-label="Виконано">` : i + 1}</div>
    <div class="dt-body"><div class="dt-h"><h3>${esc(s.title)}</h3><button class="btn sm dt-copy" data-a="dtcopy" data-i="${i}" title="Скопіювати текст кроку">⧉</button></div>
      ${s.text ? `<div class="dt-text">${esc(s.text)}</div>` : ""}
      ${s.links.length ? `<div class="dt-refs">${s.links.map((l) => l.ok
        ? `<button class="dt-ref ${l.changed ? "warn" : ""}" data-a="kbopen" data-tab="law" data-v="${esc(l.slug)}" ${l.anchor ? `data-go="${esc(l.anchor)}"` : `data-find="${esc(l.find || "")}"`} title="${esc(l.title || "")}${l.changed ? " — стаття змінилась після останньої редакції кроку" : ""}">${l.changed ? "⚠ " : "📖 "}${esc(refLabel(l.ref))}</button>`
        : `<span class="dt-ref bad" title="Статті немає в законодавчій базі">✕ ${esc(refLabel(l.ref))}</span>`).join("")}</div>` : ""}
      ${changed.length && DET.canEdit ? `<div class="dt-warn">Після останньої редакції змінились: ${changed.map((l) => esc(refLabel(l.ref))).join(", ")} — перевірте крок.</div>` : ""}</div></li>`;
}

function editView() {
  const E = st.detEdit;
  return `<div class="dt"><div class="mm-head"><div><div class="eyebrow">Редагування</div><h2>Порядок затримання</h2>
    <span class="muted small">Посилання на статті через кому: «ПК 15, ПК 16.2, КК 342». Після збереження «Сова» запам'ятає редакцію статей і попередить, коли вони зміняться.</span></div></div>
    <ol class="dt-edit">${E.map((s, i) => `<li class="card"><div class="dt-ed-h"><b>Крок ${i + 1}</b><span class="sp"></span>
        <button class="btn sm" data-a="dtmove" data-i="${i}" data-d="-1" ${i ? "" : "disabled"} title="Вище">↑</button><button class="btn sm" data-a="dtmove" data-i="${i}" data-d="1" ${i < E.length - 1 ? "" : "disabled"} title="Нижче">↓</button>
        <button class="btn sm bad" data-a="dtdel" data-i="${i}" title="Видалити крок">✕</button></div>
      <input class="i" data-dt="title" data-i="${i}" value="${esc(s.title)}" placeholder="Назва кроку" maxlength="160">
      <textarea class="i" data-dt="text" data-i="${i}" rows="4" placeholder="Що зробити (кожен пункт — з нового рядка)">${esc(s.text)}</textarea>
      <input class="i mono" data-dt="refs" data-i="${i}" value="${esc(s.refs.join(", "))}" placeholder="ПК 15, ПК 7"></li>`).join("")}</ol>
    <div class="mm-form-row"><button class="btn sm" data-a="dtadd">+ Додати крок</button><span class="sp"></span>
      <button class="btn sm bad" data-a="dtdefault" title="Відкинути всі правки й повернути стандартні кроки">↺ Стандартний</button>
      <button class="btn sm" data-a="dtcancel">Скасувати</button><button class="btn gold" data-a="dtsave">Зберегти</button></div></div>`;
}

S.detainView = async () => {
  if (st.detEdit) return editView();
  try { DET = await call("/api/detain"); }
  catch (e) { return `<div class="empty">${esc(e.message)}</div>`; }
  const changed = DET.steps.reduce((n, s) => n + s.links.filter((l) => l.changed).length, 0);
  return `<div class="dt">
    <div class="mm-head"><div><div class="eyebrow">Процесуальні дії · Процесуальний кодекс штату NG</div><h2>Порядок затримання</h2>
      <span class="muted small">${DET.custom ? `Редакція від ${fmtDT(DET.updated)} · ${esc(DET.by || "")}` : "Стандартна редакція «Сови»"} · ${DET.steps.length} кроків · натисніть статтю — відкриється текст закону</span></div>
      <div class="mm-codes"><button class="btn sm ${st.check ? "gold" : ""}" data-a="dtcheckmode" title="Відмічати виконані кроки під час затримання">☑ Чек-лист</button>
        ${st.check && st.done.size ? `<button class="btn sm" data-a="dtcheckreset">Скинути</button>` : ""}
        <button class="btn sm" data-a="mmprint">⎙ Друк / PDF</button>
        ${DET.canEdit ? `<button class="btn sm" data-a="dtedit">✎ Редагувати</button>` : ""}</div></div>
    ${changed && DET.canEdit ? `<div class="mm-alert warn">⚠ Після останньої редакції змінилось статей: ${changed}. Кроки з позначкою ⚠ варто перевірити й зберегти.</div>` : ""}
    ${st.check ? `<div class="mm-alert info">Виконано ${st.done.size} з ${DET.steps.length}. Позначки бачите лише ви й не зберігаються.</div>` : ""}
    <ol class="dt-steps">${DET.steps.map(stepView).join("")}</ol>
    <p class="muted small">Оформити затримання: База даних → Протоколи затримання. Статті для оголошення — вкладка «Пам'ятка».</p></div>`;
};

const readEdit = () => document.querySelectorAll("[data-dt]").forEach((el) => {
  const s = st.detEdit[+el.dataset.i];
  if (!s) return;
  s[el.dataset.dt] = el.dataset.dt === "refs" ? el.value.split(/[,;]+/).map((x) => x.trim()).filter(Boolean) : el.value;
});

document.addEventListener("change", (e) => {
  const c = e.target.closest("[data-dtcheck]");
  if (!c) return;
  const i = +c.dataset.dtcheck;
  c.checked ? st.done.add(i) : st.done.delete(i);
  S.render();
});

Object.assign(S.actions, {
  dtcheckmode: () => { st.check = !st.check; S.render(); },
  dtcheckreset: () => { st.done.clear(); S.render(); },
  dtcopy: async (b) => {
    const s = DET.steps[+b.dataset.i];
    const txt = `${s.title}\n${s.text}`.trim();
    try { await navigator.clipboard.writeText(txt); toast("Скопійовано"); } catch (e) { prompt("Скопіюйте:", txt); }
  },
  dtedit: () => { st.detEdit = DET.steps.map((s) => ({ title: s.title, text: s.text, refs: [...s.refs] })); S.render(); },
  dtcancel: () => { if (!confirm("Скасувати незбережені правки?")) return; st.detEdit = null; S.render(); },
  dtadd: () => { readEdit(); st.detEdit.push({ title: "", text: "", refs: [] }); S.render(); },
  dtdel: (b) => { readEdit(); if (!confirm("Видалити крок?")) return; st.detEdit.splice(+b.dataset.i, 1); S.render(); },
  dtmove: (b) => { readEdit(); const i = +b.dataset.i, j = i + +b.dataset.d; [st.detEdit[i], st.detEdit[j]] = [st.detEdit[j], st.detEdit[i]]; S.render(); },
  dtsave: (b) => run(b, async () => { readEdit(); await call("/api/detain", { json: { steps: st.detEdit } }); st.detEdit = null; toast("Порядок затримання збережено"); S.render(); }),
  dtdefault: (b) => run(b, async () => {
    if (!confirm("Повернути стандартні кроки? Усі правки буде втрачено.")) return;
    await call("/api/detain", { json: { reset: true } }); st.detEdit = null; toast("Повернуто стандартний порядок"); S.render();
  }),
});
})();
