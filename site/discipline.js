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
// Справа службового розслідування / перевірки ВВБ — бланк за зразком реєстру ВВБ (PDF і PNG)
const spNo = (i) => i.regno || `СП-${String(i.id).padStart(4, "0")}`;
const SP_DEPTS = [["alpha", "ЦСО «А»"], ["atc", "АТЦ"], ["orv", "ОРВ"], ["deb", "ДЕБ"], ["vkpp", "ВКПП"], ["vvb", "ВВБ"], ["academy", "Молодший склад"]];
function spDoc(i, kinds) {
  const M = (S.cache.disc && S.cache.disc.insp) || { kinds: {}, status: {}, grifs: {} };
  const x = i.data || {}, t = i.target || {}, a = i.author || {}, bg = i.background || { active: 0, past: [] };
  const v = (s) => esc(s || "").replace(/\n/g, "<br>") || "—";
  const box = (on) => `[${on ? " + " : "   "}]`;
  const row = (k, val) => `<tr><td class="sr-k">${k}</td><td>${val}</td></tr>`;
  const head = (i.visas || []).find((z) => z.stage === "head"), res = i.resolution;
  const st = i.status;
  return `<div class="blank ns-blank sr-blank">
    <div class="sr-cap"><b>СЛУЖБА БЕЗПЕКИ ШТАТУ NG</b><b>ВІДДІЛ ВНУТРІШНЬОЇ БЕЗПЕКИ (ВВБ)</b><span>ЄІС «Сова» | Реєстр службових перевірок та розслідувань</span>
      <span>ГРИФ: ${esc((M.grifs[x.grif] || "Цілком таємно").toUpperCase())} / СЛУЖБОВА ТАЄМНИЦЯ</span></div>
    <div class="blank-title" style="font-size:20px">СПРАВА ${i.kind === "invest" ? "СЛУЖБОВОГО РОЗСЛІДУВАННЯ" : "СЛУЖБОВОЇ ПЕРЕВІРКИ"} № ${esc(spNo(i))}</div>
    <h4 class="sr-h">1. РЕЄСТРАЦІЙНІ ВІДОМОСТІ</h4><table class="sr-t">
      ${row("Дата та час відкриття провадження", x.opened ? esc(x.opened.replace("T", " ")) : fmtDT(i.created))}
      ${row("Ініціатор розслідування / Підстава", v(x.basis))}
      ${row("Слідчий / Інспектор ВВБ", `${esc(a.rankName || "")}, ВВБ, ${esc(a.name || "")}`)}
      ${row("Попередня правова кваліфікація", v(x.qual))}
      ${row("Поточний процесуальний статус", `${box(["open", "head"].includes(st))} У провадженні ${box(st === "paused")} Зупинено ${box(st === "sent")} Передано Голові СБУ ${box(st === "closed")} Завершено`)}
      ${row("Рівень доступу та секретності", esc(M.grifs[x.grif] || "Цілком таємно"))}</table>
    <h4 class="sr-h">2. ВІДОМОСТІ ПРО ФІГУРАНТА</h4><table class="sr-t">
      ${row("Прізвище, ім'я", esc(t.name || "№" + i.sid))}
      ${row("Структурний підрозділ СБУ", SP_DEPTS.map(([k, n]) => `${box(t.dept === k)} ${n}`).join(" "))}
      ${row("Спеціальне звання та посада", esc(t.rankName || ""))}
      ${row("Службовий жетон / Позивний", `№ ${i.sid}${x.callsign || t.callsign ? ` / Позивний: ${esc(x.callsign || t.callsign)}` : ""}`)}
      ${row("Дисциплінарний бекграунд", `Активні догани: ${bg.active}/3 · Попередні стягнення: ${bg.past.length ? esc(bg.past.join(", ")) : "немає"}`)}</table>
    <h4 class="sr-h">3. ОПИСОВА ЧАСТИНА (ФАБУЛА ТА ОБСТАВИНИ)</h4>
    <p style="text-indent:0"><b>Предмет:</b> ${esc(i.title || "")}</p>
    <p style="text-indent:0"><b>Дата, час та місце інциденту:</b> ${v([x.when, x.place].filter(Boolean).join(", "))}</p>
    <p style="text-indent:0"><b>Хронологія та суть правопорушення:</b><br>${v(x.fabula || i.materials)}</p>
    <h4 class="sr-h">4. МАТЕРІАЛИ СЛУЖБОВОГО РОЗСЛІДУВАННЯ</h4>
    ${(x.mats || []).length ? `<table class="sr-t sr-m"><tr><th>№</th><th>Джерело та тип доказу</th><th>Зміст фіксації</th><th>Статус / посилання</th></tr>
      ${x.mats.map((m, n) => `<tr><td>${n + 1}</td><td>${esc(m.type)}</td><td>${v(m.desc)}</td><td class="sr-ref">${esc(m.ref || "")}</td></tr>`).join("")}</table>` : '<p style="text-indent:0">—</p>'}
    <h4 class="sr-h">5. ПРАВОВА КВАЛІФІКАЦІЯ ТА НОРМАТИВНІ АКТИ</h4>
    <p style="text-indent:0"><b>Порушення Внутрішнього статуту СБУ / Класифікатора заборон:</b><br>${v(x.statute)}</p>
    <p style="text-indent:0"><b>Порушення спеціальних регламентів та інструкцій:</b><br>${v(x.regs)}</p>
    <p style="text-indent:0"><b>Кваліфікація за статтями Кримінального кодексу штату NG:</b><br>${v(x.crim)}</p>
    <p style="text-indent:0"><b>Обставини:</b> пом'якшуючі — ${v(x.mitig)}; обтяжуючі — ${v(x.aggr)}</p>
    <p style="text-indent:0"><b>Висновок ВВБ:</b> ${v(i.conclusion)}</p>
    <p style="text-indent:0"><b>Рекомендовані заходи:</b> ${i.recommend ? esc(kinds[i.recommend]) : "без стягнення"}${i.order_id ? ` · застосовано наказом ${no(i.order_id)}` : ""}</p>
    <h4 class="sr-h">6. ПІДПИСИ, РЕЗОЛЮЦІЯ КЕРІВНИЦТВА</h4>
    <table class="sr-t">
      ${row("Інспектор ВВБ, який проводив розслідування", `${esc(a.rankName || "")} <span class="kf-sign">${esc(a.name || "")}</span><br>Дата завершення: ${i.completed ? fmtDT(i.completed) : "—"}`)}
      ${row("Начальник Відділу внутрішньої безпеки СБУ", head ? `${esc(head.rankName || "")} <span class="kf-sign">${esc(head.name)}</span><br>Дата погодження: ${fmtDT(head.t)}` : "—")}
      ${row("Резолюція Голови Служби безпеки штату NG", `${box(res && res.decision === "approve")} ЗАТВЕРДИТИ ВИСНОВОК ТА ЗАСТОСУВАТИ ЗАХОДИ<br>${box(res && res.decision === "return")} ВІДХИЛИТИ / НАПРАВИТИ СПРАВУ НА ДООПРАЦЮВАННЯ ВВБ
        ${res ? `<br>Коментар: ${v(res.comment) === "—" ? "—" : v(res.comment)}<br>Підпис: <span class="kf-sign">${esc(res.name)}</span> · ${fmtDT(res.t)}` : ""}`)}
    </table>
    <div class="blank-stamp">ЄІС «СОВА»</div></div>`;
}
const spA4 = (i) => S.a4(spDoc(i, S.cache.disc.kinds), spNo(i), { noTo: true, date: fmtDT(i.updated), sub: "Відділ внутрішньої безпеки" });

