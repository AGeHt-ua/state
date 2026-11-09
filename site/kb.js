/* База даних: законодавство NG (пошук, фільтри, витяги), зміни законодавства, бібліотека, онлайн-іспити. Підключається після app.js. */
(() => {
const S = window.SOVA;
const { esc, call, toast, fmtDT } = S;
let PREF = {};
try { PREF = JSON.parse(localStorage.getItem("sova-kb") || "{}"); } catch (e) {}
const savePref = () => { try { localStorage.setItem("sova-kb", JSON.stringify({ fs: st.fs, dark: st.dark })); } catch (e) {} };
const st = { fs: PREF.fs || 16, dark: !!PREF.dark, side: false, wide: false, fold: true, find: "", tab: "law", doc: null, q: "", sbu: false, extract: false, sel: new Set(), lib: null, libEdit: null, exam: null, take: null, result: null, examEdit: null, review: null, ans: {} };
const ME = () => S.ME();
const mark = (text, q) => q ? esc(text).replace(new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), (m) => `<mark>${m}</mark>`) : esc(text);

/* ---------- законодавство ---------- */
let INDEX = null;
async function lawView() {
  INDEX = await call("/api/kb");
  const docs = INDEX.docs.filter((d) => !st.sbu || d.sbu);
  const groups = {};
  docs.forEach((d) => { const g = d.faction_abbr ? `Фракції · ${d.faction_abbr}` : d.grp_title || (d.section === "rules" ? "Правила проєкту" : "Інше"); (groups[g] = groups[g] || []).push(d); });
  const searchBox = `<form data-f="kbsearch" class="kb-search"><input class="i" id="kb-q" placeholder="Пошук по всій базі: стаття, слово, фраза…" value="${esc(st.q)}"><button class="btn gold" type="submit">Знайти</button></form>
    <label class="kb-sbu"><input type="checkbox" data-kbsbu ${st.sbu ? "checked" : ""}> Лише документи для СБУ</label>`;
  const side = `<aside class="kb-side">${searchBox}
    <div class="kb-meta">${INDEX.docs.length} документів · звірено ${INDEX.checked ? fmtDT(INDEX.checked) : "—"}</div>
    ${Object.entries(groups).map(([g, list]) => `<details class="kb-grp" ${list.some((d) => d.slug === st.doc) || st.sbu ? "open" : ""}><summary>${esc(g)} <span>${list.length}</span></summary>
      ${list.map((d) => `<button class="kb-doc ${d.slug === st.doc ? "on" : ""} ${d.sbu ? "sbu" : ""}" data-a="kbopen" data-v="${esc(d.slug)}">${esc(d.title)}</button>`).join("")}</details>`).join("")}
  </aside>`;

  // ---- відкритий документ: панель, зміст-гармошка, розділи-теки
  if (st.doc) {
    const d = await call(`/api/kb/doc/${encodeURIComponent(st.doc)}`);
    S.cache.kbdoc = d;
    const toc = [];
    d.toc.forEach((t) => { if (t.level === 1 || !toc.length) toc.push({ ...t, kids: [] }); else toc[toc.length - 1].kids.push(t); });
    const chk = (t) => st.extract ? `<input type="checkbox" data-kbsel="${esc(t.id)}" ${st.sel.has(t.id) ? "checked" : ""}>` : "";
    return `<div class="kb-reader ${st.wide ? "wide" : ""} ${st.dark ? "dark" : ""}" style="--fs:${st.fs}px">
      ${st.side ? `<div class="kb-drawer">${side}</div>` : ""}
      <div class="kb-tools">
        <button class="btn sm" data-a="kbside">☰ Документи</button>
        <div class="kb-tools-t"><b>${esc(d.title)}</b><span>${esc(d.faction_abbr || d.grp_title || "")}${d.sbu ? " · для СБУ" : ""} · редакція від ${fmtDT(d.updated)}</span></div>
        <div class="kb-find"><input class="i" id="kb-find" placeholder="Пошук у документі" value="${esc(st.find || "")}"><span id="kb-find-n"></span>
          <button class="btn sm" data-a="kbfind" data-d="-1" title="Попередній">↑</button><button class="btn sm" data-a="kbfind" data-d="1" title="Наступний">↓</button></div>
        <div class="kb-btns">
          <button class="btn sm" data-a="kbfs" data-d="-1" title="Менший шрифт">A−</button><button class="btn sm" data-a="kbfs" data-d="1" title="Більший шрифт">A+</button>
          <button class="btn sm" data-a="kbtheme" title="Папір / темна тема">${st.dark ? "☀" : "☾"}</button>
          <button class="btn sm" data-a="kbfold" data-v="1" title="Розгорнути всі розділи">⇲ Усі</button><button class="btn sm" data-a="kbfold" data-v="0" title="Згорнути всі розділи">⇱ Згорнути</button>
          <button class="btn sm" data-a="kbwide" title="Режим читання">${st.wide ? "◫ Зміст" : "▭ Читання"}</button>
          <button class="btn sm" data-a="kbprint" title="Весь документ у PDF (через друк)">⬇ PDF</button><button class="btn sm ${st.extract ? "gold" : ""}" data-a="kbext">${st.extract ? "✕ Витяг" : "✂ Витяг"}</button>
          ${st.extract ? `<button class="btn sm gold" data-a="kbextmake" ${st.sel.size ? "" : "disabled"}>Сформувати (${st.sel.size})</button>` : ""}
        </div>
      </div>
      <div class="kb-doc-wrap">
        <nav class="kb-toc"><div class="kb-toc-h">Зміст документа</div>
          ${toc.map((s) => s.kids.length ? `<details ${st.extract ? "open" : ""}><summary>${chk(s)}<a href="#${esc(s.id)}" data-kbgo="${esc(s.id)}">${esc(s.title)}</a><i>${s.kids.length}</i></summary>
            ${s.kids.map((k) => `<label>${chk(k)}<a href="#${esc(k.id)}" data-kbgo="${esc(k.id)}">${esc(k.title)}</a></label>`).join("")}</details>`
            : `<label class="lv1">${chk(s)}<a href="#${esc(s.id)}" data-kbgo="${esc(s.id)}">${esc(s.title)}</a></label>`).join("") || '<div class="muted small">Документ без поділу на розділи.</div>'}
        </nav>
        <article class="kb-paper2"><header class="kb-ph"><img src="sbu-logo.webp" alt="" width="56" height="56"><div><div class="kb-ph-a">Законодавча база штату NG</div><div class="kb-ph-b">ЄІС «Сова» · Служба безпеки штату NG</div></div><div class="kb-ph-grif">ОФІЦІЙНИЙ ТЕКСТ</div></header>
          <h2 class="kb-title">${esc(d.title)}</h2>
          <div class="law-body" id="law-body">${sectionize(d.html)}</div>
        </article>
      </div></div>`;
  }

  // ---- результати пошуку
  if (st.q) {
    const res = await call(`/api/kb/search?q=${encodeURIComponent(st.q)}${st.sbu ? "&sbu=1" : ""}`);
    return `<div class="kb-law">${side}<div class="kb-main"><div class="kb-res"><div class="kb-res-h"><div class="eyebrow">Результати пошуку «${esc(st.q)}»</div><b>${res.length} документів</b>
      <button class="btn sm" data-a="kbclear">✕ Очистити пошук</button></div>${res.map((r) => `<article class="kb-hit" data-a="kbopen" data-v="${esc(r.slug)}" data-find="${esc(st.q)}">
      <div class="kb-hit-h"><b>${mark(r.title, st.q)}</b><span>${esc(r.faction || r.grp || "")} · збігів: ${r.hits}</span></div>
      ${r.snippets.map((s) => `<p>${mark(s, st.q)}</p>`).join("")}</article>`).join("") || '<div class="empty">Нічого не знайдено.</div>'}</div></div></div>`;
  }

  // ---- головна бази: архів штату — Конституція й кодекси книгами на полиці, закони томами, статути й правила теками
  const kind = (d) => d.faction_abbr ? "fac" : ({ "Конституція": "const", "Кодекси": "code", "Закони": "law" })[d.grp_title] || "rules";
  const short = (t) => t.replace(/\s+штату NG\s*$/i, "").replace(/^\(\(\s*|\s*\)\)$/g, "");
  const book = (d, k) => { const t = short(d.title); const law = k === "law" && /^Закон про /i.test(t);
    return `<button class="law-book k-${k}" data-a="kbopen" data-v="${esc(d.slug)}"><span class="lb-spine"></span>${d.sbu ? '<span class="law-rib">СБУ</span>' : ""}
      <img src="ng-logo.png" alt="" width="54" height="27"><span class="law-kind">${k === "const" ? "Основний закон" : k === "code" ? "Кодекс" : "Закон"}</span>
      <b>${esc(law ? t.replace(/^Закон про /i, "про ") : t)}</b><span class="lb-foot">Штат NG</span></button>`; };
  const folder = (d) => `<button class="law-folder ${d.sbu ? "sbu" : ""}" data-a="kbopen" data-v="${esc(d.slug)}"><span class="lf-tab">${esc(d.faction_abbr || "NG")}</span>
    ${d.sbu ? '<span class="lf-stamp">СБУ</span>' : ""}<span class="lf-org">${d.faction_abbr ? "Документ фракції" : "Правила проєкту NG"}</span><b>${esc(short(d.title))}</b></button>`;
  const CATS = [["sbu", "Документи СБУ", "🛡"], ["const", "Конституція", "📜"], ["code", "Кодекси", "📕"], ["law", "Закони", "📚"], ["fac", "Статути фракцій", "🗂"], ["rules", "Правила проєкту", "📁"]];
  const by = {};
  INDEX.docs.forEach((d) => { const k = kind(d); (by[k] = by[k] || []).push(d); if (d.sbu) (by.sbu = by.sbu || []).push(d); });
  const shown = CATS.filter(([k]) => (!st.lawCat || st.lawCat === k) && (!st.sbu || k === "sbu"));
  const body = (k, list) => {
    if (k === "fac") {  // статути: окремий стос тек на кожну фракцію
      const f = {};
      list.forEach((d) => (f[d.faction_abbr] = f[d.faction_abbr] || []).push(d));
      return Object.entries(f).map(([a, l]) => `<div class="law-fac"><div class="law-fac-h">${esc(a)} <i>${l.length}</i></div><div class="lib-row">${l.map(folder).join("")}</div></div>`).join("");
    }
    if (k === "sbu") {  // закони про СБУ — томами на полиці, внутрішні документи — теками
      const books = list.filter((d) => ["const", "code", "law"].includes(kind(d))), docs = list.filter((d) => !books.includes(d));
      return `${books.length ? `<div class="lib-row shelf law">${books.map((d) => book(d, kind(d))).join("")}</div>` : ""}<div class="lib-row" style="margin-top:22px">${docs.map(folder).join("")}</div>`;
    }
    return k === "rules" ? `<div class="lib-row">${list.map(folder).join("")}</div>` : `<div class="lib-row shelf law">${list.map((d) => book(d, k)).join("")}</div>`;
  };
  return `<div class="lib-arch law-arch">
    <div class="law-top"><img src="ng-logo.png" alt="NG" width="120" height="59"><div><div class="eyebrow">Державний архів · Законодавча база</div><b>Штат NG</b>
      <span class="muted small">${INDEX.docs.length} документів · звірено ${INDEX.checked ? fmtDT(INDEX.checked) : "—"}</span></div>
      <div class="law-top-s">${searchBox}</div></div>
    <div class="lib-pills"><button class="${st.lawCat ? "" : "on"}" data-a="lawcat" data-v="">Усе <i>${INDEX.docs.length}</i></button>
      ${CATS.map(([k, v, ic]) => `<button class="${st.lawCat === k ? "on" : ""}" data-a="lawcat" data-v="${k}">${ic} ${esc(v)} <i>${(by[k] || []).length}</i></button>`).join("")}</div>
    ${shown.map(([k, v, ic]) => `<section class="lib-sec"><div class="kb-sec-h"><span>${ic} ${esc(v)}</span><i></i></div>${(by[k] || []).length ? body(k, by[k]) : '<div class="lib-empty">Розділ порожній.</div>'}</section>`).join("")}
    <p class="muted small" style="margin-top:6px">Джерело — офіційна база проєкту NG. Повнотекстовий пошук шукає по змісту всіх документів.</p></div>`;
}

// Розбиває документ на розділи-«теки»: кожен заголовок розділу (h2) з наступним текстом — окремий <details>
function sectionize(html) {
  const box = document.createElement("div");
  box.innerHTML = html;
  const out = document.createElement("div");
  let cur = null;
  [...box.childNodes].forEach((n) => {
    if (n.nodeType === 1 && (n.tagName === "H2" || n.classList.contains("kb-sec"))) {
      if (cur && cur.children.length === 1) {  // «Розділ» одразу за ним «Глава» — глава стає підзаголовком того самого розділу
        const sub = document.createElement("div");
        sub.className = "kb-sub";
        sub.id = n.id || "";
        sub.innerHTML = n.innerHTML;
        cur.append(sub);
        return;
      }
      cur = document.createElement("details");
      cur.className = "kb-part";
      cur.open = st.fold !== false;
      const sum = document.createElement("summary");
      sum.id = n.id || "";
      sum.innerHTML = n.innerHTML;
      cur.append(sum);
      out.append(cur);
      return;
    }
    if (n.nodeType === 1 && n.classList.contains("kb-art")) n.classList.add("kb-art-h");
    (cur || out).append(n);
  });
  return out.innerHTML;
}

function buildExtract() {
  const d = S.cache.kbdoc, box = document.createElement("div");
  box.innerHTML = d.html;
  const ids = d.toc.map((t) => t.id);
  const parts = [];
  for (const id of ids) {
    if (!st.sel.has(id)) continue;
    const el = box.querySelector(`[id="${CSS.escape(id)}"]`);
    if (!el) continue;
    const next = ids[ids.indexOf(id) + 1];
    let n = el, html = "";
    while (n && !(n !== el && next && n.id === next)) { html += n.outerHTML || ""; n = n.nextElementSibling; }
    parts.push(html);
  }
  return `<div class="kd ext-doc"><div class="kd-grif g-dsk">ВИТЯГ</div>
    <header class="kd-head"><img src="sbu-logo.webp" alt="" width="64" height="64"><div><div class="kd-agency">Служба безпеки штату NG</div><div class="kd-dept">ЄІС «Сова» · база даних</div></div>
      <div class="kd-no"><span>сформовано</span><b>${new Date().toLocaleDateString("uk-UA")}</b></div></header>
    <div class="kd-title"><span>Витяг з документа</span><h2 style="font-size:22px">${esc(d.title)}</h2><div>редакція від ${fmtDT(d.updated)}</div></div>
    <div class="law-body">${parts.join("")}</div>
    <div class="blank-sign" style="margin-top:26px"><span>Витяг сформував: ${esc(ME().me.rankName)} ${esc(ME().me.name)}</span><span class="kf-sign">${esc(ME().me.name)}</span></div>
    <div class="ext-stamp">ЗГІДНО З ОРИГІНАЛОМ</div></div>`;
}

let HITS = [], HI = -1;
function markIn(q) {
  const body = document.getElementById("law-body");
  if (!body) return;
  body.querySelectorAll("mark.hit").forEach((m) => m.replaceWith(document.createTextNode(m.textContent)));
  body.normalize();
  HITS = []; HI = -1;
  if (q.length < 2) { const n = document.getElementById("kb-find-n"); if (n) n.textContent = ""; return; }
  const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
  const walk = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walk.nextNode()) if (re.test(walk.currentNode.nodeValue)) nodes.push(walk.currentNode);
  nodes.forEach((t) => {
    const frag = document.createDocumentFragment();
    let last = 0;
    t.nodeValue.replace(re, (m, i) => { frag.append(t.nodeValue.slice(last, i)); const k = document.createElement("mark"); k.className = "hit"; k.textContent = m; frag.append(k); HITS.push(k); last = i + m.length; return m; });
    frag.append(t.nodeValue.slice(last));
    t.replaceWith(frag);
  });
  const n = document.getElementById("kb-find-n");
  if (n) n.textContent = HITS.length ? `${HITS.length} збігів` : "немає";
}
function findIn(dir) {
  const q = (document.getElementById("kb-find") || {}).value || st.find || "";
  if (!HITS.length || dir === 0) markIn(q);
  if (!HITS.length) return;
  HI = (HI + (dir || 1) + HITS.length) % HITS.length;
  HITS.forEach((h) => h.classList.remove("cur"));
  const h = HITS[HI];
  h.classList.add("cur");
  const part = h.closest("details");
  if (part) part.open = true;
  h.scrollIntoView({ behavior: "smooth", block: "center" });
  const n = document.getElementById("kb-find-n");
  if (n) n.textContent = `${HI + 1} / ${HITS.length}`;
}

