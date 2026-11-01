/* База даних: законодавство NG (пошук, фільтри, витяги), зміни законодавства, бібліотека, онлайн-іспити. Підключається після app.js. */
(() => {
const S = window.SOVA;
const { esc, call, toast, fmtDT } = S;
const st = { tab: "law", doc: null, q: "", sbu: false, extract: false, sel: new Set(), lib: null, libEdit: null, exam: null, take: null, result: null, examEdit: null, review: null, ans: {} };
const ME = () => S.ME();
const mark = (text, q) => q ? esc(text).replace(new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), (m) => `<mark>${m}</mark>`) : esc(text);

/* ---------- законодавство ---------- */
let INDEX = null;
async function lawView() {
  INDEX = await call("/api/kb");
  const docs = INDEX.docs.filter((d) => !st.sbu || d.sbu);
  const groups = {};
  docs.forEach((d) => { const g = d.faction_abbr ? `Фракції · ${d.faction_abbr}` : d.grp_title || (d.section === "rules" ? "Правила" : "Інше"); (groups[g] = groups[g] || []).push(d); });
  const side = `<aside class="kb-side">
    <form data-f="kbsearch" class="kb-search"><input class="i" id="kb-q" placeholder="Пошук по всій базі: стаття, слово, фраза…" value="${esc(st.q)}"><button class="btn gold" type="submit">Знайти</button></form>
    <label class="kb-sbu"><input type="checkbox" data-kbsbu ${st.sbu ? "checked" : ""}> Лише документи для СБУ</label>
    <div class="kb-meta">${INDEX.docs.length} документів · звірено ${INDEX.checked ? fmtDT(INDEX.checked) : "—"}</div>
    ${Object.entries(groups).map(([g, list]) => `<details class="kb-grp" ${list.some((d) => d.slug === st.doc) || st.sbu ? "open" : ""}><summary>${esc(g)} <span>${list.length}</span></summary>
      ${list.map((d) => `<button class="kb-doc ${d.slug === st.doc ? "on" : ""} ${d.sbu ? "sbu" : ""}" data-a="kbopen" data-v="${esc(d.slug)}">${esc(d.short || d.title)}</button>`).join("")}</details>`).join("")}
  </aside>`;
  let main;
  if (st.q && !st.doc) {
    const res = await call(`/api/kb/search?q=${encodeURIComponent(st.q)}${st.sbu ? "&sbu=1" : ""}`);
    main = `<div class="kb-res"><div class="eyebrow">Результати пошуку «${esc(st.q)}» · ${res.length}</div>${res.map((r) => `<article class="kb-hit" data-a="kbopen" data-v="${esc(r.slug)}">
      <b>${mark(r.title, st.q)}</b><span class="muted small">${esc(r.faction || r.grp || "")} · збігів: ${r.hits}</span>
      ${r.snippets.map((s) => `<p>${mark(s, st.q)}</p>`).join("")}</article>`).join("") || '<div class="empty">Нічого не знайдено.</div>'}</div>`;
  } else if (st.doc) {
    const d = await call(`/api/kb/doc/${encodeURIComponent(st.doc)}`);
    S.cache.kbdoc = d;
    main = `<div class="kb-view">
      <div class="kb-bar"><button class="btn sm" data-a="kbback">← До списку</button><span class="sp"></span>
        <button class="btn sm ${st.extract ? "gold" : ""}" data-a="kbext">${st.extract ? "✕ Вийти з режиму витягу" : "✂ Зробити витяг"}</button>
        ${st.extract ? `<button class="btn sm gold" data-a="kbextmake" ${st.sel.size ? "" : "disabled"}>Сформувати витяг (${st.sel.size})</button>` : ""}</div>
      <div class="kb-doc-wrap">
        <nav class="kb-toc">${d.toc.map((t) => `<label class="lv${t.level}">${st.extract ? `<input type="checkbox" data-kbsel="${esc(t.id)}" ${st.sel.has(t.id) ? "checked" : ""}>` : ""}<a href="#${esc(t.id)}" data-kbgo="${esc(t.id)}">${esc(t.title)}</a></label>`).join("")}</nav>
        <article class="kd kb-paper"><header class="kd-head"><img src="sbu-logo.webp" alt="" width="64" height="64"><div><div class="kd-agency">Законодавча база штату NG</div><div class="kd-dept">${esc(d.faction_abbr || d.grp_title || "")}${d.sbu ? " · для СБУ" : ""}</div></div>
          <div class="kd-no"><span>редакція від</span><b>${fmtDT(d.updated)}</b></div></header>
          <h2 class="kb-title">${esc(d.title)}</h2><div class="law-body" id="law-body">${d.html}</div></article>
      </div></div>`;
  } else {
    const sbu = INDEX.docs.filter((d) => d.sbu);
    main = `<div class="kb-home"><div class="eyebrow">Швидкий доступ · документи СБУ</div><div class="kb-cards">${sbu.map((d) => `<button class="kb-card" data-a="kbopen" data-v="${esc(d.slug)}"><b>${esc(d.title)}</b><span>${esc(d.faction_abbr || d.grp_title || "")}</span></button>`).join("")}</div>
      <p class="muted small" style="margin-top:14px">Джерело — офіційна база проєкту NG. Оберіть документ ліворуч або знайдіть потрібну статтю пошуком.</p></div>`;
  }
  return `<div class="kb-law">${side}<div class="kb-main">${main}</div></div>`;
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
      ${can ? `<button class="btn" data-a="libedit">Редагувати</button><button class="btn bad" data-a="libdel">🗑 Видалити</button>` : ""}</div>
      <div class="kd-wrap"><article class="kd lib-doc"><header class="kd-head"><img src="sbu-logo.webp" alt="" width="64" height="64"><div><div class="kd-agency">Бібліотека СБУ</div><div class="kd-dept">${esc((S.cache.libcats || {})[it.cat] || "")}</div></div>
        <div class="kd-no"><span>оновлено</span><b>${fmtDT(it.updated)}</b></div></header><h2 class="kb-title">${esc(it.title)}</h2>
        <div class="law-body">${body}</div>${it.files.length ? `<div class="files">${it.files.map((f, i) => `<button class="btn sm" data-a="file" data-id="${esc(f)}">📎 Додаток ${i + 1}</button>`).join("")}</div>` : ""}</article></div>`;
  }
  const d = await call("/api/lib");
  S.cache.libcats = d.cats;
  const by = {};
  d.items.forEach((x) => (by[x.cat] = by[x.cat] || []).push(x));
  return `${can ? '<div class="bn-actions"><button class="btn gold" data-a="libnew">+ Додати матеріал</button></div>' : ""}
    ${Object.entries(d.cats).map(([k, v]) => `<section class="lib-sec"><h3 class="bn-h">${esc(v)} <span class="muted small">${(by[k] || []).length}</span></h3>
      ${(by[k] || []).length ? `<div class="lib-grid">${by[k].map((x) => `<button class="lib-card" data-a="libopen" data-id="${x.id}"><b>${x.fmt === "html" ? "▶ " : ""}${esc(x.title)}</b><span>${esc(x.authorName || "")} · ${fmtDT(x.updated)}</span></button>`).join("")}</div>` : '<div class="muted small">Порожньо.</div>'}</section>`).join("")}`;
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
    <div class="muted small">${esc(a.rankName)} ${esc(a.name)} · ${fmtDT(a.finished)}${a.late ? " · здано після ліміту часу" : ""}</div></div>
    <div class="ex-score ${a.pct == null ? "" : a.passed ? "ok" : "bad"}">${a.pct == null ? "?" : a.pct + "%"}<span>${a.pct == null ? "на перевірці" : a.passed ? "СКЛАДЕНО" : "НЕ СКЛАДЕНО"}</span></div></header>
    ${qs.map((q, i) => { const p = a.answers[q.id] || {}; return `<div class="ex-rq ${q.type === "text" ? "" : p.ok ? "ok" : "bad"}"><b>${i + 1}. ${esc(q.q)}</b>
      ${q.type === "text" ? `<p class="ex-txt">${esc(p.answer || "—")}</p>${review ? `<label class="f" style="max-width:200px"><span>Бали (з ${q.points})</span><input class="i" type="number" min="0" max="${q.points}" step="0.5" data-pts="${q.id}" value="${p.points ?? ""}"></label>` : `<div class="small muted">Бали: ${p.points ?? "на перевірці"} з ${q.points}</div>`}`
        : `<ul>${q.options.map((o, k) => `<li class="${q.correct.includes(k) ? "right" : ""} ${(p.answer || []).includes(k) ? "chosen" : ""}">${esc(o)}</li>`).join("")}</ul>`}</div>`; }).join("") || '<p class="muted">Відповіді з\'являться після перевірки ВКПП.</p>'}
    ${review ? `<label class="f"><span>Коментар ВКПП</span><input class="i" id="ex-note" value="${esc(a.note || "")}"></label>
      <div class="acts"><button class="btn gold" type="submit">Зберегти оцінку</button><button class="btn bad" type="button" data-a="exattdel" data-id="${a.id}">🗑 Анулювати спробу</button></div>` : a.note ? `<p class="note">ВКПП: ${esc(a.note)}</p>` : ""}</form>`;
}

/* ---------- сторінка ---------- */
async function view() {
  const tabs = [["law", "Законодавство"], ["changes", "Зміни законодавства"], ["lib", "Бібліотека"], ["exams", "Іспити", ME().pending.exams || undefined]];
  const head = `<div class="tabs">${tabs.map(([v, l, n]) => `<button class="tb ${st.tab === v ? "on" : ""}" data-a="kbtab" data-v="${v}">${l}${n ? `<span class="cnt">${n}</span>` : ""}</button>`).join("")}</div>`;
  const body = st.tab === "changes" ? await changesView() : st.tab === "lib" ? await libView() : st.tab === "exams" ? await examsView() : await lawView();
  return head + body;
}
S.views.kb = view;

const R = () => S.render();
const run = async (b, fn) => { if (b) b.disabled = true; try { await fn(); } catch (e) { toast(e.message, 1); } if (b) b.disabled = false; };
Object.assign(S.actions, {
  kbtab: (b) => { st.tab = b.dataset.v; st.take = st.result = st.review = st.examEdit = st.libEdit = null; R(); },
  kbopen: (b) => { st.doc = b.dataset.v; st.extract = false; st.sel.clear(); if (b.dataset.tab) st.tab = b.dataset.tab; R(); scrollTo(0, 0); },
  kbback: () => { st.doc = null; st.extract = false; R(); },
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
document.addEventListener("click", (e) => {
  const a = e.target.closest("[data-kbgo]");
  if (!a) return;
  e.preventDefault();
  const el = document.getElementById(a.dataset.kbgo);
  if (el) { el.scrollIntoView({ behavior: "smooth", block: "start" }); el.classList.add("kb-flash"); setTimeout(() => el.classList.remove("kb-flash"), 1600); }
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
})();
