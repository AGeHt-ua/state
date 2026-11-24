/* «Клопотання»: до суду (ордери), Генерального прокурора, Міністерства юстиції, довільні — заготовки за законодавчою базою NG.
   Подає будь-хто → начальник управління відділу (якщо є) → Заступник Голови або Голова СБУ → PDF / PNG / текст для подання.
   Клопотання до Кабінету Міністрів і Мінфіну — окрема вкладка (розділ finance.js). */
(() => {
const S = window.SOVA;
const { esc, call, toast, fmtDT } = S;
const st = { tab: null, id: null, edit: null, group: "court" };
const CHIP = { wait: "wait", rejected: "bad", approved: "ok", posted: "info", granted: "ok", denied: "bad" };
const day = (t) => new Date(t || Date.now()).toLocaleDateString("uk-UA");
const M = () => S.cache.pet ? S.cache.pet.meta : { kinds: {}, fields: {}, groups: {}, status: {} };
const deptName = (d) => ((S.META().depts || {})[d] || {}).n || "";

// що просимо: поля підставляються в текст заготовки
function askText(k, x) {
  if (!k.ask) return esc(x.body || "");
  const of = x.person ? `, особа: ${x.person}` : "";
  return esc(k.ask.replace(/\{(\w+)\}/g, (_, f) => f === "person_of" ? of : (x[f] || "________")));
}
const titleOf = (k, x) => k.title || (x.subject ? `щодо: ${x.subject}` : "");
const addrOf = (k, x) => k.addr || (k.to ? x[k.to] : x.addressee) || "________";
const docOf = (k) => k.doc || "КЛОПОТАННЯ";
const leadOf = (k) => k.lead || "Служба безпеки штату NG просить";

function blank(p) {
  const m = M(), k = m.kinds[p.kind] || {}, x = p.data || {}, a = p.author || {};
  const skip = new Set(["addressee", "subject", "body"]);
  const rows = (k.fields || []).filter((f) => !skip.has(f) && x[f]).map((f) => `<p class="fin-row"><b>${esc(m.fields[f].n)}:</b> ${esc(x[f])}</p>`).join("");
  const visas = (p.visas || []).map((v) => `<div class="fin-visa"><b>${v.stage === "mgmt" ? "ПОГОДЖЕНО" : "ЗАТВЕРДЖЕНО"}</b><span>${esc(v.rankName || "")}</span><span class="kf-sign">${esc(v.name)}</span><span>${fmtDT(v.t)}</span></div>`).join("");
  return `<div class="blank fin-blank pet-blank">
    <div class="fin-to">${k.to === "person" ? "Кому" : "До"}: ${esc(addrOf(k, x))}<br>Від: ${esc(a.rankName || "")} ${esc(a.name || "")}, ${esc(deptName(a.dept) || "")}<br>Державна організація: Служба безпеки штату NG</div>
    <div class="blank-title">${docOf(k).split("").join(" ")}</div>
    <div class="fin-sub">${esc(titleOf(k, x))}${p.id ? ` · № ${esc(p.no)}` : ""}</div>
    <p>${k.basis ? `Керуючись ${esc(k.basis)}, ` : ""}${esc(leadOf(k))} ${k.ask ? askText(k, x) : ""}${k.ask ? "." : ""}</p>
    ${k.ask ? "" : `<p>${esc(x.body || "…").replace(/\n/g, "<br>")}</p>`}
    ${rows}
    ${k.group === "summons" && k.note ? `<p class="fin-row"><i>${esc(k.note)}</i></p>` : ""}
    <div class="fin-sign"><span><b>Дата:</b> ${day(p.approved || p.t)}</span><span><b>Підпис:</b> <span class="kf-sign">${esc(a.name || "")}</span></span></div>
    ${visas}</div>`;
}
const a4 = (p) => S.a4(blank(p), p.no || "КЛП-нов.", { noTo: true, date: day(p.approved || p.t), sub: (M().kinds[p.kind] || {}).group === "summons" ? "Повістка" : "Клопотання" });
const fname = (p) => `${p.no}_${(M().kinds[p.kind] || {}).group || ""}`;

// текст для подання на форумі / в порталі адресата
function forumText(p) {
  const m = M(), k = m.kinds[p.kind] || {}, x = p.data || {}, a = p.author || {};
  const tmp = document.createElement("div");
  tmp.innerHTML = k.ask ? askText(k, x) : esc(x.body || "");
  const lines = [`${k.to === "person" ? "Кому" : "До"}: ${addrOf(k, x)}`, `Від: ${a.rankName} ${a.name}, ${deptName(a.dept)}`, "Державна організація: Служба безпеки штату NG", "",
    `[B]${docOf(k)}[/B] ${titleOf(k, x)} · № ${p.no}`, "",
    `${k.basis ? `Керуючись ${k.basis}, ` : ""}${leadOf(k)} ${tmp.textContent}${k.ask ? "." : ""}`, ""];
  for (const f of (k.fields || [])) if (x[f] && !["addressee", "subject", "body"].includes(f)) lines.push(`[B]${m.fields[f].n}:[/B] ${x[f]}`);
  if (k.group === "summons" && k.note) lines.push("", k.note);
  lines.push("", `[B]Дата:[/B] ${day(p.approved || p.t)}`, `[B]Підпис:[/B] ${a.name}`);
  for (const v of p.visas || []) lines.push(`[B]${v.stage === "mgmt" ? "Погоджено" : "Затверджено"}:[/B] ${v.rankName || ""} ${v.name}`);
  return lines.join("\n");
}

async function load() {
  S.cache.pet = await call("/api/petitions");
  return S.cache.pet;
}

function listHtml(items, empty) {
  if (!items.length) return `<div class="empty">${empty}</div>`;
  const m = M();
  return `<div class="docs">${items.map((p) => {
    const k = m.kinds[p.kind] || {};
    return `<article class="doc st-${{ wait: "wait", rejected: "rej", approved: "ok", posted: "ok", granted: "ok", denied: "rej" }[p.status] || ""} clickable" data-a="petopen" data-id="${p.id}">
      <div class="doc-no"><b>${esc(p.no)}</b><span>${fmtDT(p.t)}</span></div>
      <div class="doc-main"><div class="doc-title">${esc(m.groups[k.group] || "")} · ${esc(titleOf(k, p.data || {}))}</div>
        <div class="doc-line">${esc(p.author ? p.author.name : "")} · ${esc(deptName(p.dept))}</div>
        ${p.status === "rejected" && p.note ? `<div class="doc-note"><b>Повернуто:</b> ${esc(p.note)}</div>` : ""}</div>
      <div class="doc-side"><span class="chip ${CHIP[p.status] || ""}">${esc(p.statusName)}</span>${p.stageName ? `<span class="muted small">${esc(p.stageName)}</span>` : ""}</div>
    </article>`;
  }).join("")}</div>`;
}

function formHtml() {
  const m = M(), e = st.edit, k = m.kinds[e.kind] || {}, me = S.ME().me;
  const kinds = Object.entries(m.kinds).filter(([, v]) => v.group === e.group);
  const preview = { ...e, no: e.no || "КЛП-нов.", data: e.data, author: e.author || { name: me.name, rankName: me.rankName, dept: me.dept }, visas: [] };
  return `<div class="grid2 rap-wrap"><form class="card" data-f="petsave">
      <header><h3>${e.id ? `Виправлення ${esc(e.no)}` : "Нове клопотання"}</h3></header>
      <div class="form-grid">
        ${e.id ? "" : `<label class="f wide"><span>Кому</span><select class="i" data-pg="1">${Object.entries(m.groups).map(([g, n]) => `<option value="${g}" ${g === e.group ? "selected" : ""}>${esc(n)}</option>`).join("")}${S.ME().fin && S.ME().fin.view ? '<option value="__fin">Кабінет Міністрів / Мінфін (фінансування)</option>' : ""}</select></label>
        <label class="f wide"><span>Вид клопотання</span><select class="i" data-pk="1">${kinds.map(([kk, v]) => `<option value="${kk}" ${kk === e.kind ? "selected" : ""}>${esc(v.title ? v.title[0].toUpperCase() + v.title.slice(1) : "Довільне клопотання")}</option>`).join("")}</select></label>`}
        ${(k.fields || []).map((f) => {
          const fd = m.fields[f], req = (k.req || []).includes(f) ? " *" : "", v = esc((e.data || {})[f] || "");
          return fd.t === "area" ? `<label class="f wide"><span>${esc(fd.n)}${req}</span><textarea class="i" id="pt-${f}" data-pf="${f}">${v}</textarea></label>`
            : `<label class="f wide"><span>${esc(fd.n)}${req}</span><input class="i" id="pt-${f}" data-pf="${f}" value="${v}" maxlength="300"></label>`;
        }).join("")}
        ${e.id ? "" : S.tagSelect('data-pf="tag"', (e.data || {}).tag || "")}
      </div>
      ${k.note && k.group !== "summons" ? `<p class="note">${esc(k.note)}</p>` : ""}
      <p class="note">${k.group === "summons" ? "Повістку погоджує начальник або заступник начальника вашого відділу (від начальника управління й вище — одразу чинна). Після погодження — PDF, PNG і текст для вручення."
        : "Після подання: начальник управління вашого відділу (якщо відділ входить в управління) → Заступник Голови або Голова СБУ. Після затвердження — PDF, PNG і текст для подання адресату."}</p>
      <div class="acts"><button class="btn" type="button" data-a="petcancel">Скасувати</button><button class="btn gold" type="submit">${e.id ? "Зберегти й подати знову" : "Подати клопотання"}</button></div>
    </form><div id="pet-blank">${blank(preview)}</div></div>`;
}

function docHtml(p) {
  const done = ["approved", "posted", "granted", "denied"].includes(p.status);
  return `<div class="kd-bar"><button class="btn" data-a="petback">← До клопотань</button><span class="sp"></span>
      <span class="chip ${CHIP[p.status] || ""}">${esc(p.statusName)}${p.stageName ? ` · ${esc(p.stageName)}` : ""}</span></div>
    ${p.status === "rejected" && p.note ? `<p class="note warn"><b>Повернуто на доопрацювання:</b> ${esc(p.note)}</p>` : ""}
    ${p.result_url ? `<p class="note">Подано: ${S.safeUrl(p.result_url) ? `<a href="${esc(S.safeUrl(p.result_url))}" target="_blank" rel="noopener">${esc(p.result_url)}</a>` : esc(p.result_url)}</p>` : ""}
    <div class="acts" style="margin:12px 0;flex-wrap:wrap">
      <button class="btn" data-a="petpdf">⬇ PDF</button><button class="btn" data-a="petpng">⬇ PNG</button>${done ? '<button class="btn" data-a="petcopy">⧉ Текст для подання</button>' : ""}${S.docImgBtn("pet", p.id)}
      ${p.canAct ? `<button class="btn ok" data-a="petok">${p.stage === "chief" || S.cache.pet.rights.approve ? "Затвердити" : "Погодити"}</button><button class="btn bad" data-a="petrej">↩ Повернути автору</button>` : ""}
      ${p.canEdit || (p.mine && p.status === "rejected") ? '<button class="btn" data-a="petedit">✏️ Виправити</button>' : ""}
      ${p.canResult ? `<button class="btn" data-a="petres" data-v="posted">📤 ${(M().kinds[p.kind] || {}).group === "summons" ? "Вручено" : "Подано адресату"}</button><button class="btn ok" data-a="petres" data-v="granted">✅ Задоволено</button><button class="btn bad" data-a="petres" data-v="denied">⛔ Відмовлено</button>` : ""}
      ${p.canDelete ? '<button class="btn bad" data-a="petdel">🗑</button>' : ""}
    </div>
    ${blank(p)}
    ${(p.history || []).length ? `<div class="card" style="margin-top:16px"><header><h3>Рух документа</h3></header><ul class="small">${p.history.map((h) => `<li>${fmtDT(h.t)} · ${esc(h.name)} · ${esc({ create: "подав", edit: "виправив і подав знову", visa: "погодив", approve: "затвердив", reject: "повернув", posted: "позначив «подано»", granted: "позначив «задоволено»", denied: "позначив «відмовлено»", delete: "видалив" }[h.action] || h.action)}${h.note ? ` — ${esc(h.note)}` : ""}</li>`).join("")}</ul></div>` : ""}`;
}

S.views.pet = async () => {
  const d = st.edit && S.cache.pet ? S.cache.pet : await load();
  const head = (t) => `<div class="tabs">${[["mine", "Мої клопотання"], ["new", "Нове клопотання"],
    ...(d.items.some((p) => p.canAct) || d.rights.approve ? [["review", "На погодження", d.items.filter((p) => p.canAct).length]] : []),
    ...(d.items.some((p) => !p.mine) ? [["all", "Реєстр"]] : [])]
    .map(([v, l, n]) => `<button class="tb ${t === v ? "on" : ""}" data-a="pettab" data-v="${v}">${l}${n !== undefined ? `<span class="cnt">${n}</span>` : ""}</button>`).join("")}
    ${S.ME().fin && S.ME().fin.view ? '<button class="tb" data-a="nav" data-v="fin">Мінфін ↗</button>' : ""}</div>`;
  if (st.edit) return formHtml();
  if (st.id) {
    const p = d.items.find((x) => x.id === st.id);
    if (!p) { st.id = null; return head("mine") + '<p class="note bad">Клопотання не знайдено або немає доступу.</p>'; }
    S.cache.petDoc = p;
    return docHtml(p);
  }
  const t = st.tab || (d.items.some((p) => p.canAct) ? "review" : "mine");
  if (t === "new") { newEdit(); return formHtml(); }
  const items = t === "review" ? d.items.filter((p) => p.canAct) : t === "all" ? d.items : d.items.filter((p) => p.mine);
  return head(t) + listHtml(items, t === "review" ? "Немає клопотань на погодження." : t === "mine" ? "Ви ще не подавали клопотань." : "Клопотань немає.");
};

function newEdit(group) {
  const g = group || st.group || "court";
  const kind = Object.keys(M().kinds).find((k) => M().kinds[k].group === g);
  st.edit = { group: g, kind, data: {} };
}
const readForm = () => { document.querySelectorAll("[data-pf]").forEach((el) => { st.edit.data[el.dataset.pf] = el.value; }); };
const refreshBlank = () => {
  const b = document.getElementById("pet-blank");
  const me = S.ME().me, e = st.edit;
  if (b && e) b.innerHTML = blank({ ...e, no: e.no || "КЛП-нов.", author: e.author || { name: me.name, rankName: me.rankName, dept: me.dept }, visas: [] });
};
document.addEventListener("input", (ev) => { if (st.edit && ev.target.dataset && ev.target.dataset.pf) { readForm(); refreshBlank(); } });
document.addEventListener("change", (ev) => {
  if (!st.edit || !ev.target.dataset) return;
  if (ev.target.dataset.pg) {
    if (ev.target.value === "__fin") { st.edit = null; S.actions.nav({ dataset: { v: "fin" } }); return; }
    readForm(); st.group = ev.target.value; const keep = st.edit.data; newEdit(st.group); st.edit.data = keep; S.render();
  }
  if (ev.target.dataset.pk) { readForm(); st.edit.kind = ev.target.value; S.render(); }
});

const docImg = async (id) => {
  const d = await load().catch(() => null);
  const p = d && d.items.find((x) => x.id === id);
  return p ? S.docImage("pet", id, a4(p)) : false;
};
S.docImageFns.pet = docImg;
const act = async (b, url, body, ok, id) => {
  b.disabled = true;
  try { await call(url, { json: body || {} }); toast(ok); if (id) await docImg(id); await S.refreshMe(); S.render(); return true; }
  catch (e) { toast(e.message, 1); b.disabled = false; return false; }
};

S.forms.petsave = async (f, ev) => {
  readForm();
  const e = st.edit, btn = f.querySelector("button[type=submit]");
  btn.disabled = true;
  try {
    const r = await call(e.id ? `/api/petitions/${e.id}` : "/api/petitions", { json: { kind: e.kind, ...e.data } });
    toast(e.id ? "Клопотання виправлено й подано знову" : "Клопотання подано на погодження");
    st.edit = null; st.id = r.id;
    await docImg(r.id);
    await S.refreshMe(); S.render(); scrollTo(0, 0);
  } catch (err) { toast(err.message, 1); btn.disabled = false; }
};
Object.assign(S.actions, {
  pettab: (b) => { st.tab = b.dataset.v; st.id = null; st.edit = null; S.render(); },
  petopen: (b) => { st.id = +b.dataset.id; S.render(); scrollTo(0, 0); },
  petback: () => { st.id = null; S.render(); },
  petcancel: () => { if (st.edit && st.edit.id) st.id = st.edit.id; else st.tab = "mine"; st.edit = null; S.render(); },
  petedit: () => { const p = S.cache.petDoc; st.edit = { id: p.id, no: p.no, kind: p.kind, group: (M().kinds[p.kind] || {}).group, data: { ...p.data }, author: p.author }; S.render(); },
  petok: (b) => { if (confirm("Погодити клопотання?")) act(b, `/api/petitions/${st.id}/decide`, { decision: "ok" }, "Погоджено", st.id); },
  petrej: (b) => { const note = prompt("Що виправити (побачить автор):", ""); if (note === null) return; if (!note.trim()) return toast("Вкажіть, що виправити", 1); act(b, `/api/petitions/${st.id}/decide`, { decision: "reject", note }, "Повернуто автору", st.id); },
  petres: (b) => {
    const v = b.dataset.v;
    const url = v === "posted" ? prompt("Посилання на подане клопотання (форум / портал), необов'язково:", S.cache.petDoc.result_url || "") : S.cache.petDoc.result_url;
    if (v === "posted" && url === null) return;
    act(b, `/api/petitions/${st.id}/result`, { status: v, url: url || "" }, "Збережено", st.id);
  },
  petdel: (b) => { if (confirm("Видалити клопотання?")) act(b, `/api/petitions/${st.id}/delete`, null, "Видалено").then((ok) => { if (ok) { st.id = null; S.render(); } }); },
  petpdf: (b) => S.pdfA4(b, a4(S.cache.petDoc), fname(S.cache.petDoc)),
  petpng: (b) => S.pngBtn(b, blank(S.cache.petDoc), fname(S.cache.petDoc)),
  petcopy: async () => { const t = forumText(S.cache.petDoc); try { await navigator.clipboard.writeText(t); toast("Текст скопійовано"); } catch (e) { prompt("Скопіюйте текст:", t); } },
});
S.onNav.push((v) => { if (v !== "pet") { st.id = null; st.edit = null; } });
// адреса: #/pet · #/pet/review · #/pet/12
const isId = (x) => /^\d+$/.test(x || "");
S.routes.pet = {
  get: () => st.edit ? ["new"] : st.id ? [st.id] : [st.tab],
  set: (p) => { st.edit = null; st.id = isId(p[0]) ? +p[0] : null; if (!isId(p[0]) && p[0]) st.tab = p[0]; },
};
})();
