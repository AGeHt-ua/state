/* Розділ відділу: контрольна панель для Голови СБУ, Заступника Голови та начальника відділу. Підключається після app.js (window.SOVA). */
(() => {
const S = window.SOVA;
const { esc, call } = S;
const st = { d: null };
const DOW = ["Нд", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];
const RSHORT = ["Стажер", "Мол. агент", "Агент", "Ст. агент", "Мол. опер", "Опер", "Ст. опер", "Інструктор", "Кер. групи", "Кер. сектору", "Заст. нач.", "Нач. відділу", "Нач. управл.", "Заст. Голови", "Голова"];
const ago = (t) => {
  if (!t) return "ніколи";
  const m = Math.floor((Date.now() - t) / 60000);
  if (m < 60) return `${m} хв тому`;
  if (m < 1440) return `${Math.floor(m / 60)} год тому`;
  return `${Math.floor(m / 1440)} дн тому`;
};
const delta = (a, b) => {
  if (!b) return a ? '<span class="dv up">▲ новий</span>' : '<span class="dv">—</span>';
  const p = Math.round(((a - b) / b) * 100);
  return `<span class="dv ${p > 0 ? "up" : p < 0 ? "down" : ""}">${p > 0 ? "▲" : p < 0 ? "▼" : "•"} ${Math.abs(p)}%</span>`;
};

function chart(days) {
  const max = Math.max(1, ...days.map((d) => d.pts));
  const W = 560, H = 170, bw = 50, gap = (W - bw * 7) / 6;
  return `<svg class="dp-chart" viewBox="0 0 ${W} ${H + 34}" role="img" aria-label="Бали відділу за 7 днів">
    ${[0.25, 0.5, 0.75, 1].map((f) => `<line x1="0" x2="${W}" y1="${H - H * f}" y2="${H - H * f}" class="grid"/>`).join("")}
    ${days.map((d, i) => {
      const h = Math.max(2, (d.pts / max) * (H - 16)), x = i * (bw + gap), today = i === 6;
      return `<g><rect x="${x}" y="${H - h}" width="${bw}" height="${h}" class="${today ? "today" : ""}" style="animation-delay:${i * 60}ms"><title>${d.pts} балів · ${d.n} звітів</title></rect>
        <text x="${x + bw / 2}" y="${H - h - 6}" class="v">${d.pts || ""}</text>
        <text x="${x + bw / 2}" y="${H + 18}" class="d">${DOW[new Date(d.t).getDay()]}</text>
        <text x="${x + bw / 2}" y="${H + 31}" class="n">${d.n} зв.</text></g>`;
    }).join("")}
  </svg>`;
}

async function view() {
  const o = await call("/api/dept" + (st.d ? `?d=${encodeURIComponent(st.d)}` : ""));
  st.d = o.dept;
  const D = S.META().depts, d = D[o.dept], t = o.totals;
  const okPct = t.submitted ? Math.round((t.approved / t.submitted) * 100) : 0;
  const maxPts = Math.max(1, ...o.people.map((p) => p.pts));
  const maxType = Math.max(1, ...o.types.map((x) => x.n));
  return `
  ${o.allowed.length > 1 ? `<div class="dp-switch">${o.allowed.map((k) => `<button class="${k === o.dept ? "on" : ""}" style="--dc:${D[k].color}" data-a="dpsel" data-v="${k}"><b>${esc(D[k].s)}</b><span>${esc(D[k].n)}</span></button>`).join("")}</div>` : ""}
  <section class="dp-hero" style="--dc:${d.color}">
    <div class="dp-emb">${esc(d.s)}</div>
    <div class="dp-id"><div class="eyebrow">Контрольна справа підрозділу · тиждень з ${new Date(o.weekStart).toLocaleDateString("uk-UA")}</div>
      <h2>${esc(d.n)}</h2>
      <div class="dp-lead"><span>Начальник: <b>${o.head ? esc(o.head.name) : '<i class="vac">вакантно</i>'}</b></span><span>Заступник: <b>${o.deputy ? esc(o.deputy.name) : '<i class="vac">вакантно</i>'}</b></span><span>Особовий склад: <b>${t.staff}</b></span></div></div>
    <div class="dp-stamp">ДЛЯ СЛУЖБОВОГО<br>КОРИСТУВАННЯ</div>
  </section>

  <div class="dp-kpi">
    <div class="k gold"><span>Бали відділу за тиждень</span><b>${t.pts}</b>${delta(t.pts, t.ptsPrev)}<small>минулий: ${t.ptsPrev}</small></div>
    <div class="k"><span>Звітів подано</span><b>${t.submitted}</b><small>підтверджено ${t.approved} · відхилено ${t.rejected}</small></div>
    <div class="k ${okPct >= 80 ? "ok" : okPct ? "warn" : ""}"><span>Якість звітів</span><b>${okPct}%</b><small>частка підтверджених</small></div>
    <div class="k ${t.pending ? "warn" : ""}"><span>На перевірці</span><b>${t.pending}</b><small>очікують керівника</small></div>
    <div class="k ${t.inactive ? "bad" : "ok"}"><span>Неактивні &gt; 3 діб</span><b>${t.inactive}</b><small>без жодного звіту</small></div>
    <div class="k info"><span>У відпустці</span><b>${t.vacation}</b><small>з ${t.staff} осіб</small></div>
  </div>

  <div class="grid2 dp-row">
    <div class="card"><header><h3>Динаміка за 7 днів</h3><span class="sp muted small">бали підтверджених звітів</span></header>${chart(o.days)}</div>
    <div class="card"><header><h3>Структура роботи тижня</h3></header>
      ${o.types.length ? `<div class="dp-types">${o.types.map((x) => `<div><span>${esc(x.name)}</span><i><b style="width:${(x.n / maxType) * 100}%"></b></i><em>${x.n}</em></div>`).join("")}</div>` : '<div class="empty">Цього тижня звітів ще немає.</div>'}
    </div>
  </div>

  <div class="card dp-staff"><header><h3>Контроль особового складу</h3><span class="sp muted small">сортування за балами тижня</span></header>
    <div class="tbl-wrap"><table class="t"><thead><tr><th>#</th><th>Співробітник</th><th>Звання</th><th>Бали тижня</th><th class="r">Минулий</th><th class="r">Звітів</th><th>Догани</th><th>Остання активність</th><th>Статус</th></tr></thead><tbody>
    ${o.people.map((p, i) => `<tr class="${p.inactive ? "inact" : ""}">
      <td class="mono muted">${i + 1}</td>
      <td><b>${esc(p.name)}</b><div class="mono small muted">${p.sid}</div></td>
      <td>${RSHORT[p.rank - 1] || esc(p.rankName)}</td>
      <td><div class="dp-bar"><i style="width:${(p.pts / maxPts) * 100}%"></i></div><b class="num">${p.pts}</b> ${delta(p.pts, p.ptsPrev)}</td>
      <td class="r num muted">${p.ptsPrev}</td>
      <td class="r num">${p.acts}${p.wait ? ` <span class="muted small">(${p.wait} на перев.)</span>` : ""}</td>
      <td>${p.reps ? `<span class="chip bad">${p.reps} акт.</span>` : '<span class="muted">—</span>'}</td>
      <td class="${p.inactive ? "bad" : ""}">${ago(p.last)}</td>
      <td>${p.status === "vacation" ? '<span class="chip info">Відпустка</span>' : p.inactive ? '<span class="chip bad">Неактивний</span>' : '<span class="chip ok">На службі</span>'}</td></tr>`).join("") || '<tr><td colspan="9" class="muted">У відділі нікого немає.</td></tr>'}
    </tbody></table></div></div>

  <div class="dp-queue">
    <div class="card"><header><h3>Звіти на перевірці</h3><span class="sp cnt-b">${o.queue.acts.length}</span></header>
      ${o.queue.acts.length ? `<ul>${o.queue.acts.map((a) => `<li><span class="mono">ЗВТ-${String(a.id).padStart(4, "0")}</span><b>${esc(a.name)}</b><span>${esc(a.what)}</span><em>${ago(a.t)}</em></li>`).join("")}</ul>
        <button class="btn sm" data-a="go" data-v="act" data-tab="review">Перейти до перевірки</button>` : '<div class="empty">Черга порожня.</div>'}</div>
    <div class="card"><header><h3>Рапорти на розгляді</h3><span class="sp cnt-b">${o.queue.raps.length}</span></header>
      ${o.queue.raps.length ? `<ul>${o.queue.raps.map((r) => `<li><span class="mono">РАП-${String(r.id).padStart(4, "0")}</span><b>${esc(r.name)}</b><span>${esc(S.META().rapTypes[r.type] || r.type)}</span><em>${ago(r.t)}</em></li>`).join("")}</ul>` : '<div class="empty">Немає.</div>'}</div>
    ${["orv", "deb", "atc", "alpha"].includes(o.dept) ? `<div class="card"><header><h3>Кейс-файли в роботі</h3><span class="sp cnt-b">${o.queue.cases.length}</span></header>
      ${o.queue.cases.length ? `<ul>${o.queue.cases.map((c) => `<li><span class="mono">КФ-${String(c.id).padStart(4, "0")}</span><b>«${esc(c.title)}»</b><span>${{ draft: "чернетка", head: "у начальника", chief: "у Голови", prosecutor: "у прокурора" }[c.status] || c.status}</span><em>${ago(c.updated)}</em></li>`).join("")}</ul>
        <button class="btn sm" data-a="nav" data-v="cases">Відкрити кейс-файли</button>` : '<div class="empty">Немає.</div>'}</div>` : ""}
  </div>`;
}

S.views.dept = view;
S.actions.dpsel = (b) => { st.d = b.dataset.v; S.render(); };
// адреса: #/dept/відділ
S.routes.dept = { get: () => [st.d], set: (p) => { st.d = p[0] || null; } };
})();
