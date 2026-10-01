/* Сховище порталу (5/5): Пошук і відображення списків.
   Файли assets/store/*.js підключаються саме в цьому порядку й разом утворюють спільні функції сторінок. */

/* ---------- Пошук ----------
   Шукаємо за назвою, номером, видом, органом, автором і повним текстом документа.
   Кілька слів — документ має містити всі; у результатах показуємо уривок тексту з виділеним збігом. */
function docSearchText(d) {
  return [d.title, d.number, d.type, d.body, d.author, d.text].map((x) => String(x || "")).join(" ").toLowerCase();
}
function searchWords(q) {
  return String(q || "").toLowerCase().split(/\s+/).filter(Boolean);
}
function docMatches(d, q) {
  const words = searchWords(q);
  if (!words.length) return true;
  const hay = docSearchText(d);
  return words.every((w) => hay.includes(w));
}
// Уривок тексту довкола першого збігу: текст екранований, збіги — у <mark>
function searchSnippet(d, q) {
  const words = searchWords(q);
  const text = String(d.text || "").replace(/\s+/g, " ");
  const lower = text.toLowerCase();
  const first = words.map((w) => lower.indexOf(w)).filter((i) => i >= 0).sort((a, b) => a - b)[0];
  if (first === undefined) return "";
  const from = Math.max(0, first - 70), to = Math.min(text.length, first + 130);
  let html = "", i = from;
  while (i < to) {
    // Найближчий збіг будь-якого слова, починаючи з позиції i
    let at = -1, len = 0;
    words.forEach((w) => { const p = lower.indexOf(w, i); if (p >= 0 && p < to && (at < 0 || p < at)) { at = p; len = w.length; } });
    if (at < 0) { html += esc(text.slice(i, to)); break; }
    html += esc(text.slice(i, at)) + "<mark>" + esc(text.slice(at, Math.min(at + len, to))) + "</mark>";
    i = at + len;
  }
  return (from ? "…" : "") + html + (to < text.length ? "…" : "");
}

function renderActList(targetId, query = "") {
  const root = document.getElementById(targetId);
  if (!root) return;
  const params = new URLSearchParams(location.search);
  const q = (query || params.get("q") || "").trim().toLowerCase();
  const section = params.get("type") || "all";
  const office = params.get("office") || "all";
  const sort = params.get("sort") || "date-desc";
  let items = docsBySection(section).filter((a) => docMatches(a, q));
  if (office !== "all") items = items.filter((a) => (a.office || "") === office);
  items.sort((a, b) => {
    if (sort === "date-asc") return String(a.publishedAt || a.date).localeCompare(String(b.publishedAt || b.date));
    if (sort === "title") return String(a.title).localeCompare(String(b.title), "uk");
    if (sort === "office") return String(officeName(a.office) + a.title).localeCompare(officeName(b.office) + b.title, "uk");
    if (sort === "type") return String(a.type + a.title).localeCompare(b.type + b.title, "uk");
    return String(b.publishedAt || b.date).localeCompare(String(a.publishedAt || a.date));
  });
  const counter = document.getElementById("acts-count");
  if (counter) counter.textContent = "Знайдено: " + items.length;
  if (!items.length) {
    root.innerHTML = "<p class='empty-note muted'>Документів за цими умовами не знайдено.</p>";
    return;
  }
  root.innerHTML = items.map((a) => `
    <article class="act-row">
      <div class="act-num">${esc(a.number)}<br>${esc(formatDocWhen(a))}</div>
      <div>
        <h3><a href="${attr(docHref(a))}">${esc(a.title)}</a></h3>
        <div class="act-meta">${esc(a.type)} · ${esc(officeName(a.office) !== "—" ? officeName(a.office) : (a.body || ""))}</div>
        ${q && searchSnippet(a, q) ? `<p class="search-snippet">${searchSnippet(a, q)}</p>` : ""}
      </div>
      <span class="badge ${attr(badgeClass(a.status))}">${esc(DOC_STATUSES[a.status] || a.status)}</span>
    </article>
  `).join("");
}

// Дані починають завантажуватися одразу, як підключено всі файли сховища
startState();
