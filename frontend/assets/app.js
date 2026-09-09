function siteBase() {
  const el = document.querySelector('script[src*="assets/app.js"]');
  if (!el) return "./";
  return el.src.replace(/assets\/app\.js.*$/, "");
}

function pathTo(route) {
  return siteBase() + String(route).replace(/^\//, "");
}

const ACTS = [
  {
    id: "const-sa-01",
    type: "Конституція штату",
    number: "КС-01",
    date: "2026-09-08",
    status: "ok",
    statusLabel: "Чинний",
    body: "Уряд штату Сан-Андреас",
    title: "Конституція штату Сан-Андреас",
    href: "acts/const-sa-01/"
  },
  {
    id: "law-gov-01",
    type: "Закон",
    number: "З-17",
    date: "2026-09-09",
    status: "ok",
    statusLabel: "Чинний",
    body: "Уряд штату Сан-Андреас",
    title: "Закон про діяльність Уряду",
    href: "acts/law-gov-01/"
  },
  {
    id: "decree-warrant-01",
    type: "Указ",
    number: "У-04",
    date: "2026-09-09",
    status: "draft",
    statusLabel: "Проєкт",
    body: "Апарат Уряду",
    title: "Порядок видачі ордерів",
    href: "acts/decree-warrant-01/"
  }
];

function badgeClass(status) {
  return status === "ok" ? "ok" : status === "draft" ? "draft" : "dead";
}

function renderActList(targetId, query = "") {
  const root = document.getElementById(targetId);
  if (!root) return;
  const q = query.trim().toLowerCase();
  const items = ACTS.filter((a) =>
    !q || `${a.title} ${a.number} ${a.type}`.toLowerCase().includes(q)
  );
  if (!items.length) {
    root.innerHTML = "<p class='lead'>Документів не знайдено.</p>";
    return;
  }
  root.innerHTML = items.map((a) => `
    <article class="act-row">
      <div class="act-num">${a.number}<br>${a.date}</div>
      <div>
        <h3><a href="${pathTo(a.href)}">${a.title}</a></h3>
        <div class="act-meta">${a.type} · ${a.body}</div>
      </div>
      <span class="badge ${badgeClass(a.status)}">${a.statusLabel}</span>
    </article>
  `).join("");
}

function bindSearch() {
  const form = document.getElementById("site-search");
  if (!form) return;
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const q = new FormData(form).get("q") || "";
    const onActs = /\/acts\/?$/.test(location.pathname.replace(/index\.html$/, ""));
    if (onActs) {
      renderActList("acts-list", String(q));
    } else {
      location.href = pathTo("acts/") + `?q=${encodeURIComponent(String(q))}`;
    }
  });
}

function currentUser() {
  try {
    return JSON.parse(localStorage.getItem("state_session") || "null");
  } catch {
    return null;
  }
}

function requireAuth(neededRole) {
  const user = currentUser();
  if (!user) {
    location.href = pathTo("login/");
    return null;
  }
  if (neededRole && !(user.roles || []).includes(neededRole) && !(user.roles || []).includes("admin_stub")) {
    location.href = pathTo("denied/");
    return null;
  }
  return user;
}

document.addEventListener("DOMContentLoaded", () => {
  bindSearch();
  const list = document.getElementById("acts-list");
  if (list) {
    const q = new URLSearchParams(location.search).get("q") || "";
    const input = document.querySelector("#site-search input[name='q']");
    if (input && q) input.value = q;
    renderActList("acts-list", q);
  }
});