/* ---------- зміни законодавства ---------- */
async function changesView() {
  const [list, idx, sync] = await Promise.all([call("/api/kb/changes"), call("/api/kb"), call("/api/kb/sync")]);
  const W = { new: ["Новий документ", "ok"], changed: ["Змінено", "wait"], removed: ["Вилучено", "bad"] };
  const last = sync.last;
  return `<div class="kb-sync"><div><div class="eyebrow">Звірка з офіційною базою NG</div><b>${idx.docs.length} документів</b> · остання звірка: ${idx.checked ? fmtDT(idx.checked) : "ще не було"}
      ${last && !sync.syncing ? `<div class="small muted">${last.error ? "Помилка: " + esc(last.error) : `Знайдено змін: ${last.changes} (нових ${last.new}, змінених ${last.changed}, вилучених ${last.removed})`}</div>` : ""}
      <div class="small muted">ШІ-підсумок змін: ${idx.ai ? "увімкнено" : "вимкнено (потрібен ключ API у налаштуваннях бота)"}</div></div>
    ${idx.canSync ? `<button class="btn gold" data-a="kbsync" ${sync.syncing ? "disabled" : ""}>${sync.syncing ? '<span class="spin"></span> Звіряю…' : "↻ Оновити законодавчу базу"}</button>` : ""}</div>
    ${list.length ? `<div class="docs">${list.map((c) => `<article class="doc st-${W[c.kind][1] === "ok" ? "ok" : W[c.kind][1] === "bad" ? "rej" : "wait"}">
      <div class="doc-no"><b>${fmtDT(c.t)}</b><span>${c.kind === "changed" ? `+${c.added} / −${c.removed}` : ""}</span></div>
      <div class="doc-main"><div class="doc-title">${esc(c.title)}</div>
        ${c.summary ? `<div class="kb-ai"><b>Підсумок ШІ</b><p>${esc(c.summary)}</p></div>` : ""}
        ${c.diff ? `<details class="kb-diff"><summary>Показати змінені рядки</summary><pre>${c.diff.split("\n").map((l) => `<span class="${l.startsWith("+") ? "add" : l.startsWith("-") ? "del" : l.startsWith("@@") ? "hunk" : ""}">${esc(l)}</span>`).join("\n")}</pre></details>` : ""}
        <button class="btn sm" data-a="kbopen" data-v="${esc(c.slug)}" data-tab="law">Відкрити документ</button></div>
      <div class="doc-side"><span class="chip ${W[c.kind][1]}">${W[c.kind][0]}</span></div></article>`).join("")}</div>`
      : '<div class="empty">Змін ще не зафіксовано. Перша звірка зберігає поточну редакцію як відправну.</div>'}`;
}

