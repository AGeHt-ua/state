/* Кейс-файли: реєстр (теки), редактор чернетки, документ справи з візами, PDF після затвердження Генеральним прокурором.
   Підключається після app.js; використовує його глобальні SOVA-хелпери (window.SOVA). */
(() => {
const S = window.SOVA;
const { esc, fmtDT, call, toast, $ } = S;
const GRIF = { dsk: "ДЛЯ СЛУЖБОВОГО КОРИСТУВАННЯ", secret: "ТАЄМНО", top: "ЦІЛКОМ ТАЄМНО" };
const REQ = { search: "Ордер на обшук", arrest: "Ордер на арешт (затримання)", op: "Санкція на проведення спецоперації",
  surv: "Санкція на негласне стеження та прослуховування", suspect: "Повідомлення про підозру", other: "Інше клопотання" };
const ROLES = ["підозрюваний", "фігурант", "свідок", "потерпілий", "джерело"];
const ROUTE = [["draft", "Виконавець"], ["head", "Начальник відділу"], ["chief", "Голова СБУ"], ["prosecutor", "Генеральний прокурор"]];
const ORDER = { draft: 0, head: 1, chief: 2, prosecutor: 3, approved: 4, rejected: -1 };
const no = (id) => `КФ-${String(id).padStart(4, "0")}`;
const dept = (k) => S.META().depts[k] || { s: k, n: k, color: "#c9a05a" };
const UIc = { id: null, edit: null, tab: null };

/* ---------- реєстр ---------- */
function folder(c) {
  const d = dept(c.dept), st = c.status, step = ORDER[st];
  return `<article class="kf" data-a="kfopen" data-id="${c.id}" style="--dc:${d.color}" tabindex="0">
    <div class="kf-tab"><b>${no(c.id)}</b><span>${esc(d.s)}</span></div>
    <div class="kf-body">
      <div class="kf-grif g-${esc(c.data.grif)}">${GRIF[c.data.grif] || ""}</div>
      <div class="kf-op">Операція</div><h3>«${esc(c.data.title || "без назви")}»</h3>
      <div class="kf-org">${esc(c.data.org || "—")}</div>
      <div class="kf-steps">${ROUTE.map(([k], i) => `<i class="${st === "rejected" ? "bad" : step > i ? "done" : step === i ? "cur" : ""}"></i>`).join("")}<i class="${st === "approved" ? "done" : ""}"></i></div>
      <div class="kf-meta"><span class="${st === "approved" ? "ok" : st === "rejected" ? "bad" : c.canDecide ? "act" : ""}">${esc(c.stageName)}</span><span>${fmtDT(c.updated)}</span></div>
      <div class="kf-by">Виконавець: ${c.authorUser ? esc(c.authorUser.name) : "№" + c.author}</div>
    </div>
    ${st === "approved" ? '<div class="kf-ok">ЗАТВЕРДЖЕНО</div>' : ""}
  </article>`;
}

async function vList() {
  const list = await call("/api/cases");
  const r = S.ME().cases || {};
  const mine = list.filter((c) => c.author === S.ME().me.sid), todo = list.filter((c) => c.canDecide);
  const t = UIc.tab || (todo.length ? "todo" : r.create && r.create.length ? "mine" : "all");
  const tabs = [["todo", "На моєму погодженні", todo.length], ...(r.create && r.create.length ? [["mine", "Мої справи", mine.length]] : []),
    ["all", "Реєстр", list.length], ["ok", "Затверджені", list.filter((c) => c.status === "approved").length]];
  const shown = { todo, mine, all: list, ok: list.filter((c) => c.status === "approved") }[t];
  return `<div class="kf-head"><div class="tabs">${tabs.map(([v, l, n]) => `<button class="tb ${t === v ? "on" : ""}" data-a="kftab" data-v="${v}">${l}<span class="cnt">${n}</span></button>`).join("")}</div>
      ${r.create && r.create.length ? '<button class="btn gold" data-a="kfnew">+ Завести кейс-файл</button>' : ""}</div>
    ${shown.length ? `<div class="kf-grid">${shown.map(folder).join("")}</div>` : `<div class="empty">${t === "todo" ? "Немає справ, що очікують вашого рішення." : "Справ немає."}</div>`}`;
}

/* ---------- документ ---------- */
function visas(c) {
  // Візи лише поточного кола погодження: з останнього подання; після відкликання — порожньо
  const all = c.history || [];
  const i = all.map((x) => x.action).lastIndexOf("submit");
  const h = all.length && all[all.length - 1].action === "withdraw" ? [] : i >= 0 ? all.slice(i) : [];
  const last = (stage, acts) => [...h].reverse().find((x) => x.stage === stage && acts.includes(x.action));
  return `<div class="kf-visas">${ROUTE.map(([k, label]) => {
    const v = k === "draft" ? last("draft", ["submit"]) : last(k, ["ok", "return", "rej"]);
    const skipped = !v && ORDER[c.status] > ORDER[k] && k !== "draft" && c.status !== "rejected";
    const cls = v ? { submit: "ok", ok: "ok", return: "warn", rej: "bad" }[v.action] : c.status === k ? "cur" : "";
    const word = v ? { submit: "ПІДГОТУВАВ", ok: k === "prosecutor" ? "ЗАТВЕРДЖЕНО" : "ПОГОДЖЕНО", return: "ПОВЕРНУТО", rej: "ВІДМОВЛЕНО" }[v.action] : skipped ? "—" : c.status === k ? "НА РОЗГЛЯДІ" : "";
    return `<div class="kf-visa ${cls}"><div class="kf-visa-t">${label}</div>
      ${word ? `<div class="kf-visa-s">${word}</div>` : '<div class="kf-visa-e">очікує</div>'}
      ${v ? `<div class="kf-sign">${esc(v.name)}</div><div class="kf-visa-d">${fmtDT(v.t)}</div>${v.note ? `<div class="kf-visa-n">«${esc(v.note)}»</div>` : ""}` : ""}</div>`;
  }).join("")}</div>`;
}

function docHtml(c, pdf) {
  const d = c.data, dp = dept(c.dept);
  const sec = (n, t, body) => `<section class="kd-sec"><h4><b>${n}</b>${t}</h4>${body}</section>`;
  const approvedBy = c.status === "approved" ? [...(c.history || [])].reverse().find((x) => x.stage === "prosecutor" && x.action === "ok") : null;
  return `<div class="kd ${pdf ? "pdf" : ""}" style="--dc:${dp.color}">
    <div class="kd-grif g-${esc(d.grif)}">${GRIF[d.grif]}</div>
    <header class="kd-head">
      <img src="sbu-logo.webp" alt="" width="84" height="84">
      <div><div class="kd-agency">Служба безпеки штату NG</div><div class="kd-dept">${esc(dp.n)}</div></div>
      <div class="kd-no"><span>Кейс-файл</span><b>№ ${no(c.id)}</b><span>${fmtDT(c.created)}</span></div>
    </header>
    <div class="kd-title"><span>Оперативна справа · операція</span><h2>«${esc(d.title)}»</h2>${d.org ? `<div>Об'єкт розробки: <b>${esc(d.org)}</b></div>` : ""}</div>
    <dl class="kd-meta"><dt>Виконавець</dt><dd>${c.authorUser ? `${esc(c.authorUser.rankName)} ${esc(c.authorUser.name)}, жетон №${c.author}` : "№" + c.author}</dd>
      <dt>Підрозділ</dt><dd>${esc(dp.n)}</dd><dt>Стан</dt><dd>${esc(c.stageName)}</dd><dt>Оновлено</dt><dd>${fmtDT(c.updated)}</dd></dl>
    ${sec("I", "Фабула справи", `<p class="kd-text">${esc(d.summary || "—")}</p>`)}
    ${sec("II", "Фігуранти", (d.persons || []).length ? `<div class="kd-persons">${d.persons.map((p, i) => `<div class="kd-p r-${esc(p.role)}">
        <div class="kd-p-n">${i + 1}</div><div><b>${esc(p.name)}</b>${p.sid ? ` <span class="mono">· ${esc(p.sid)}</span>` : ""}<div class="kd-p-r">${esc(p.role)}${p.org ? ` · ${esc(p.org)}` : ""}</div>${p.note ? `<div class="kd-p-x">${esc(p.note)}</div>` : ""}</div></div>`).join("")}</div>` : "<p>—</p>")}
    ${sec("III", "Кваліфікація", `<div class="kd-arts">${(d.arts || []).map((a) => `<span>ст. ${esc(a)} КК штату NG</span>`).join("") || "—"}</div>`)}
    ${sec("IV", "Докази", (d.evidence || []).length ? `<ol class="kd-ev">${d.evidence.map((e) => `<li><div>${esc(e.desc || "без опису")}</div>
        ${pdf ? (e.url ? `<div class="mono small">${esc(e.url)}</div>` : "") : `<div class="files">${e.url ? `<a class="btn sm" href="${esc(e.url)}" target="_blank" rel="noopener">▶ Матеріал</a>` : ""}${(e.files || []).map((f, i) => `<button class="btn sm" data-a="file" data-id="${esc(f)}">📎 Додаток ${i + 1}</button>`).join("")}</div>`}
        ${pdf && (e.files || []).length ? `<div class="small">Додатків: ${e.files.length} (зберігаються в ЄІС «Сова»)</div>` : ""}</li>`).join("")}</ol>` : "<p>—</p>")}
    ${sec("V", "Проведені оперативно-розшукові заходи", `<p class="kd-text">${esc(d.measures || "—")}</p>`)}
    ${sec("VI", "Клопотання", `<div class="kd-req"><div class="kd-req-t">${esc(REQ[(d.request || {}).type] || "")}</div><p class="kd-text">${esc((d.request || {}).text || "—")}</p></div>`)}
    ${sec("VII", "Візи погодження", visas(c))}
    ${approvedBy ? `<div class="kd-approved"><b>ЗАТВЕРДЖУЮ</b><span>Генеральний прокурор штату NG</span><span class="kf-sign">${esc(approvedBy.name)}</span><span>${fmtDT(approvedBy.t)}</span></div>` : ""}
    <footer class="kd-foot">ЄІС «Сова» · ${no(c.id)} · ${GRIF[d.grif]} · Розголошення відомостей тягне відповідальність згідно із Законом «Про Державну та Службову таємницю»</footer>
  </div>`;
}

function history(c) {
  const W = { create: "Заведено справу", withdraw: "Відкликано виконавцем з погодження", submit: "Подано на погодження", ok: "Погоджено", return: "Повернуто на доопрацювання", rej: "Відмовлено" };
  return `<div class="card"><header><h3>Рух документа</h3></header><div class="aud">${(c.history || []).slice().reverse().map((h) => `
    <div class="aud-it k-${h.action === "ok" || h.action === "submit" ? "in" : h.action === "rej" ? "down" : h.action === "return" ? "up" : "misc"}"><i></i>
      <div class="aud-when"><b>${new Date(h.t).toLocaleDateString("uk-UA", { day: "2-digit", month: "2-digit" })}</b><span>${new Date(h.t).toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit" })}</span></div>
      <div class="aud-body"><div class="aud-act">${W[h.action] || h.action}</div><div class="aud-who"><b>${esc(h.name)}</b>${h.note ? ` · «${esc(h.note)}»` : ""}</div></div></div>`).join("")}</div></div>`;
}

async function vCase(id) {
  const c = await call(`/api/cases/${id}`);
  S.cache.case = c;
  const pros = c.status === "prosecutor";
  const bar = `<div class="kd-bar"><button class="btn" data-a="kfback">← До реєстру</button><span class="sp"></span>
    ${c.canEdit ? `<button class="btn" data-a="kfedit">Редагувати</button><button class="btn gold" data-a="kfsubmit">Подати на погодження</button>` : ""}
    ${c.canWithdraw ? '<button class="btn" data-a="kfwd">↩ Відкликати з погодження</button>' : ""}
    ${c.canDecide ? `<button class="btn ok" data-a="kfdec" data-d="ok">${pros ? "Затвердити" : "Погодити"}</button><button class="btn" data-a="kfdec" data-d="return">Повернути на доопрацювання</button><button class="btn bad" data-a="kfdec" data-d="rej">Відмовити</button>` : ""}
    ${c.status === "approved" ? '<button class="btn gold" data-a="kfpdf">⬇ Завантажити PDF</button>' : ""}</div>`;
  return bar + `<div class="kd-wrap">${docHtml(c, false)}</div>` + history(c);
}

/* ---------- редактор ---------- */
const blankCase = () => ({ dept: (S.ME().cases.create || [])[0], data: { title: "", org: "", grif: "secret", summary: "", measures: "", arts: [], persons: [{ name: "", sid: "", role: "підозрюваний", org: "", note: "" }], evidence: [{ desc: "", url: "", files: [] }], request: { type: "search", text: "" } } });

function editor(c) {
  const d = c.data, depts = S.ME().cases.create || [];
  return `<div class="kd-bar"><button class="btn" data-a="kfback">← До реєстру</button><span class="sp"></span><span class="muted small">${c.id ? `Чернетка ${no(c.id)}` : "Нова справа"}</span></div>
  <form class="card kf-ed" data-f="kfsave">
    <header class="paper-head"><div><div class="eyebrow">Служба безпеки штату NG</div><h3>КЕЙС-ФАЙЛ · ${c.id ? "РЕДАГУВАННЯ" : "НОВА СПРАВА"}</h3></div><div class="paper-no">${c.id ? no(c.id) : "КФ-нов."}</div></header>
    <div class="form-grid">
      <label class="f"><span>Кодова назва операції</span><input class="i" id="kf-title" maxlength="80" value="${esc(d.title)}" placeholder="напр. ЯСТРУБ" required></label>
      <label class="f"><span>Підрозділ</span><select class="i" id="kf-dept">${depts.map((k) => `<option value="${k}" ${k === c.dept ? "selected" : ""}>${esc(dept(k).n)}</option>`).join("")}</select></label>
      <label class="f"><span>Гриф секретності</span><select class="i" id="kf-grif">${Object.entries(GRIF).map(([k, v]) => `<option value="${k}" ${k === d.grif ? "selected" : ""}>${v}</option>`).join("")}</select></label>
      <label class="f"><span>Об'єкт розробки (угруповання, організація)</span><input class="i" id="kf-org" maxlength="120" value="${esc(d.org)}"></label>
      <label class="f wide"><span>I. Фабула справи</span><textarea class="i kf-big" id="kf-summary" maxlength="6000" placeholder="Що встановлено: час, місце, обставини, зв'язки">${esc(d.summary)}</textarea></label>
    </div>
    <div class="kf-ed-sec"><div class="kf-ed-h"><b>II</b> Фігуранти <button type="button" class="btn sm" data-a="kfadd" data-k="persons">+ Додати</button></div>
      <div id="kf-persons">${(d.persons || []).map((p) => `<div class="kf-row kf-person">
        <input class="i" data-f="name" placeholder="Ім'я Прізвище" value="${esc(p.name)}"><input class="i mono" data-f="sid" placeholder="Static ID" value="${esc(p.sid)}">
        <select class="i" data-f="role">${ROLES.map((r) => `<option ${r === p.role ? "selected" : ""}>${r}</option>`).join("")}</select>
        <input class="i" data-f="org" placeholder="Угруповання" value="${esc(p.org)}"><input class="i wide" data-f="note" placeholder="Роль у справі, прикмети, зв'язки" value="${esc(p.note)}">
        <button type="button" class="btn sm bad" data-a="kfdel" title="Прибрати">✕</button></div>`).join("")}</div></div>
    <div class="form-grid"><label class="f wide"><span>III. Кваліфікація: статті КК (через кому)</span><input class="i mono" id="kf-arts" value="${esc((d.arts || []).join(", "))}" placeholder="255, 258, 263"></label></div>
    <div class="kf-ed-sec"><div class="kf-ed-h"><b>IV</b> Докази <button type="button" class="btn sm" data-a="kfadd" data-k="evidence">+ Додати</button></div>
      <div id="kf-evidence">${(d.evidence || []).map((e) => `<div class="kf-row kf-ev" data-files="${esc((e.files || []).join(","))}">
        <input class="i wide" data-f="desc" placeholder="Опис доказу" value="${esc(e.desc)}"><input class="i" data-f="url" placeholder="Посилання на відкат / матеріал" value="${esc(e.url)}">
        <input class="i" data-f="file" type="file" accept="image/*,video/mp4,application/pdf" multiple>
        <span class="muted small">${(e.files || []).length ? `додатків: ${e.files.length}` : ""}</span>
        <button type="button" class="btn sm bad" data-a="kfdel" title="Прибрати">✕</button></div>`).join("")}</div></div>
    <div class="form-grid">
      <label class="f wide"><span>V. Проведені оперативно-розшукові заходи</span><textarea class="i" id="kf-measures" maxlength="4000">${esc(d.measures)}</textarea></label>
      <label class="f"><span>VI. Клопотання</span><select class="i" id="kf-rtype">${Object.entries(REQ).map(([k, v]) => `<option value="${k}" ${k === (d.request || {}).type ? "selected" : ""}>${v}</option>`).join("")}</select></label>
      <label class="f wide"><span>Зміст клопотання</span><textarea class="i" id="kf-rtext" maxlength="3000" placeholder="Прошу надати санкцію на...">${esc((d.request || {}).text)}</textarea></label>
    </div>
    <div class="paper-sign"><span class="muted small">Чернетку бачите лише ви. Після подання справа піде начальнику відділу, далі Голові СБУ та Генеральному прокурору.</span>
      <div class="acts"><button class="btn" type="submit" data-then="save">Зберегти чернетку</button><button class="btn gold" type="submit" data-then="submit">Зберегти й подати</button></div></div>
  </form>`;
}

function collect() {
  const v = (id) => ($(id) ? $(id).value.trim() : "");
  const rows = (sel) => [...document.querySelectorAll(sel)];
  return {
    dept: v("#kf-dept"),
    data: {
      title: v("#kf-title"), org: v("#kf-org"), grif: v("#kf-grif"), summary: v("#kf-summary"), measures: v("#kf-measures"),
      arts: v("#kf-arts").split(/[,;\s]+/).filter(Boolean),
      persons: rows(".kf-person").map((r) => Object.fromEntries(["name", "sid", "role", "org", "note"].map((k) => [k, r.querySelector(`[data-f=${k}]`).value.trim()]))),
      evidence: rows(".kf-ev").map((r) => ({ desc: r.querySelector("[data-f=desc]").value.trim(), url: r.querySelector("[data-f=url]").value.trim(),
        files: (r.dataset.files || "").split(",").filter(Boolean), _input: r.querySelector("[data-f=file]") })),
      request: { type: v("#kf-rtype"), text: v("#kf-rtext") },
    },
  };
}

async function save(then) {
  const draft = collect();
  for (const e of draft.data.evidence) {
    if (e._input && e._input.files.length) e.files = e.files.concat(await S.uploadFiles(e._input));
    delete e._input;
  }
  const body = { dept: draft.dept, ...draft.data };
  const id = UIc.edit && UIc.edit.id;
  let c = await call(id ? `/api/cases/${id}` : "/api/cases", { json: body });
  if (then === "submit") c = await call(`/api/cases/${c.id}/submit`, { json: {} });
  UIc.edit = null;
  UIc.id = c.id;
  toast(then === "submit" ? "Кейс-файл подано на погодження" : "Чернетку збережено");
}

/* ---------- PDF ---------- */
let pdfLib = null;
function loadPdf() {
  if (window.html2pdf) return Promise.resolve();
  return pdfLib || (pdfLib = new Promise((ok, bad) => {
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js";
    s.onload = ok; s.onerror = () => bad(new Error("Не вдалося завантажити модуль PDF"));
    document.head.append(s);
  }));
}
async function makePdf(c) {
  await loadPdf();
  const box = document.createElement("div");
  box.className = "pdf-host";
  box.innerHTML = docHtml(c, true);
  document.body.append(box);
  try {
    await window.html2pdf().set({ margin: [8, 8, 10, 8], filename: `${no(c.id)}_${(c.data.title || "").replace(/[^\p{L}\p{N}]+/gu, "_")}.pdf`,
      image: { type: "jpeg", quality: 0.96 }, html2canvas: { scale: 2, backgroundColor: "#f3eee2", useCORS: true },
      jsPDF: { unit: "mm", format: "a4", orientation: "portrait" }, pagebreak: { mode: ["css", "legacy"], avoid: [".kd-p", ".kd-ev li", ".kf-visa", ".kd-approved"] } })
      .from(box.firstElementChild).save();
  } finally { box.remove(); }
}

/* ---------- підключення до кабінету ---------- */
S.views.cases = async () => {
  if (UIc.edit) return editor(UIc.edit);
  if (UIc.id) return vCase(UIc.id);
  return vList();
};
Object.assign(S.actions, {
  kftab: (b) => { UIc.tab = b.dataset.v; S.render(); },
  kfopen: (b) => { UIc.id = +b.dataset.id; S.render(); scrollTo(0, 0); },
  kfback: () => { UIc.id = null; UIc.edit = null; S.render(); },
  kfnew: () => { UIc.edit = blankCase(); S.render(); },
  kfedit: () => { UIc.edit = JSON.parse(JSON.stringify(S.cache.case)); S.render(); },
  kfadd: (b) => {
    const cur = collect();
    UIc.edit = { ...(UIc.edit || {}), dept: cur.dept, data: { ...cur.data, evidence: cur.data.evidence.map(({ _input, ...e }) => e) } };
    UIc.edit.data[b.dataset.k].push(b.dataset.k === "persons" ? { name: "", sid: "", role: "фігурант", org: "", note: "" } : { desc: "", url: "", files: [] });
    S.render();
  },
  kfdel: (b) => b.closest(".kf-row").remove(),
  kfsubmit: async (b) => {
    if (!confirm("Подати кейс-файл на погодження? Після подання редагування закривається.")) return;
    b.disabled = true;
    try { await call(`/api/cases/${UIc.id}/submit`, { json: {} }); toast("Кейс-файл подано на погодження"); await S.refreshMe(); S.render(); }
    catch (e) { toast(e.message, 1); b.disabled = false; }
  },
  kfwd: async (b) => {
    if (!confirm("Відкликати справу з погодження? Вона повернеться у вашу чернетку.")) return;
    b.disabled = true;
    try { await call(`/api/cases/${UIc.id}/withdraw`, { json: {} }); toast("Справу відкликано в чернетку"); await S.refreshMe(); S.render(); }
    catch (e) { toast(e.message, 1); b.disabled = false; }
  },
  kfdec: async (b) => {
    const d = b.dataset.d;
    let note = "";
    if (d !== "ok") { note = prompt(d === "return" ? "Що доопрацювати? (виконавець побачить)" : "Причина відмови:", ""); if (note === null) return; }
    else if (!confirm(S.cache.case.status === "prosecutor" ? "Затвердити кейс-файл?" : "Погодити й передати далі?")) return;
    b.disabled = true;
    try { await call(`/api/cases/${UIc.id}/decision`, { json: { decision: d, note } }); toast(d === "ok" ? "Рішення внесено" : d === "return" ? "Повернуто виконавцю" : "Відмовлено"); await S.refreshMe(); S.render(); }
    catch (e) { toast(e.message, 1); b.disabled = false; }
  },
  kfpdf: async (b) => {
    b.disabled = true; const t = b.textContent; b.innerHTML = '<span class="spin"></span> Формую PDF…';
    try { await makePdf(S.cache.case); } catch (e) { toast(e.message, 1); }
    b.disabled = false; b.textContent = t;
  },
});
S.forms.kfsave = async (f, ev) => {
  const then = (ev.submitter && ev.submitter.dataset.then) || "save";
  const btns = f.querySelectorAll("button[type=submit]");
  btns.forEach((x) => (x.disabled = true));
  try { await save(then); await S.refreshMe(); S.render(); scrollTo(0, 0); }
  catch (e) { toast(e.message, 1); btns.forEach((x) => (x.disabled = false)); }
};
S.onNav.push((v) => { if (v !== "cases") { UIc.id = null; UIc.edit = null; } });
})();
