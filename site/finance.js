/* Клопотання до Кабінету Міністрів і Мінфіну штату NG (форма III) та звіти про використання коштів (форма IV).
   Готує керівництво ДЕБ → погоджує Голова СБУ або Заступник → PDF / PNG / текст для теми Мінфіну на форумі. */
(() => {
const S = window.SOVA;
const { esc, call, toast, fmtDT } = S;
const st = { id: null, edit: null, purposes: {} };
const FORUM = "https://forum.ng-gta5.com/threads/817-minfin-pryymalnya-klopotan-shchodo-finansuvannya-materialno";
const $$ = (n) => "$" + Number(n || 0).toLocaleString("uk-UA").replace(/\s/g, " ");
const day = (t) => new Date(t || Date.now()).toLocaleDateString("uk-UA");
const CHIP = { draft: "mute", wait: "wait", approved: "ok", posted: "info", funded: "ok", denied: "bad", rejected: "bad" };
// посада автора так, як її пишуть у темі Мінфіну
const post = (p) => !p ? "[Посада]" : /відділу/.test(p.rankName) ? `${p.rankName} ДЕБ СБУ` : /СБУ/.test(p.rankName) ? p.rankName : `${p.rankName} Служби безпеки штату NG`;

function petitionBlank(d, author) {
  const x = d.data || {}, total = (x.items || []).reduce((s, i) => s + (+i.sum || 0), 0), a = author || d.authorUser, ok = d.approverUser;
  return `<div class="blank fin-blank">
    <div class="fin-to">До Кабінету Міністрів штату NG<br>Та Міністерства фінансів штату NG<br>Від: ${esc(post(a))}, ${esc(a ? a.name : "")}<br>Державна організація: СБУ</div>
    <div class="blank-title">К Л О П О Т А Н Н Я</div><div class="fin-sub">про виділення цільових коштів із Державної казни${d.no ? ` · № ${esc(d.no)}` : ""}</div>
    <p>Я, ${esc(post(a))} ${esc(a ? a.name : "")}, звертаюся до керівництва Уряду та Міністерства фінансів штату NG із проханням розглянути можливість виділення бюджетних асигнувань на <b>матеріально-технічне забезпечення нашої організації</b>.</p>
    <p class="fin-row"><b>Необхідна сума фінансування:</b> ${$$(total)}</p>
    <p class="fin-row"><b>Цільове призначення та обґрунтування витрат:</b> ${esc(st.purposes[x.purpose] || "")}. ${esc(x.why || "…")}</p>
    <div class="fin-row"><b>Попередній кошторис планованих витрат:</b>
      <table class="fin-t">${(x.items || []).map((i, n) => `<tr><td>Пункт ${n + 1}: ${esc(i.name)}</td><td class="num">${$$(i.sum)}</td></tr>`).join("") || "<tr><td>—</td><td></td></tr>"}
      <tr class="sum"><td>Разом</td><td class="num">${$$(total)}</td></tr></table></div>
    <p class="fin-row"><b>Офіційний баланс / номер рахунку казни організації:</b> ${esc(x.account || "Казна Служби безпеки штату NG")}</p>
    <p class="fin-oath">Зобов'язуюся використати кошти суворо за призначенням та надати повний звіт про витрати протягом 72 годин.</p>
    <div class="fin-sign"><span><b>Дата подання:</b> ${day(d.approved || d.updated)}</span><span><b>Особистий підпис:</b> <span class="kf-sign">${esc(a ? a.name : "")}</span></span></div>
    ${visa(d)}</div>`;
}

function reportBlank(d, author) {
  const x = d.data || {}, a = author || d.authorUser, par = d.parentInfo || {};
  return `<div class="blank fin-blank">
    <div class="fin-to">До Міністерства фінансів штату NG<br>Від: ${esc(post(a))}, ${esc(a ? a.name : "")}<br>Державна організація: Служба безпеки штату NG</div>
    <div class="blank-title">З В І Т</div><div class="fin-sub">про цільове використання виділених бюджетних коштів${d.no ? ` · № ${esc(d.no)}` : ""}</div>
    <p>Доповідаю, що кошти, виділені згідно з клопотанням № ${esc(par.no || "…")}${par.url ? ` (${esc(par.url)})` : ""} у розмірі <b>${$$(x.amount)}</b>, були повністю освоєні за цільовим призначенням.</p>
    <p class="fin-row"><b>Фактично виконані заходи / здійснені закупівлі:</b> ${esc(x.done || "…")}</p>
    <p class="fin-row"><b>Залишок невикористаних коштів:</b> ${$$(x.rest)} (${x.restFate === "returned" ? "повернуто до Державної казни" : "залишено на балансі організації"})</p>
    <div class="fin-row"><b>Докази цільового використання:</b>${(x.evidence || []).length ? `<ul>${x.evidence.map((u) => `<li class="mono small">${esc(u)}</li>`).join("")}</ul>` : ""}
      ${(x.files || []).length ? `<div class="small">Файлів-додатків: ${x.files.length} (у ЄІС «Сова»)</div><div class="files">${x.files.map((f, i) => `<button class="btn sm" data-a="file" data-id="${esc(f)}">📎 Файл ${i + 1}</button>`).join("")}</div>` : ""}
      ${!(x.evidence || []).length && !(x.files || []).length ? " —" : ""}</div>
    <div class="fin-sign"><span><b>Дата подання:</b> ${day(d.approved || d.updated)}</span><span><b>Особистий підпис:</b> <span class="kf-sign">${esc(a ? a.name : "")}</span></span></div>
    ${visa(d)}</div>`;
}

const visa = (d) => d.approverUser && ["approved", "posted", "funded", "denied"].includes(d.status)
  ? `<div class="fin-visa"><b>ПОГОДЖЕНО</b><span>${esc(d.approverUser.rankName)}</span><span class="kf-sign">${esc(d.approverUser.name)}</span><span>${fmtDT(d.approved)}</span></div>` : "";
const blank = (d, a) => d.kind === "report" ? reportBlank(d, a) : petitionBlank(d, a);

// текст для відповіді в темі Мінфіну (BB-коди форуму)
function forumText(d) {
  const x = d.data, a = d.authorUser, ok = d.approverUser ? `\n[B]Погоджено:[/B] ${d.approverUser.rankName} ${d.approverUser.name}` : "";
  if (d.kind === "report") {
    const par = d.parentInfo || {};
    return `До Міністерства фінансів штату NG\nВід: ${post(a)}, ${a.name}\nДержавна організація: Служба безпеки штату NG\n\n[B]ЗВІТ[/B]\nпро цільове використання виділених бюджетних коштів\n\n`
      + `Доповідаю, що кошти, виділені згідно з клопотанням № ${par.no || ""}${par.url ? ` (${par.url})` : ""} у розмірі ${$$(x.amount)}, були повністю освоєні за цільовим призначенням.\n\n`
      + `[B]Фактично виконані заходи / здійснені закупівлі:[/B] ${x.done}\n[B]Залишок невикористаних коштів (за наявності):[/B] ${$$(x.rest)} (${x.restFate === "returned" ? "повернуто до Державної казни" : "залишено на балансі організації"})\n`
      + `[B]Докази цільового використання:[/B] ${(x.evidence || []).join(" , ") || "додаються"}\n[B]Дата подання:[/B] ${day(d.approved)}\n[B]Особистий підпис:[/B] ${a.name}${ok}`;
  }
  return `До Кабінету Міністрів штату NG\nТа Міністерства фінансів штату NG\nВід: ${post(a)}, ${a.name}\nДержавна організація: СБУ\n\n[B]КЛОПОТАННЯ[/B]\nпро виділення цільових коштів із Державної казни\n`
    + `[B]Я,[/B] ${post(a)} ${a.name}, звертаюся до керівництва Уряду та Міністерства фінансів штату NG із проханням розглянути можливість виділення бюджетних асигнувань на [B]матеріально-технічне забезпечення нашої організації[/B].\n\n`
    + `[B]Необхідна сума фінансування:[/B] ${$$(d.total)}\n[B]Цільове призначення та обґрунтування витрат:[/B] ${st.purposes[x.purpose] || ""}. ${x.why}\n[B]Попередній кошторис планованих витрат:[/B]\n`
    + x.items.map((i, n) => `Пункт ${n + 1}: ${i.name} - ${$$(i.sum)}`).join("\n")
    + `\n[B]Офіційний баланс / номер рахунку казни організації/структури:[/B] ${x.account}\n[I][B]Зобов'язуюся використати кошти суворо за призначенням та надати повний звіт про витрати протягом 72 годин.[/B][/I]\n`
    + `[B]Дата подання:[/B] ${day(d.approved)}\n[B]Особистий підпис:[/B] ${a.name}${ok}`;
}

function left(t) {
  const ms = t - Date.now();
  if (ms <= 0) return "строк минув";
  return `${Math.floor(ms / 36e5)} год ${Math.floor((ms % 36e5) / 6e4)} хв`;
}

async function listView() {
  const r = await call("/api/fin");
  st.purposes = r.purposes;
  const petitions = r.docs.filter((d) => d.kind === "petition"), reports = Object.fromEntries(r.docs.filter((d) => d.kind === "report").map((d) => [d.parent, d]));
  return `<div class="fin-head"><div><div class="eyebrow">Державна казна · тема Мінфіну на форумі</div><b>Клопотання про цільове фінансування</b></div>
      <a class="btn sm" href="${FORUM}" target="_blank" rel="noopener">Тема Мінфіну ↗</a>${r.rights.prepare ? '<button class="btn gold" data-a="finnew">+ Нове клопотання</button>' : ""}</div>
    <p class="note">Готує начальник або заступник начальника ДЕБ від свого імені → погоджує Голова СБУ або Заступник → документ подається на форум (PDF, PNG або текст). Після отримання коштів — звіт протягом 72 годин.</p>
    ${petitions.length ? `<div class="docs">${petitions.map((d) => { const rep = reports[d.id]; return `<article class="doc fin-row-doc st-${d.status === "funded" || d.status === "approved" ? "ok" : d.status === "wait" ? "wait" : d.status === "denied" || d.status === "rejected" ? "rej" : "info"}" data-a="finopen" data-id="${d.id}">
      <div class="doc-no"><b>${esc(d.no)}</b><span>${fmtDT(d.created)}</span></div>
      <div class="doc-main"><div class="doc-title">${$$(d.total)} · ${esc(st.purposes[d.data.purpose] || "")}</div>
        <div class="doc-line"><span>Підготував</span>${esc(d.authorUser ? d.authorUser.name : "—")}${d.approverUser ? ` · <span>Погодив</span>${esc(d.approverUser.name)}` : ""}</div>
        ${d.status === "funded" ? `<div class="doc-note">Отримано ${$$(d.funded_amount)} · звіт: ${rep ? `<b>${esc(rep.no)}</b> — ${esc(rep.statusName)}` : `<b class="${d.deadline - Date.now() < 12 * 36e5 ? "bad" : ""}">ще не подано, лишилось ${left(d.deadline)}</b>`}</div>` : ""}</div>
      <div class="doc-side"><span class="chip ${CHIP[d.status] || "mute"}">${esc(d.statusName)}</span></div></article>`; }).join("")}</div>` : '<div class="empty">Клопотань ще немає.</div>'}`;
}

function editView() {
  const e = st.edit, x = e.data, me = S.ME().me, author = e.authorUser || { name: me.name, rankName: me.rankName, sid: me.sid };
  const form = e.kind === "petition" ? `
    <label class="f wide"><span>Напрям фінансування</span><select class="i" data-fx="purpose">${Object.entries(st.purposes).map(([k, v]) => `<option value="${k}" ${x.purpose === k ? "selected" : ""}>${esc(v)}</option>`).join("")}</select></label>
    <label class="f wide"><span>Обґрунтування: на що підуть кошти, чому виникла потреба, обсяг закупівлі</span><textarea class="i kf-big" data-fx="why">${esc(x.why || "")}</textarea></label>
    <div class="f wide"><span>Кошторис</span><div class="fin-items">${(x.items || []).map((i, n) => `<div class="fin-item"><input class="i" data-fi="${n}" data-k="name" value="${esc(i.name)}" placeholder="Товар / послуга">
      <input class="i mono" type="number" min="0" data-fi="${n}" data-k="sum" value="${i.sum || ""}" placeholder="$"><button class="btn sm" type="button" data-a="findel" data-n="${n}">✕</button></div>`).join("")}</div>
      <button class="btn sm" type="button" data-a="finadd">+ Пункт кошторису</button></div>
    <label class="f wide"><span>Офіційний баланс / номер рахунку</span><input class="i" data-fx="account" value="${esc(x.account || "Казна Служби безпеки штату NG")}"></label>`
    : `
    <label class="f"><span>Отримано за клопотанням, $</span><input class="i mono" type="number" data-fx="amount" value="${x.amount || ""}"></label>
    <label class="f"><span>Залишок, $</span><input class="i mono" type="number" data-fx="rest" value="${x.rest || 0}"></label>
    <label class="f"><span>Залишок</span><select class="i" data-fx="restFate"><option value="kept" ${x.restFate !== "returned" ? "selected" : ""}>залишено на балансі СБУ</option><option value="returned" ${x.restFate === "returned" ? "selected" : ""}>повернуто до Державної казни</option></select></label>
    <label class="f wide"><span>Фактично виконані заходи / закупівлі</span><textarea class="i kf-big" data-fx="done">${esc(x.done || "")}</textarea></label>
    <label class="f wide"><span>Докази: посилання (кожне з нового рядка)</span><textarea class="i" data-fx="evidence">${esc((x.evidence || []).join("\n"))}</textarea></label>
    <label class="f wide"><span>Файли: чеки, перекази, скріни (до 5)</span><input class="i" id="fin-files" type="file" multiple accept="image/*,application/pdf,video/mp4"></label>`;
  return `<div class="kd-bar"><button class="btn" data-a="finback">← До реєстру</button><span class="sp"></span>
      <button class="btn" data-a="finsave">💾 Зберегти чернетку</button><button class="btn gold" data-a="finsave" data-submit="1">Зберегти й подати на погодження</button></div>
    <div class="grid2 rap-wrap"><form class="card form-grid" onsubmit="return false"><header class="wide"><h3>${e.kind === "petition" ? "Клопотання про цільове фінансування" : "Звіт про використання коштів"}</h3></header>${form}</form>
      <div id="fin-prev">${blank({ ...e, data: x }, author)}</div></div>`;
}

async function docView(id) {
  const d = await call(`/api/fin/${id}`);
  st.doc = d;
  const R = S.ME().fin, mine = d.author === S.ME().me.sid, done = ["approved", "posted", "funded", "denied"].includes(d.status);
  const btn = [
    d.status === "draft" && R.prepare && `<button class="btn" data-a="finedit">Редагувати</button><button class="btn gold" data-a="finact" data-x="submit">Подати на погодження</button>`,
    d.status === "wait" && R.prepare && `<button class="btn" data-a="finact" data-x="withdraw">↩ Відкликати</button>`,
    d.status === "wait" && R.approve && !mine && `<button class="btn ok" data-a="finact" data-x="ok">✔ Погодити</button><button class="btn" data-a="finact" data-x="return">Повернути</button><button class="btn bad" data-a="finact" data-x="rej">Відмовити</button>`,
    done && `<button class="btn gold" data-a="finpdf">⬇ PDF</button><button class="btn" data-a="finpng">⬇ PNG</button><button class="btn" data-a="fincopy">⧉ Текст для форуму</button>`,
    d.status === "approved" && R.prepare && `<button class="btn ok" data-a="finact" data-x="posted">Подано на форум…</button>`,
    d.status === "posted" && d.kind === "petition" && (R.prepare || R.approve) && `<button class="btn ok" data-a="finact" data-x="funded">Мінфін схвалив…</button><button class="btn bad" data-a="finact" data-x="denied">Мінфін відмовив</button>`,
    d.status === "funded" && !d.report && R.prepare && `<button class="btn gold" data-a="finreport">+ Звіт про використання (72 год)</button>`,
    d.report && `<button class="btn" data-a="finopen" data-id="${d.report.id}">Звіт ${esc(d.report.no)} · ${esc(d.report.status)}</button>`,
    (R.approve || (mine && ["draft", "rejected"].includes(d.status))) && `<button class="btn bad" data-a="finact" data-x="delete">🗑</button>`,
  ].filter(Boolean).join("");
  const W = { create: "Створено", submit: "Подано на погодження", withdraw: "Відкликано", ok: "Погоджено", return: "Повернуто на доопрацювання", rej: "Відмовлено", posted: "Подано на форум", funded: "Мінфін схвалив", denied: "Мінфін відмовив" };
  return `<div class="kd-bar"><button class="btn" data-a="finback">← До реєстру</button><span class="chip ${CHIP[d.status] || "mute"}">${esc(d.statusName)}</span><span class="sp"></span>${btn}</div>
    ${d.status === "funded" && !d.report ? `<p class="note warn">Кошти отримано ${fmtDT(d.funded_at)}: звіт про використання треба подати до ${fmtDT(d.deadline)} (лишилось ${left(d.deadline)}).</p>` : ""}
    ${d.forum_url ? `<p class="note">На форумі: <a href="${esc(d.forum_url)}" target="_blank" rel="noopener">${esc(d.forum_url)}</a></p>` : ""}
    <div class="fin-page"><div id="fin-doc">${blank(d)}</div>
    <aside class="card"><header><h3>Рух документа</h3></header><div class="aud">${d.history.slice().reverse().map((h) => `<div class="aud-it k-${h.action === "rej" || h.action === "denied" ? "down" : "in"}"><i></i>
      <div class="aud-when"><b>${new Date(h.t).toLocaleDateString("uk-UA", { day: "2-digit", month: "2-digit" })}</b><span>${new Date(h.t).toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit" })}</span></div>
      <div class="aud-body"><div class="aud-act">${W[h.action] || h.action}</div><div class="aud-who"><b>${esc(h.name)}</b> · ${esc(h.rank || "")}${h.note ? ` · «${esc(h.note)}»` : ""}</div></div></div>`).join("")}</div></aside></div>`;
}

S.views.fin = async () => st.edit ? editView() : st.id ? docView(st.id) : listView();

// --- редактор: живий бланк
const read = () => {
  const e = st.edit;
  document.querySelectorAll("[data-fx]").forEach((el) => { e.data[el.dataset.fx] = el.dataset.fx === "evidence" ? el.value.split(/\n+/).map((s) => s.trim()).filter(Boolean) : el.value; });
  document.querySelectorAll("[data-fi]").forEach((el) => { e.data.items[+el.dataset.fi][el.dataset.k] = el.dataset.k === "sum" ? +el.value || 0 : el.value; });
};
const preview = () => { const p = document.getElementById("fin-prev"); if (p && st.edit) p.innerHTML = blank({ ...st.edit }, st.edit.authorUser || { name: S.ME().me.name, rankName: S.ME().me.rankName }); };
document.addEventListener("input", (e) => { if (st.edit && (e.target.dataset.fx || e.target.dataset.fi)) { read(); preview(); } });

const run = async (b, fn) => { if (b) b.disabled = true; try { await fn(); } catch (e) { toast(e.message, 1); } if (b) b.disabled = false; };
const docName = () => `${st.doc.no}_${st.doc.kind === "petition" ? "Клопотання_Мінфін" : "Звіт_Мінфін"}`;
Object.assign(S.actions, {
  finnew: () => { st.edit = { kind: "petition", data: { purpose: "arms", why: "", items: [{ name: "", sum: 0 }], account: "Казна Служби безпеки штату NG" } }; S.render(); },
  finopen: (b) => { st.id = +b.dataset.id; st.edit = null; S.render(); scrollTo(0, 0); },
  finback: () => { if (st.edit) { st.id = st.edit.id || null; st.edit = null; } else st.id = null; S.render(); },
  finedit: () => { const d = st.doc; st.edit = { id: d.id, kind: d.kind, parent: d.parent, data: JSON.parse(JSON.stringify(d.data)), authorUser: d.authorUser, parentInfo: d.parentInfo }; if (d.kind === "petition" && !st.edit.data.items.length) st.edit.data.items.push({ name: "", sum: 0 }); S.render(); },
  finreport: () => { const d = st.doc; st.edit = { kind: "report", parent: d.id, parentInfo: { no: d.no, amount: d.funded_amount, url: d.forum_url }, data: { amount: d.funded_amount, rest: 0, restFate: "kept", done: "", evidence: [], files: [] } }; S.render(); },
  finadd: () => { read(); st.edit.data.items.push({ name: "", sum: 0 }); S.render(); },
  findel: (b) => { read(); st.edit.data.items.splice(+b.dataset.n, 1); S.render(); },
  finsave: (b) => run(b, async () => {
    read();
    const e = st.edit, f = document.getElementById("fin-files");
    if (f && f.files.length) e.data.files = [...(e.data.files || []), ...(await S.uploadFiles(f))].slice(0, 10);
    const d = await call("/api/fin", { json: { id: e.id, kind: e.kind, parent: e.parent, data: e.data } });
    if (b.dataset.submit) await call(`/api/fin/${d.id}/submit`, { json: {} });
    toast(b.dataset.submit ? "Подано на погодження Голові СБУ" : "Чернетку збережено");
    st.edit = null; st.id = d.id; await S.refreshMe(); S.render();
  }),
  finact: (b) => run(b, async () => {
    const x = b.dataset.x, body = {};
    if (["return", "rej", "denied"].includes(x)) { const n = prompt(x === "denied" ? "Причина відмови Мінфіну (необов'язково):" : "Причина:", ""); if (n === null) return; body.note = n; }
    if (x === "posted") { const u = prompt("Посилання на вашу відповідь у темі Мінфіну:", "https://forum.ng-gta5.com/"); if (!u) return; body.url = u; }
    if (x === "funded") { const a = prompt("Скільки коштів перераховано на казну СБУ, $:", String(st.doc.total)); if (!a) return; body.amount = a; }
    if (x === "ok" && !confirm("Погодити документ? Після цього його можна подавати на форум Мінфіну.")) return;
    if (x === "delete" && !confirm("Видалити документ?")) return;
    const r = await call(`/api/fin/${st.doc.id}/${x}`, { json: body });
    toast({ submit: "Подано на погодження", withdraw: "Відкликано", ok: "Погоджено", return: "Повернуто", rej: "Відмовлено", posted: "Позначено як подане на форум", funded: "Кошти отримано — звіт протягом 72 годин", denied: "Позначено відмову Мінфіну", delete: "Видалено" }[x]);
    if (x === "delete") st.id = null;
    await S.refreshMe(); S.render();
  }),
  finpdf: (b) => S.pdfBtn(b, blank(st.doc), docName()),
  finpng: (b) => S.pngBtn(b, blank(st.doc), docName()),
  fincopy: async () => { try { await navigator.clipboard.writeText(forumText(st.doc)); toast("Текст скопійовано — вставте відповіддю в темі Мінфіну"); } catch (e) { prompt("Скопіюйте текст:", forumText(st.doc)); } },
});
})();