function spMatRow(m, n) {
  const T = S.cache.disc.insp.mats;
  return `<div class="sp-mat" style="display:grid;grid-template-columns:200px 1fr 1fr auto;gap:8px;margin-bottom:6px">
    <select class="i" data-sm="type">${T.map((t) => `<option ${t === m.type ? "selected" : ""}>${esc(t)}</option>`).join("")}</select>
    <input class="i" data-sm="desc" placeholder="Зміст фіксації" value="${esc(m.desc || "")}" maxlength="500">
    <input class="i" data-sm="ref" placeholder="Посилання / статус (долучено, відмова…)" value="${esc(m.ref || "")}" maxlength="500">
    <button type="button" class="btn sm" data-a="spmatdel" data-n="${n}">✕</button></div>`;
}
function spRead() {
  const g = (id) => (S.$("#" + id) || {}).value || "";
  const i = st.insp, x = (i.data = i.data || {});
  Object.assign(i, { kind: g("sp-kind"), sid: g("sp-sid"), title: g("sp-title"), conclusion: g("sp-con"), recommend: g("sp-rec") });
  for (const k of ["grif", "opened", "basis", "qual", "callsign", "when", "place", "fabula", "statute", "regs", "crim", "mitig", "aggr"]) x[k] = g("sp-" + k);
  x.mats = [...document.querySelectorAll(".sp-mat")].map((r) => ({ type: r.querySelector("[data-sm=type]").value, desc: r.querySelector("[data-sm=desc]").value, ref: r.querySelector("[data-sm=ref]").value }));
  return i;
}


