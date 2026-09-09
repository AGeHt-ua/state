function siteBase() {
  const el = document.querySelector('script[src*="assets/app.js"]');
  if (!el) return "./";
  return el.src.replace(/assets\/app\.js.*$/, "");
}

function pathTo(route) {
  return siteBase() + String(route).replace(/^\//, "");
}

function bindSearch() {
  const form = document.getElementById("site-search");
  if (!form) return;
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const q = new FormData(form).get("q") || "";
    const onActs = /\/acts\/?$/.test(location.pathname.replace(/index\.html$/, ""));
    if (onActs && typeof renderActList === "function") {
      renderActList("acts-list", String(q));
    } else {
      location.href = pathTo("acts/") + `?q=${encodeURIComponent(String(q))}`;
    }
  });
}

function bindLogout() {
  const el = document.getElementById("logout");
  if (!el) return;
  el.addEventListener("click", (e) => {
    e.preventDefault();
    logout();
    location.href = pathTo("");
  });
}

document.addEventListener("DOMContentLoaded", () => {
  bindSearch();
  bindLogout();
  const list = document.getElementById("acts-list");
  if (list) {
    const q = new URLSearchParams(location.search).get("q") || "";
    const input = document.querySelector("#site-search input[name='q']");
    if (input && q) input.value = q;
    renderActList("acts-list", q);
  }
});
