function siteBase() {
  const el = document.querySelector('script[src*="assets/app.js"]');
  if (!el) return "./";
  return el.src.replace(/assets\/app\.js.*$/, "");
}

function pathTo(route) {
  return siteBase() + String(route).replace(/^\//, "");
}

/* Шлях поточної сторінки відносно кореня сайту: "", "acts/", "cabinet/inbox/"… */
function currentRoute() {
  const base = new URL(siteBase(), location.href).pathname;
  return location.pathname.replace(/index\.html$/, "").slice(base.length);
}

const SITE_ICONS = {
  home: "M4 11 12 4l8 7v9h-5v-6H9v6H4z",
  bell: "M6 16V11a6 6 0 1 1 12 0v5l2 2H4zM10 20a2 2 0 0 0 4 0",
  mail: "M3.5 6h17v12h-17zM4 7l8 6 8-6",
  building: "M4 20h16M6 20V9l6-4 6 4v11M10 20v-5h4v5M9 11h.01M15 11h.01",
  scales: "M12 4v16M7 20h10M5 7h14M5 7l-3 6a3 3 0 0 0 6 0zM19 7l-3 6a3 3 0 0 0 6 0z",
  folder: "M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2h8.5A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z",
  shield: "M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6z",
  pen: "M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4",
  book: "M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5zM5 19.5A1.5 1.5 0 0 0 6.5 21H19v-3",
  logout: "M14 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 16l-4-4 4-4M6 12h10",
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4.5 20c.8-3.6 3.8-5.6 7.5-5.6s6.7 2 7.5 5.6",
  menu: "M4 7h16M4 12h16M4 17h16",
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4",
  moon: "M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z",
  sun: "M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"
};

/* Тема сайту: світла або темна. Вибір зберігається в браузері; без вибору — як у системі.
   Атрибут на <html> ставить ще короткий скрипт у <head> кожної сторінки, щоб не було спалаху світлої теми. */
function siteTheme() {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}
function setSiteTheme(theme) {
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem("state_theme", theme); } catch (e) { /* приватний режим */ }
  const btn = document.getElementById("theme-toggle");
  if (btn) themeToggleSync(btn);
}
function themeToggleSync(btn) {
  const dark = siteTheme() === "dark";
  btn.innerHTML = siteIcon(dark ? "sun" : "moon");
  btn.title = dark ? "Світла тема" : "Темна тема";
  btn.setAttribute("aria-label", btn.title);
}
function siteIcon(name) {
  return `<svg class="ico" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${SITE_ICONS[name] || ""}"/></svg>`;
}
function siteEsc(v) {
  return String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function siteUser() {
  try { return typeof currentUser === "function" ? currentUser() : null; } catch (e) { return null; }
}
function attentionCount(user) {
  try { return typeof notificationsFor === "function" ? notificationsFor(user).filter((n) => n.attention).length : 0; } catch (e) { return 0; }
}
function canAdmin(user) {
  return typeof hasPermission === "function" && ["managePeople", "manageStructure", "manageRoutes", "approveProfiles", "manageCongress"].some((p) => hasPermission(user, p));
}

function ensureSiteSearch() {
  if (document.getElementById("site-search")) return;
  const inner = document.querySelector(".header-inner");
  if (!inner) return;
  inner.insertAdjacentHTML("beforeend", `
    <form class="search" id="site-search" role="search">
      <input name="q" type="search" placeholder="Пошук за назвою або номером акта" aria-label="Пошук актів" />
      <button type="submit">Знайти</button>
    </form>`);
}

/* Кнопка входу / кабінету в шапці */
function ensureAccountActions() {
  const old = document.getElementById("account-actions");
  if (old) old.remove();
  const inner = document.querySelector(".header-inner");
  if (!inner) return;
  ensureSiteSearch();
  const user = siteUser();
  let html;
  if (!user) {
    html = `
      <a class="account-main" href="${pathTo("cabinet/portal/")}">${siteIcon("user")}<span>Увійти</span></a>
      <a class="account-sub" href="${pathTo("register/")}">Реєстрація</a>`;
  } else {
    const active = typeof isCabinetUser === "function" && isCabinetUser(user);
    const n = active ? attentionCount(user) : 0;
    const initial = siteEsc(String(user.username || user.login || "?").trim().charAt(0).toUpperCase());
    html = `
      <a class="account-main is-user" href="${pathTo(active ? "cabinet/" : "cabinet/pending/")}" title="${siteEsc(user.username)}">
        ${user.photo ? `<img class="account-avatar" src="${siteEsc(user.photo)}" alt="">` : `<span class="account-avatar">${initial}</span>`}
        <span class="account-name">${active ? "Кабінет" : "Очікує доступ"}</span>
        ${n ? `<span class="nav-badge" title="Потребує уваги">${n}</span>` : ""}
      </a>
      <a class="account-sub" href="#" data-logout>Вийти</a>`;
  }
  inner.insertAdjacentHTML("beforeend", `<div class="account-actions" id="account-actions"><button type="button" class="theme-toggle" id="theme-toggle"></button>${html}</div>`);
  themeToggleSync(document.getElementById("theme-toggle"));
}

/* Головне меню: однакове на всіх сторінках, з підсвіткою розділу */
function ensureHeader() {
  if (!document.querySelector(".header")) {
    document.body.insertAdjacentHTML("afterbegin", `
      <header class="header"><div class="header-inner">
        <a class="brand" href="${pathTo("")}"><img class="crest crest-logo" src="${pathTo("assets/logos/u-original.svg")}" alt="STATE"><div><h1>STATE | UKRAINE GTA 5 RP</h1><p>Законодавство і органи влади штату</p></div></a>
      </div></header>`);
  }
  if (!document.querySelector(".nav:not(.wd-nav)")) {
    document.querySelector(".header").insertAdjacentHTML("afterend", `<nav class="nav"><div class="nav-inner"></div></nav>`);
  }
}

function buildMainNav() {
  ensureHeader();
  const inner = document.querySelector(".nav:not(.wd-nav) .nav-inner");
  if (!inner) return;
  const route = currentRoute();
  const user = siteUser();
  const links = [
    { href: "", label: "Головна", on: route === "" },
    { href: "acts/", label: "Законодавча база", on: route.indexOf("acts/") === 0 },
    { href: "structure/", label: "Органи влади", on: route.indexOf("structure/") === 0 },
    { href: "cabinet/portal/", label: "Послуги громадянам", on: route.indexOf("cabinet/portal/") === 0 || route.indexOf("register/") === 0 }
  ];
  if (user && typeof isCabinetUser === "function" && isCabinetUser(user)) {
    links.push({ href: "cabinet/", label: "Кабінет", on: route.indexOf("cabinet/") === 0 && route.indexOf("cabinet/portal/") !== 0 });
  }
  inner.innerHTML = `
    <button type="button" class="nav-toggle" aria-label="Меню" aria-expanded="false">${siteIcon("menu")}<span>Меню</span></button>
    <div class="nav-links">${links.map((l) => `<a href="${pathTo(l.href)}"${l.on ? ' class="active" aria-current="page"' : ""}>${l.label}</a>`).join("")}</div>`;
  const toggle = inner.querySelector(".nav-toggle");
  toggle.addEventListener("click", () => {
    const open = inner.classList.toggle("open");
    toggle.setAttribute("aria-expanded", String(open));
  });
}

/* Бічне меню кабінету: один список для всіх сторінок, пункти — за роллю й правами */
function buildCabinetNav() {
  const side = document.querySelector(".side-nav");
  if (!side) return;
  const user = siteUser();
  if (!user) return;
  const route = currentRoute();
  // Лише в кабінеті: на інших сторінках .side-nav — власне меню розділів (напр. законодавча база)
  if (route.indexOf("cabinet/") !== 0) return;
  const staff = typeof isStaff === "function" && isStaff(user);
  const notes = typeof notificationsFor === "function" ? (() => { try { return notificationsFor(user); } catch (e) { return []; } })() : [];
  const inboxCount = notes.filter((n) => n.attention && !n.appeal).length;
  const appealCount = notes.filter((n) => n.attention && n.appeal).length;
  const items = [
    { href: "cabinet/", icon: "home", label: "Огляд", on: route === "cabinet/" },
    { href: "cabinet/inbox/", icon: "bell", label: "Повідомлення", count: inboxCount, on: route === "cabinet/inbox/" },
    { href: "cabinet/appeals/", icon: "mail", label: staff ? "Звернення" : "Мої звернення", count: appealCount, on: route === "cabinet/appeals/" },
    // Робочий простір свого кабінету (повні адміністратори — усі кабінети)
    staff && typeof canEnterOffice === "function"
      ? { href: typeof officeRoute === "function" ? officeRoute(userOffice(user)) : "office/", icon: "building", label: "Мій кабінет", on: route.indexOf("office/") === 0 } : null,
    // Суд: судова влада й адміністратори — усі справи; інші — якщо мають власні справи
    (typeof canManageCases === "function" && canManageCases(user)) || (typeof casesForUser === "function" && casesForUser(user).length)
      ? { href: "cabinet/court/", icon: "scales", label: "Суд", on: route === "cabinet/court/" } : null,
    staff ? { href: "cabinet/all/", icon: "folder", label: "Реєстр документів", on: route === "cabinet/all/" || route === "cabinet/docs/" } : null,
    staff && canAdmin(user) ? { href: "cabinet/admin/", icon: "shield", label: "Адмін-панель", on: route === "cabinet/admin/" } : null
  ].filter(Boolean);
  const canCreate = staff && typeof hasPermission === "function" && ((user.roles || [])[0] === "governor" || hasPermission(user, "createDocs"));
  const initial = siteEsc(String(user.username || "?").charAt(0).toUpperCase());
  const role = typeof isCitizen === "function" && isCitizen(user) ? "Громадянин штату" : (user.post || (typeof officeTitle === "function" ? officeTitle(user) : ""));
  side.innerHTML = `
    <div class="side-me">
      ${user.photo ? `<img src="${siteEsc(user.photo)}" alt="">` : `<span class="side-avatar">${initial}</span>`}
      <div><b>${siteEsc(user.username)}</b><small>${siteEsc(role)}</small></div>
    </div>
    ${canCreate ? `<a class="create-doc-link${route === "cabinet/create/" ? " active" : ""}" href="${pathTo("cabinet/create/")}">${siteIcon("pen")}<span>Створити документ</span></a>` : ""}
    <nav class="side-links" aria-label="Кабінет">
      ${items.map((it) => `<a href="${pathTo(it.href)}"${it.on ? ' class="active" aria-current="page"' : ""}>${siteIcon(it.icon)}<span>${it.label}</span>${it.count ? `<span class="nav-badge">${it.count}</span>` : ""}</a>`).join("")}
    </nav>`;
}
// Сторінки викликають це після дій (погодження тощо), щоб оновити лічильники
function enhanceCabinetNavigation() {
  buildCabinetNav();
  ensureAccountActions();
}

function ensureFooter() {
  const year = new Date().getFullYear();
  const html = `
    <div class="footer-inner">
      <div class="footer-brand">
        <b>STATE | UKRAINE GTA 5 RP</b>
        <span>Офіційний ігровий портал Уряду штату Сан-Андреас</span>
      </div>
      <nav class="footer-links" aria-label="Нижнє меню">
        <a href="${pathTo("acts/")}">Законодавча база</a>
        <a href="${pathTo("structure/")}">Органи влади</a>
        <a href="${pathTo("cabinet/portal/")}">Електронний кабінет</a>
      </nav>
      <span class="footer-note">© ${year} · Не є державним ресурсом України</span>
    </div>`;
  let f = document.querySelector("footer.footer");
  if (!f) {
    f = document.createElement("footer");
    f.className = "footer";
    document.body.insertBefore(f, document.querySelector("body > script"));
  }
  f.innerHTML = html;
}

function bindSearch() {
  ensureSiteSearch();
  const form = document.getElementById("site-search");
  if (!form) return;
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const q = new FormData(form).get("q") || "";
    const route = currentRoute();
    if (route === "cabinet/all/" && typeof window.drawRegistry === "function") {
      const registrySearch = document.querySelector("#registry-filter input[name='q']");
      const registryStatus = document.querySelector("#registry-filter select[name='status']");
      const registryType = document.querySelector("#registry-filter select[name='type']");
      if (registrySearch) registrySearch.value = String(q);
      if (registryStatus) registryStatus.value = "all";
      if (registryType) registryType.value = "all";
      window.drawRegistry();
      return;
    }
    if (route.indexOf("cabinet/") === 0 && route !== "cabinet/portal/") {
      location.href = pathTo("cabinet/all/") + `?q=${encodeURIComponent(String(q))}`;
      return;
    }
    if (route === "acts/" && typeof renderActList === "function") {
      const url = new URL(location.href);
      if (q) url.searchParams.set("q", q); else url.searchParams.delete("q");
      history.replaceState(null, "", url);
      renderActList("acts-list", String(q));
    } else {
      location.href = pathTo("acts/") + `?q=${encodeURIComponent(String(q))}`;
    }
  });
}