/* ---------- бібліотека ---------- */
async function libView() {
  const can = ME().kb.lib;
  if (st.libEdit) {
    const it = st.libEdit;
    const cats = (S.cache.libcats || {});
    return `<form class="card" data-f="libsave" style="max-width:980px"><header><h3>${it.id ? "Редагування матеріалу" : "Новий матеріал"}</h3></header>
      <div class="form-grid"><label class="f"><span>Розділ</span><select class="i" id="lb-cat">${Object.entries(cats).map(([k, v]) => `<option value="${k}" ${k === it.cat ? "selected" : ""}>${esc(v)}</option>`).join("")}</select></label>
        <label class="f"><span>Назва</span><input class="i" id="lb-title" maxlength="150" value="${esc(it.title || "")}"></label>
        <label class="f wide"><span>Готова презентація чи сторінка (.html) — замість тексту</span><input class="i" id="lb-html" type="file" accept=".html,text/html">${it.fmt === "html" ? '<small class="muted">Зараз завантажено HTML-презентацію. Оберіть новий файл, щоб замінити.</small>' : ""}</label>
        <label class="f wide"><span>Текст (абзаци через порожній рядок; рядки з «# » стануть заголовками)</span><textarea class="i kb-edit" id="lb-body" ${it.fmt === "html" ? "disabled" : ""}>${it.fmt === "html" ? "" : esc(it.body || "")}</textarea></label>
        <label class="f wide"><span>Файли (PDF, зображення) — до 10</span><input class="i" id="lb-files" type="file" multiple accept="application/pdf,image/*"></label></div>
      <div class="acts"><button class="btn" type="button" data-a="libback">Скасувати</button><button class="btn gold" type="submit">Зберегти</button></div></form>`;
  }
  if (st.lib) {
    const it = await call(`/api/lib/${st.lib}`);
    S.cache.libitem = it;
    if (it.fmt === "html") {
      // готова презентація: ізольоване вікно без доступу до сайту (sandbox без allow-same-origin)
      return `<div class="kd-bar"><button class="btn" data-a="libback">← До бібліотеки</button><b class="lib-h">${esc(it.title)}</b><span class="sp"></span>
        <button class="btn" data-a="libfs">⛶ На весь екран</button>${can ? `<button class="btn" data-a="libedit">Редагувати</button><button class="btn bad" data-a="libdel">🗑 Видалити</button>` : ""}</div>
        <iframe class="lib-frame" id="lib-frame" sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox" srcdoc="${esc(it.body)}" title="${esc(it.title)}"></iframe>`;
    }
    const body = esc(it.body || "").split(/\n{2,}/).map((p) => p.startsWith("# ") ? `<h3>${p.slice(2)}</h3>` : `<p>${p.replace(/\n/g, "<br>")}</p>`).join("");
    return `<div class="kd-bar"><button class="btn" data-a="libback">← До бібліотеки</button><span class="sp"></span>
      <button class="btn" data-a="pdfel" data-sel=".lib-doc" data-name="${esc(it.title)}">⬇ PDF</button>${can ? `<button class="btn" data-a="libedit">Редагувати</button><button class="btn bad" data-a="libdel">🗑 Видалити</button>` : ""}</div>
      <div class="kd-wrap"><article class="kd lib-doc"><header class="kd-head"><img src="sbu-logo.webp" alt="" width="64" height="64"><div><div class="kd-agency">Бібліотека СБУ</div><div class="kd-dept">${esc((S.cache.libcats || {})[it.cat] || "")}</div></div>
        <div class="kd-no"><span>оновлено</span><b>${fmtDT(it.updated)}</b></div></header><h2 class="kb-title">${esc(it.title)}</h2>
        <div class="law-body">${body}</div>${it.files.length ? `<div class="files">${it.files.map((f, i) => `<button class="btn sm" data-a="file" data-id="${esc(f)}">📎 Додаток ${i + 1}</button>`).join("")}</div>` : ""}</article></div>`;
  }
  const d = await call("/api/lib");
  S.cache.libcats = d.cats;
  const by = {};
  d.items.forEach((x) => (by[x.cat] = by[x.cat] || []).push(x));
  // архів: лекції — книги на полиці, внутрішні — теки ДСК, пам'ятки — картки, матеріали — папки-реєстратори
  const no = (x) => String(x.id).padStart(4, "0");
  const item = {
    lecture: (x) => { const lv = (x.title.match(/^([IVX]+)\s+рівень/) || [])[1] || "★"; const t = x.title.replace(/^[IVX]+\s+рівень\s*·\s*/, "");
      return `<button class="lib-book" data-a="libopen" data-id="${x.id}" data-t="${esc(x.title.toLowerCase())}"><span class="lb-spine"></span><span class="lb-lv">${esc(lv)}</span><span class="lb-rank">рівень</span>
        <img src="sbu-logo.webp" alt="" width="40" height="40"><b>${esc(t)}</b><span class="lb-foot">${x.fmt === "html" ? "▶ Презентація" : "Лекція"} · Академія СБУ</span></button>`; },
    internal: (x) => `<button class="lib-folder" data-a="libopen" data-id="${x.id}" data-t="${esc(x.title.toLowerCase())}"><span class="lf-tab">ВД-${no(x)}</span>
      <span class="lf-stamp">ДСК</span><span class="lf-org">Служба безпеки штату NG</span><b>${esc(x.title)}</b><span class="lf-meta">${esc(x.authorName || "")} · ${fmtDT(x.updated)}</span></button>`,
    memo: (x) => `<button class="lib-memo" data-a="libopen" data-id="${x.id}" data-t="${esc(x.title.toLowerCase())}"><span class="lm-clip"></span><span class="lm-kind">Пам'ятка · П-${no(x)}</span>
      <b>${esc(x.title.replace(/^Пам'ятка:\s*(.)/, (m, c) => c.toUpperCase()))}</b><span class="lm-meta">${fmtDT(x.updated)}</span></button>`,
    material: (x) => `<button class="lib-binder" data-a="libopen" data-id="${x.id}" data-t="${esc(x.title.toLowerCase())}"><span class="lbd-ring"></span><span class="lbd-label"><i>НМ-${no(x)}</i><b>${esc(x.title)}</b></span>
      <span class="lbd-meta">${fmtDT(x.updated)}</span></button>`,
  };
  const icon = { lecture: "📚", internal: "🗂", memo: "📋", material: "📁" };
  const cats = Object.entries(d.cats).filter(([k]) => !st.libCat || st.libCat === k);
  return `<div class="lib-arch">
    <div class="lib-top"><div><div class="eyebrow">Архів · Бібліотека СБУ</div><b>${d.items.length} матеріалів</b></div>
      <input class="i lib-q" id="lib-q" placeholder="Пошук у бібліотеці…" autocomplete="off">
      ${can ? '<button class="btn gold" data-a="libnew">+ Додати матеріал</button>' : ""}</div>
    <div class="lib-pills"><button class="${st.libCat ? "" : "on"}" data-a="libcat" data-v="">Усе <i>${d.items.length}</i></button>
      ${Object.entries(d.cats).map(([k, v]) => `<button class="${st.libCat === k ? "on" : ""}" data-a="libcat" data-v="${k}">${icon[k] || ""} ${esc(v)} <i>${(by[k] || []).length}</i></button>`).join("")}</div>
    ${cats.map(([k, v]) => `<section class="lib-sec lib-s-${k}"><div class="kb-sec-h"><span>${icon[k] || ""} ${esc(v)}</span><i></i></div>
      ${(by[k] || []).length ? `<div class="lib-row ${k === "lecture" ? "shelf lec" : ""}">${by[k].map(item[k] || item.material).join("")}</div>` : '<div class="lib-empty">Розділ порожній.</div>'}</section>`).join("")}
    <div class="lib-empty" id="lib-none" hidden>Нічого не знайдено.</div></div>`;
}