// аркуш А4 наказу про стягнення (PDF і картинка в картці Discord)
const nsA4 = (o) => S.a4(nsDoc(o), no(o.id), { noTo: true, date: fmtDT(o.issued), sub: "Наказ про дисциплінарне стягнення" });
async function nsImage(id) {
  try {
    const d = await call("/api/discipline");
    const o = [...(d.journal || []), ...(d.mine || [])].find((x) => x.id === id);
    return o ? await S.docImage("ns", id, nsA4(o)) : false;
  } catch (e) { console.warn(e); return false; }
}
S.docImageFns.ns = nsImage;

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
      <button class="btn sm" data-a="nspdf" data-id="${o.id}">⬇ PDF</button>${S.docImgBtn("ns", o.id, true)}
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
      <label class="f wide"><span>Порушення</span><select class="i" id="ns-v" data-ns>${d.violations.map((x) => `<option value="${x.id}" ${x.id === v.id ? "selected" : ""}>${esc(x.t)}${x.kinds.some((k) => d.rights.kinds.includes(k)) ? "" : " · лише вище керівництво"}</option>`).join("")}</select></label>
      <label class="f"><span>Вид стягнення</span><select class="i" id="ns-kind" data-ns>${kinds.length ? kinds.map((k) => `<option value="${k}" ${k === kind ? "selected" : ""}>${esc(d.kinds[k])}</option>`).join("") : '<option value="">немає повноважень</option>'}</select></label>
      ${kind === "fine" ? `<label class="f"><span>Сума штрафу, $</span><input class="i" id="ns-fine" type="number" min="0" step="1000" value="${f.fine ?? v.fine}" data-ns></label>` : ""}
      <label class="f wide"><span>Обставини порушення</span><textarea class="i" id="ns-reason" data-ns placeholder="Коли, де, що сталося; докази">${esc(f.reason || "")}</textarea></label>
      ${S.tagSelect('id="ns-tag" data-ns', f.tag || "")}
    </div>
    ${["demote", "dismiss", "blacklist"].includes(kind) ? '<p class="note warn">Бот одразу виконає наказ: змінить звання або зніме ролі СБУ в Discord і запише це в кадровий аудит.</p>' : ""}
    ${kinds.length ? "" : `<p class="note warn">За це порушення статут передбачає: ${v.kinds.map((k) => `<b>${esc((d.kinds[k] || "").toLowerCase())}</b>`).join(" або ")} — це поза вашими повноваженнями, такий наказ оголошує вище керівництво.${d.rights.vvb ? " Оформіть службову перевірку з рекомендованим стягненням і передайте її керівництву." : ""}</p>`}
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
  const R = d.rights, me = S.ME().me, M = d.insp;
  if (st.insp) {
    const i = st.insp, x = i.data || {};
    const ta = (id, label, rows) => `<label class="f wide"><span>${label}</span><textarea class="i" id="sp-${id}" ${rows ? `rows="${rows}"` : ""}>${esc(x[id] || "")}</textarea></label>`;
    const tx = (id, label, ph) => `<label class="f"><span>${label}</span><input class="i" id="sp-${id}" value="${esc(x[id] || "")}" placeholder="${ph || ""}"></label>`;
    const now = new Date(Date.now() - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 16);
    return `<form class="card" data-f="nsinsp" style="max-width:1000px"><header><h3>${i.id ? `Справа ${esc(spNo(i))}` : "Нова справа ВВБ"}</h3></header>
      <div class="form-grid">
        <h4 class="wide sr-h">1. Реєстраційні відомості</h4>
        <label class="f"><span>Вид</span><select class="i" id="sp-kind">${Object.entries(M.kinds).map(([k, n]) => `<option value="${k}" ${k === (i.kind || "invest") ? "selected" : ""}>${n}</option>`).join("")}</select></label>
        <label class="f"><span>Гриф</span><select class="i" id="sp-grif">${Object.entries(M.grifs).map(([k, n]) => `<option value="${k}" ${k === (x.grif || "top") ? "selected" : ""}>${n}</option>`).join("")}</select></label>
        <label class="f"><span>Дата та час відкриття провадження</span><input class="i" type="datetime-local" id="sp-opened" value="${esc(x.opened || now)}"></label>
        <label class="f wide"><span>Предмет (коротко)</span><input class="i" id="sp-title" maxlength="120" value="${esc(i.title || "")}" placeholder="напр. Неправомірне застосування сили під час допиту"></label>
        ${tx("basis", "Ініціатор / підстава", "Розпорядження заступника начальника ВВБ")}
        ${tx("qual", "Попередня правова кваліфікація", "напр. ч. 2 ст. 365 КК")}
        <h4 class="wide sr-h">2. Фігурант</h4>
        <label class="f"><span>Співробітник</span><select class="i" id="sp-sid"><option value="">— оберіть —</option>${staff.map((p) => `<option value="${p.sid}" ${String(p.sid) === String(i.sid) ? "selected" : ""}>${esc(p.name)} · ${esc(p.rankName)} · ${p.sid}</option>`).join("")}</select></label>
        ${tx("callsign", "Позивний (якщо не вказано в картці)")}
        <p class="note wide">Підрозділ, звання й дисциплінарний бекграунд (активні догани, попередні стягнення) бот підставить у справу сам.</p>
        <h4 class="wide sr-h">3. Фабула</h4>
        ${tx("when", "Дата й час інциденту", "06.11.2026 ~23:52")}${tx("place", "Місце", "ГУ СБУ")}
        ${ta("fabula", "Хронологія дій та суть правопорушення", 8)}
        <h4 class="wide sr-h">4. Матеріали</h4>
        <div class="f wide" id="sp-mats">${(x.mats && x.mats.length ? x.mats : [{ type: M.mats[0] }]).map(spMatRow).join("")}</div>
        <div class="wide"><button type="button" class="btn sm" data-a="spmatadd">+ Матеріал</button></div>
        <h4 class="wide sr-h">5. Правова кваліфікація</h4>
        ${ta("statute", "Порушення Внутрішнього статуту СБУ / Класифікатора заборон")}${ta("regs", "Порушення спеціальних регламентів та інструкцій")}
        ${ta("crim", "Кваліфікація за статтями Кримінального кодексу")}${ta("mitig", "Пом'якшуючі обставини")}${ta("aggr", "Обтяжуючі обставини")}
        <h4 class="wide sr-h">Висновок</h4>
        <label class="f wide"><span>Висновок ВВБ</span><textarea class="i" id="sp-con" rows="4">${esc(i.conclusion || "")}</textarea></label>
        <label class="f"><span>Рекомендоване стягнення</span><select class="i" id="sp-rec"><option value="">— без стягнення —</option>${Object.entries(d.kinds).map(([k, n]) => `<option value="${k}" ${k === i.recommend ? "selected" : ""}>${esc(n)}</option>`).join("")}</select></label>
      </div>
      <div class="acts"><button class="btn" type="button" data-a="nsinspback">Скасувати</button><button class="btn gold" type="submit">Зберегти</button></div></form>`;
  }
  const chip = { open: "wait", paused: "mute", head: "info", sent: "info", closed: "ok" };
  return `${R.vvb ? '<div class="bn-actions"><button class="btn gold" data-a="nsinspnew">+ Відкрити справу (розслідування / перевірка)</button></div>' : ""}
    ${d.inspections.length ? `<div class="docs">${d.inspections.map((i) => {
      const mine = i.author && i.author.sid === me.sid, st_ = i.status;
      const btn = (to, label, cls) => `<button class="btn sm ${cls || ""}" data-a="nsinspmove" data-id="${i.id}" data-to="${to}">${label}</button>`;
      return `<article class="doc st-${st_ === "closed" ? "ok" : ["sent", "head"].includes(st_) ? "info" : "wait"}">
      <div class="doc-no"><b>${esc(spNo(i))}</b><span>${fmtDT(i.updated)}</span></div>
      <div class="doc-main"><div class="doc-title">${esc((M.kinds[i.kind] || "Службова перевірка"))} · ${esc(i.title)}</div>
        <div class="doc-line"><span>Фігурант</span>${i.target ? esc(i.target.rankName + " " + i.target.name) : "№" + i.sid} · <span>Інспектор</span>${i.author ? esc(i.author.name) : "—"}</div>
        ${i.conclusion ? `<div class="doc-note"><b>Висновок:</b> ${esc(i.conclusion)}${i.recommend ? ` · рекомендовано: <b>${esc(d.kinds[i.recommend])}</b>` : ""}</div>` : ""}
        ${i.resolution && i.resolution.decision === "return" && st_ === "open" ? `<div class="doc-note"><b>Повернуто на доопрацювання:</b> ${esc(i.resolution.comment)}</div>` : ""}
        ${i.order_id ? `<div class="small muted">Застосовано наказом ${no(i.order_id)}</div>` : ""}</div>
      <div class="doc-side"><span class="chip ${chip[st_] || ""}">${esc(M.status[st_] || st_)}</span>
        <button class="btn sm" data-a="sppdf" data-id="${i.id}">⬇ PDF</button><button class="btn sm" data-a="sppng" data-id="${i.id}">⬇ PNG</button>
        ${["open", "paused"].includes(st_) && R.vvb ? `<button class="btn sm" data-a="nsinspedit" data-id="${i.id}">Редагувати</button>` : ""}
        ${st_ === "open" && R.vvb ? btn("paused", "⏸ Зупинити") + btn(R.vvbHead || R.chief ? "sent" : "head", R.vvbHead || R.chief ? "Направити Голові" : "На погодження начальнику ВВБ", "gold") : ""}
        ${st_ === "paused" && R.vvb ? btn("open", "▶ Відновити") : ""}
        ${st_ === "head" && (R.vvbHead && !mine || R.chief) ? btn("sent", "Погодити й направити Голові", "ok") + btn("return", "↩ На доопрацювання") : ""}
        ${st_ === "sent" && R.chief ? btn("closed", "Затвердити висновок", "ok") + btn("return", "↩ На доопрацювання ВВБ") : ""}
        ${["sent", "closed"].includes(st_) && R.chief && !i.order_id && i.recommend ? `<button class="btn sm gold" data-a="nsinspord" data-id="${i.id}">Застосувати заходи (наказ)</button>` : ""}
        ${(mine && ["open", "paused"].includes(st_)) || R.chief ? btn("deleted", "🗑", "bad") : ""}</div>
    </article>`; }).join("")}</div>` : '<div class="empty">Службових перевірок і розслідувань немає.</div>'}`;
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
  fine: S.$("#ns-fine") ? +S.$("#ns-fine").value : undefined, reason: S.$("#ns-reason")?.value, inspection: (st.form || {}).inspection, tag: S.$("#ns-tag")?.value || "" });
