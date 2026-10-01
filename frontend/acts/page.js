/* Скрипт сторінки «acts». Запускається, коли дані порталу завантажені й сторінка готова. */
whenStateReady(async function () {
  const params = new URLSearchParams(location.search);
  const cur = params.get("type") || "all";
  const nav = document.getElementById("sec-nav");
  // Розділи з кількістю актів; порожні ховаємо, щоб меню не було довгим
  nav.innerHTML = `<nav class="side-links">${actSections().map((s) => {
    const n = docsBySection(s.key).length;
    if (!n && s.key !== "all" && s.key !== cur) return "";
    const p = new URLSearchParams(params);
    p.set("type", s.key);
    return `<a class="${s.key === cur ? "active" : ""}" href="?${p.toString()}"><span>${esc(s.label)}</span><span class="pill">${n}</span></a>`;
  }).join("")}</nav>`;
  const form = document.getElementById("sort-form");
  form.office.insertAdjacentHTML("beforeend", allOffices().map((o) => `<option value="${attr(o.id)}">${esc(o.name)}</option>`).join(""));
  form.sort.value = params.get("sort") || "date-desc";
  form.office.value = params.get("office") || "all";
  form.addEventListener("change", () => {
    const p = new URLSearchParams(location.search);
    p.set("sort", form.sort.value);
    p.set("office", form.office.value);
    location.search = p.toString();
  });
});
