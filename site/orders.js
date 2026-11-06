/* Накази про призначення на посаду (Голова СБУ): форма з живим бланком і реєстр наказів. Вкладка «Призначення» в «Особовому складі». */
(() => {
const S = window.SOVA;
const { esc, call, toast, fmtDT } = S;
const st = { f: {} };
const no = (id) => `НП-${String(id).padStart(4, "0")}`;
const OPS = () => S.META().opsDepts;

function deptFor(f, p) {
  const r = +f.rank || (p && p.rank) || 0;
  if (r >= 13) return "lead";
  if (r && r <= 4 && !OPS().includes(f.dept)) return "academy";
  return f.dept || (p && OPS().includes(p.dept) ? p.dept : OPS()[0]);
}

function blank(staff) {
  const f = st.f, me = S.ME().me, D = S.META().depts, R = S.META().ranks;
  const p = staff.find((x) => String(x.sid) === String(f.sid));
  const r = +f.rank || 0, d = deptFor(f, p);
  return `<div class="blank ns-blank" id="ap-blank">
    <div class="blank-to">СЛУЖБА БЕЗПЕКИ ШТАТУ NG</div>
    <div class="blank-title">Н А К А З</div>
    <div style="text-align:center;margin:-8px 0 18px">№ НП-нов. · ${new Date().toLocaleDateString("uk-UA")} · Про призначення на посаду</div>
    <p>${f.reason ? `${esc(f.reason)}. ` : ""}Керуючись Внутрішнім статутом Служби безпеки штату NG (р. V, п. 5.2),</p>
    <p style="text-indent:0"><b>НАКАЗУЮ:</b> ${p ? `${esc(p.rankName.toLowerCase())} ${esc(p.name)}, жетон №${p.sid},` : "________________,"}
      призначити на посаду <b>${r ? esc(R[r - 1].n.toLowerCase()) : "________"}</b>${d && D[d] && d !== "lead" ? ` (${esc(D[d].n)}${r === 12 && f.extra && f.extra !== d ? `, ${esc(D[f.extra].n)}` : ""})` : ""}.</p>
    <p style="text-indent:0">Відділу кадрів та підготовки персоналу внести зміни до особової справи.</p>
    <div class="blank-sign"><span>Голова Служби безпеки штату NG</span><span>${S.ME().appoint.sign ? `<span class="kf-sign">${esc(me.name)}</span>` : "__________ (підпис)"}</span></div>
    ${S.ME().appoint.sign ? "" : `<div class="small" style="margin-top:8px">Проєкт підготував: ${esc(me.rankName)} ${esc(me.name)} (ВКПП)</div>`}
    <div class="blank-stamp">ЄІС «СОВА»</div>
  </div>`;
}

// бланк наказу з реєстру (для PDF)
function apDoc(o) {
  const D = S.META().depts;
  const signed = o.status === "active";
  return `<div class="blank ns-blank">
    <div class="blank-to">СЛУЖБА БЕЗПЕКИ ШТАТУ NG</div>
    <div class="blank-title">Н А К А З</div>
    <div style="text-align:center;margin:-8px 0 18px">№ ${no(o.id)} · ${fmtDT(o.signed || o.t)} · Про призначення на посаду</div>
    <p>${o.reason ? `${esc(o.reason)}. ` : ""}Керуючись Внутрішнім статутом Служби безпеки штату NG (р. V, п. 5.2),</p>
    <p style="text-indent:0"><b>НАКАЗУЮ:</b> ${esc((o.fromRank || "").toLowerCase())} ${esc(o.name)}, жетон №${o.sid},
      призначити на посаду <b>${esc((o.toRank || "").toLowerCase())}</b>${D[o.to_dept] && o.to_dept !== "lead" ? ` (${esc(D[o.to_dept].n)}${o.extra && D[o.extra] ? `, ${esc(D[o.extra].n)}` : ""})` : ""}.</p>
    <p style="text-indent:0">Відділу кадрів та підготовки персоналу внести зміни до особової справи.</p>
    <div class="blank-sign"><span>Голова Служби безпеки штату NG</span><span>${signed && o.signedName ? `<span class="kf-sign">${esc(o.signedName)}</span>` : "__________ (підпис)"}</span></div>
    <div class="small" style="margin-top:8px">Проєкт підготував: ${esc(o.byName || "")}${o.status === "rejected" ? ` · ВІДХИЛЕНО${o.note ? ": " + esc(o.note) : ""}` : o.status === "draft" ? " · ПРОЄКТ, не підписано" : ""}</div>
    <div class="blank-stamp">ЄІС «СОВА»</div>
  </div>`;
}

// аркуш А4 наказу про призначення (PDF і картинка в Discord)
const apA4 = (o) => S.a4(apDoc(o), no(o.id), { noTo: true, date: fmtDT(o.signed || o.t), sub: "Наказ про призначення на посаду" });
// після створення чи підпису — свіжий бланк картинкою в картку наказу в Discord
async function apImage(id) {
  const list = await call("/api/orders").catch(() => []);
  const o = list.find((x) => x.id === id);
  return o ? S.docImage("np", id, apA4(o)) : false;
}
S.docImageFns.np = apImage;

async function view(head) {
  const [staff, list] = await Promise.all([call("/api/structure"), call("/api/orders"), S.loadTags()]);
  S.cache.apStaff = staff;
  S.cache.apList = Object.fromEntries(list.map((o) => [o.id, o]));
  const f = st.f, D = S.META().depts, R = S.META().ranks, me = S.ME().me;
  const p = staff.find((x) => String(x.sid) === String(f.sid));
  const r = +f.rank || 0, d = deptFor(f, p), sign = S.ME().appoint.sign;
  list.sort((a, b) => (a.status === "draft" ? 0 : 1) - (b.status === "draft" ? 0 : 1));
  return head + `<div class="grid2 rap-wrap"><form class="card" data-f="apsave">
      <header><h3>Наказ про призначення на посаду</h3></header>
      <p class="note">Проєкти наказів готує ВКПП, підписують Голова СБУ або Заступник Голови. Після підпису бот одразу змінить ролі звання й відділу в Discord, нікнейм і запише це в кадровий аудит.</p>
      <div class="form-grid">
        <label class="f wide"><span>Співробітник</span><select class="i" data-ap="sid"><option value="">— оберіть —</option>${staff.filter((x) => x.sid !== me.sid && x.dept !== "prosecutor")
          .map((x) => `<option value="${x.sid}" ${String(x.sid) === String(f.sid) ? "selected" : ""}>${esc(x.name)} · ${esc(x.rankName)} · ${esc((D[x.dept] || {}).s || "")} · ${x.sid}</option>`).join("")}</select></label>
        <label class="f"><span>Нове звання</span><select class="i" data-ap="rank"><option value="">—</option>${R.slice(0, 14).map((x, i) => `<option value="${i + 1}" ${r === i + 1 ? "selected" : ""}>${i + 1}. ${esc(x.n)}</option>`).join("")}</select></label>
        <label class="f"><span>Підрозділ</span>${r >= 13 ? '<input class="i" value="Керівництво СБУ" disabled>'
          : `<select class="i" data-ap="dept">${r && r <= 4 ? `<option value="academy" ${d === "academy" ? "selected" : ""}>Академія СБУ</option>` : ""}${OPS().map((k) => `<option value="${k}" ${d === k ? "selected" : ""}>${esc(D[k].n)}</option>`).join("")}</select>`}</label>
        ${r === 12 ? `<label class="f wide"><span>Другий відділ (якщо начальник веде два, напр. ОРВ + ДЕБ)</span><select class="i" data-ap="extra"><option value="">— немає —</option>${OPS().filter((k) => k !== d).map((k) => `<option value="${k}" ${f.extra === k ? "selected" : ""}>${esc(D[k].n)}</option>`).join("")}</select></label>` : ""}
        <label class="f wide"><span>Підстава (необов'язково)</span><input class="i" data-ap="reason" maxlength="800" value="${esc(f.reason || "")}" placeholder="напр. за зразкове виконання службових обов'язків"></label>
        ${S.tagSelect('data-ap="tag"', f.tag || "")}
      </div>
      ${p && r && r < p.rank ? '<p class="note warn">Нове звання нижче за поточне. Для пониження як стягнення краще використати «Дисципліну».</p>' : ""}
      <div class="acts">${S.ME().appoint.sign ? '<button class="btn" type="submit" data-sign="0">Зберегти як проєкт</button><button class="btn gold" type="submit" data-sign="1">Підписати наказ</button>'
        : '<button class="btn gold" type="submit" data-sign="0">Подати проєкт на підпис</button>'}</div></form>
    ${blank(staff)}</div>
    <div class="card" style="margin-top:16px"><header><h3>Реєстр наказів про призначення</h3></header>
      ${list.length ? `<div class="docs">${list.map((o) => `<article class="doc st-${{ draft: "wait", active: "ok", rejected: "rej" }[o.status]}">
        <div class="doc-no"><b>${no(o.id)}</b><span>${fmtDT(o.t)}</span></div>
        <div class="doc-main"><div class="doc-title">${esc(o.name)}</div>
          <div class="doc-line">${esc(o.fromRank)} · ${esc((D[o.from_dept] || {}).s || "")} → <b>${esc(o.toRank)}</b> · ${esc((D[o.to_dept] || {}).s || "")}${o.extra ? ` + ${esc(D[o.extra].s)}` : ""}</div>
          ${o.reason ? `<div class="doc-note">${esc(o.reason)}</div>` : ""}
          ${o.status === "rejected" && o.note ? `<div class="doc-note"><b>Відхилено:</b> ${esc(o.note)}</div>` : ""}
          <div class="small muted">Проєкт: ${esc(o.byName)}${o.signedName ? ` · ${o.status === "rejected" ? "відхилив" : "підписав"} ${esc(o.signedName)}` : ""}</div></div>
        <div class="doc-side"><span class="doc-stamp">${{ draft: "На підписі", active: "Чинний", rejected: "Відхилено" }[o.status]}</span>
          <button class="btn sm" data-a="appdf" data-id="${o.id}">⬇ PDF</button>${S.docImgBtn("np", o.id, true)}
          ${o.status === "draft" && sign ? `<button class="btn sm ok" data-a="apsign" data-id="${o.id}">Підписати</button><button class="btn sm" data-a="apreject" data-id="${o.id}">Відхилити</button>` : ""}
          ${o.status === "active" && sign ? `<button class="btn sm bad" data-a="apcancel" data-id="${o.id}">↩ Скасувати наказ</button>` : ""}
          ${o.status !== "active" && (sign || o.by_sid === me.sid) ? `<button class="btn sm" data-a="apdel" data-id="${o.id}">🗑</button>` : ""}</div>
      </article>`).join("")}</div>` : '<div class="empty">Наказів ще немає.</div>'}</div>`;
}

S.appointView = view;
const read = () => { document.querySelectorAll("[data-ap]").forEach((el) => { st.f[el.dataset.ap] = el.value; }); };
document.addEventListener("change", (e) => { if (e.target.dataset && e.target.dataset.ap && e.target.tagName === "SELECT") { read(); S.render(); } });
document.addEventListener("input", (e) => {
  if (!e.target.dataset || e.target.dataset.ap !== "reason") return;
  read();
  const b = document.getElementById("ap-blank");
  if (b) b.outerHTML = blank(S.cache.apStaff || []);
});
S.forms.apsave = async (form, ev) => {
  read();
  const btn = (ev && ev.submitter) || form.querySelector("button[type=submit]");
  const signNow = btn.dataset.sign === "1";
  if (!st.f.sid || !st.f.rank) return toast("Оберіть співробітника й нове звання.", 1);
  if (!confirm(signNow ? "Підписати наказ? Бот одразу змінить звання й ролі в Discord." : "Подати проєкт наказу на підпис?")) return;
  btn.disabled = true;
  try {
    const p = (S.cache.apStaff || []).find((x) => String(x.sid) === String(st.f.sid));
    const r = await call("/api/orders", { json: { sid: st.f.sid, rank: st.f.rank, dept: deptFor(st.f, p), extra: st.f.extra || null, reason: st.f.reason || "", sign: signNow, tag: st.f.tag || "" } });
    if (r.rolesWarning) alert(r.rolesWarning); else toast(signNow ? "Наказ підписано. Ролі в Discord перевірено — збігаються з наказом" : "Проєкт наказу подано на підпис");
    await apImage(r.id);
    st.f = {};
    await S.refreshMe();
    S.render();
  } catch (e) { toast(e.message, 1); btn.disabled = false; }
};
const act = async (b, url, body, ok, img) => {
  b.disabled = true;
  try { const r = await call(url, { json: body || {} }); if (r && r.rolesWarning) alert(r.rolesWarning); else toast(ok); if (img) await apImage(img); await S.refreshMe(); S.render(); }
  catch (e) { toast(e.message, 1); b.disabled = false; }
};
S.actions.apsign = (b) => { if (confirm("Підписати наказ? Бот одразу змінить звання й ролі в Discord.")) act(b, `/api/orders/${b.dataset.id}/sign`, null, "Наказ підписано. Ролі в Discord перевірено — збігаються з наказом", +b.dataset.id); };
S.actions.apreject = (b) => { const note = prompt("Причина відхилення (побачить ВКПП):", ""); if (note !== null) act(b, `/api/orders/${b.dataset.id}/reject`, { note }, "Проєкт відхилено", +b.dataset.id); };
S.actions.appdf = (b) => { const o = (S.cache.apList || {})[b.dataset.id]; if (o) S.pdfA4(b, apA4(o), `${no(o.id)}_${o.name}`); };
S.actions.apdel = (b) => { if (confirm("Видалити проєкт наказу?")) act(b, `/api/orders/${b.dataset.id}/delete`, null, "Проєкт видалено"); };
S.actions.apcancel = async (b) => {
  if (!confirm("Скасувати наказ? Якщо звання з того часу не змінювалось, бот поверне попереднє звання й підрозділ.")) return;
  b.disabled = true;
  try {
    const r = await call(`/api/orders/${b.dataset.id}/cancel`, { json: {} });
    if (r.rolesWarning) alert(r.rolesWarning);
    else toast(r.reverted ? "Наказ скасовано, попереднє звання й ролі повернуто" : "Наказ скасовано (звання вже змінювалось — повертайте окремо)");
    S.render();
  } catch (e) { toast(e.message, 1); b.disabled = false; }
};
})();

