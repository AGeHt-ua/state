/* Скрипт сторінки «головна». Запускається, коли дані порталу завантажені й сторінка готова. */
whenStateReady(async function () {
  const row = (a) => `
    <article class="act-row">
      <div class="act-num">${esc(formatDocWhen(a))}</div>
      <div>
        <h3><a href="${attr(docHref(a))}">${esc(a.title)}</a></h3>
        <div class="act-meta">${esc(a.type)} · ${esc(a.number)}${a.author ? " · " + esc(a.author) : ""}</div>
      </div>
      <span class="badge ${attr(badgeClass(a.status))}">${esc(DOC_STATUSES[a.status] || a.status)}</span>
    </article>`;
  // Основний закон штату: документи з позначкою «Основний закон штату» (редактор → «Файл»); поки їх немає — вбудована Конституція
  const fundamental = fundamentalDocs();
  const constitution = fundamental.find((d) => /конституц/i.test(d.type + " " + d.title));
  if (constitution) document.getElementById("quick-constitution").href = docHref(constitution);
  const fundBox = document.getElementById("fundamental-list");
  const fundItems = fundamental.length ? fundamental : [{ title: "Конституція штату San Andreas", type: "Конституція штату", number: "КС-01", href: "acts/const-sa-01/" }];
  fundBox.innerHTML = fundItems.map((d) => `
    <a class="fund-item" href="${attr(d.href || docHref(d))}">
      <b>${esc(d.title)}</b>
      <span>${esc(d.type)}${d.number ? " · " + esc(d.number) : ""}${d.publishedAt || d.date ? " · " + esc(formatDocWhen(d)) : ""}</span>
    </a>`).join("");
  const home = homeDocs().filter((d) => !d.fundamental).slice(0, 6);
  document.getElementById("stat-published").textContent = publishedDocs().length;
  document.getElementById("stat-home").textContent = homeDocs().length;
  document.getElementById("stat-cabinet").textContent = cabinetCreatedDocs().length;
  const box = document.getElementById("home-acts");
  if (box) {
    box.innerHTML = home.length ? home.map(row).join("") : "<p class='lead'>Немає актів для головної.</p>";
  }
  const created = cabinetCreatedDocs().slice(0, 8);
  const feed = document.getElementById("cabinet-feed");
  if (feed) {
    feed.innerHTML = created.length
      ? created.map(row).join("")
      : "<p class='lead'>З кабінету ще нічого не додавали в цьому браузері.</p>";
  }
});
