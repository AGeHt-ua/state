/* Дисципліна: мої стягнення, журнал наказів, новий наказ (з бланком), службові перевірки ВВБ. Підключається після app.js (window.SOVA). */
(() => {
const S = window.SOVA;
const { esc, call, toast, fmtDT } = S;
const st = { tab: null, form: null, insp: null };
const no = (id) => `НС-${String(id).padStart(4, "0")}`;
const $$ = (n) => "$" + Number(n || 0).toLocaleString("uk-UA").replace(/ /g, " ");
const SEV = { remark: "low", reprimand: "mid", severe: "high", fine: "mid", demote: "high", dismiss: "crit", blacklist: "crit" };
const left = (t) => {
  const ms = t - Date.now();
  if (ms <= 0) return "погашено";
  const d = Math.floor(ms / 864e5), h = Math.floor((ms % 864e5) / 36e5);
  return d ? `ще ${d} дн ${h} год` : `ще ${h} год`;
};
const STATUS = (o) => o.status === "cancelled" ? ["Скасовано за скаргою", "info"] : o.status === "lifted" ? ["Знято достроково", "info"]
  : o.active ? ["Чинна", "bad"] : o.expires ? ["Погашена", "mute"] : ["Виконано", "mute"];

// паперові бланки для PDF: наказ про стягнення і матеріали службової перевірки
const ALL = {};
function nsDoc(o) {
  const D = S.META().depts, t = o.target || { name: "№" + o.sid, rankName: "" }, [sl] = STATUS(o), ap = o.appeal;
  return `<div class="blank ns-blank">
    <div class="rap-no">${no(o.id)}</div>
    <div class="blank-to">СЛУЖБА БЕЗПЕКИ ШТАТУ NG</div>
    <div class="blank-title">Н А К А З</div>
    <div style="text-align:center;margin:-8px 0 18px">№ ${no(o.id)} · ${fmtDT(o.issued)} · Про дисциплінарне стягнення</div>
    <p>За ${esc(o.violationText.toLowerCase())}${o.reason ? ` (${esc(o.reason)})` : ""}, керуючись Дисциплінарними стягненнями СБУ,</p>
    <p style="text-indent:0"><b>НАКАЗУЮ:</b> оголосити ${esc(o.kindName.toLowerCase())}${o.fine ? ` у розмірі ${$(o.fine)}` : ""}
      ${esc((t.rankName || "").toLowerCase())} ${esc(t.name)}, жетон №${o.sid}${D[o.dept] ? `, ${esc(D[o.dept].n)}` : ""}.</p>
    ${o.expires ? `<p style="text-indent:0">Строк дії стягнення — до ${fmtDT(o.expires)}. Оскарження Голові СБУ — протягом 24 годин (п. 4.1).</p>` : ""}
    ${ap ? `<p style="text-indent:0"><b>Скарга від ${fmtDT(ap.t)}:</b> ${esc(ap.text)}${ap.decision ? ` — <b>${ap.decision === "cancel" ? "задоволено, стягнення скасовано" : "відхилено"}</b>${ap.by ? ` (${esc(ap.by)})` : ""}` : " — на розгляді"}</p>` : ""}
    <p style="text-indent:0">Стан: <b>${esc(sl)}</b>.</p>
    <div class="blank-sign"><span>${o.issuer ? esc(o.issuer.rankName) : ""}</span><span class="kf-sign">${o.issuer ? esc(o.issuer.name) : ""}</span></div>
    <div class="blank-stamp">ЄІС «СОВА»</div></div>`;
}
function spDoc(i, kinds) {
  const n = `СП-${String(i.id).padStart(4, "0")}`, sec = (t, v) => `<p style="text-indent:0"><b>${t}:</b> ${esc(v || "—").replace(/\n/g, "<br>")}</p>`;
  return `<div class="blank ns-blank">
    <div class="rap-no">${n}</div>
    <div class="blank-to">СЛУЖБА БЕЗПЕКИ ШТАТУ NG<br>Відділ внутрішньої безпеки</div>
    <div class="blank-title">М А Т Е Р І А Л И</div>
    <div style="text-align:center;margin:-8px 0 18px">службової перевірки № ${n} · ${fmtDT(i.updated)}</div>
    ${sec("Предмет перевірки", i.title)}${sec("Щодо співробітника", i.target ? i.target.rankName + " " + i.target.name + ", жетон №" + i.sid : "№" + i.sid)}
    ${sec("Матеріали", i.materials)}${sec("Висновок ВВБ", i.conclusion)}${sec("Рекомендоване стягнення", i.recommend ? kinds[i.recommend] : "без стягнення")}
    ${i.order_id ? sec("За результатами", "наказ " + no(i.order_id)) : ""}
    <div class="blank-sign"><span>Перевірку провів</span><span class="kf-sign">${i.author ? esc(i.author.name) : ""}</span></div>
    <div class="blank-stamp">ЄІС «СОВА»</div></div>`;
}

function order(o, D, opts = {}) {
  ALL[o.id] = o;
  const [sl, sc] = STATUS(o), t = o.target || { name: "№" + o.sid, rankName: "" };
  const canAppeal = opts.mine && !o.appeal && Date.now() - o.issued < 864e5 && o.status === "active";
  const ap = o.appeal;
  return `<article class="ns sev-${SEV[o.kind]} ${o.active ? "on" : ""}">
    <header><div><b>НАКАЗ ${no(o.id)}</b><span>${fmtDT(o.issued)} · Про дисциплінарне стягнення</span></div><span class="chip ${sc}">${sl}</span></header>
    <div class="ns-body">
      <p>За <b>${esc(o.violationText.toLowerCase())}</b>${o.reason ? ` (${esc(o.reason)})` : ""} оголосити
        <span class="ns-kind">${esc(o.kindName.toLowerCase())}</span>${o.fine ? ` у розмірі <b>${$$(o.fine)}</b>` : ""}
        ${esc((t.rankName || "").toLowerCase())} <b>${esc(t.name)}</b>, жетон №${o.sid}${D[o.dept] ? `, ${esc(D[o.dept].s)}` : ""}.</p>
      <div class="ns-meta"><span>Видав: ${o.issuer ? esc(o.issuer.rankName + " " + o.issuer.name) : "—"}</span>${o.expires ? `<span class="${o.active ? "act" : ""}">⏱ ${o.active ? left(o.expires) : "діяла до " + fmtDT(o.expires)}</span>` : ""}</div>
      ${ap ? `<div class="ns-appeal ${ap.decision || "wait"}"><b>Скарга Голові СБУ</b> · ${fmtDT(ap.t)}<p>${esc(ap.text)}</p>
        ${ap.decision ? `<div>Рішення: <b>${ap.decision === "cancel" ? "стягнення скасовано" : "стягнення залишено"}</b> · ${esc(ap.by || "")}${ap.note ? ` · «${esc(ap.note)}»` : ""}</div>` : "<div>На розгляді Голови СБУ</div>"}</div>` : ""}
    </div>
    <div class="ns-stamp">${esc(o.kindName.toUpperCase())}</div>
    <footer>
      <button class="btn sm" data-a="nspdf" data-id="${o.id}">⬇ PDF</button>
      ${canAppeal ? `<button class="btn sm" data-a="nsappeal" data-id="${o.id}">⚖ Оскаржити (до ${fmtDT(o.issued + 864e5)})</button>` : ""}
      ${opts.head && ap && !ap.decision ? `<button class="btn sm ok" data-a="nsdec" data-id="${o.id}" data-x="cancel">Задовольнити скаргу</button><button class="btn sm" data-a="nsdec" data-id="${o.id}" data-x="uphold">Відхилити скаргу</button>` : ""}
      ${opts.head && o.active ? `<button class="btn sm" data-a="nsdec" data-id="${o.id}" data-x="lift">Зняти достроково</button>` : ""}
      ${opts.del ? `<button class="btn sm bad" data-a="nsdel" data-id="${o.id}">🗑 Скасувати й видалити</button>` : ""}
    </footer>
  </article>`;
}

function mine(d) {
  const act = d.mine.filter((o) => o.active && o.kind === "reprimand").length, sev = d.mine.filter((o) => o.active && o.kind === "severe").length;
  return `<div class="ns-panel">
    <div class="ns-lights"><div class="eyebrow">Активні письмові догани</div>
      <div class="ns-dots">${[0, 1, 2].map((i) => `<i class="${i < act ? "on" : ""}"></i>`).join("")}</div>
      <b>${act} з 3</b><small>3 активні догани = безумовне звільнення (п. 3.4)</small></div>
    <div class="ns-info"><div><span>Сувора догана</span><b class="${sev ? "bad" : ""}">${sev ? "чинна" : "немає"}</b></div>
      <div><span>Підвищення та премії</span><b class="${act + sev ? "bad" : "ok"}">${act + sev ? "заблоковано" : "доступні"}</b></div>
      <div><span>Усього наказів</span><b>${d.mine.length}</b></div></div>
  </div>
  ${d.mine.length ? `<div class="ns-list">${d.mine.map((o) => order(o, S.META().depts, { mine: true })).join("")}</div>` : '<div class="empty ns-clean">Стягнень немає. Бездоганна служба.</div>'}`;
}

function journalView(d) {
  const f = st.f || "active";
  const rows = d.journal.filter((o) => f === "all" || (f === "active" ? o.active || (o.appeal && !o.appeal.decision) : o.kind === f));
  const me = S.ME().me;
  return `<div class="aud-f" style="margin-bottom:14px">${[["active", "Чинні"], ["all", "Усі"], ["reprimand", "Догани"], ["fine", "Штрафи"], ["dismiss", "Звільнення"]]
      .map(([k, l]) => `<button class="${k === f ? "on" : ""}" data-a="nsf" data-v="${k}">${l}</button>`).join("")}</div>
    ${rows.length ? `<div class="ns-list">${rows.map((o) => order(o, S.META().depts, { head: d.rights.head, del: d.rights.chief || (o.issuer && o.issuer.sid === me.sid) })).join("")}</div>` : '<div class="empty">Записів немає.</div>'}`;
}

function formView(d, staff) {
  const f = st.form || {};
  const me = S.ME().me;
  const v = d.violations.find((x) => x.id === f.violation) || d.violations[0];
  const kinds = v.kinds.filter((k) => d.rights.kinds.includes(k));
  const kind = kinds.includes(f.kind) ? f.kind : kinds[0];
  const target = staff.find((p) => String(p.sid) === String(f.sid));
  return `<div class="grid2 rap-wrap"><form class="card" data-f="nsissue">
    <header><h3>Новий наказ про стягнення</h3></header>
    <div class="form-grid">
      <label class="f wide"><span>Співробітник</span><select class="i" id="ns-sid" data-ns>${'<option value="">— оберіть —</option>' + staff.filter((p) => p.sid !== me.sid)
        .map((p) => `<option value="${p.sid}" ${String(p.sid) === String(f.sid) ? "selected" : ""}>${esc(p.name)} · ${esc(p.rankName)} · ${esc((S.META().depts[p.dept] || {}).s || "")} · ${p.sid}</option>`).join("")}</select></label>
      <label class="f wide"><span>Порушення</span><select class="i" id="ns-v" data-ns>${d.violations.map((x) => `<option value="${x.id}" ${x.id === v.id ? "selected" : ""}>${esc(x.t)}</option>`).join("")}</select></label>
      <label class="f"><span>Вид стягнення</span><select class="i" id="ns-kind" data-ns>${kinds.length ? kinds.map((k) => `<option value="${k}" ${k === kind ? "selected" : ""}>${esc(d.kinds[k])}</option>`).join("") : '<option value="">немає повноважень</option>'}</select></label>
      ${kind === "fine" ? `<label class="f"><span>Сума штрафу, $</span><input class="i" id="ns-fine" type="number" min="0" step="1000" value="${f.fine ?? v.fine}" data-ns></label>` : ""}
      <label class="f wide"><span>Обставини порушення</span><textarea class="i" id="ns-reason" data-ns placeholder="Коли, де, що сталося; докази">${esc(f.reason || "")}</textarea></label>
    </div>
    ${["demote", "dismiss", "blacklist"].includes(kind) ? '<p class="note warn">Бот одразу виконає наказ: змінить звання або зніме ролі СБУ в Discord і запише це в кадровий аудит.</p>' : ""}
    ${f.inspection ? `<p class="note">Наказ за матеріалами службової перевірки СП-${String(f.inspection).padStart(4, "0")}.</p>` : ""}
    <div><button class="btn gold" type="submit" ${kinds.length ? "" : "disabled"}>Оголосити наказ</button></div></form>
    ${blankHtml(d, staff)}</div>`;
}

function blankHtml(d, staff) {
  const f = st.form || {}, me = S.ME().me;
  const v = d.violations.find((x) => x.id === f.violation) || d.violations[0];
  const kinds = v.kinds.filter((k) => d.rights.kinds.includes(k));
  const kind = kinds.includes(f.kind) ? f.kind : kinds[0];
  const target = staff.find((p) => String(p.sid) === String(f.sid));
  return `<div class="blank ns-blank">
      <div class="blank-to">СЛУЖБА БЕЗПЕКИ ШТАТУ NG</div>
      <div class="blank-title">Н А К А З</div>
      <div style="text-align:center;margin:-8px 0 18px">№ НС-нов. · ${new Date().toLocaleDateString("uk-UA")} · Про дисциплінарне стягнення</div>
      <p>За ${esc((v.t || "").toLowerCase())}${f.reason ? `, а саме: ${esc(f.reason)}` : ""}, керуючись Регламентом «Дисциплінарні стягнення СБУ»,</p>
      <p style="text-indent:0"><b>НАКАЗУЮ:</b> оголосити ${esc((d.kinds[kind] || "").toLowerCase())}${kind === "fine" ? ` у розмірі ${$$(f.fine ?? v.fine)}` : ""}
        ${target ? `${esc(target.rankName.toLowerCase())} ${esc(target.name)}, жетон №${target.sid}` : "________________"}.</p>
      <div class="blank-sign"><span>${esc(me.rankName)}</span><span>${esc(me.name)}</span></div>
      <div class="blank-stamp">ЄІС «СОВА»</div>
    </div>`;
}

function inspView(d, staff) {
  const R = d.rights, me = S.ME().me;
  if (st.insp) {
    const i = st.insp;
    return `<form class="card" data-f="nsinsp" style="max-width:900px"><header><h3>${i.id ? `Службова перевірка СП-${String(i.id).padStart(4, "0")}` : "Нова службова перевірка"}</h3></header>
      <div class="form-grid">
        <label class="f"><span>Щодо співробітника</span><select class="i" id="sp-sid">${staff.map((p) => `<option value="${p.sid}" ${String(p.sid) === String(i.sid) ? "selected" : ""}>${esc(p.name)} · ${esc(p.rankName)} · ${p.sid}</option>`).join("")}</select></label>
        <label class="f"><span>Предмет перевірки</span><input class="i" id="sp-title" maxlength="120" value="${esc(i.title || "")}"></label>
        <label class="f wide"><span>Матеріали: факти, пояснення, свідки, докази (посилання)</span><textarea class="i kf-big" id="sp-mat">${esc(i.materials || "")}</textarea></label>
        <label class="f wide"><span>Висновок ВВБ</span><textarea class="i" id="sp-con">${esc(i.conclusion || "")}</textarea></label>
        <label class="f"><span>Рекомендоване стягнення</span><select class="i" id="sp-rec"><option value="">— без стягнення —</option>${Object.entries(d.kinds).map(([k, n]) => `<option value="${k}" ${k === i.recommend ? "selected" : ""}>${esc(n)}</option>`).join("")}</select></label>
      </div>
      <div class="acts"><button class="btn" type="button" data-a="nsinspback">Скасувати</button><button class="btn gold" type="submit">Зберегти</button></div></form>`;
  }
  const lab = { open: ["Проводиться", "wait"], sent: ["Направлено Голові", "info"], closed: ["Закрито", "mute"] };
  return `${R.vvb ? '<div class="bn-actions"><button class="btn gold" data-a="nsinspnew">+ Розпочати службову перевірку</button></div>' : ""}
    ${d.inspections.length ? `<div class="docs">${d.inspections.map((i) => `<article class="doc st-${i.status === "closed" ? "ok" : i.status === "sent" ? "info" : "wait"}">
      <div class="doc-no"><b>СП-${String(i.id).padStart(4, "0")}</b><span>${fmtDT(i.updated)}</span></div>
      <div class="doc-main"><div class="doc-title">${esc(i.title)}</div>
        <div class="doc-line"><span>Щодо</span>${i.target ? esc(i.target.rankName + " " + i.target.name) : "№" + i.sid} · <span>Перевіряє</span>${i.author ? esc(i.author.name) : "—"}</div>
        ${i.conclusion ? `<div class="doc-note"><b>Висновок:</b> ${esc(i.conclusion)}${i.recommend ? ` · рекомендовано: <b>${esc(d.kinds[i.recommend])}</b>` : ""}</div>` : ""}
        ${i.order_id ? `<div class="small muted">За результатами — наказ ${no(i.order_id)}</div>` : ""}</div>
      <div class="doc-side"><span class="chip ${lab[i.status][1]}">${lab[i.status][0]}</span><button class="btn sm" data-a="sppdf" data-id="${i.id}">⬇ PDF</button>
        ${i.status === "open" && R.vvb ? `<button class="btn sm" data-a="nsinspedit" data-id="${i.id}">Редагувати</button><button class="btn sm gold" data-a="nsinspmove" data-id="${i.id}" data-to="sent">Направити Голові</button>` : ""}
        ${i.status === "sent" && R.chief ? `<button class="btn sm ok" data-a="nsinspord" data-id="${i.id}">Накласти стягнення</button><button class="btn sm" data-a="nsinspmove" data-id="${i.id}" data-to="closed">Закрити без стягнення</button>` : ""}
        ${i.author && (i.author.sid === me.sid || R.chief) ? `<button class="btn sm bad" data-a="nsinspmove" data-id="${i.id}" data-to="deleted">🗑</button>` : ""}</div>
    </article>`).join("")}</div>` : '<div class="empty">Службових перевірок немає.</div>'}`;
}

async function view() {
  const d = await call("/api/discipline");
  S.cache.disc = d;
  const R = d.rights;
  const tabs = [["mine", "Мої стягнення"], ...(R.journal ? [["journal", "Журнал наказів"]] : []), ...(R.kinds.length ? [["new", "Новий наказ"]] : []),
    ...(R.vvb || R.chief ? [["insp", "Службові перевірки"]] : [])];
  const t = tabs.find((x) => x[0] === st.tab) ? st.tab : "mine";
  const head = tabs.length > 1 ? `<div class="tabs">${tabs.map(([v, l]) => `<button class="tb ${t === v ? "on" : ""}" data-a="nstab" data-v="${v}">${l}</button>`).join("")}</div>` : "";
  let body;
  if (t === "journal") body = journalView(d);
  else if (t === "new" || t === "insp") { const staff = await call("/api/structure"); S.cache.staff = staff; body = t === "new" ? formView(d, staff) : inspView(d, staff); }
  else body = mine(d);
  return head + body;
}

const run = async (b, fn) => { if (b) b.disabled = true; try { await fn(); } catch (e) { toast(e.message, 1); } if (b) b.disabled = false; };
const readForm = () => ({ sid: S.$("#ns-sid")?.value, violation: S.$("#ns-v")?.value, kind: S.$("#ns-kind")?.value,
  fine: S.$("#ns-fine") ? +S.$("#ns-fine").value : undefined, reason: S.$("#ns-reason")?.value, inspection: (st.form || {}).inspection });
S.views.disc = view;
Object.assign(S.actions, {
  nspdf: (b) => { const o = ALL[b.dataset.id]; if (o) S.pdfBtn(b, nsDoc(o), `${no(o.id)}_${o.kindName}`); },
  sppdf: (b) => { const i = (S.cache.disc.inspections || []).find((x) => String(x.id) === b.dataset.id); if (i) S.pdfBtn(b, spDoc(i, S.cache.disc.kinds), `СП-${String(i.id).padStart(4, "0")}_${i.title || ""}`); },
  nstab: (b) => { st.tab = b.dataset.v; st.insp = null; S.render(); },
  nsf: (b) => { st.f = b.dataset.v; S.render(); },
  nsappeal: (b) => run(b, async () => {
    const text = prompt("Скарга Голові СБУ (п. 4.1): чому стягнення незаконне чи необґрунтоване?", "");
    if (text === null) return;
    await call(`/api/discipline/${b.dataset.id}/appeal`, { json: { text } }); toast("Скаргу подано Голові СБУ"); S.render();
  }),
  nsdec: (b) => run(b, async () => {
    const x = b.dataset.x, q = { cancel: "Задовольнити скаргу й скасувати стягнення?", uphold: "Відхилити скаргу?", lift: "Зняти догану достроково?" }[x];
    const note = prompt(q + "\nКоментар (необов'язково):", "");
    if (note === null) return;
    await call(`/api/discipline/${b.dataset.id}/decide`, { json: { action: x, note } }); toast("Рішення внесено"); await S.refreshMe(); S.render();
  }),
  nsdel: (b) => run(b, async () => {
    if (!confirm("Скасувати й видалити наказ? Пониження чи звільнення бот назад не поверне — це робиться окремо.")) return;
    await call(`/api/discipline/${b.dataset.id}/delete`, { json: {} }); toast("Наказ видалено"); await S.refreshMe(); S.render();
  }),
  nsinspnew: () => { st.insp = {}; S.render(); },
  nsinspback: () => { st.insp = null; S.render(); },
  nsinspedit: (b) => { st.insp = S.cache.disc.inspections.find((i) => i.id === +b.dataset.id); S.render(); },
  nsinspmove: (b) => run(b, async () => {
    const to = b.dataset.to;
    if (!confirm({ sent: "Направити матеріали Голові СБУ?", closed: "Закрити перевірку без стягнення?", deleted: "Видалити службову перевірку?" }[to])) return;
    await call(`/api/inspections/${b.dataset.id}/move`, { json: { to } }); toast("Готово"); await S.refreshMe(); S.render();
  }),
  nsinspord: (b) => {
    const i = S.cache.disc.inspections.find((x) => x.id === +b.dataset.id);
    st.form = { sid: i.sid, violation: "other", kind: i.recommend, reason: i.conclusion, inspection: i.id };
    st.tab = "new"; S.render();
  },
});
// Бланк наказу оновлюється під час введення; зміна списків перемальовує форму (доступні види стягнень залежать від порушення)
document.addEventListener("input", (e) => {
  if (!e.target.hasAttribute || !e.target.hasAttribute("data-ns") || e.target.tagName === "SELECT") return;
  st.form = readForm();
  const bl = document.querySelector(".ns-blank");
  if (bl) bl.outerHTML = blankHtml(S.cache.disc, S.cache.staff);
});
document.addEventListener("change", (e) => { if (e.target.tagName === "SELECT" && e.target.hasAttribute("data-ns")) { st.form = readForm(); S.render(); } });
S.forms.nsissue = async (f) => run(f.querySelector("button[type=submit]"), async () => {
  const b = readForm();
  if (!b.sid) throw new Error("Оберіть співробітника.");
  if (!confirm("Оголосити наказ? Співробітник побачить його в кабінеті, запис піде в кадровий аудит.")) return;
  await call("/api/discipline", { json: b });
  toast("Наказ оголошено"); st.form = null; st.tab = "journal"; await S.refreshMe(); S.render();
});
S.forms.nsinsp = async (f) => run(f.querySelector("button[type=submit]"), async () => {
  const v = (id) => S.$(id).value;
  const body = { sid: v("#sp-sid"), title: v("#sp-title"), materials: v("#sp-mat"), conclusion: v("#sp-con"), recommend: v("#sp-rec") };
  await call(st.insp.id ? `/api/inspections/${st.insp.id}` : "/api/inspections", { json: body });
  toast("Перевірку збережено"); st.insp = null; S.render();
});
S.onNav.push((v) => { if (v !== "disc") { st.insp = null; } });
})();