/* ---------- довільні накази Голови / Заступника (НГ-…): бачать усі, видають звання 14–15 ---------- */
(() => {
const S = window.SOVA;
const { esc, call, toast, fmtDT } = S;
const fs = { title: "", body: "" };
const no = (id) => `НГ-${String(id).padStart(4, "0")}`;
const paper = (o, draft) => `<article class="blank ng-doc" ${draft ? "" : `id="ng-${o.id}"`}>
    <div class="rap-no">${draft ? "НГ-нов." : no(o.id)}</div>
    <div class="blank-to">СЛУЖБА БЕЗПЕКИ ШТАТУ NG</div>
    <div class="blank-title">Н А К А З</div>
    <div style="text-align:center;margin:-8px 0 16px">${draft ? new Date().toLocaleDateString("uk-UA") : fmtDT(o.t)}</div>
    <h3 class="ng-title">${esc(o.title || "Назва наказу")}</h3>
    <p class="ng-body">${esc(o.body || "Текст наказу…")}</p>
    <div class="blank-sign"><span>${esc(o.byRank || S.ME().me.rankName)}</span><span class="kf-sign">${esc(o.byName || S.ME().me.name)}</span></div>
    <div class="blank-stamp">ЄІС «СОВА»</div>
    ${draft ? "" : `<div class="ng-act no-pdf"><button class="btn sm" data-a="ngpdf" data-id="${o.id}">⬇ PDF</button>${S.docImgBtn("ng", o.id, true)}${o.by_sid === S.ME().me.sid || S.ME().me.rank === 15 ? `<button class="btn sm bad" data-a="ngdel" data-id="${o.id}">↩ Скасувати наказ</button>` : ""}</div>`}
  </article>`;
const ngA4 = (o) => S.a4(paper(o, false), no(o.id), { noTo: true, date: fmtDT(o.t), sub: "Наказ Голови Служби безпеки" });
S.freeOrdersView = async (head) => {
  const [list] = await Promise.all([call("/api/orders/free"), S.loadTags()]);
  S.cache.ngList = Object.fromEntries(list.map((o) => [o.id, o]));
  const can = S.ME().me.rank >= 14;
  return head + (can ? `<div class="grid2 rap-wrap"><form class="card" data-f="ngsave"><header><h3>Новий наказ Голови СБУ</h3></header>
      <p class="note">Наказ одразу з'явиться в Discord у каналі наказів зі згадкою @СБУ і в цьому реєстрі для всього особового складу.</p>
      <div class="form-grid"><label class="f wide"><span>Назва наказу</span><input class="i" data-ng="title" maxlength="150" value="${esc(fs.title)}" placeholder="напр. Про посилення патрулювання в районі порту"></label>
        <label class="f wide"><span>Текст наказу</span><textarea class="i kf-big" data-ng="body" maxlength="3500" placeholder="Керуючись… НАКАЗУЮ: 1. … 2. …">${esc(fs.body)}</textarea></label>
        ${S.tagSelect('data-ng="tag"', fs.tag || "")}</div>
      <div><button class="btn gold" type="submit">Підписати й оголосити</button></div></form>
      <div id="ng-prev">${paper(fs, true)}</div></div>` : "")
    + `<h3 class="bn-h" style="margin-top:18px">Реєстр наказів Голови СБУ</h3>`
    + (list.length ? `<div class="ng-list">${list.map((o) => paper(o, false)).join("")}</div>` : '<div class="empty">Наказів ще немає.</div>');
};
document.addEventListener("input", (e) => {
  if (!e.target.dataset || !e.target.dataset.ng) return;
  fs[e.target.dataset.ng] = e.target.value;
  const p = document.getElementById("ng-prev");
  if (p) p.innerHTML = paper(fs, true);
});
S.forms.ngsave = async (f) => {
  const b = f.querySelector("button[type=submit]");
  if (!confirm("Підписати й оголосити наказ? Усі з роллю СБУ отримають сповіщення.")) return;
  b.disabled = true;
  try {
    const r = await call("/api/orders/free", { json: fs });
    toast("Наказ оголошено");
    const o = (await call("/api/orders/free").catch(() => [])).find((x) => x.id === r.id);
    if (o) await S.docImage("ng", r.id, ngA4(o));
    fs.title = ""; fs.body = ""; fs.tag = ""; S.render();
  }
  catch (e) { toast(e.message, 1); b.disabled = false; }
};
S.docImageFns.ng = async (id) => { const o = (await call("/api/orders/free").catch(() => [])).find((x) => x.id === id); return o ? S.docImage("ng", id, ngA4(o)) : false; };
S.actions.ngpdf = (b) => { const o = (S.cache.ngList || {})[b.dataset.id]; if (o) S.pdfA4(b, ngA4(o), `${no(o.id)}_${o.title || ""}`); };
S.actions.ngdel = async (b) => {
  if (!confirm("Скасувати наказ? У Discord з'явиться повідомлення про скасування.")) return;
  b.disabled = true;
  try { await call(`/api/orders/free/${b.dataset.id}/delete`, { json: {} }); toast("Наказ скасовано"); S.render(); }
  catch (e) { toast(e.message, 1); b.disabled = false; }
};
})();