/* ---------- іспити ---------- */
async function examsView() {
  if (st.examEdit) return examEditor(st.examEdit);
  if (st.take) return takeView(st.take);
  if (st.result) return resultView(st.result, false);
  if (st.review) return resultView(st.review, true);
  const d = await call("/api/exams");
  S.cache.exams = d;
  const pct = (a) => a.pct == null ? '<span class="chip wait">На перевірці ВКПП</span>' : `<span class="chip ${a.passed ? "ok" : "bad"}">${a.pct}% · ${a.passed ? "складено" : "не складено"}</span>`;
  return `${d.examiner ? '<div class="bn-actions"><button class="btn gold" data-a="exnew">+ Створити іспит</button></div>' : ""}
    <div class="ex-grid">${d.exams.map((e) => `<article class="ex-card ${e.status}"><div class="eyebrow">${e.status === "published" ? "Опубліковано" : "Чернетка"}</div><h3>${esc(e.title)}</h3>
      <p class="muted small">${esc(e.descr || "")}</p><div class="ex-meta"><span>${e.count} питань</span><span>прохідний ${e.pass_pct}%</span><span>${e.minutes ? e.minutes + " хв" : "без ліміту часу"}</span></div>
      <div class="acts">${e.status === "published" ? `<button class="btn gold sm" data-a="exstart" data-id="${e.id}">Скласти іспит</button>` : ""}
        ${d.examiner ? `<button class="btn sm" data-a="exedit" data-id="${e.id}">Редагувати</button><button class="btn sm bad" data-a="exdel" data-id="${e.id}">🗑</button>` : ""}</div></article>`).join("") || '<div class="empty">Іспитів ще немає.</div>'}</div>
    <h3 class="bn-h" style="margin-top:20px">Мої результати</h3>
    ${d.mine.length ? `<div class="docs">${d.mine.map((a) => `<article class="doc st-${a.pct == null ? "wait" : a.passed ? "ok" : "rej"}" data-a="exres" data-id="${a.id}" style="cursor:pointer">
      <div class="doc-no"><b>${fmtDT(a.finished)}</b></div><div class="doc-main"><div class="doc-title">${esc(a.examTitle)}</div>${a.note ? `<div class="doc-note">ВКПП: ${esc(a.note)}</div>` : ""}</div><div class="doc-side">${pct(a)}</div></article>`).join("")}</div>` : '<div class="muted small">Ви ще не складали іспитів.</div>'}
    ${d.examiner ? `<h3 class="bn-h" style="margin-top:20px">Перевірка ВКПП</h3>${d.review.length ? `<div class="tbl-wrap"><table class="t"><thead><tr><th>Співробітник</th><th>Іспит</th><th>Здано</th><th>Результат</th><th></th></tr></thead><tbody>
      ${d.review.map((a) => `<tr><td><b>${esc(a.name)}</b><div class="muted small">${esc(a.rankName)} · ${a.sid}</div></td><td>${esc(a.examTitle)}${a.late ? ' <span class="chip bad">пізно</span>' : ""}</td><td class="muted num">${fmtDT(a.finished)}</td><td>${pct(a)}</td>
        <td class="r"><button class="btn sm ${a.status === "submitted" ? "gold" : ""}" data-a="exrev" data-id="${a.id}">${a.status === "submitted" ? "Перевірити" : "Переглянути"}</button></td></tr>`).join("")}</tbody></table></div>` : '<div class="muted small">Немає спроб.</div>'}` : ""}`;
}