S.views.disc = view;
Object.assign(S.actions, {
  nspdf: (b) => { const o = ALL[b.dataset.id]; if (o) S.pdfA4(b, nsA4(o), `${no(o.id)}_${o.kindName}`); },
  sppdf: (b) => { const i = (S.cache.disc.inspections || []).find((x) => String(x.id) === b.dataset.id); if (i) S.pdfA4(b, spA4(i), `${spNo(i)}_${i.title || ""}`); },
  sppng: (b) => { const i = (S.cache.disc.inspections || []).find((x) => String(x.id) === b.dataset.id); if (i) S.pngBtn(b, spDoc(i, S.cache.disc.kinds), `${spNo(i)}_${i.title || ""}`); },
  spmatadd: () => { spRead(); st.insp.data.mats.push({ type: S.cache.disc.insp.mats[0], desc: "", ref: "" }); S.render(); },
  spmatdel: (b) => { spRead(); st.insp.data.mats.splice(+b.dataset.n, 1); S.render(); },
  nstab: (b) => { st.tab = b.dataset.v; st.insp = null; S.render(); },
  nsf: (b) => { st.f = b.dataset.v; S.render(); },
  nsappeal: (b) => run(b, async () => {
    const text = prompt("Скарга Голові СБУ (п. 4.1): чому стягнення незаконне чи необґрунтоване?", "");
    if (text === null) return;
    await call(`/api/discipline/${b.dataset.id}/appeal`, { json: { text } }); toast("Скаргу подано Голові СБУ"); await nsImage(+b.dataset.id); S.render();
  }),
  nsdec: (b) => run(b, async () => {
    const x = b.dataset.x, q = { cancel: "Задовольнити скаргу й скасувати стягнення?", uphold: "Відхилити скаргу?", lift: "Зняти догану достроково?" }[x];
    const note = prompt(q + "\nКоментар (необов'язково):", "");
    if (note === null) return;
    await call(`/api/discipline/${b.dataset.id}/decide`, { json: { action: x, note } }); toast("Рішення внесено"); await nsImage(+b.dataset.id); await S.refreshMe(); S.render();
  }),
  nsdel: (b) => run(b, async () => {
    if (!confirm("Скасувати й видалити наказ? Пониження чи звільнення бот назад не поверне — це робиться окремо.")) return;
    await call(`/api/discipline/${b.dataset.id}/delete`, { json: {} }); toast("Наказ видалено"); await S.refreshMe(); S.render();
  }),
  nsinspnew: () => { st.insp = { kind: "invest", data: { mats: [] } }; S.render(); },
  nsinspback: () => { st.insp = null; S.render(); },
  nsinspedit: (b) => { st.insp = JSON.parse(JSON.stringify(S.cache.disc.inspections.find((i) => i.id === +b.dataset.id))); S.render(); },
  nsinspmove: (b) => run(b, async () => {
    const to = b.dataset.to;
    const ask = { sent: "Направити справу Голові СБУ?", head: "Направити справу на погодження начальнику ВВБ?", closed: "Затвердити висновок?",
      paused: "Зупинити провадження?", open: "Відновити провадження?", deleted: "Видалити справу?", return: "" }[to];
    let note = "";
    if (to === "return") { note = prompt("Що доопрацювати (побачить ВВБ):", ""); if (!note) return; }
    else if (to === "closed") { note = prompt("Затвердити висновок.\nКоментар Голови (необов'язково), напр. «Не заперечую»:", "Не заперечую"); if (note === null) return; }
    else if (!confirm(ask)) return;
    await call(`/api/inspections/${b.dataset.id}/move`, { json: { to, note } }); toast("Готово"); await S.refreshMe(); S.render();
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
  const r = await call("/api/discipline", { json: b });
  toast("Наказ оголошено");
  await nsImage(r.id); st.form = null; st.tab = "journal"; await S.refreshMe(); S.render();
});
S.forms.nsinsp = async (f) => run(f.querySelector("button[type=submit]"), async () => {
  const i = spRead();
  const body = { kind: i.kind, sid: i.sid, title: i.title, conclusion: i.conclusion, recommend: i.recommend, files: i.files || [], ...i.data };
  await call(i.id ? `/api/inspections/${i.id}` : "/api/inspections", { json: body });
  toast("Справу збережено"); st.insp = null; S.render();
});
S.onNav.push((v) => { if (v !== "disc") { st.insp = null; } });
// адреса: #/disc/вкладка · #/disc/insp/5 (службова перевірка) · #/disc/insp/new
S.routes.disc = {
  get: () => [st.tab, st.insp ? (st.insp.id || "new") : null],
  set: (p) => {
    st.tab = p[0] || null;
    st.insp = p[1] === "new" ? {} : p[1] ? (((S.cache.disc || {}).inspections) || []).find((i) => String(i.id) === p[1]) || null : null;
  },
};
})();