function bindLogout() {
  document.addEventListener("click", (e) => {
    if (e.target.closest("#theme-toggle")) { setSiteTheme(siteTheme() === "dark" ? "light" : "dark"); return; }
    const el = e.target.closest("#logout, [data-logout]");
    if (!el) return;
    e.preventDefault();
    if (typeof logout === "function") logout();
    location.href = pathTo("");
  });
}

// Адмін скинув пароль: доки людина не змінить тимчасовий, на кожній сторінці — нагадування з посиланням
function showMustChangeBanner() {
  let flag = "";
  try { flag = localStorage.getItem("state_must_change"); } catch (e) { /* приватний режим */ }
  if (flag !== "1" || !siteUser() || document.getElementById("must-change-banner")) return;
  document.body.insertAdjacentHTML("afterbegin", `<div id="must-change-banner" role="alert" style="background:#8a6300;color:#fff;padding:9px 16px;text-align:center;font-size:14px">
    Вам видано тимчасовий пароль. <a href="${pathTo("cabinet/?changePassword=1")}" style="color:#fff;font-weight:700;text-decoration:underline">Змініть його зараз</a> — інакше він може потрапити до сторонніх.</div>`);
}

// Шапка й меню залежать від того, хто увійшов, тож будуються, коли дані порталу завантажені
document.addEventListener("DOMContentLoaded", () => whenStateReady(() => {
  bindLogout();
  showMustChangeBanner();
  // Редактор документів має власний інтерфейс
  // Редактор і сайти кабінетів (office/…) мають власний інтерфейс
  if (document.body.classList.contains("wd-body") || document.body.classList.contains("ws-app")) return;
  ensureHeader();
  bindSearch();
  ensureAccountActions();
  buildMainNav();
  buildCabinetNav();
  ensureFooter();
  const list = document.getElementById("acts-list");
  if (list) {
    const q = new URLSearchParams(location.search).get("q") || "";
    const input = document.querySelector("#site-search input[name='q']");
    if (input && q) input.value = q;
    renderActList("acts-list", q);
  }
}));
