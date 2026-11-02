/* База даних → Протоколи затримання (ст. 41 ПК штату NG): реєстр ПЗ-0001…, форма з живим бланком і підказками з ПК,
   підпис = реєстрація (за бажанням — одразу звіт про діяльність), анулювання з причиною, PDF / PNG. Підключається після kb.js. */
(() => {
const S = window.SOVA;
const { esc, call, toast, fmtDT } = S;
const st = { id: null, edit: null, doc: null, meta: null, q: "" };
const CHIP = { draft: "mute", signed: "ok", void: "bad" };
const pad = (n) => String(n).padStart(2, "0");
const dt = (t) => { const d = new Date(t || Date.now()); return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const local = (t) => { const d = new Date(t || Date.now()); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
// статті з ПК / КК штату NG, на які спираються підказки
const SECURITY = ["111", "113", "258"];                                   // ст. 15 ч.5 п.2 «в» ПК — обов'язковий виклик прокурора
const NO_BAIL = ["109", "110", "111", "113", "115", "119", "121", "122", "258", "260", "263", "309", "328", "342", "348"];  // ст. 16.1 ПК
const art = (a) => String(a).split(/[.\s]/)[0];

function hints(x) {
  const out = [], arts = (x.arts || []).map(art), warn = (t) => out.push(["warn", t]), info = (t) => out.push(["info", t]);
  if (!x.rights) warn("Права не роз'яснено: будь-які показання затриманого — недопустимі докази (ст. 15 ч.2 п.5 ПК).");
  if (arts.some((a) => SECURITY.includes(a)) && !x.prosecutor) warn("Державна зрада, диверсія чи тероризм (ст. 111, 113, 258 КК): виклик чергового прокурора або ДБР обов'язковий (ст. 15 ч.5 п.2 «в» ПК).");
  if (x.whoGov && !x.prosecutor) warn("Затримано співробітника державного органу: обов'язковий виклик прокурора, ДБР або керівництва (ст. 15 ч.5 п.2 «а», ст. 16.2 ПК).");
  if (x.lawyer && x.decision === "short") info("Затриманий вимагав адвоката: рішення одноосібно приймається лише без такої вимоги (ст. 15 ч.5 п.1 ПК). Зафіксуйте участь адвоката.");
  if (x.decision === "short" && +x.term > 15) warn("Скорочене провадження — лише якщо санкція (сукупність) не перевищує 15 років позбавлення волі (ст. 15 ч.4 ПК).");
  if (x.decision === "kpz" && arts.some((a) => NO_BAIL.includes(a))) info("За цими статтями застава заборонена (ст. 16.1 ч.3 ПК).");
  if ((x.items || []).some((i) => i.name) && !x.handover) warn("Вилучене здається до кімнати зберігання речових доказів не пізніше ніж за 30 хвилин (ст. 22 ПК) — вкажіть, кому і коли.");
  if (x.basis === "warrant" && !x.warrant) warn("Затримання за ордером: вкажіть номер ОРД-АРЕШТ (реквізити — ст. 30 ПК).");
  if (x.force !== "none" && !x.forceWhy) warn("Застосовано силу або спецзасоби — обґрунтуйте необхідність.");
  if (!x.video && !(x.files || []).length) warn("Немає відеофіксації: додайте посилання на відкат боді-камери або файл.");
  info("Загальний строк затримання — 60 хвилин; очікування адвоката чи прокурора та протокольний допит його зупиняють (ст. 15 ПК).");
  return out;
}

function blank(p, author) {
  const x = p.data || {}, a = author || p.authorUser || {}, M = st.meta || {}, team = p.teamUsers || [];
  const yn = (v) => v ? "так" : "ні";
  const row = (k, v) => `<tr><th>${k}</th><td>${v || "—"}</td></tr>`;
  return `<div class="blank prot-blank${p.status === "void" ? " void" : ""}">
    <div class="prot-head"><div>СЛУЖБА БЕЗПЕКИ ШТАТУ NG<br><small>${esc(a.deptName || "")}</small></div><div class="prot-no">№ ${esc(p.no || "ПЗ-____")}</div></div>
    <div class="blank-title">ПРОТОКОЛ ЗАТРИМАННЯ</div><div class="prot-sub">складений відповідно до ст. 15, 41 Процесуального кодексу штату NG</div>
    <table class="prot-t">
      ${row("1. Дата та час", dt(x.when))}
      ${row("2. Місце затримання", esc(x.place))}
      ${row("3. Посадова особа", `${esc(a.rankName || "")} ${esc(a.name || "")}${a.sid ? `, жетон № ${a.sid}` : ""}`)}
      ${row("4. Учасники", team.length ? team.map((t) => `${esc(t.rankName)} ${esc(t.name)} (№ ${t.sid})`).join("; ") : "—")}
      ${row("5. Затриманий", `<b>${esc(x.who)}</b>${x.whoId ? `, ID/паспорт ${esc(x.whoId)}` : ""}${x.whoGov ? ", співробітник державного органу" : ""}${x.whoMore ? `<br><small>${esc(x.whoMore)}</small>` : ""}`)}
      ${row("6. Підстава (ст. 14 ПК)", `${esc((M.basis || {})[x.basis] || "")}${x.basis === "warrant" && x.warrant ? ` № ${esc(x.warrant)}` : ""}`)}
      ${row("7. Інкриміновано", (x.arts || []).length ? x.arts.map((n) => `ст. ${esc(n)} КК штату NG`).join(", ") : "")}
      ${row("8. Опис дії", `${esc(x.desc).replace(/\n/g, "<br>")}<div class="prot-force">Сила / спецзасоби: ${esc((M.force || {})[x.force] || "")}${x.forceWhy ? ` — ${esc(x.forceWhy)}` : ""}</div>`)}
      ${row("9. Права роз'яснено", `${yn(x.rights)}${x.rights && x.rightsAt ? ` о ${esc(x.rightsAt)}` : ""} · дзвінок: ${yn(x.call)} · адвокат: ${yn(x.lawyer)} · прокурор: ${x.prosecutor ? `так${x.prosecutorName ? ` (${esc(x.prosecutorName)})` : ""}` : "ні"}`)}
      ${row("10. Вилучено (ст. 21–22 ПК)", (x.items || []).filter((i) => i.name).length ? `<ol>${x.items.filter((i) => i.name).map((i) => `<li>${esc(i.name)}${i.qty ? ` — ${esc(i.qty)}` : ""}</li>`).join("")}</ol>${x.handover ? `<small>Передано: ${esc(x.handover)}</small>` : ""}` : "нічого не вилучено")}
      ${row("11. Відеофіксація", `${x.video ? `<span class="mono small">${esc(x.video)}</span>` : ""}${x.videoAt ? ` · таймкод ${esc(x.videoAt)}` : ""}${(x.files || []).length ? `<div class="files">${x.files.map((f, i) => `<button class="btn sm" data-a="file" data-id="${esc(f)}">📎 Файл ${i + 1}</button>`).join("")}</div>` : ""}`)}
      ${row("12. Рішення", `<b>${esc((M.decision || {})[x.decision] || "")}</b>${x.decision === "short" && x.term ? ` на ${x.term} р.` : ""}${x.fine ? ` · штраф $${x.fine}` : ""}`)}
      ${row("13. Зауваження учасників", esc(x.remarks) || "не надходили")}
    </table>
    <div class="prot-sign"><span>Протокол склав: ${esc(a.rankName || "")} ${esc(a.name || "")}</span><span class="kf-sign">${p.status === "signed" || p.status === "void" ? esc(a.name || "") : ""}</span><span>${p.signed ? dt(p.signed) : "не підписано"}</span></div>
    ${p.status === "void" ? `<div class="prot-stamp">АНУЛЬОВАНО</div>` : p.status === "signed" ? `<div class="prot-stamp ok">ЗАРЕЄСТРОВАНО</div>` : ""}</div>`;
}

async function load() {
  const r = await call("/api/protocols");
  st.meta = r;
  return r;
}

async function listView() {
  const r = await load(), R = r.rights;
  const items = r.items, q = st.q.toLowerCase();
  return `<div class="fin-head"><div><div class="eyebrow">ст. 41 ПК штату NG · реєстр ЄІС «Сова»</div><b>Протоколи затримання</b></div>
      <input class="i prot-q" id="prot-q" placeholder="Пошук: ПЗ-номер, затриманий, стаття, жетон…" value="${esc(st.q)}">
      ${R.create ? '<button class="btn gold" data-a="protnew">+ Новий протокол</button>' : ""}</div>
    <p class="note">Складає співробітник, який здійснив затримання. Після підпису протокол одразу реєструється; бачать його автор, учасники, керівництво відділу, ВВБ, Голова й Заступник.</p>
    ${items.length ? `<div class="docs" id="prot-list">${items.map((p) => { const x = p.data, key = [p.no, x.who, x.whoId, x.place, (x.arts || []).join(" "), p.author, p.authorUser && p.authorUser.name].join(" ").toLowerCase();
      return `<article class="doc st-${p.status === "signed" ? "ok" : p.status === "void" ? "rej" : "info"}" data-a="protopen" data-id="${p.id}" data-q="${esc(key)}"${q && !key.includes(q) ? " hidden" : ""}>
      <div class="doc-no"><b>${esc(p.no)}</b><span>${fmtDT(x.when)}</span></div>
      <div class="doc-main"><div class="doc-title">${esc(x.who || "Без імені")} · ${(x.arts || []).map((n) => "ст. " + esc(n)).join(", ") || "статті не вказано"}</div>
        <div class="doc-line"><span>Місце</span>${esc(x.place || "—")} · <span>Склав</span>${esc(p.authorUser ? `${p.authorUser.name} №${p.authorUser.sid}` : "—")}${p.act_id ? ` · <span>Звіт</span>№${p.act_id}` : ""}</div></div>
      <div class="doc-side"><span class="chip ${CHIP[p.status] || "mute"}">${esc(p.statusName)}</span></div></article>`; }).join("")}</div>` : '<div class="empty">Протоколів ще немає.</div>'}`;
}

function editView() {
  const e = st.edit, x = e.data, M = st.meta, me = S.ME().me;
  const author = { name: me.name, rankName: me.rankName, sid: me.sid, deptName: me.deptName };
  const opt = (o, v) => Object.entries(o).map(([k, l]) => `<option value="${k}" ${v === k ? "selected" : ""}>${esc(l)}</option>`).join("");
  const chk = (k, l) => `<label class="chk"><input type="checkbox" data-px="${k}" ${x[k] ? "checked" : ""}> ${l}</label>`;
  const team = M.people.filter((p) => x.team.includes(p.sid));
  return `<div class="kd-bar"><button class="btn" data-a="protback">← До реєстру</button><span class="sp"></span>
      <button class="btn" data-a="protsave">💾 Зберегти чернетку</button><button class="btn gold" data-a="protsave" data-sign="1">✍ Підписати й зареєструвати</button></div>
    <div class="grid2 rap-wrap prot-wrap"><form class="card form-grid" onsubmit="return false"><header class="wide"><h3>Протокол затримання</h3><div class="muted small">Складає ${esc(me.rankName)} ${esc(me.name)} · жетон № ${me.sid}</div></header>
      <label class="f"><span>1. Дата та час</span><input class="i" type="datetime-local" data-px="when" value="${local(x.when)}"></label>
      <label class="f"><span>2. Місце затримання</span><input class="i" data-px="place" value="${esc(x.place)}" placeholder="Напр. Vinewood Blvd, біля АЗС"></label>
      <div class="f wide"><span>4. Учасники затримання (співробітники)</span>
        <div class="prot-team">${team.map((p) => `<span class="chip info">${esc(p.rankName)} ${esc(p.name)} · ${p.sid} <button type="button" class="x" data-a="protteamdel" data-sid="${p.sid}">✕</button></span>`).join("")}</div>
        <div class="prot-add"><select class="i" id="prot-team-sel"><option value="">— обрати співробітника —</option>${M.people.filter((p) => p.sid !== me.sid && !x.team.includes(p.sid)).map((p) => `<option value="${p.sid}">${esc(p.rankName)} ${esc(p.name)} · ${p.sid}</option>`).join("")}</select>
        <button type="button" class="btn sm" data-a="protteamadd">+ Додати</button></div></div>
      <label class="f"><span>5. Затриманий (ім'я та прізвище)</span><input class="i" data-px="who" value="${esc(x.who)}"></label>
      <label class="f"><span>ID / паспорт</span><input class="i mono" data-px="whoId" value="${esc(x.whoId)}"></label>
      <label class="f wide"><span>Прикмети, організація, особливості (необов'язково)</span><input class="i" data-px="whoMore" value="${esc(x.whoMore)}"></label>
      <div class="f wide">${chk("whoGov", "Затриманий — співробітник державного органу / силовик (ст. 16.2 ПК)")}</div>
      <label class="f"><span>6. Підстава затримання (ст. 14 ПК)</span><select class="i" data-px="basis">${opt(M.basis, x.basis)}</select></label>
      <label class="f"><span>№ ОРД-АРЕШТ (за ордером)</span><input class="i mono" data-px="warrant" value="${esc(x.warrant)}" ${x.basis === "warrant" ? "" : "disabled"}></label>
      <label class="f wide"><span>7. Статті КК, що інкримінуються (через кому)</span><input class="i mono" data-px="arts" value="${esc((x.arts || []).join(", "))}" placeholder="напр. 263, 342"></label>
      <label class="f wide"><span>8. Опис дії: як відбулося затримання, що встановлено</span><textarea class="i kf-big" data-px="desc">${esc(x.desc)}</textarea></label>
      <label class="f"><span>Сила / спецзасоби</span><select class="i" data-px="force">${opt(M.force, x.force)}</select></label>
      <label class="f"><span>Обґрунтування сили</span><input class="i" data-px="forceWhy" value="${esc(x.forceWhy)}" ${x.force === "none" ? "disabled" : ""}></label>
      <div class="f wide prot-checks"><span>9. Права й процесуальні гарантії (ст. 15 ПК)</span>
        ${chk("rights", "Права роз'яснено (правило Міранди)")} <label class="chk">о <input class="i mono sm" data-px="rightsAt" value="${esc(x.rightsAt)}" placeholder="14:05" style="width:80px"></label>
        ${chk("call", "Надано дзвінок (до 3 хв)")} ${chk("lawyer", "Викликано адвоката")} ${chk("prosecutor", "Викликано прокурора / ДБР")}
        <input class="i" data-px="prosecutorName" value="${esc(x.prosecutorName)}" placeholder="Прокурор (ім'я), якщо викликали" ${x.prosecutor ? "" : "disabled"}></div>
      <div class="f wide"><span>10. Вилучені предмети</span><div class="fin-items">${x.items.map((i, n) => `<div class="fin-item"><input class="i" data-pi="${n}" data-k="name" value="${esc(i.name)}" placeholder="Предмет, ознаки (номер зброї тощо)">
        <input class="i mono" data-pi="${n}" data-k="qty" value="${esc(i.qty)}" placeholder="К-сть"><button class="btn sm" type="button" data-a="protitemdel" data-n="${n}">✕</button></div>`).join("")}</div>
        <button class="btn sm" type="button" data-a="protitemadd">+ Предмет</button></div>
      <label class="f wide"><span>Кому і коли передано вилучене (кімната речдоків, ≤ 30 хв)</span><input class="i" data-px="handover" value="${esc(x.handover)}"></label>
      <label class="f"><span>11. Відеофіксація: посилання</span><input class="i" data-px="video" value="${esc(x.video)}" placeholder="https://…"></label>
      <label class="f"><span>Таймкод</span><input class="i mono" data-px="videoAt" value="${esc(x.videoAt)}" placeholder="02:15–07:40"></label>
      <label class="f wide"><span>Файли (скріни, відео) ${(x.files || []).length ? `· уже додано ${x.files.length}` : ""}</span><input class="i" id="prot-files" type="file" multiple accept="image/*,video/mp4,application/pdf"></label>
      <label class="f"><span>12. Рішення</span><select class="i" data-px="decision">${opt(M.decision, x.decision)}</select></label>
      <label class="f"><span>Строк, років / штраф, $</span><span class="prot-two"><input class="i mono" type="number" min="0" data-px="term" value="${x.term || ""}" placeholder="років" ${x.decision === "short" ? "" : "disabled"}><input class="i mono" type="number" min="0" data-px="fine" value="${x.fine || ""}" placeholder="$"></span></label>
      <label class="f wide"><span>13. Зауваження учасників / затриманого</span><textarea class="i" data-px="remarks">${esc(x.remarks)}</textarea></label>
      <div class="f wide"><label class="chk"><input type="checkbox" id="prot-rep" checked> Після підпису одразу створити звіт про діяльність (затримання)</label></div>
    </form>
    <div class="prot-side"><div class="prot-hints" id="prot-hints">${hintsHtml(x)}</div><div id="prot-prev">${blank({ ...e, data: x, teamUsers: team }, author)}</div></div></div>`;
}

const hintsHtml = (x) => `<div class="eyebrow">Підказки з ПК штату NG</div>${hints(x).map(([k, t]) => `<p class="note ${k === "warn" ? "warn" : ""}">${k === "warn" ? "⚠" : "ℹ"} ${esc(t)}</p>`).join("")}`;

async function docView(id) {
  if (!st.meta) await load();
  const p = await call(`/api/protocols/${id}`);
  st.doc = p;
  const me = S.ME().me, mine = p.author === me.sid, R = st.meta.rights;
  const btn = [
    p.status === "draft" && mine && `<button class="btn" data-a="protedit">Редагувати</button><button class="btn gold" data-a="protsign">✍ Підписати</button>`,
    p.status !== "draft" && `<button class="btn gold" data-a="protpdf">⬇ PDF</button><button class="btn" data-a="protpng">⬇ PNG</button>`,
    p.status === "signed" && mine && !p.act_id && `<button class="btn" data-a="protx" data-x="report">+ Звіт про діяльність</button>`,
    p.act_id && `<button class="btn" data-a="actopen" data-id="${p.act_id}">📂 Звіт №${p.act_id}</button>`,
    p.status === "signed" && `<button class="btn bad" data-a="protx" data-x="void">Анулювати…</button>`,
    p.status === "void" && (R.chief || R.vvb) && `<button class="btn ok" data-a="protx" data-x="restore">Відновити</button>`,
    ((mine && p.status === "draft") || R.chief) && `<button class="btn bad" data-a="protx" data-x="delete">🗑</button>`,
  ].filter(Boolean).join("");
  const W = { create: "Створено чернетку", sign: "Підписано й зареєстровано", report: "Створено звіт про діяльність", void: "Анульовано", restore: "Відновлено", delete: "Видалено" };
  return `<div class="kd-bar"><button class="btn" data-a="protback">← До реєстру</button><span class="chip ${CHIP[p.status] || "mute"}">${esc(p.statusName)}</span><span class="sp"></span>${btn}</div>
    ${p.status === "draft" ? `<div class="prot-hints">${hintsHtml(p.data)}</div>` : ""}
    <div class="fin-page"><div id="prot-doc">${blank(p)}</div>
    <aside class="card"><header><h3>Рух документа</h3></header><div class="aud">${p.history.slice().reverse().map((h) => `<div class="aud-it k-${h.action === "void" || h.action === "delete" ? "down" : "in"}"><i></i>
      <div class="aud-when"><b>${new Date(h.t).toLocaleDateString("uk-UA", { day: "2-digit", month: "2-digit" })}</b><span>${new Date(h.t).toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit" })}</span></div>
      <div class="aud-body"><div class="aud-act">${W[h.action] || h.action}</div><div class="aud-who"><b>${esc(h.name)}</b> · ${esc(h.rank || "")}${h.note ? ` · «${esc(h.note)}»` : ""}</div></div></div>`).join("")}</div></aside></div>`;
}

S.protView = async () => st.edit ? editView() : st.id ? docView(st.id) : listView();

// --- редактор: живий бланк і підказки
const read = () => {
  const x = st.edit.data;
  document.querySelectorAll("[data-px]").forEach((el) => {
    const k = el.dataset.px;
    x[k] = el.type === "checkbox" ? el.checked : k === "when" ? (el.value ? new Date(el.value).getTime() : Date.now())
      : k === "arts" ? el.value.split(/[,;\s]+/).map((s) => s.replace(/^ст\.?/i, "").trim()).filter(Boolean) : el.value;
  });
  document.querySelectorAll("[data-pi]").forEach((el) => { x.items[+el.dataset.pi][el.dataset.k] = el.value; });
};
const preview = () => {
  const e = st.edit, me = S.ME().me, x = e.data;
  const p = document.getElementById("prot-prev"), h = document.getElementById("prot-hints");
  if (p) p.innerHTML = blank({ ...e, teamUsers: st.meta.people.filter((q) => x.team.includes(q.sid)) }, { name: me.name, rankName: me.rankName, sid: me.sid, deptName: me.deptName });
  if (h) h.innerHTML = hintsHtml(x);
  const dis = (k, on) => { const el = document.querySelector(`[data-px="${k}"]`); if (el) el.disabled = !on; };
  dis("warrant", x.basis === "warrant"); dis("forceWhy", x.force !== "none"); dis("prosecutorName", x.prosecutor); dis("term", x.decision === "short");
};
const onEdit = (e) => { if (st.edit && (e.target.dataset.px || e.target.dataset.pi)) { read(); preview(); } };
document.addEventListener("input", onEdit);
document.addEventListener("change", onEdit);
document.addEventListener("input", (e) => {
  if (e.target.id !== "prot-q") return;
  st.q = e.target.value; const q = st.q.toLowerCase();
  document.querySelectorAll("#prot-list .doc").forEach((d) => { d.hidden = q && !d.dataset.q.includes(q); });
});

const run = async (b, fn) => { if (b) b.disabled = true; try { await fn(); } catch (e) { toast(e.message, 1); } if (b) b.disabled = false; };
const docName = () => `${st.doc.no}_Протокол_затримання_${st.doc.data.who || ""}`;
const fresh = () => ({ when: Date.now(), place: "", team: [], who: "", whoId: "", whoMore: "", whoGov: false, basis: "scene", warrant: "", arts: [], desc: "",
  force: "none", forceWhy: "", rights: true, rightsAt: "", call: false, lawyer: false, prosecutor: false, prosecutorName: "",
  items: [{ name: "", qty: "" }], handover: "", video: "", videoAt: "", files: [], decision: "short", term: 0, fine: 0, remarks: "" });
const sign = async (id, report) => {
  if (!confirm("Підписати протокол? Після підпису він реєструється і редагувати його вже не можна (лише анулювати з причиною).")) return false;
  await call(`/api/protocols/${id}/sign`, { json: { report } });
  toast(report ? "Протокол зареєстровано, звіт про діяльність надіслано на перевірку" : "Протокол зареєстровано");
  return true;
};
Object.assign(S.actions, {
  protnew: () => { st.edit = { data: fresh() }; S.render(); scrollTo(0, 0); },
  protopen: (b) => { st.id = +b.dataset.id; st.edit = null; S.render(); scrollTo(0, 0); },
  protback: () => { if (st.edit) { st.id = st.edit.id || null; st.edit = null; } else st.id = null; S.render(); },
  protedit: () => { const p = st.doc; st.edit = { id: p.id, data: JSON.parse(JSON.stringify(p.data)) }; if (!st.edit.data.items.length) st.edit.data.items.push({ name: "", qty: "" }); S.render(); },
  protteamadd: () => { read(); const v = +document.getElementById("prot-team-sel").value; if (v && !st.edit.data.team.includes(v)) st.edit.data.team.push(v); S.render(); },
  protteamdel: (b) => { read(); st.edit.data.team = st.edit.data.team.filter((s) => s !== +b.dataset.sid); S.render(); },
  protitemadd: () => { read(); st.edit.data.items.push({ name: "", qty: "" }); S.render(); },
  protitemdel: (b) => { read(); st.edit.data.items.splice(+b.dataset.n, 1); S.render(); },
  protsave: (b) => run(b, async () => {
    read();
    const e = st.edit, f = document.getElementById("prot-files"), rep = document.getElementById("prot-rep");
    if (f && f.files.length) e.data.files = [...(e.data.files || []), ...(await S.uploadFiles(f))].slice(0, 10);
    const p = await call("/api/protocols", { json: { id: e.id, data: e.data } });
    st.edit = null; st.id = p.id;
    if (b.dataset.sign) { try { await sign(p.id, rep && rep.checked); } catch (err) { toast(err.message, 1); } }
    else toast("Чернетку збережено");
    S.render();
  }),
  protsign: (b) => run(b, async () => { if (await sign(st.doc.id, confirm("Одразу створити звіт про діяльність за цим затриманням?"))) S.render(); }),
  protx: (b) => run(b, async () => {
    const x = b.dataset.x, body = {};
    if (x === "void") { const n = prompt("Причина анулювання протоколу:", ""); if (!n) return; body.note = n; }
    if (x === "delete" && !confirm("Видалити протокол?")) return;
    await call(`/api/protocols/${st.doc.id}/${x}`, { json: body });
    toast({ report: "Звіт про діяльність надіслано на перевірку", void: "Протокол анульовано", restore: "Протокол відновлено", delete: "Видалено" }[x]);
    if (x === "delete") st.id = null;
    S.render();
  }),
  protpdf: (b) => S.pdfBtn(b, blank(st.doc), docName()),
  protpng: (b) => S.pngBtn(b, blank(st.doc), docName()),
});
})();
