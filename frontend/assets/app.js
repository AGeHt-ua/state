function siteBase() {
  const el = document.querySelector('script[src*="assets/app.js"]');
  if (!el) return "./";
  return el.src.replace(/assets\/app\.js.*$/, "");
}

function pathTo(route) {
  return siteBase() + String(route).replace(/^\//, "");
}

function ensureSiteSearch() {
  if (document.getElementById("site-search")) return;
  const inner = document.querySelector(".header-inner");
  if (!inner) return;
  inner.insertAdjacentHTML("beforeend", `
    <form class="search" id="site-search">
      <input name="q" type="search" placeholder="Пошук за назвою або номером акта" />
      <button type="submit">Знайти</button>
    </form>`);
}

function ensureAccountActions() {
  if (document.getElementById("account-actions")) return;
  const inner = document.querySelector(".header-inner");
  if (!inner) return;
  ensureSiteSearch();
  const user = typeof currentUser === "function" ? currentUser() : null;
  const staff = user && typeof isStaff === "function" && isStaff(user);
  const citizen = user && typeof isCitizen === "function" && isCitizen(user);
  const cabinetUrl = user ? (staff || (typeof isCitizen === "function" && isCitizen(user)) ? pathTo("cabinet/") : pathTo("cabinet/pending/")) : pathTo("cabinet/portal/");
  const title = user ? (staff ? "Кабінет" : (citizen ? "Кабінет громадянина" : "Очікує доступ")) : "Електронний кабінет";
  const secondary = user ? `<a href="#" data-logout>Вийти</a>` : "";
  inner.insertAdjacentHTML("beforeend", `
    <div class="account-actions" id="account-actions">
      <a class="account-main" href="${cabinetUrl}">
        <span class="account-icon" aria-hidden="true">◉</span>
        <span>${title}</span>
      </a>
      ${secondary}
    </div>`);
}

function bindSearch() {
  ensureSiteSearch();
  const form = document.getElementById("site-search");
  if (!form) return;
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const q = new FormData(form).get("q") || "";
    const onActs = /\/acts\/?$/.test(location.pathname.replace(/index\.html$/, ""));
    const onRegistry = /\/cabinet\/all\/?$/.test(location.pathname.replace(/index\.html$/, ""));
    const inCabinet = /\/cabinet\//.test(location.pathname);
    if (onRegistry && typeof window.drawRegistry === "function") {
      const registrySearch = document.querySelector("#registry-filter input[name='q']");
      const registryStatus = document.querySelector("#registry-filter select[name='status']");
      const registryType = document.querySelector("#registry-filter select[name='type']");
      if (registrySearch) registrySearch.value = String(q);
      if (registryStatus) registryStatus.value = "all";
      if (registryType) registryType.value = "all";
      window.drawRegistry();
      return;
    }
    if (inCabinet) {
      location.href = pathTo("cabinet/all/") + `?q=${encodeURIComponent(String(q))}`;
      return;
    }
    if (onActs && typeof renderActList === "function") {
      renderActList("acts-list", String(q));
    } else {
      location.href = pathTo("acts/") + `?q=${encodeURIComponent(String(q))}`;
    }
  });
}

function bindLogout() {
  const links = document.querySelectorAll("#logout, [data-logout]");
  links.forEach((el) => el.addEventListener("click", (e) => {
    e.preventDefault();
    if (typeof logout === "function") logout();
    location.href = pathTo("");
  }));
}

function enhanceCabinetNavigation() {
  const sideNav = document.querySelector(".side-nav");
  if (!sideNav || typeof currentUser !== "function" || typeof reviewDocsFor !== "function") return;
  const user = currentUser();
  if (!user) return;
  const count = reviewDocsFor(user).length;
  const appealCount = typeof pendingAppealsFor === "function" ? pendingAppealsFor(user).length : 0;
  const existing = document.getElementById("nav-review-alert");
  if (!count) {
    if (existing) existing.remove();
  } else {
    const hrefPrefix = /\/cabinet\/?$/.test(location.pathname.replace(/index\.html$/, "")) ? "" : "../";
    const html = `<a class="review-nav-link" id="nav-review-alert" href="${hrefPrefix}inbox/">На погодження <span>${count}</span></a>`;
    if (existing) existing.outerHTML = html;
    else sideNav.insertAdjacentHTML("afterbegin", html);
  }
  const hrefPrefix = /\/cabinet\/?$/.test(location.pathname.replace(/index\.html$/, "")) ? "" : "../";
  const appealExisting = document.getElementById("nav-appeal-alert");
  if (!appealCount) {
    if (appealExisting) appealExisting.remove();
  } else {
    const html = `<a class="review-nav-link" id="nav-appeal-alert" href="${hrefPrefix}inbox/">Нові звернення <span>${appealCount}</span></a>`;
    if (appealExisting) appealExisting.outerHTML = html;
    else sideNav.insertAdjacentHTML("afterbegin", html);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  bindSearch();
  ensureAccountActions();
  bindLogout();
  enhanceCabinetNavigation();
  const list = document.getElementById("acts-list");
  if (list) {
    const q = new URLSearchParams(location.search).get("q") || "";
    const input = document.querySelector("#site-search input[name='q']");
    if (input && q) input.value = q;
    renderActList("acts-list", q);
  }
});
