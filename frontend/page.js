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
  const home = homeDocs().slice(0, 6);
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
