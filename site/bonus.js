/* Премії: мій розрахунок, щотижнева відомість преміювання (п. 1.55 правил держорганізацій), ліміти. Підключається після app.js (window.SOVA). */
(() => {
const S = window.SOVA;
const { esc, call, toast, fmtDT } = S;
const st = { tab: null, id: null };
const $$ = (n) => "$" + Number(n || 0).toLocaleString("uk-UA").replace(/ /g, " ");
const TIERS = { lead: "Керівний склад", senior: "Старший склад", junior: "Молодший склад" };
const STATUS = { draft: ["Формується", "wait"], sent: ["Подано куратору", "info"], approved: ["Схвалено куратором", "ok"], paid: ["Виплачено", "ok"] };
const RSHORT = ["Стажер", "Мол. агент", "Агент", "Ст. агент", "Мол. опер", "Опер", "Ст. опер", "Інструктор", "Кер. групи", "Кер. сектору", "Заст. нач.", "Нач. відділу", "Нач. управл.", "Заст. Голови", "Голова"];
const chip = (s) => `<span class="chip ${STATUS[s][1]}">${STATUS[s][0]}</span>`;

function mineView(m) {
  const e = m.estimate, pct = Math.min(1, e.min ? e.pts / e.min : 1);
  return `<div class="bn-est">
    <div class="bn-est-main"><div class="eyebrow">Орієнтовна премія за поточний тиждень</div><div class="bn-sum">${$$(e.amount)}</div>
      <div class="muted small">${e.pts} балів × ${$$(e.rate)} за бал · ліміт категорії «${esc(e.tier)}»: ${$$(e.cap)}</div></div>
    <div class="bn-est-side"><span>Поріг для премії</span><b>${e.pts} / ${e.min} балів</b><div class="bar ${pct >= 1 ? "ok" : ""}"><i style="width:${pct * 100}%"></i></div>
      <small>${pct >= 1 ? "Поріг виконано" : `Ще ${e.min - e.pts} балів до порогу`}. Остаточну суму затверджує керівництво й куратор.</small></div>
  </div>
  <h3 class="bn-h">Мої нарахування</h3>
  ${m.history.length ? `<div class="bn-slips">${m.history.map((h) => `<div class="bn-slip st-${h.status}">
      <div class="bn-slip-t">Розрахунковий лист · тиждень ${esc(h.label)}</div><div class="bn-slip-s">${$$(h.amount)}</div>
      <div class="bn-slip-m"><span>${h.pts} балів</span>${chip(h.status)}</div>${h.note ? `<div class="muted small">${esc(h.note)}</div>` : ""}
      ${h.status === "paid" ? '<div class="bn-paid">ВИПЛАЧЕНО</div>' : ""}</div>`).join("")}</div>` : '<div class="empty">Нарахувань ще немає.</div>'}`;
}

function listView(d) {
  const r = S.ME().bonus;
  const n = d.now, c = d.cfg;
  const hint = n ? `<div class="note ${n.reached ? "" : "warn"}" style="margin-bottom:12px"><b>Поточний тиждень:</b> звіти мають ${n.active} співробітників,
    поріг ${c.min_pts} б. набрали <b>${n.reached}</b> (найбільше — ${n.best} б.), разом до виплати ≈ <b>${$$(n.total)}</b>.
    ${n.reached ? "" : ` Премія нараховується лише тим, хто набрав за тиждень щонайменше ${c.min_pts} балів, тому зараз суми нульові. Поріг змінює Голова у вкладці «Ліміти».`}
    ${n.wait ? ` Ще ${n.wait} звітів чекають перевірки — бали з них зарахуються лише після підтвердження.` : ""}</div>` : "";
  return hint + `<div class="bn-actions"><button class="btn gold" data-a="bnnew" data-o="1">Сформувати за минулий тиждень</button><button class="btn" data-a="bnnew" data-o="0">За поточний тиждень</button></div>
    ${d.list.length ? `<div class="docs">${d.list.map((s) => `<article class="doc st-${s.status === "paid" ? "ok" : s.status === "draft" ? "wait" : "info"}" data-a="bnopen" data-id="${s.id}" style="cursor:pointer">
      <div class="doc-no"><b>ВП-${String(s.id).padStart(4, "0")}</b><span>${fmtDT(s.updated)}</span></div>
      <div class="doc-main"><div class="doc-title">Відомість преміювання · тиждень ${esc(s.label)}</div><div class="doc-line">Премійовано: ${s.count} осіб</div></div>
      <div class="doc-side"><b class="bn-total">${$$(s.total)}</b>${chip(s.status)}</div></article>`).join("")}</div>` : '<div class="empty">Відомостей ще немає. Сформуйте першу — суми розрахуються з балів автоматично.</div>'}`;
}

function cfgView(c) {
  const fin = S.ME().bonus.finalize, dis = fin ? "" : "disabled";
  return `<form class="card" data-f="bncfg" style="max-width:720px"><header><h3>Ліміти й ставки преміювання</h3></header>
    <p class="note">Ліміти на організацію та на одного співробітника затверджує Головний куратор державних структур, а вводяться вони Указом Прем'єр-міністра (п. 1.55). Внесіть сюди затверджені значення.${fin ? "" : " Змінювати може лише Голова СБУ."}</p>
    <div class="form-grid">
      <label class="f"><span>Ставка, $ за 1 бал</span><input class="i" id="bc-rate" type="number" min="0" value="${c.rate}" ${dis}></label>
      <label class="f"><span>Поріг: мінімум балів за тиждень</span><input class="i" id="bc-min" type="number" min="0" value="${c.min_pts}" ${dis}></label>
      <label class="f wide"><span>Ліміт на організацію за тиждень, $</span><input class="i" id="bc-limit" type="number" min="0" value="${c.limit}" ${dis}></label>
      ${Object.entries(TIERS).map(([k, l]) => `<label class="f"><span>Максимум: ${l.toLowerCase()} ($)</span><input class="i" id="bc-${k}" type="number" min="0" value="${c.caps[k]}" ${dis}></label>`).join("")}
    </div>
    <p class="muted small">Керівний склад — звання 11–15, старший — 8–10, молодший — 1–7.</p>
    ${fin ? '<div><button class="btn gold" type="submit">Зберегти ліміти</button></div>' : ""}</form>`;
}

function docView(s) {
  const me = S.ME().me.sid, edit = s.status === "draft", c = s.cfg, D = S.META().depts, r = S.ME().bonus;
  const pct = c.limit ? Math.min(1.2, s.total / c.limit) : 0;
  const groups = Object.keys(D).map((k) => [k, s.rows.filter((x) => x.dept === k)]).filter(([, rows]) => rows.length);
  let n = 0;
  const bar = `<div class="kd-bar"><button class="btn" data-a="bnback">← До відомостей</button><span class="sp"></span>
    ${edit ? '<button class="btn" data-a="bnrecalc">↻ Перерахувати з балів</button><button class="btn" data-a="bnsave">Зберегти зміни</button><button class="btn gold" data-a="bnmove" data-to="sent">Подати куратору</button><button class="btn bad" data-a="bndelete">🗑 Видалити</button>' : ""}
    ${s.status === "sent" ? '<button class="btn" data-a="bnmove" data-to="draft">Повернути на доопрацювання</button>' + (r.finalize ? '<button class="btn ok" data-a="bnmove" data-to="approved">Схвалено куратором</button>' : "") : ""}
    ${s.status === "approved" && r.finalize ? '<button class="btn gold" data-a="bnmove" data-to="paid">Позначити виплаченим</button>' : ""}
    <button class="btn" data-a="bncopy">⧉ Звіт для куратора</button><button class="btn gold" data-a="bnpdf">⬇ PDF</button></div>`;
  return bar + `<div class="kd-wrap"><div class="kd bn-doc">
    <div class="kd-grif g-dsk">ДЛЯ СЛУЖБОВОГО КОРИСТУВАННЯ</div>
    <header class="kd-head"><img src="sbu-logo.webp" alt="" width="84" height="84">
      <div><div class="kd-agency">Служба безпеки штату NG</div><div class="kd-dept">Фінансово-кадрове забезпечення</div></div>
      <div class="kd-no"><span>Відомість</span><b>№ ВП-${String(s.id).padStart(4, "0")}</b><span>${fmtDT(s.created)}</span></div></header>
    <div class="kd-title"><span>Щотижнева відомість</span><h2>ПРЕМІЮВАННЯ ОСОБОВОГО СКЛАДУ</h2><div>за тиждень <b>${esc(s.label)}</b></div></div>
    <dl class="kd-meta"><dt>Ставка</dt><dd>${$$(c.rate)} за бал, поріг ${c.min_pts} б.</dd><dt>Стан</dt><dd>${STATUS[s.status][0]}</dd>
      <dt>Ліміти</dt><dd>кер. ${$$(c.caps.lead)} · ст. ${$$(c.caps.senior)} · мол. ${$$(c.caps.junior)}</dd><dt>Ліміт СБУ</dt><dd>${$$(c.limit)}</dd></dl>
    <div class="bn-gauge ${pct > 1 ? "over" : ""}"><div><span>Використано ліміту організації</span><b>${$$(s.total)} з ${$$(c.limit)}</b></div><i><b style="width:${Math.min(100, pct * 100)}%"></b></i></div>
    <table class="bn-t"><thead><tr><th>№</th><th>Співробітник</th><th>Звання</th><th>Бали</th><th>Розрахунок</th><th>До виплати</th><th>Примітка</th></tr></thead>
    ${groups.map(([k, rows]) => `<tbody><tr class="bn-dept"><td colspan="7">${esc(D[k].n)}<span>${$$(rows.reduce((a, x) => a + x.amount, 0))}</span></td></tr>
      ${rows.map((x) => { n++; const own = x.sid === me; return `<tr class="${x.amount ? "" : "zero"}" data-sid="${x.sid}">
        <td>${n}</td><td><b>${esc(x.name)}</b><div class="mono small">${x.sid}</div></td><td>${RSHORT[x.rank - 1] || ""}<div class="small">${TIERS[x.tier]}</div></td>
        <td class="num">${x.pts}</td><td class="num">${$$(x.auto)}</td>
        <td>${edit && !own ? `<input class="bn-in" type="number" min="0" step="100" data-k="amount" value="${x.amount}">` : `<b>${$$(x.amount)}</b>${edit && own ? '<div class="small">свій рядок не змінюється</div>' : ""}`}</td>
        <td>${edit ? `<input class="bn-in note" data-k="note" maxlength="120" value="${esc(x.note)}">` : esc(x.note)}</td></tr>`; }).join("")}</tbody>`).join("")}
    <tfoot><tr><td colspan="5">РАЗОМ ДО ВИПЛАТИ</td><td colspan="2"><b>${$$(s.total)}</b></td></tr></tfoot></table>
    <div class="bn-signs">
      ${[["sent", "Подав куратору"], ["approved", "Схвалення куратора"], ["paid", "Виплату здійснив"]].map(([a, t]) => {
        const h = [...s.history].reverse().find((x) => x.action === a);
        return `<div class="kf-visa ${h ? "ok" : ""}"><div class="kf-visa-t">${t}</div>${h ? `<div class="kf-visa-s">${{ sent: "ПОДАНО", approved: "СХВАЛЕНО", paid: "ВИПЛАЧЕНО" }[a]}</div><div class="kf-sign">${esc(h.name)}</div><div class="kf-visa-d">${fmtDT(h.t)}</div>` : '<div class="kf-visa-e">очікує</div>'}</div>`;
      }).join("")}
    </div>
    <footer class="kd-foot">П. 1.55 Загальних правил державних організацій · ст. 22 Трудового кодексу штату NG · ЄІС «Сова»</footer>
  </div></div>`;
}

async function view() {
  const r = S.ME().bonus || {};
  if (st.id && r.manage) { const s = await call(`/api/bonus/${st.id}`); S.cache.bonus = s; return docView(s); }
  const d = await call("/api/bonus");
  const t = st.tab || (r.manage ? "list" : "mine");
  const tabs = [["mine", "Мої премії"], ...(r.manage ? [["list", "Відомості"], ["cfg", "Ліміти"]] : [])];
  const head = tabs.length > 1 ? `<div class="tabs">${tabs.map(([v, l]) => `<button class="tb ${t === v ? "on" : ""}" data-a="bntab" data-v="${v}">${l}</button>`).join("")}</div>` : "";
  return head + (t === "list" ? listView(d) : t === "cfg" ? cfgView(d.cfg) : mineView(d.mine));
}

const busy = async (b, fn) => { b.disabled = true; try { await fn(); } catch (e) { toast(e.message, 1); } b.disabled = false; };
S.views.bonus = view;
Object.assign(S.actions, {
  bntab: (b) => { st.tab = b.dataset.v; S.render(); },
  bnopen: (b) => { st.id = +b.dataset.id; S.render(); scrollTo(0, 0); },
  bnback: () => { st.id = null; st.tab = "list"; S.render(); },
  bnnew: (b) => busy(b, async () => { const s = await call("/api/bonus", { json: { offset: +b.dataset.o } }); st.id = s.id; S.render(); }),
  bndelete: (b) => busy(b, async () => {
    if (!confirm("Видалити відомість, що формується? Її можна буде сформувати заново.")) return;
    await call(`/api/bonus/${st.id}/delete`, { json: {} }); toast("Відомість видалено"); st.id = null; st.tab = "list"; S.render();
  }),
  bnrecalc: (b) => busy(b, async () => { if (!confirm("Перерахувати всі суми з балів? Ручні зміни буде скинуто.")) return; await call(`/api/bonus/${st.id}/recalc`, { json: {} }); toast("Перераховано"); S.render(); }),
  bnsave: (b) => busy(b, async () => { await save(); toast("Зміни збережено"); S.render(); }),
  bnmove: (b) => busy(b, async () => {
    const to = b.dataset.to;
    const q = { sent: "Подати відомість куратору? Редагування закриється.", draft: "Повернути відомість на доопрацювання?", approved: "Позначити, що куратор схвалив звіт?", paid: "Позначити премії виплаченими?" }[to];
    if (!confirm(q)) return;
    if (to === "sent") await save();
    await call(`/api/bonus/${st.id}/status`, { json: { to } });
    toast("Статус відомості змінено");
    S.render();
  }),
  bnpdf: (b) => busy(b, async () => {
    // Знімок поточного бланка: поля вводу замінюються значеннями; чернетку позначаємо водяним знаком «ПРОЄКТ»
    const doc = document.querySelector(".bn-doc").cloneNode(true);
    doc.querySelectorAll("input.bn-in").forEach((i) => { const sp = document.createElement("b"); sp.textContent = i.dataset.k === "amount" ? $$(i.value) : i.value; i.replaceWith(sp); });
    doc.querySelectorAll(".small").forEach((x) => { if (x.textContent.includes("свій рядок")) x.remove(); });
    const s = S.cache.bonus;
    if (s.status === "draft") doc.insertAdjacentHTML("afterbegin", '<div class="bn-wm">ПРОЄКТ</div>');
    const t = b.textContent;
    b.innerHTML = '<span class="spin"></span> Формую PDF…';
    try { await S.pdf(doc.outerHTML, `ВП-${String(s.id).padStart(4, "0")}_${s.label.replace(/[^\p{L}\p{N}]+/gu, "_")}.pdf`, ["tr", ".bn-gauge"]); }
    finally { b.textContent = t; }
  }),
  bncopy: async () => {
    try { await navigator.clipboard.writeText(S.cache.bonus.report); toast("Звіт для куратора скопійовано"); }
    catch (e) { prompt("Скопіюйте звіт:", S.cache.bonus.report); }
  },
});
async function save() {
  const rows = {};
  document.querySelectorAll(".bn-t tr[data-sid]").forEach((tr) => {
    const a = tr.querySelector("[data-k=amount]"), n = tr.querySelector("[data-k=note]");
    if (a || n) rows[tr.dataset.sid] = { ...(a ? { amount: +a.value || 0 } : {}), ...(n ? { note: n.value } : {}) };
  });
  await call(`/api/bonus/${st.id}`, { json: { rows } });
}
S.forms.bncfg = async (f) => {
  const v = (id) => +document.getElementById(id).value || 0;
  try {
    await call("/api/bonus/cfg", { json: { rate: v("bc-rate"), min_pts: v("bc-min"), limit: v("bc-limit"), caps: { lead: v("bc-lead"), senior: v("bc-senior"), junior: v("bc-junior") } } });
    toast("Ліміти збережено");
  } catch (e) { toast(e.message, 1); }
};
S.onNav.push((v) => { if (v !== "bonus") st.id = null; });
})();
