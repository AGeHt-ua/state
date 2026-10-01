/* Скрипт сторінки «structure». Запускається, коли дані порталу завантажені й сторінка готова. */
whenStateReady(async function () {
  // Гілка влади визначається роллю апарату
  const GOV_BRANCHES = [
    { id: "exec", title: "Виконавча влада", roles: ["governor", "official"], text: "Губернатор штату, уряд і департаменти." },
    { id: "court", title: "Судова влада", roles: ["court"], text: "Верховний, апеляційні та окружні суди." },
    { id: "pros", title: "Прокуратура", roles: ["prosecutor"], text: "Нагляд за законністю та кримінальне переслідування." }
  ];
  const offices = allOffices();
  const positions = allPositions();
  const people = allUsers().filter((u) => isStaff(u));
  const other = { id: "other", title: "Інші органи", roles: [], text: "Апарати, створені в адмін-панелі." };
  const known = new Set(GOV_BRANCHES.flatMap((b) => b.roles));
  const groups = GOV_BRANCHES.concat([other]).map((b) => ({
    b,
    offices: offices.filter((o) => b === other ? !known.has(o.role) : b.roles.includes(o.role))
  })).filter((g) => g.offices.length);
  // Конгрес — не апарат, а посадовці зі статусом конгресмена
  const congress = congressMembers();
  const congressCard = `
    <section class="card branch-card">
      <p class="branch-tag">Законодавча влада</p>
      <p class="muted" style="margin:0 0 12px">Конгрес штату: розгляд і голосування за закони.</p>
      <h3>Конгрес штату</h3>
      ${congress.length ? congress.map((u) => `<div class="structure-row"><div><b>${esc(u.name || u.login)}</b><span>${esc(u.post || officeName(u.office || userOffice(u)))}</span></div><span class="pill">конгресмен</span></div>`).join("") : `<p class="muted">Склад ще не сформовано.</p>`}
    </section>`;
  document.getElementById("branches").innerHTML = congressCard + groups.map(({ b, offices }) => `
    <section class="card branch-card">
      <p class="branch-tag">${esc(b.title)}</p>
      <p class="muted" style="margin:0 0 12px">${esc(b.text)}</p>
      ${offices.map((o) => {
        const posts = positions.filter((p) => p.office === o.id);
        const members = people.filter((u) => (u.office || userOffice(u)) === o.id);
        return `
          <h3>${esc(o.name)}</h3>
          ${posts.length || members.length ? posts.map((p) => {
            const holders = members.filter((u) => u.positionId === p.id);
            return `<div class="structure-row"><div><b>${esc(p.title)}</b><span>${holders.length ? holders.map((u) => esc(u.name || u.login)).join(", ") : "вакантно"}</span></div></div>`;
          }).join("") + members.filter((u) => !posts.some((p) => p.id === u.positionId)).map((u) =>
            `<div class="structure-row"><div><b>${esc(u.post || "Посадовець")}</b><span>${esc(u.name || u.login)}</span></div></div>`
          ).join("") : `<p class="muted">Склад ще не сформовано.</p>`}`;
      }).join("")}
    </section>`).join("");
});