function examEditor(e) {
  const qs = e.questions || [];
  return `<form class="card" data-f="exsave" style="max-width:980px"><header><h3>${e.id ? "Редагування іспиту" : "Новий іспит"}</h3></header>
    <div class="form-grid"><label class="f wide"><span>Назва</span><input class="i" id="ex-title" value="${esc(e.title || "")}"></label>
      <label class="f wide"><span>Опис / інструкція</span><input class="i" id="ex-descr" value="${esc(e.descr || "")}"></label>
      <label class="f"><span>Прохідний бал, %</span><input class="i" id="ex-pass" type="number" min="1" max="100" value="${e.pass_pct || 70}"></label>
      <label class="f"><span>Ліміт часу, хв (0 — без ліміту)</span><input class="i" id="ex-min" type="number" min="0" max="240" value="${e.minutes || 0}"></label></div>
    <p class="note">Варіанти відповіді — кожен з нового рядка; правильні позначте зірочкою на початку: <code>*Так</code>. Для письмової відповіді варіанти не потрібні — її перевіряє ВКПП.</p>
    <div id="ex-qs">${qs.map((q, i) => qCard(q, i)).join("")}</div>
    <div class="acts"><button class="btn" type="button" data-a="exaddq">+ Питання</button><span class="sp"></span><button class="btn" type="button" data-a="exback">Скасувати</button>
      <button class="btn" type="submit" data-pub="0">Зберегти чернетку</button><button class="btn gold" type="submit" data-pub="1">Опублікувати</button></div></form>`;
}
const qCard = (q, i) => `<div class="ex-q" data-i="${i}"><div class="ex-q-h"><b>Питання ${i + 1}</b>
    <select class="i" data-q="type">${[["single", "Одна правильна"], ["multi", "Кілька правильних"], ["text", "Письмова відповідь"]].map(([k, l]) => `<option value="${k}" ${k === (q.type || "single") ? "selected" : ""}>${l}</option>`).join("")}</select>
    <input class="i" data-q="points" type="number" min="1" max="20" value="${q.points || 1}" title="Бали" style="width:80px">
    <button type="button" class="btn sm bad" data-a="exdelq">✕</button></div>
  <textarea class="i" data-q="q" placeholder="Текст питання">${esc(q.q || "")}</textarea>
  <textarea class="i" data-q="opts" placeholder="*Правильний варіант&#10;Неправильний варіант">${esc((q.options || []).map((o, k) => ((q.correct || []).includes(k) ? "*" : "") + o).join("\n"))}</textarea></div>`;
