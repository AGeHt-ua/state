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

async function view(head) {
  const [staff, list] = await Promise.all([call("/api/structure"), call("/api/orders")]);
  S.cache.apStaff = staff;
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
    await call("/api/orders", { json: { sid: st.f.sid, rank: st.f.rank, dept: deptFor(st.f, p), extra: st.f.extra || null, reason: st.f.reason || "", sign: signNow } });
    toast(signNow ? "Наказ підписано. Ролі в Discord оновлено" : "Проєкт наказу подано на підпис");
    st.f = {};
    await S.refreshMe();
    S.render();
  } catch (e) { toast(e.message, 1); btn.disabled = false; }
};
const act = async (b, url, body, ok) => {
  b.disabled = true;
  try { await call(url, { json: body || {} }); toast(ok); await S.refreshMe(); S.render(); }
  catch (e) { toast(e.message, 1); b.disabled = false; }
};
S.actions.apsign = (b) => { if (confirm("Підписати наказ? Бот одразу змінить звання й ролі в Discord.")) act(b, `/api/orders/${b.dataset.id}/sign`, null, "Наказ підписано"); };
S.actions.apreject = (b) => { const note = prompt("Причина відхилення (побачить ВКПП):", ""); if (note !== null) act(b, `/api/orders/${b.dataset.id}/reject`, { note }, "Проєкт відхилено"); };
S.actions.apdel = (b) => { if (confirm("Видалити проєкт наказу?")) act(b, `/api/orders/${b.dataset.id}/delete`, null, "Проєкт видалено"); };
S.actions.apcancel = async (b) => {
  if (!confirm("Скасувати наказ? Якщо звання з того часу не змінювалось, бот поверне попереднє звання й підрозділ.")) return;
  b.disabled = true;
  try {
    const r = await call(`/api/orders/${b.dataset.id}/cancel`, { json: {} });
    toast(r.reverted ? "Наказ скасовано, попереднє звання повернуто" : "Наказ скасовано (звання вже змінювалось — повертайте окремо)");
    S.render();
  } catch (e) { toast(e.message, 1); b.disabled = false; }
};
})();
