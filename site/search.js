/* Пошук за SID / ім'ям усюди, де вибирають співробітника чи переглядають довгі списки.
   Підключається автоматично: стежить за сторінкою й додає поле пошуку
   — до випадних списків співробітників (варіанти виду «Ім'я · Звання · Відділ · 1234»);
   — до таблиць (.t), журналів документів (.docs) і наказів (.ns-list), якщо в них багато записів. */
(() => {
const norm = (s) => String(s || "").toLowerCase().replace(/[’'`ʼ]/g, "'").replace(/\s+/g, " ").trim();
const hit = (text, q) => q.split(" ").every((w) => text.includes(w));  // кілька слів — усі мають бути (напр. «орв 63»)
const staffSelect = (s) => s.options.length > 6 && [...s.options].some((o) => /·\s*\d{1,6}\s*$/.test(o.textContent));

function enhanceSelect(sel) {
  sel.dataset.sq = "1";
  const box = document.createElement("div");
  box.className = "sq-box";
  box.innerHTML = '<input class="i sq-in" type="search" placeholder="🔍 Пошук: SID, ім\'я, звання або відділ" autocomplete="off"><span class="sq-n"></span>';
  sel.before(box);
  const inp = box.firstElementChild, n = box.lastElementChild;
  // повний перелік пунктів; фільтр лишає в списку лише збіги (Safari на iPhone/iPad ігнорує option.hidden — тому прибираємо, а не ховаємо)
  const all = [...sel.options];
  let chosen = sel.value;  // вибір людини: не губиться, поки пошук тимчасово прибирає пункти
  sel.addEventListener("change", () => { if (!inp.value) chosen = sel.value; });
  const filter = () => {
    const q = norm(inp.value);
    let shown = 0, first = null;
    const keep = all.filter((o) => !q || !o.value || hit(norm(o.textContent), q));
    if (keep.length !== sel.options.length || keep.some((o, i) => sel.options[i] !== o)) {
      sel.replaceChildren(...keep);
    }
    sel.value = keep.some((o) => o.value === chosen) ? chosen : "";
    keep.forEach((o) => { if (o.value) { shown++; first = first || o; } });
    n.textContent = q ? (shown ? `знайдено: ${shown}` : "нікого не знайдено") : "";
    sel.size = q && shown ? Math.min(8, shown + 1) : 0;  // поки шукаємо — список розкритий під полем
    sel.classList.toggle("sq-open", !!q && shown > 0);
    return first;
  };
  const pick = (o) => {
    if (!o) return;
    chosen = o.value;
    inp.value = "";
    filter();
    sel.dispatchEvent(new Event("input", { bubbles: true }));
    sel.dispatchEvent(new Event("change", { bubbles: true }));
  };
  inp.addEventListener("input", filter);
  inp.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); pick(filter()); }
    if (e.key === "ArrowDown" && sel.size) { e.preventDefault(); sel.focus(); }
    if (e.key === "Escape") { inp.value = ""; filter(); }
  });
  // вибір мишею чи клавішами з розкритого списку
  sel.addEventListener("click", () => { if (sel.size && sel.selectedOptions[0] && sel.selectedOptions[0].value) pick(sel.selectedOptions[0]); });
  sel.addEventListener("keydown", (e) => { if (e.key === "Enter" && sel.size) { e.preventDefault(); pick(sel.selectedOptions[0]); } });
}

function enhanceList(list, rowsOf, what) {
  list.dataset.sq = "1";
  const box = document.createElement("div");
  box.className = "sq-box sq-list";
  box.innerHTML = `<input class="i sq-in" type="search" placeholder="🔍 Пошук у ${what}: SID, ім'я, номер документа…" autocomplete="off"><span class="sq-n"></span>`;
  (list.closest(".tbl-wrap") || list).before(box);
  const inp = box.firstElementChild, n = box.lastElementChild;
  inp.addEventListener("input", () => {
    const q = norm(inp.value), rows = rowsOf();
    let shown = 0;
    rows.forEach((r) => { const ok = !q || hit(norm(r.textContent), q); r.hidden = !ok; shown += ok; });
    n.textContent = q ? `знайдено: ${shown} з ${rows.length}` : "";
  });
}

function scan(root) {
  root.querySelectorAll("select:not([data-sq])").forEach((s) => { if (staffSelect(s)) enhanceSelect(s); });
  root.querySelectorAll("table.t:not([data-sq])").forEach((t) => {
    if (t.tBodies[0] && t.tBodies[0].rows.length > 6) enhanceList(t, () => [...t.tBodies[0].rows], "таблиці");
  });
  root.querySelectorAll(".docs:not([data-sq]), .ns-list:not([data-sq])").forEach((l) => {
    const rows = () => [...l.children].filter((c) => c.tagName === "ARTICLE");
    if (rows().length > 5) enhanceList(l, rows, "списку");
  });
}

let pending = false;
new MutationObserver(() => {
  if (pending) return;
  pending = true;
  requestAnimationFrame(() => { pending = false; const v = document.getElementById("view"); if (v) scan(v); });
}).observe(document.body, { childList: true, subtree: true });
})();