function readQs() {
  return [...document.querySelectorAll(".ex-q")].map((el) => {
    const v = (k) => el.querySelector(`[data-q=${k}]`).value;
    const lines = v("opts").split("\n").map((s) => s.trim()).filter(Boolean);
    return { type: v("type"), q: v("q"), points: +v("points") || 1, options: lines.map((s) => s.replace(/^\*\s*/, "")), correct: lines.map((s, k) => (s.startsWith("*") ? k : -1)).filter((k) => k >= 0) };
  });
}

function takeView(t) {
  const e = t.exam;
  const left = e.minutes ? Math.max(0, e.minutes * 60 - Math.floor((Date.now() - t.started) / 1000)) : null;
  return `<form class="card ex-take" data-f="exsubmit"><header class="paper-head"><div><div class="eyebrow">Онлайн-іспит · ЄІС «Сова»</div><h3>${esc(e.title)}</h3></div>
      ${left != null ? `<div class="ex-timer" id="ex-timer" data-end="${t.started + e.minutes * 60000}">${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}</div>` : ""}</header>
    ${e.descr ? `<p class="note">${esc(e.descr)}</p>` : ""}
    ${e.questions.map((q, i) => `<fieldset class="ex-tq"><legend>${i + 1}. ${esc(q.q)} <span class="muted small">(${q.points} б.)</span></legend>
      ${q.type === "text" ? `<textarea class="i" data-ans="${q.id}" placeholder="Ваша відповідь">${esc(st.ans[q.id] || "")}</textarea>`
        : q.options.map((o, k) => `<label class="ex-opt"><input type="${q.multi ? "checkbox" : "radio"}" name="q${q.id}" data-ans="${q.id}" value="${k}"> ${esc(o)}</label>`).join("")}</fieldset>`).join("")}
    <div class="acts"><button class="btn" type="button" data-a="exback">Вийти</button><button class="btn gold" type="submit">Завершити й здати</button></div></form>`;
}

function resultView(a, review) {
  const qs = a.questions || [];
  return `<div class="kd-bar"><button class="btn" data-a="exback">← До іспитів</button></div>
  <form class="card" data-f="exgrade"><header class="paper-head"><div><div class="eyebrow">${review ? "Перевірка ВКПП" : "Результат іспиту"}</div><h3>${esc(a.examTitle)}</h3>
    <div class="muted small">${esc(a.rankName)} ${esc(a.name)} · ${fmtDT(a.finished)}${a.late ? " · здано після ліміту часу (не зараховується)" : ""}</div></div>
    <div class="ex-score ${a.pct == null ? "" : a.passed ? "ok" : "bad"}">${a.pct == null ? "?" : a.pct + "%"}<span>${a.pct == null ? "на перевірці" : a.passed ? "СКЛАДЕНО" : "НЕ СКЛАДЕНО"}</span></div></header>
    ${qs.map((q, i) => { const p = a.answers[q.id] || {}; return `<div class="ex-rq ${q.type === "text" ? "" : p.ok ? "ok" : "bad"}"><b>${i + 1}. ${esc(q.q)}</b>
      ${q.type === "text" ? `<p class="ex-txt">${esc(p.answer || "—")}</p>${review ? `<label class="f" style="max-width:200px"><span>Бали (з ${q.points})</span><input class="i" type="number" min="0" max="${q.points}" step="0.5" data-pts="${q.id}" value="${p.points ?? ""}"></label>` : `<div class="small muted">Бали: ${p.points ?? "на перевірці"} з ${q.points}</div>`}`
        : `<ul>${q.options.map((o, k) => `<li class="${(q.correct || []).includes(k) ? "right" : ""} ${(p.answer || []).includes(k) ? "chosen" : ""}">${esc(o)}</li>`).join("")}</ul>`}</div>`; }).join("") || '<p class="muted">Відповіді з\'являться після перевірки ВКПП.</p>'}
    ${review ? `<label class="f"><span>Коментар ВКПП</span><input class="i" id="ex-note" value="${esc(a.note || "")}"></label>
      <div class="acts"><button class="btn gold" type="submit">Зберегти оцінку</button><button class="btn bad" type="button" data-a="exattdel" data-id="${a.id}">🗑 Анулювати спробу</button></div>` : a.note ? `<p class="note">ВКПП: ${esc(a.note)}</p>` : ""}</form>`;
}

/* ---------- сторінка ---------- */
async function view() {
  const tabs = [["law", "Законодавство"], ["memo", "Пам'ятка"], ["detain", "Порядок затримання"], ["changes", "Зміни законодавства"], ["lib", "Бібліотека"], ["exams", "Іспити", ME().pending.exams || undefined], ["prot", "Протоколи затримання"]];
  const head = `<div class="tabs">${tabs.map(([v, l, n]) => `<button class="tb ${st.tab === v ? "on" : ""}" data-a="kbtab" data-v="${v}">${l}${n ? `<span class="cnt">${n}</span>` : ""}</button>`).join("")}</div>`;
  const body = st.tab === "memo" ? await S.memoView() : st.tab === "detain" ? await S.detainView() : st.tab === "prot" ? await S.protView() : st.tab === "changes" ? await changesView() : st.tab === "lib" ? await libView() : st.tab === "exams" ? await examsView() : await lawView();
  return head + body;
}
S.views.kb = view;

