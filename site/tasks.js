/* «Завдання тижня»: Куратор, Заступник Голови й Голова ставлять відділам завдання на тиждень (Пн–Нд).
   За звітами — закриваються самі, щойно підтверджено достатньо звітів; ручні — начальник відділу позначає виконання з доказами,
   керівництво підтверджує. Щонеділі — підсумок з доказами в Discord. Підключається після app.js (window.SOVA). */
(() => {
const S = window.SOVA;
const { esc, call, toast, fmtDT } = S;
const WEEK = 7 * 86400000;
const st = { w: null, id: null, edit: null, d: "all", o: null, doc: null };
const CHIP = { open: "info", review: "wait", done: "ok", cancel: "mute", fail: "bad" };
const ICON = { done: "✅", review: "🕓", cancel: "▫️", fail: "❌" };
const D = () => S.META().depts;
const dname = (k) => (D()[k] || {}).s || k;
const dd = (ms) => new Date(ms).toLocaleDateString("uk-UA", { day: "2-digit", month: "2-digit" });
const icon = (x) => ICON[x.state] || (x.progress.n > 0 ? "🟡" : "⬜");
const goal = (x) => {
  if (x.kind !== "auto") return "Ручне · виконання підтверджує керівництво";
  const A = S.META().acts || {}, t = x.data.acts || [];
  return `${t.length ? t.map((k) => esc((A[k] || {}).n || k)).join(", ") : "Будь-які підтверджені звіти"} — ціль <b>${x.progress.target}</b>`;
};
const pbar = (x, big) => `<div class="tk-bar${big ? " big" : ""}${x.state === "done" ? " ok" : x.state === "fail" ? " bad" : ""}"><i style="width:${x.pct}%"></i></div>`;
const prog = (x) => x.kind === "auto"
  ? `<b class="num">${x.progress.n}/${x.progress.target}</b>${x.progress.wait ? ` <span class="muted small">+${x.progress.wait} на перевірці</span>` : ""}`
  : `<span class="muted small">${{ done: "виконання підтверджено", review: "очікує підтвердження", fail: "не виконано", cancel: "скасовано" }[x.state] || "в роботі"}</span>`;

async function load() {
  st.o = await call("/api/tasks" + (st.w ? "?w=" + st.w : ""));
  st.w = st.o.week;
  return st.o;
}

async function listView() {
  const o = await load(), R = o.rights, s = o.stats;
  const depts = R.depts.filter((k) => o.items.some((x) => x.dept === k) || R.manage);
  if (st.d !== "all" && !depts.includes(st.d)) st.d = "all";
  const shown = depts.filter((k) => st.d === "all" || st.d === k).filter((k) => o.items.some((x) => x.dept === k));
  const review = o.items.filter((x) => x.state === "review").length;
  const left = o.items.filter((x) => x.status !== "cancel" && x.state !== "done").length;
  const future = o.week > o.current, past = o.week < o.current;
  return `<div class="tk-head">
      <div><div class="eyebrow">Завдання від керівництва СБУ · ${past ? "архів" : future ? "заплановано" : "поточний тиждень"}</div>
        <div class="tk-week"><button class="btn sm" data-a="tkw" data-v="-1" title="Попередній тиждень">←</button><b>${esc(o.label)}</b>
          <button class="btn sm" data-a="tkw" data-v="1" title="Наступний тиждень" ${!R.manage && !past ? "disabled" : ""}>→</button>
          ${o.isCurrent ? "" : '<button class="btn sm" data-a="tkw" data-v="0">Поточний тиждень</button>'}</div></div>
      <span class="sp"></span>
      ${R.manage ? `<button class="btn" data-a="tksum">📤 Підсумок у Discord</button><button class="btn gold" data-a="tknew">+ Нове завдання</button>` : ""}
    </div>
    ${o.carry ? `<p class="note warn">Минулого тижня не виконано завдань: <b>${o.carry}</b>. <button class="btn sm" data-a="tkcarry">Перенести всі на цей тиждень</button></p>` : ""}
    <div class="dp-kpi tk-kpi">
      <div class="k gold"><span>Виконано</span><b>${s.pct}%</b><small>${s.done} з ${s.total} завдань</small></div>
      <div class="k"><span>Завдань тижня</span><b>${s.total}</b><small>відділів: ${Object.keys(s.depts).length}</small></div>
      <div class="k ${review ? "warn" : ""}"><span>На підтвердженні</span><b>${review}</b><small>ручні завдання</small></div>
      <div class="k ${left && past ? "bad" : ""}"><span>${past ? "Не виконано" : "Лишилось"}</span><b>${left}</b><small>${past ? "тиждень закрито" : "до неділі"}</small></div>
    </div>
    ${depts.length > 1 ? `<div class="car-filter"><button class="${st.d === "all" ? "on" : ""}" data-a="tkd" data-v="all">Усі відділи</button>${depts.map((k) => {
      const x = s.depts[k];
      return `<button class="${st.d === k ? "on" : ""}" data-a="tkd" data-v="${k}">${esc(dname(k))}${x ? `<em>${x.done}/${x.total}</em>` : ""}</button>`; }).join("")}</div>` : ""}
    ${shown.length ? `<div class="tk-board">${shown.map((k) => deptCard(k, o)).join("")}</div>`
      : `<div class="empty">${R.manage ? "На цей тиждень завдань ще немає. Натисніть «+ Нове завдання»." : "На цей тиждень завдань для вашого відділу немає."}</div>`}
    <p class="muted small tk-foot">Завдання за звітами закриваються самі, щойно керівник підтвердить достатньо звітів відділу за тиждень (Пн–Нд).
      Ручні — начальник відділу або заступник позначає виконання з доказами, керівництво підтверджує. Щонеділі підсумок із доказами надходить у Discord.</p>`;
}

function deptCard(k, o) {
  const d = D()[k] || {}, s = o.stats.depts[k] || { done: 0, total: 0, pct: 0 };
  const items = o.items.filter((x) => x.dept === k);
  const who = {};
  items.forEach((x) => (x.acts || []).forEach((a) => { who[a.byName] = (who[a.byName] || 0) + a.units; }));
  const top = Object.entries(who).sort((a, b) => b[1] - a[1]).slice(0, 3);
  return `<section class="card tk-dept" style="--dc:${d.color}">
    <header><div><b>${esc(d.s)}</b><span class="muted small">${esc(d.n)}</span></div><span class="sp"></span><span class="tk-pct">${s.done}/${s.total} · ${s.pct}%</span></header>
    <div class="tk-bar dept"><i style="width:${s.pct}%"></i></div>
    <ul class="tk-list">${items.map((x) => `<li class="st-${x.state}" data-a="tkopen" data-id="${x.id}">
      <span class="tk-ic">${icon(x)}</span>
      <div class="tk-main"><div class="tk-t">${esc(x.data.title)}${x.data.prio === "high" ? ' <span class="chip bad">важливе</span>' : ""}${x.repeat ? ' <span class="chip mute" title="Повторюється щотижня">↻</span>' : ""}</div>
        <div class="tk-g">${goal(x)}</div>${x.kind === "auto" ? pbar(x) : ""}</div>
      <div class="tk-r">${prog(x)}<span class="chip ${CHIP[x.state] || "mute"}">${esc(x.stateName)}</span></div></li>`).join("")}</ul>
    ${top.length ? `<div class="tk-who muted small">👤 ${top.map(([n, c]) => `${esc(n)} <b>${c}</b>`).join(" · ")}</div>` : ""}
  </section>`;
}

async function docView(id) {
  const x = await call(`/api/tasks/${id}`);
  st.doc = x;
  const R = (st.o && st.o.rights) || S.ME().tasks || {}, d = D()[x.dept] || {};
  const lead = (R.lead || []).includes(x.dept), past = Date.now() >= x.week + WEEK;
  const btn = [
    x.state === "review" && R.manage && `<button class="btn ok" data-a="tkx" data-x="confirm">✔ Підтвердити виконання</button><button class="btn bad" data-a="tkx" data-x="reject">✖ Не зараховувати…</button>`,
    R.manage && ["open", "review"].includes(x.status) && !past && `<button class="btn" data-a="tkedit">Редагувати</button>`,
    R.manage && past && ["open", "review"].includes(x.status) && `<button class="btn gold" data-a="tkx" data-x="carry">↷ Перенести на цей тиждень</button>`,
    R.manage && `<button class="btn" data-a="tkx" data-x="repeat">${x.repeat ? "↻ Не повторювати" : "↻ Повторювати щотижня"}</button>`,
    R.manage && ["open", "review"].includes(x.status) && `<button class="btn bad" data-a="tkx" data-x="cancel">Скасувати</button>`,
    R.manage && `<button class="btn bad" data-a="tkx" data-x="delete" title="Видалити">🗑</button>`,
  ].filter(Boolean).join("");
  const W = { create: "Завдання поставлено", edit: "Завдання змінено", submit: "Позначено виконаним", done: "Виконано (позначило керівництво)",
    confirm: "Виконання підтверджено", reject: "Виконання не зараховано", cancel: "Скасовано", delete: "Видалено", carry: "Перенесено",
    carried: "Перенесено з минулого тижня", repeat: "Повтор щотижневого завдання", repeat_on: "Увімкнено щотижневий повтор",
    repeat_off: "Щотижневий повтор вимкнено", auto_done: "Ціль досягнуто — закрито автоматично" };
  const pr = x.proof || {};
  const canSubmit = x.kind === "manual" && x.status === "open" && (lead || R.manage) && Date.now() < x.week + WEEK + 86400000;
  return `<div class="kd-bar"><button class="btn" data-a="tkback">← До завдань</button><span class="chip ${CHIP[x.state] || "mute"}">${esc(x.stateName)}</span><span class="sp"></span>${btn}</div>
    <div class="fin-page"><div class="tk-doc">
      <section class="card tk-hero" style="--dc:${d.color}">
        <div class="eyebrow">${esc(d.n || "")} · тиждень ${dd(x.week)}–${dd(x.week + 6 * 86400000)}</div>
        <h2>${icon(x)} ${esc(x.data.title)}</h2>
        <div class="tk-tags"><span class="dtag" style="--c:${d.color}">${esc(d.s)}</span>
          <span class="chip ${x.kind === "auto" ? "info" : "mute"}">${x.kind === "auto" ? "За звітами" : "Ручне"}</span>
          ${x.data.prio === "high" ? '<span class="chip bad">Важливе</span>' : ""}${x.repeat ? '<span class="chip mute">↻ щотижня</span>' : ""}</div>
        ${x.data.descr ? `<p class="tk-descr">${esc(x.data.descr).replace(/\n/g, "<br>")}</p>` : ""}
        <div class="tk-goal">${goal(x)}</div>
        ${x.kind === "auto" ? `${pbar(x, true)}<div class="tk-big">${prog(x)} <span class="muted">· ${x.pct}%</span></div>` : ""}
        <div class="muted small">Поставив: ${x.byUser ? `${esc(x.byUser.rankName)} ${x.byUser.rankName === x.byUser.name ? "" : esc(x.byUser.name)}` : "—"} · ${fmtDT(x.created)}${x.doneAt ? ` · виконано ${fmtDT(x.doneAt)}` : ""}</div>
      </section>
      ${x.kind === "auto" ? `<section class="card"><header><h3>Зараховані звіти</h3><span class="sp cnt-b">${x.acts.length}</span></header>
        ${x.acts.length ? `<div class="tbl-wrap"><table class="t"><thead><tr><th>Звіт</th><th>Дія</th><th>Виконавець</th><th>Коли</th><th>Докази</th></tr></thead><tbody>
          ${x.acts.map((a) => `<tr><td class="mono"><a href="#/act/${a.id}">${esc(a.no)}</a></td><td>${esc(a.type)}${a.units > 1 ? ` <span class="muted small">×${a.units}</span>` : ""}</td>
            <td>${esc(a.byName)}</td><td class="muted">${fmtDT(a.t)}</td>
            <td>${S.safeUrl(a.evidence) ? `<a href="${esc(S.safeUrl(a.evidence))}" target="_blank" rel="noopener">🔗 відкат</a> ` : ""}${(a.files || []).map((f, i) => `<button class="btn sm" data-a="tkfile" data-id="${esc(f)}">📎 ${i + 1}</button>`).join(" ")}</td></tr>`).join("")}
        </tbody></table></div>` : `<div class="empty">Підтверджених звітів потрібного типу за цей тиждень ще немає.${x.progress.wait ? ` На перевірці: ${x.progress.wait}.` : ""}</div>`}</section>` : ""}
      ${x.kind === "manual" && (pr.links || pr.files) ? `<section class="card"><header><h3>Докази виконання</h3></header>
        ${pr.note ? `<p>${esc(pr.note).replace(/\n/g, "<br>")}</p>` : ""}
        <div class="tk-proof">${(pr.links || []).map((u, i) => S.safeUrl(u) ? `<a class="btn sm" href="${esc(S.safeUrl(u))}" target="_blank" rel="noopener">🔗 Доказ ${i + 1}</a>` : "").join("")}
          ${(pr.files || []).map((f, i) => `<button class="btn sm" data-a="tkfile" data-id="${esc(f)}">📎 Файл ${i + 1}</button>`).join("")}</div>
        ${x.doneUser ? `<p class="muted small">Позначив: ${esc(x.doneUser.rankName)} ${esc(x.doneUser.name)}${pr.t ? " · " + fmtDT(pr.t) : ""}</p>` : ""}</section>` : ""}
      ${canSubmit ? `<form class="card form-grid" data-f="tksubmit"><header class="wide"><h3>Позначити виконаним</h3>
          <div class="muted small">${R.manage ? "Ви ставите завдання — воно одразу буде виконаним." : "Після цього Куратор, Заступник Голови або Голова підтвердить виконання."}</div></header>
        <label class="f wide"><span>Посилання на докази (кожне з нового рядка, до 5)</span><textarea class="i" id="tk-links" placeholder="https://…"></textarea></label>
        <label class="f wide"><span>Скріни або відео (до 5)</span><input class="i" id="tk-files" type="file" multiple></label>
        <label class="f wide"><span>Що зроблено (необов'язково)</span><textarea class="i" id="tk-note" maxlength="1000"></textarea></label>
        <div class="wide"><button class="btn gold">📨 Позначити виконаним</button></div></form>` : ""}
    </div>
    <aside class="card"><header><h3>Рух завдання</h3></header><div class="aud">${(x.history || []).slice().reverse().map((h) => `<div class="aud-it k-${["reject", "cancel", "delete"].includes(h.action) ? "down" : "in"}"><i></i>
      <div class="aud-when"><b>${dd(h.t)}</b><span>${new Date(h.t).toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit" })}</span></div>
      <div class="aud-body"><div class="aud-act">${W[h.action] || esc(h.action)}</div><div class="aud-who"><b>${esc(h.name)}</b>${h.rank ? " · " + esc(h.rank) : ""}${h.note ? ` · «${esc(h.note)}»` : ""}</div></div></div>`).join("")}</div></aside></div>`;
}

function editView() {
  const e = st.edit, x = e.data, A = S.META().acts || {}, o = st.o || {};
  // для яких з обраних відділів цей тип звіту недоступний (як у формі звіту; «instr» — інструктори будь-якого відділу)

  const all = o.depts || Object.keys(D()).filter((k) => !["lead", "curator", "prosecutor"].includes(k));
  const acts = Object.entries(A).filter(([, v]) => !v.off);
  return `<div class="kd-bar"><button class="btn" data-a="tkback">← До завдань</button><span class="sp"></span>
      <button class="btn gold" data-a="tksave">${e.id ? "💾 Зберегти" : "📨 Поставити завдання"}</button></div>
    <div class="grid2 rap-wrap prot-wrap"><form class="card form-grid" onsubmit="return false"><header class="wide"><h3>${e.id ? "Редагування завдання" : "Нове завдання тижня"}</h3></header>
      ${e.id ? `<div class="f wide"><span>Відділ</span><b>${esc((D()[e.dept] || {}).n || e.dept)}</b></div>` : `<div class="f wide tk-depts"><span>Відділи (кожен отримає окреме завдання)</span>
        <label class="chk"><input type="checkbox" id="tk-alld"> <b>Усі відділи</b></label>
        ${all.map((k) => `<label class="chk"><input type="checkbox" data-td="${k}" ${(e.depts || []).includes(k) ? "checked" : ""}> ${esc((D()[k] || {}).n || k)}</label>`).join("")}</div>`}
      <label class="f wide"><span>Назва</span><input class="i" data-tx="title" value="${esc(x.title)}" maxlength="120" placeholder="Напр. Провести 3 рейди на наркоточки"></label>
      <label class="f wide"><span>Опис і вимоги (необов'язково)</span><textarea class="i" data-tx="descr" maxlength="1500">${esc(x.descr)}</textarea></label>
      ${e.id ? "" : `<div class="f wide"><span>Як виконується</span>
        <label class="chk"><input type="radio" name="tk-kind" value="auto" ${e.kind === "auto" ? "checked" : ""}> <b>За звітами</b> — закривається саме, коли підтверджено потрібну кількість звітів</label>
        <label class="chk"><input type="radio" name="tk-kind" value="manual" ${e.kind === "manual" ? "checked" : ""}> <b>Ручне</b> — начальник відділу позначає з доказами, ви підтверджуєте</label></div>`}
      <div class="f wide tk-auto" ${e.kind === "auto" ? "" : "hidden"}><span>Які звіти зараховуються (нічого не обрано — будь-які)</span>
        <div class="tk-acts">${acts.map(([k, v]) => { const no = actNoDepts(v, e.id ? [e.dept] : e.depts || []); return `<label class="chk"><input type="checkbox" data-ta="${k}" ${(x.acts || []).includes(k) ? "checked" : ""}> ${esc(v.n)} <span class="muted small tk-no" data-k="${k}" title="Співробітники цих відділів не можуть подати такий звіт — завдання для них не виконається">${noText(no)}</span></label>`; }).join("")}</div></div>
      <label class="f tk-auto" ${e.kind === "auto" ? "" : "hidden"}><span>Ціль: скільки звітів (патрулювання — блоків по 30 хв)</span><input class="i mono" type="number" min="1" max="200" data-tx="target" value="${esc(x.target || 3)}"></label>
      <label class="f"><span>Пріоритет</span><select class="i" data-tx="prio"><option value="normal">Звичайне</option><option value="high" ${x.prio === "high" ? "selected" : ""}>Важливе ❗</option></select></label>
      ${e.id ? "" : `<label class="f"><span>Тиждень</span><select class="i" id="tk-week"><option value="cur">Поточний (${dd(o.current)}–${dd(o.current + 6 * 86400000)})</option>
        <option value="next" ${e.week === "next" ? "selected" : ""}>Наступний (${dd(o.current + WEEK)}–${dd(o.current + WEEK + 6 * 86400000)})</option></select></label>`}
      <div class="f wide"><label class="chk"><input type="checkbox" id="tk-repeat" ${e.repeat ? "checked" : ""}> ↻ Повторювати щотижня (щопонеділка створюється знову)</label></div>
    </form>
    <div class="prot-side"><div class="prot-hints"><div class="eyebrow">Як це працює</div>
      <p class="note"><b>За звітами.</b> Рахуються підтверджені звіти відділу за тиждень (Пн–Нд, Київ). Щойно ціль досягнуто, завдання закривається, а відділ отримує повідомлення в Discord.</p>
      <p class="note"><b>Ручне.</b> Для того, що звітом не порахуєш: навчання, план операції, перевірка. Начальник відділу чи заступник додає докази, а ви підтверджуєте або повертаєте з причиною.</p>
      <p class="note">Нове завдання на поточний тиждень одразу надходить у канал відділу з пінгом ролі. У п'ятницю — нагадування про невиконане, у неділю — підсумок у Discord.</p></div></div></div>`;
}

S.views.tasks = async () => st.edit ? editView() : st.id ? docView(st.id) : listView();

const run = async (b, fn) => { if (b) b.disabled = true; try { await fn(); } catch (e) { toast(e.message, 1); } if (b) b.disabled = false; };
// для яких з обраних відділів тип звіту недоступний (як у формі звіту; «all» і «instr» — будь-який відділ)
const actNoDepts = (v, depts) => Array.isArray(v.d) ? depts.filter((d) => !v.d.includes(d)) : [];
const noText = (no) => no.length ? `⚠ недоступно: ${esc(no.map((d) => (D()[d] || {}).s || d).join(", "))}` : "";
function updNo() {
  const A = S.META().acts || {}, e = st.edit;
  if (!e) return;
  const depts = e.id ? [e.dept] : [...document.querySelectorAll("[data-td]:checked")].map((el) => el.dataset.td);
  document.querySelectorAll(".tk-no").forEach((el) => { el.innerHTML = A[el.dataset.k] ? noText(actNoDepts(A[el.dataset.k], depts)) : ""; });
}
const read = () => {
  const e = st.edit, x = e.data;
  document.querySelectorAll("[data-tx]").forEach((el) => { x[el.dataset.tx] = el.value; });
  x.acts = [...document.querySelectorAll("[data-ta]:checked")].map((el) => el.dataset.ta);
  if (!e.id) {
    e.depts = [...document.querySelectorAll("[data-td]:checked")].map((el) => el.dataset.td);
    e.kind = (document.querySelector("[name=tk-kind]:checked") || {}).value || "auto";
    e.week = (document.getElementById("tk-week") || {}).value || "cur";
  }
  e.repeat = !!(document.getElementById("tk-repeat") || {}).checked;
};
document.addEventListener("change", (e) => {
  if (e.target.name === "tk-kind") document.querySelectorAll(".tk-auto").forEach((el) => { el.hidden = e.target.value !== "auto"; });
  if (e.target.id === "tk-alld") document.querySelectorAll("[data-td]").forEach((el) => { el.checked = e.target.checked; });
  if (e.target.id === "tk-alld" || e.target.dataset.td) updNo();
});
S.forms.tksubmit = (f) => run(f.querySelector("button"), async () => {
  const links = document.getElementById("tk-links").value.split(/\s+/).map((s) => s.trim()).filter(Boolean);
  const fi = document.getElementById("tk-files");
  const files = fi.files.length ? await S.uploadFiles(fi) : [];
  if (!links.length && !files.length) throw new Error("Додайте докази: посилання або файли.");
  await call(`/api/tasks/${st.doc.id}/submit`, { json: { links, files, note: document.getElementById("tk-note").value } });
  toast((st.o && st.o.rights.manage) ? "Завдання виконано" : "Надіслано на підтвердження");
  await S.refreshMe?.();
  S.render();
});
const fresh = () => ({ title: "", descr: "", acts: [], target: 3, prio: "normal" });
Object.assign(S.actions, {
  tkw: (b) => { const v = +b.dataset.v; st.w = v === 0 ? null : (st.w || st.o.current) + v * WEEK; st.id = null; S.render(); },
  tkd: (b) => { st.d = b.dataset.v; S.render(); },
  tkopen: (b) => { st.id = +b.dataset.id; st.edit = null; S.render(); scrollTo(0, 0); },
  tkback: () => { if (st.edit) { st.id = st.edit.id || null; st.edit = null; } else st.id = null; S.render(); },
  tknew: () => { st.edit = { data: fresh(), kind: "auto", depts: st.d !== "all" ? [st.d] : [], week: st.o && st.w > st.o.current ? "next" : "cur" }; S.render(); scrollTo(0, 0); },
  tkedit: () => { const x = st.doc; st.edit = { id: x.id, dept: x.dept, kind: x.kind, repeat: x.repeat, data: { ...fresh(), ...JSON.parse(JSON.stringify(x.data)) } }; S.render(); scrollTo(0, 0); },
  tkfile: (b) => S.showFile(b.dataset.id),
  tksave: (b) => run(b, async () => {
    read();
    const e = st.edit, body = { ...e.data, kind: e.kind, repeat: e.repeat };
    if (e.id) {
      await call(`/api/tasks/${e.id}/edit`, { json: body });
      st.id = e.id; toast("Завдання змінено");
    } else {
      const r = await call("/api/tasks", { json: { ...body, depts: e.depts, week: e.week } });
      st.w = r.week; st.id = null;
      toast(r.ids.length > 1 ? `Поставлено завдань: ${r.ids.length}` : "Завдання поставлено");
    }
    st.edit = null;
    S.render();
  }),
  tksum: (b) => run(b, async () => {
    if (!confirm(`Надіслати підсумок завдань за тиждень ${st.o.label} у канал Discord?`)) return;
    const r = await call("/api/tasks/summary", { json: { w: st.w } });
    toast(`Підсумок надіслано (${r.n} повідомл.)`);
  }),
  tkcarry: (b) => run(b, async () => {
    if (!confirm("Перенести всі невиконані завдання минулого тижня на поточний?")) return;
    const r = await call("/api/tasks/carry", { json: {} });
    toast(`Перенесено: ${r.n}`); S.render();
  }),
  tkx: (b) => run(b, async () => {
    const x = b.dataset.x, body = {}, t = st.doc;
    if (x === "reject") {
      const n = prompt("Чому виконання не зараховано? Це побачить відділ у Discord:", "");
      if (n === null) return;
      if (n.trim().length < 3) throw new Error("Вкажіть причину (хоча б кілька слів).");
      body.note = n.trim();
    }
    if (x === "cancel" && !confirm("Скасувати завдання? Воно не рахуватиметься в підсумку.")) return;
    if (x === "delete" && !confirm("Видалити завдання остаточно?")) return;
    if (x === "confirm" && !confirm(`Підтвердити виконання «${t.data.title}»?`)) return;
    const r = await call(`/api/tasks/${t.id}/${x}`, { json: body });
    toast({ confirm: "Виконання підтверджено", reject: "Повернуто відділу", cancel: "Завдання скасовано", delete: "Завдання видалено",
      carry: "Перенесено на цей тиждень", repeat: "Збережено" }[x] || "Готово");
    if (x === "delete") st.id = null;
    if (x === "carry") { st.id = r.id; st.w = r.week; }
    await S.refreshMe?.();
    S.render();
  }),
});
// адреса: #/tasks · #/tasks/w/<понеділок> · #/tasks/12 · #/tasks/new · #/tasks/12/edit
const isId = (v) => /^\d+$/.test(v || "");
S.routes.tasks = {
  get: () => st.edit ? [st.edit.id || "new", st.edit.id ? "edit" : null].filter(Boolean) : st.id ? [st.id] : st.w && st.o && st.w !== st.o.current ? ["w", st.w] : [],
  set: (p) => {
    st.edit = null; st.id = null;
    if (p[0] === "w" && isId(p[1])) st.w = +p[1];
    else if (isId(p[0])) st.id = +p[0];
    else if (p[0] === "new") st.edit = { data: fresh(), kind: "auto", depts: [], week: "cur" };
    else st.w = null;
  },
};
S.onNav.push((v) => { if (v !== "tasks") { st.id = null; st.edit = null; } });
})();