const R = () => S.render();
const run = async (b, fn) => { if (b) b.disabled = true; try { await fn(); } catch (e) { toast(e.message, 1); } if (b) b.disabled = false; };
Object.assign(S.actions, {
  kbtab: (b) => { st.tab = b.dataset.v; st.take = st.result = st.review = st.examEdit = st.libEdit = null; R(); },
  kbopen: async (b) => { st.doc = b.dataset.v; st.extract = false; st.side = false; st.fold = true; st.sel.clear(); st.find = b.dataset.find || "";
    if (b.dataset.tab) st.tab = b.dataset.tab; await R(); scrollTo(0, 0); if (st.find) setTimeout(() => findIn(0), 50);
    if (b.dataset.go) setTimeout(() => goTo(b.dataset.go), 80); },  // з пам'ятки чи порядку затримання — одразу до статті
  kbback: () => { st.doc = null; st.extract = false; R(); },
  kbclear: () => { st.q = ""; R(); },
  kbside: () => { st.side = !st.side; R(); },
  kbwide: () => { st.wide = !st.wide; R(); },
  kbtheme: () => { st.dark = !st.dark; savePref(); document.querySelector(".kb-reader")?.classList.toggle("dark", st.dark); const b = document.querySelector("[data-a=kbtheme]"); if (b) b.textContent = st.dark ? "☀" : "☾"; },
  kbfs: (b) => { st.fs = Math.max(13, Math.min(22, st.fs + +b.dataset.d)); savePref(); document.querySelector(".kb-reader")?.style.setProperty("--fs", st.fs + "px"); },
  kbfold: (b) => { st.fold = b.dataset.v === "1"; document.querySelectorAll(".kb-part").forEach((d) => (d.open = st.fold)); },
  kbfind: (b) => findIn(+b.dataset.d),
  kbext: () => { st.extract = !st.extract; st.sel.clear(); R(); },
  kbextmake: () => {
    const html = buildExtract();
    const w = document.getElementById("view");
    w.innerHTML = `<div class="kd-bar"><button class="btn" data-a="kbextclose">← Назад до документа</button><span class="sp"></span><button class="btn" data-a="kbextcopy">⧉ Копіювати текст</button><button class="btn gold" data-a="kbextpdf">⬇ PDF</button></div><div class="kd-wrap" id="ext-wrap">${html}</div>`;
  },
  kbextclose: () => R(),
  kbextcopy: async () => { const t = document.querySelector(".ext-doc").innerText; try { await navigator.clipboard.writeText(t); toast("Витяг скопійовано"); } catch (e) { prompt("Скопіюйте:", t); } },
  kbextpdf: (b) => run(b, async () => { await S.pdf(document.querySelector(".ext-doc").outerHTML, `Витяг_${(S.cache.kbdoc.title || "").replace(/[^\p{L}\p{N}]+/gu, "_").slice(0, 60)}.pdf`, ["p"]); }),
  kbsync: (b) => run(b, async () => {
    if (!confirm("Звірити законодавчу базу з офіційним сайтом NG? Це триває до хвилини.")) return;
    await call("/api/kb/sync", { json: {} });
    toast("Звірку запущено");
    const poll = async () => { const s = await call("/api/kb/sync"); if (s.syncing) return setTimeout(poll, 4000); toast(s.last && s.last.error ? s.last.error : `Готово: змін ${s.last ? s.last.changes : 0}`, s.last && s.last.error); if (st.tab === "changes") R(); };
    setTimeout(poll, 4000); R();
  }),
  libopen: (b) => { st.lib = +b.dataset.id; R(); scrollTo(0, 0); },
  lawcat: (b) => { st.lawCat = b.dataset.v || null; R(); },
  // повний текст закону — через вікно друку (довгі кодекси не вміщаються в одне полотно html2pdf)
  kbprint: () => {
    const art = document.querySelector(".kb-paper2");
    if (!art) return;
    const c = art.cloneNode(true);
    c.querySelectorAll("details").forEach((d) => { d.open = true; });
    c.querySelectorAll("mark").forEach((m) => m.replaceWith(m.textContent));
    c.querySelectorAll("img").forEach((i) => { i.src = new URL(i.getAttribute("src"), location.href).href; });
    const w = window.open("", "_blank");
    if (!w) return toast("Дозвольте спливаючі вікна для сайту, щоб зберегти PDF", 1);
    const css = [...document.querySelectorAll('link[rel="stylesheet"]')].map((l) => `<link rel="stylesheet" href="${l.href}">`).join("");
    w.document.write(`<!doctype html><html lang="uk"><head><meta charset="utf-8"><title>${esc(S.cache.kbdoc.title)}</title>${css}
      <style>body{background:#fff!important;margin:0;padding:0}.kb-paper2{box-shadow:none!important;margin:0 auto!important;max-width:none!important;width:auto!important}
      details>summary{list-style:none}details>summary::-webkit-details-marker{display:none}@page{size:A4;margin:14mm}</style></head>
      <body style="--fs:15px">${c.outerHTML}<script>window.onload=()=>setTimeout(()=>{print();},400)</script></body></html>`);
    w.document.close();
    toast("У вікні друку оберіть «Зберегти як PDF»");
  },
  libcat: (b) => { st.libCat = b.dataset.v || null; R(); },
  libback: () => { st.lib = null; st.libEdit = null; R(); },
  libfs: () => { const f = document.getElementById("lib-frame"); if (f && f.requestFullscreen) f.requestFullscreen(); },
  libnew: () => { st.libEdit = { cat: "lecture" }; R(); },
  libedit: () => { st.libEdit = { ...S.cache.libitem }; R(); },
  libdel: (b) => run(b, async () => { if (!confirm("Видалити матеріал з бібліотеки?")) return; await call(`/api/lib/${st.lib}/delete`, { json: {} }); st.lib = null; toast("Видалено"); R(); }),
  exnew: () => { st.examEdit = { questions: [{ type: "single" }] }; R(); },
  exedit: (b) => run(b, async () => { st.examEdit = await call(`/api/exams/${b.dataset.id}`); R(); }),
  exdel: (b) => run(b, async () => { if (!confirm("Видалити іспит?")) return; await call(`/api/exams/${b.dataset.id}/delete`, { json: {} }); toast("Іспит видалено"); R(); }),
  exaddq: () => { const box = document.getElementById("ex-qs"); box.insertAdjacentHTML("beforeend", qCard({ type: "single" }, box.children.length)); },
  exdelq: (b) => { b.closest(".ex-q").remove(); document.querySelectorAll(".ex-q b").forEach((x, i) => (x.textContent = `Питання ${i + 1}`)); },
  exback: () => { st.examEdit = st.take = st.result = st.review = null; R(); },
  exstart: (b) => run(b, async () => { if (!confirm("Розпочати іспит? Якщо є ліміт часу, відлік почнеться одразу.")) return; st.ans = {}; st.take = await call(`/api/exams/${b.dataset.id}/start`, { json: {} }); R(); }),
  exres: (b) => { st.result = S.cache.exams.mine.find((a) => a.id === +b.dataset.id); R(); },
  exrev: (b) => { st.review = S.cache.exams.review.find((a) => a.id === +b.dataset.id); R(); },
  exattdel: (b) => run(b, async () => { if (!confirm("Анулювати спробу?")) return; await call(`/api/attempts/${b.dataset.id}/delete`, { json: {} }); st.review = null; R(); }),
});
S.forms.kbsearch = () => { st.q = document.getElementById("kb-q").value.trim(); st.doc = null; R(); };
S.forms.libsave = async (f) => run(f.querySelector("button[type=submit]"), async () => {
  const it = st.libEdit;
  const files = (it.files || []).concat(await S.uploadFiles(document.getElementById("lb-files")));
  const hf = document.getElementById("lb-html").files[0];
  const html = hf ? await hf.text() : null;
  const body = { cat: document.getElementById("lb-cat").value, title: document.getElementById("lb-title").value, files,
    ...(html ? { fmt: "html", body: html } : it.fmt === "html" ? { fmt: "html", body: it.body } : { body: document.getElementById("lb-body").value }) };
  const r = await call(it.id ? `/api/lib/${it.id}` : "/api/lib", { json: body });
  st.libEdit = null; st.lib = r.id; toast("Збережено"); R();
});
S.forms.exsave = async (f, ev) => run(ev && ev.submitter, async () => {
  const v = (id) => document.getElementById(id).value;
  const body = { title: v("ex-title"), descr: v("ex-descr"), pass_pct: +v("ex-pass"), minutes: +v("ex-min"), questions: readQs(), publish: ev && ev.submitter && ev.submitter.dataset.pub === "1" };
  await call(st.examEdit.id ? `/api/exams/${st.examEdit.id}` : "/api/exams", { json: body });
  st.examEdit = null; toast(body.publish ? "Іспит опубліковано" : "Чернетку збережено"); R();
});
S.forms.exsubmit = async (f) => run(f.querySelector("button[type=submit]"), async () => {
  const timeUp = document.getElementById("ex-timer")?.dataset.done;
  if (!timeUp && !confirm("Здати іспит? Змінити відповіді вже не вийде.")) return;
  const answers = {};
  f.querySelectorAll("[data-ans]").forEach((el) => {
    const id = el.dataset.ans;
    if (el.tagName === "TEXTAREA") answers[id] = el.value;
    else if (el.checked) answers[id] = el.type === "checkbox" ? [...(answers[id] || []), +el.value] : [+el.value];
  });
  st.result = await call(`/api/exams/${st.take.exam.id}/submit`, { json: { answers } });
  st.take = null; toast("Іспит здано"); R();
});
S.forms.exgrade = async (f) => run(f.querySelector("button[type=submit]"), async () => {
  const points = {};
  f.querySelectorAll("[data-pts]").forEach((el) => (points[el.dataset.pts] = +el.value || 0));
  st.review = await call(`/api/attempts/${st.review.id}/grade`, { json: { points, note: document.getElementById("ex-note").value } });
  toast("Оцінку збережено"); await S.refreshMe(); R();
});
document.addEventListener("change", (e) => {
  if (e.target.hasAttribute && e.target.hasAttribute("data-kbsbu")) { st.sbu = e.target.checked; R(); }
  if (e.target.dataset && e.target.dataset.kbsel) { e.target.checked ? st.sel.add(e.target.dataset.kbsel) : st.sel.delete(e.target.dataset.kbsel); const b = document.querySelector("[data-a=kbextmake]"); if (b) { b.disabled = !st.sel.size; b.textContent = `Сформувати витяг (${st.sel.size})`; } }
});
document.addEventListener("input", (e) => {
  if (e.target.id === "kb-find") { st.find = e.target.value; markIn(st.find.trim()); }
  if (e.target.id === "lib-q") {
    const q = e.target.value.trim().toLowerCase();
    let shown = 0;
    document.querySelectorAll(".lib-arch [data-t]").forEach((el) => { const ok = !q || el.dataset.t.includes(q); el.hidden = !ok; shown += ok; });
    document.querySelectorAll(".lib-arch .lib-sec").forEach((s) => { s.hidden = !!q && !s.querySelector("[data-t]:not([hidden])"); });
    document.getElementById("lib-none").hidden = shown > 0;
  }
});
document.addEventListener("keydown", (e) => { if (e.target.id === "kb-find" && e.key === "Enter") { e.preventDefault(); findIn(e.shiftKey ? -1 : 1); } });
function goTo(id) {
  const el = document.getElementById(id);
  if (el && el.closest("details")) el.closest("details").open = true;
  if (el) { el.scrollIntoView({ behavior: "smooth", block: "start" }); el.classList.add("kb-flash"); setTimeout(() => el.classList.remove("kb-flash"), 1600); }
}
document.addEventListener("click", (e) => {
  const a = e.target.closest("[data-kbgo]");
  if (!a) return;
  e.preventDefault();
  goTo(a.dataset.kbgo);
});
setInterval(() => {
  const t = document.getElementById("ex-timer");
  if (!t) return;
  const left = Math.max(0, Math.floor((+t.dataset.end - Date.now()) / 1000));
  t.textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
  t.classList.toggle("low", left < 60);
  if (!left && !t.dataset.done) { t.dataset.done = 1; toast("Час вийшов — іспит здається автоматично", 1); document.querySelector("form[data-f=exsubmit]")?.requestSubmit(); }
}, 1000);
S.onNav.push((v) => { if (v !== "kb") { st.take = null; } });
// адреса: #/kb/law/<документ> · #/kb/lib/4 · #/kb/prot/… · #/kb/exams · #/kb/changes
S.routes.kb = {
  get: () => st.tab === "prot" ? ["prot", ...((S.protRoute && S.protRoute.get()) || [])]
    : st.tab === "lib" ? ["lib", st.lib] : st.tab === "law" || !st.tab ? ["law", st.doc] : [st.tab],
  set: (p) => {
    st.tab = p[0] || "law";
    st.take = st.result = st.review = st.examEdit = st.libEdit = null;
    st.doc = st.tab === "law" ? p[1] || null : null;
    st.lib = st.tab === "lib" && /^\d+$/.test(p[1] || "") ? +p[1] : null;
    if (st.tab === "prot" && S.protRoute) S.protRoute.set(p.slice(1));
  },
};
})();
