/* Адмін-панель: Голова СБУ та Куратор. Користувачі, доступи, ролі Discord, канали й згадки, система, журнал адміністрування. */
(() => {
const S = window.SOVA;
const { esc, call, toast, fmtDT } = S;
const st = { tab: "users", d: null };
const kb = (n) => n > 1048576 ? `${(n / 1048576).toFixed(1)} МБ` : `${Math.round(n / 1024)} КБ`;
const ago = (s) => { const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return h ? `${h} год ${m} хв` : `${m} хв`; };
const TABS = [["users", "Користувачі"], ["promo", "Підвищення"], ["nick", "Нікнейми й позивні"], ["perms", "Доступи"], ["roles", "Ролі Discord"], ["chan", "Канали й згадки"], ["sys", "Система"], ["log", "Журнал адміністрування"]];

function usersView(d) {
  const blocked = d.users.filter((u) => u.blocked).length;
  return `<div class="adm-stats"><div><b>${d.users.length}</b><span>облікових записів</span></div><div><b>${d.users.filter((u) => u.sessions).length}</b><span>зараз з активним входом</span></div>
      <div><b>${blocked}</b><span>заблоковано</span></div><div><b>${d.users.filter((u) => !u.linked).length}</b><span>без Discord</span></div></div>
    <div class="card"><div class="tbl-wrap"><table class="t adm-t"><thead><tr><th>Жетон</th><th>Користувач</th><th>Звання / підрозділ</th><th>Стан</th><th>Останній вхід</th><th class="r">Дії</th></tr></thead><tbody>
    ${d.users.map((u) => `<tr class="${u.blocked ? "adm-blocked" : ""}"><td class="mono">${u.sid}</td><td><b>${esc(u.name)}</b>${u.dept === "curator" ? ' <span class="chip info">прихований</span>' : ""}</td>
      <td>${esc(u.rankName)}<div class="muted small">${esc(u.deptName)}</div></td>
      <td>${u.blocked ? '<span class="chip bad">Заблоковано</span>' : u.status === "dismissed" ? '<span class="chip mute">Звільнено</span>' : '<span class="chip ok">Активний</span>'}
        ${u.linked ? "" : ' <span class="chip warn">без Discord</span>'}${u.inStaff === false && u.status !== "dismissed" && !/curator|prosecutor/.test(u.dept) ? ' <span class="chip bad" title="Вийшов із сервера або знято ролі СБУ">поза штатом</span>' : ""}${u.sessions ? ` <span class="chip info">входів: ${u.sessions}</span>` : ""}</td>
      <td class="muted num">${u.lastLogin ? fmtDT(u.lastLogin) : "—"}</td>
      <td class="r"><div class="adm-acts">
        <button class="btn sm" data-a="admu" data-sid="${u.sid}" data-x="sync" title="Звірити ролі з Discord">⟳</button>
        <button class="btn sm" data-a="admu" data-sid="${u.sid}" data-x="logout" title="Завершити всі входи" ${u.sessions ? "" : "disabled"}>⏏</button>
        <button class="btn sm" data-a="admu" data-sid="${u.sid}" data-x="reset" title="Новий код доступу (у Discord)" ${u.linked ? "" : "disabled"}>🔑</button>
        ${u.blocked ? `<button class="btn sm ok" data-a="admu" data-sid="${u.sid}" data-x="unblock">Розблокувати</button>` : `<button class="btn sm bad" data-a="admu" data-sid="${u.sid}" data-x="block">Блок</button>`}
        ${u.linked ? `<button class="btn sm" data-a="admu" data-sid="${u.sid}" data-x="unlink" title="Відв'язати Discord">⛓</button>` : ""}
        <button class="btn sm" data-a="admu" data-sid="${u.sid}" data-x="rename" data-name="${esc(u.name)}" title="Змінити ім'я (IC)">✎</button>
        ${u.status === "dismissed" ? `<button class="btn sm" data-a="admu" data-sid="${u.sid}" data-x="restore" title="Відновити з архіву">↺</button>` : `<button class="btn sm" data-a="admu" data-sid="${u.sid}" data-x="archive" title="В архів (звільнено)">🗄</button>`}
      </div></td></tr>`).join("")}</tbody></table></div></div>
    <p class="muted small">✎ — змінити ім'я · 🗄 — в архів (звільнено), ↺ — повернути · «поза штатом» — вийшов із сервера або зняли ролі СБУ. ⟳ — звірити ролі з Discord зараз · ⏏ — вийти з усіх пристроїв · 🔑 — новий код доступу в особисті Discord · ⛓ — відв'язати Discord. Заблокований не може увійти на сайт, ролі в Discord не змінюються.</p>`;
}

function nickView(d) {
  const n = d.nick, cs = n.people.filter((p) => n.depts.includes(p.dept));
  return `<form class="card" data-f="admnick"><header><h3>Формат нікнеймів у Discord</h3></header>
    <p class="note">Підстановки: <span class="mono">{rank}</span> — скорочене звання, <span class="mono">{name}</span> — ім'я, <span class="mono">{sid}</span> — Static ID,
      <span class="mono">{dept}</span> — відділ, <span class="mono">{callsign}</span> — позивний. Discord дозволяє 32 символи: довге ім'я скорочується до «І. Прізвище».</p>
    <div class="form-grid">
      <label class="f"><span>Звичайний нікнейм <i class="muted">· стандарт: ${esc(n.defTpl)}</i></span><input class="i mono" name="tpl" value="${esc(n.tpl)}"></label>
      <label class="f"><span>Нікнейм із позивним <i class="muted">· стандарт: ${esc(n.defCallsignTpl)}</i></span><input class="i mono" name="callsignTpl" value="${esc(n.callsignTpl)}"></label>
      <div class="f wide"><span>Відділи з позивними</span><div class="adm-checks">${n.allDepts.map((x) => `<label><input type="checkbox" name="dept" value="${x.key}" ${n.depts.includes(x.key) ? "checked" : ""}> ${esc(x.s)}</label>`).join("")}</div></div>
    </div>
    <h4 class="adm-sub">Скорочення звань у нікнеймі</h4>
    <div class="adm-ranks">${n.ranks.map((r, i) => `<label><span>${i + 1}. ${esc(d.ranks[i])}</span><input class="i mono" name="rank" maxlength="16" value="${esc(r)}" placeholder="${esc(n.defRanks[i])}"></label>`).join("")}</div>
    <div class="acts"><button class="btn" type="button" data-a="admnickdef">Стандартний формат</button><button class="btn gold" type="submit">Зберегти формат</button></div>
    <p class="muted small">Новий формат застосовується, коли бот наступного разу оновлює нікнейм людини (наказ, звірка посвідчення). Щоб перейменувати всіх одразу — кнопка нижче.</p></form>
  <div class="card"><header><h3>Нікнейми співробітників</h3><span class="sp"></span><button class="btn gold sm" data-a="admnickall">↻ Застосувати всім зараз</button></header>
    <p class="muted small">Позивний можна призначити чи зняти вручну — без заявки (у відділах з позивними: ${n.depts.map((k) => esc((n.allDepts.find((x) => x.key === k) || {}).s || k)).join(", ")}; з позивними зараз ${cs.filter((p) => p.callsign).length}).</p>
    <div class="tbl-wrap"><table class="t"><thead><tr><th>Жетон</th><th>Співробітник</th><th>Відділ</th><th>Позивний</th><th>Нікнейм за форматом</th><th class="r"></th></tr></thead><tbody>
    ${n.people.map((p) => `<tr><td class="mono">${p.sid}</td><td><b>${esc(p.name)}</b><div class="muted small">${esc(p.rankName)}</div></td><td>${esc(p.deptS)}</td>
      <td>${n.depts.includes(p.dept) ? `<div class="adm-in"><input class="i mono adm-cs" id="cs-${p.sid}" maxlength="16" value="${esc(p.callsign || "")}" placeholder="—"><button class="btn sm" data-a="admcs" data-sid="${p.sid}" title="Зберегти позивний">✔</button></div>` : `<span class="muted small">${p.callsign ? esc(p.callsign) + " (не діє у відділі)" : "—"}</span>`}</td>
      <td class="mono small">${esc(p.nick)}</td><td class="r"><button class="btn sm" data-a="admnick1" data-sid="${p.sid}" title="Поставити цей нікнейм у Discord зараз">↻</button></td></tr>`).join("")}</tbody></table></div></div>`;
}

function promoView(p) {
  const rows = Object.entries(p.cfg);
  return `<form class="card" data-f="admpromo"><header><h3>Єдина система підвищення</h3></header>
    <p class="note">Бали — підтверджені звіти. Для кожного звання — поріг балів. Надлишок переходить на наступне звання: після підвищення списується лише поріг.
      Іспит — обов'язкова умова (зарахована спроба з прохідним балом). «Наказ» — рапорт не подається, звання присвоює Голова. Активна догана блокує рапорт. Погоджує ВКПП.</p>
    <div class="tbl-wrap"><table class="t adm-promo"><thead><tr><th>Звання</th><th>Поріг балів</th><th>Обов'язковий іспит</th><th>Спосіб</th></tr></thead><tbody>
    ${rows.map(([r, c]) => `<tr><td><b>${r}. ${esc(p.ranks[r - 1])}</b></td>
      <td><input class="i mono" type="number" min="0" name="pts-${r}" value="${c.pts}"></td>
      <td><select class="i" name="exam-${r}"><option value="">— без іспиту —</option>${p.exams.map((e) => `<option value="${e.id}" ${c.exam === e.id ? "selected" : ""}>${esc(e.title)}${e.status !== "published" ? " (чернетка)" : ""}</option>`).join("")}</select></td>
      <td><select class="i" name="mode-${r}"><option value="rap" ${c.mode === "rap" ? "selected" : ""}>рапорт за балами</option><option value="order" ${c.mode === "order" ? "selected" : ""}>лише наказом</option></select></td></tr>`).join("")}</tbody></table></div>
    <h4 class="adm-sub">Вартість звітів у балах</h4>
    <div class="adm-ranks">${p.acts.filter((a) => !a.custom).map((a) => `<label><span>${esc(a.name)} <i class="muted">· стандарт ${a.default}</i></span><input class="i mono" type="number" min="0" max="100" name="act-${a.key}" value="${a.value}"></label>`).join("")}</div>
    <div class="acts"><button class="btn gold" type="submit">Зберегти систему підвищення</button></div></form>
  ${actsCard(p)}`;
}

// Пункти звітів, додані в панелі: назва, бали, хто подає, чи потрібні статті КК
function actForm(p, a) {
  const d = a ? a.d : "all", list = Array.isArray(d) ? d : [];
  const k = a ? a.key : "new";
  return `<form class="adm-act" data-f="admact" data-key="${a ? esc(a.key) : ""}">
    <input class="i" name="name" maxlength="60" placeholder="Назва пункту, напр. Блокпост" value="${a ? esc(a.name) : ""}">
    <input class="i mono" name="points" type="number" min="0" max="100" placeholder="Бали" value="${a ? a.value : ""}" title="Бали за один звіт">
    <select class="i" name="scope"><option value="all" ${d === "all" ? "selected" : ""}>Усі відділи</option><option value="instr" ${d === "instr" ? "selected" : ""}>Інструктори (ВКПП, 8 і 11+ звання)</option><option value="list" ${list.length ? "selected" : ""}>Лише обрані відділи…</option></select>
    <div class="adm-checks" ${list.length ? "" : "hidden"}>${p.actDepts.map((x) => `<label><input type="checkbox" name="dept-${k}" value="${x.key}" ${list.includes(x.key) ? "checked" : ""}> ${esc(x.s)}</label>`).join("")}</div>
    <label class="adm-art"><input type="checkbox" name="art" ${a && a.art ? "checked" : ""}> потрібні статті КК</label>
    <div class="acts">${a ? `<button class="btn sm gold" type="submit">Зберегти</button><button class="btn sm bad" type="button" data-a="admactdel" data-key="${esc(a.key)}" data-name="${esc(a.name)}">🗑 Видалити</button>` : '<button class="btn sm gold" type="submit">+ Додати пункт</button>'}</div>
  </form>`;
}
function actsCard(p) {
  const mine = p.acts.filter((a) => a.custom);
  return `<div class="card"><header><h3>Пункти звітів</h3></header>
    <p class="note">Тут можна додати новий вид службового звіту: він одразу з'явиться у формі звіту в тих, кому дозволено. Стандартні пункти (вище) змінюються лише за балами.
      Видалений пункт зникає з форми; якщо за ним уже є звіти, вони й нараховані бали лишаються.</p>
    ${mine.length ? mine.map((a) => actForm(p, a)).join("") : '<p class="muted small">Доданих пунктів ще немає.</p>'}
    <h4 class="adm-sub">Новий пункт</h4>${actForm(p, null)}
    <style>.adm-act{display:grid;grid-template-columns:2fr 90px 1.4fr auto auto;gap:8px;align-items:center;padding:8px 0;border-bottom:1px solid var(--line)}
      .adm-act .adm-checks{grid-column:1/-1}.adm-art{display:flex;gap:6px;align-items:center;font-size:13px;white-space:nowrap}.adm-act .acts{margin:0}
      @media (max-width:760px){.adm-act{grid-template-columns:1fr 90px}.adm-act select,.adm-act .adm-art,.adm-act .acts{grid-column:1/-1}}</style></div>`;
}

function permsView(d) {
  return `<form class="card" data-f="admperms"><header><h3>Хто що може на сайті</h3></header>
    <p class="note">Мінімальне звання для кожної дії. За замовчуванням — як у статуті. Зміни діють одразу, без перезапуску бота.</p>
    <div class="adm-perms">${d.perms.map((p) => `<label class="adm-perm ${p.value !== p.default ? "chg" : ""}"><div><b>${esc(p.label)}</b>${p.note ? `<span>${esc(p.note)}</span>` : ""}</div>
      <select class="i" name="${p.key}">${d.ranks.map((n, i) => `<option value="${i + 1}" ${p.value === i + 1 ? "selected" : ""}>від ${i + 1} · ${esc(n)}${p.default === i + 1 ? " (стандарт)" : ""}</option>`).join("")}</select></label>`).join("")}</div>
    <div class="acts"><button class="btn" type="button" data-a="admpermreset">Скинути до стандартних</button><button class="btn gold" type="submit">Зберегти доступи</button></div></form>
    <div class="card"><header><h3>Постійні правила (не змінюються)</h3></header><ul class="adm-fixed">
      <li>Адмін-панель — лише Голова СБУ та Куратор.</li><li>Куратор бачить усі розділи, але нічого не змінює, окрім адмін-панелі та схвалення відомостей премій.</li>
      <li>Генеральний прокурор бачить лише кейс-файли, що дійшли до нього.</li><li>Нарахувати премію собі не можна (ст. 22 ТК).</li>
      <li>Звання й відділ кожного беруться з ролей Discord (синхронізація кожні 4 хв).</li></ul></div>`;
}

function rolesView(d) {
  const bad = d.roles.filter((r) => !r.exists).length, noman = d.roles.filter((r) => r.exists && !r.manageable).length;
  return `${bad || noman ? `<div class="note warn">${bad ? `Ролей, яких немає на сервері: <b>${bad}</b>. ` : ""}${noman ? `Ролей вище за роль бота (бот не може їх видавати й знімати): <b>${noman}</b>.` : ""}</div>` : '<div class="note">Усі ролі на місці, бот може ними керувати.</div>'}
    <div class="card"><div class="tbl-wrap"><table class="t"><thead><tr><th>Призначення на сайті</th><th>Роль у Discord</th><th>ID</th><th>Стан</th></tr></thead><tbody>
    ${d.roles.map((r) => `<tr><td>${esc(r.label)}</td><td>${r.exists ? `<span class="adm-role" style="--rc:${r.color || "#9aa7b8"}">${esc(r.name)}</span>` : "—"}</td><td class="mono small">${r.id}</td>
      <td>${!r.exists ? '<span class="chip bad">Немає на сервері</span>' : r.manageable ? '<span class="chip ok">OK</span>' : '<span class="chip warn">Вище за бота</span>'}</td></tr>`).join("")}</tbody></table></div></div>`;
}

function chanView(d) {
  return `<form class="card" data-f="admchan"><header><h3>Канали Discord для документів</h3></header>
    <p class="note">Вкажіть ID каналу, щоб змінити, куди надходять документи. Порожнє поле — стандартний канал.</p>
    <div class="adm-grid">${d.channels.map((c) => `<label class="f"><span>${esc(c.label)} <i class="muted">· ${esc(c.source)}${c.name ? " · " + esc(c.name) : c.id ? " · не знайдено" : ""}</i></span>
      <input class="i mono" name="${esc(c.key)}" value="${c.source === "панель" ? esc(c.id) : ""}" placeholder="${esc(c.id || "не задано")}"></label>`).join("")}</div>
    <div class="acts"><button class="btn gold" type="submit">Зберегти канали</button></div></form>
  <form class="card" data-f="admment"><header><h3>Кого згадувати в документах</h3></header>
    <p class="note">ID ролей через кому або пробіл. Порожньо — нікого не згадувати. «Стандарт» повертає згадки з коду.</p>
    <div class="adm-grid">${d.mentions.map((m) => `<label class="f"><span>${esc(m.label)} <i class="muted">· ${m.custom ? "панель" : "стандарт"}${m.names.length ? " · " + m.names.map(esc).join(", ") : " · нікого"}</i></span>
      <div class="adm-in"><input class="i mono" name="${esc(m.key)}" value="${esc(m.ids.join(", "))}" placeholder="нікого">${m.custom ? `<button class="btn sm" type="button" data-a="admmdef" data-k="${esc(m.key)}">Стандарт</button>` : ""}</div></label>`).join("")}</div>
    <div class="acts"><button class="btn gold" type="submit">Зберегти згадки</button></div></form>`;
}

function sysView(d) {
  const s = d.system;
  return `<div class="adm-stats"><div><b class="${s.guild ? "ok" : "bad"}">${s.guild ? "На зв'язку" : "Немає зв'язку"}</b><span>${esc(s.bot || "")}</span></div>
      <div><b>${s.latency ?? "—"} мс</b><span>затримка Discord</span></div><div><b>${ago(s.uptime)}</b><span>бот працює без перезапуску</span></div>
      <div><b>${s.users}</b><span>в особовому складі · ${s.sessions} активних входів</span></div><div><b>${kb(s.dbSize)}</b><span>розмір бази</span></div></div>
    ${s.warnings.length ? `<div class="card"><header><h3>Попередження</h3></header>${s.warnings.map((w) => `<p class="note warn">${esc(w)}</p>`).join("")}</div>` : ""}
    <div class="card"><header><h3>Дії</h3></header><div class="acts" style="justify-content:flex-start">
      <button class="btn gold" data-a="admsync">⟳ Синхронізувати ролі всіх зараз</button><button class="btn" data-a="admbackup">💾 Резервна копія бази зараз</button></div>
      <p class="muted small">Ролі й так звіряються автоматично кожні 4 хвилини. Резервні копії робляться автоматично й надсилаються в канал бекапів.</p></div>
    <div class="grid2"><div class="card"><header><h3>Останні резервні копії</h3></header>
      ${s.backups.length ? `<ul class="adm-list">${s.backups.map((b) => `<li><span class="mono">${esc(b.name)}</span><span class="muted">${kb(b.size)} · ${fmtDT(b.t)}</span></li>`).join("")}</ul>` : '<p class="muted">Ще немає.</p>'}</div>
    <div class="card"><header><h3>Попередження й помилки бота</h3></header>
      ${s.errors.length ? `<ul class="adm-list adm-err">${s.errors.map((e) => `<li><span class="chip ${e.lvl === "WARNING" ? "warn" : "bad"}">${e.lvl === "WARNING" ? "увага" : "помилка"}</span><span class="muted small">${fmtDT(e.t)} · ${esc(e.src)}</span><div>${esc(e.msg)}</div></li>`).join("")}</ul>` : '<p class="muted">Помилок немає.</p>'}</div></div>`;
}

function logView(d) {
  return `<div class="card"><header><h3>Журнал адміністрування</h3></header><p class="muted small">Видно лише Голові СБУ та Куратору. У кадровий аудит ці записи не потрапляють.</p>
    ${d.log.length ? `<div class="aud">${d.log.map((r) => `<div class="aud-it k-misc"><i></i>
      <div class="aud-when"><b>${new Date(r.t).toLocaleDateString("uk-UA", { day: "2-digit", month: "2-digit" })}</b><span>${new Date(r.t).toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit" })}</span></div>
      <div class="aud-body"><div class="aud-act">${esc(r.action.replace(/^⚙\s*/, ""))}${r.targetUser ? ` · ${esc(r.targetUser.name)} №${r.target}` : ""}</div>
        <div class="aud-who"><b>${esc(r.actorUser ? r.actorUser.name : "—")}</b>${r.details ? ` · ${esc(r.details)}` : ""}</div></div></div>`).join("")}</div>` : '<p class="muted">Змін ще не було.</p>'}</div>`;
}

async function view() {
  const d = st.d = await call("/api/admin");
  if (st.tab === "promo") st.promo = await call("/api/admin/promo");
  const body = { users: usersView, promo: () => promoView(st.promo), nick: nickView, perms: permsView, roles: rolesView, chan: chanView, sys: sysView, log: logView }[st.tab](d);
  return `<div class="adm-head"><div><div class="eyebrow">Керування ЄІС «Сова»</div><b>Адмін-панель</b></div><span class="muted small">Доступ: Голова СБУ та Куратор</span></div>
    <div class="tabs">${TABS.map(([k, l]) => `<button class="tb ${st.tab === k ? "on" : ""}" data-a="admtab" data-v="${k}">${l}</button>`).join("")}</div>${body}`;
}
S.views.admin = view;

const run = async (b, fn) => { if (b) b.disabled = true; try { await fn(); } catch (e) { toast(e.message, 1); } if (b) b.disabled = false; };
const ASK = { block: "Заблокувати доступ до сайту? Усі входи буде завершено.", unblock: "Розблокувати доступ?", logout: "Завершити всі входи цього користувача?",
  reset: "Видати новий код доступу? Старий перестане діяти, код прийде в особисті Discord.", unlink: "Відв'язати Discord? Людина не зможе увійти, доки не оформить допуск знову.", sync: null,
  archive: "Перенести в архів як звільненого? Вхід на сайт закриється, з особового складу зникне. Ролі в Discord не змінюються.", restore: "Повернути з архіву?" };
Object.assign(S.actions, {
  admtab: (b) => { st.tab = b.dataset.v; S.render(); },
  admu: (b) => run(b, async () => {
    const x = b.dataset.x, body = {};
    if (x === "rename") { const n = prompt("Ім'я та прізвище персонажа (IC):", b.dataset.name || ""); if (!n) return; body.name = n; }
    else if (ASK[x] && !confirm(ASK[x])) return;
    const r = await call(`/api/admin/user/${b.dataset.sid}/${x}`, { json: body });
    if (x === "reset" && r.code) alert(`Особисті повідомлення закриті. Передайте код особисто:\n\n${r.code}`);
    toast(x === "sync" ? `Ролі звірено: ${r.result}` : x === "reset" ? (r.sent ? "Новий код надіслано в Discord" : "Код показано") : "Готово");
    S.render();
  }),
  admsync: (b) => run(b, async () => { const r = await call("/api/admin/sync", { json: {} }); toast(`Ролі звірено: ${r.count} у штаті`); S.render(); }),
  admbackup: (b) => run(b, async () => { const r = await call("/api/admin/backup", { json: {} }); toast(`Копію ${r.name} збережено`); S.render(); }),
  admpermreset: (b) => run(b, async () => { if (!confirm("Повернути всі доступи до стандартних?")) return; await call("/api/admin/perms", { json: {} }); toast("Доступи стандартні"); await S.refreshMe(); S.render(); }),
  admcs: (b) => run(b, async () => {
    const v = document.getElementById(`cs-${b.dataset.sid}`).value.trim();
    const r = await call(`/api/admin/callsign/${b.dataset.sid}`, { json: { callsign: v } });
    toast(`${r.callsign ? "Позивний " + r.callsign : "Позивний знято"} · нікнейм ${r.applied ? "змінено" : "не вдалося змінити"}: ${r.nick}`);
    S.render();
  }),
  admnick1: (b) => run(b, async () => { const r = await call(`/api/admin/nick/apply/${b.dataset.sid}`, { json: {} }); toast(r.applied ? "Нікнейм поставлено" : "Не вдалося: роль людини вища за роль бота або вона не на сервері", !r.applied); }),
  admnickall: (b) => run(b, async () => {
    if (!confirm("Перейменувати всіх співробітників у Discord за поточним форматом? Бот робитиме це поступово, ~1 людина на секунду.")) return;
    const r = await call("/api/admin/nick/apply", { json: {} });
    toast(`Перейменування запущено: ${r.total} співробітників, ~${Math.ceil(r.total * 1.2 / 60)} хв`);
  }),
  admnickdef: (b) => run(b, async () => { if (!confirm("Повернути стандартний формат нікнеймів?")) return; await call("/api/admin/nick", { json: {} }); toast("Формат стандартний"); S.render(); }),
  admactdel: (b) => run(b, async () => {
    if (!confirm(`Видалити пункт звітів «${b.dataset.name}»? Він зникне з форми звіту. Уже подані звіти й бали лишаться.`)) return;
    await call(`/api/admin/acts/${encodeURIComponent(b.dataset.key)}/delete`, { json: {} }); toast("Пункт видалено"); await reloadMeta(); S.render();
  }),
  admmdef: (b) => run(b, async () => { await call("/api/admin/mentions", { json: { [b.dataset.k]: null } }); toast("Повернено стандартні згадки"); S.render(); }),
});
const formData = (f) => Object.fromEntries([...f.querySelectorAll("[name]")].map((el) => [el.name, el.value]));
S.forms.admperms = (f) => run(f.querySelector("[type=submit]"), async () => { await call("/api/admin/perms", { json: formData(f) }); toast("Доступи збережено"); await S.refreshMe(); S.render(); });
S.forms.admnick = (f) => run(f.querySelector("[type=submit]"), async () => {
  const body = { tpl: f.querySelector("[name=tpl]").value, callsignTpl: f.querySelector("[name=callsignTpl]").value,
    ranks: [...f.querySelectorAll("[name=rank]")].map((el) => el.value.trim() || el.placeholder),
    depts: [...f.querySelectorAll("[name=dept]:checked")].map((el) => el.value) };
  await call("/api/admin/nick", { json: body }); toast("Формат нікнеймів збережено"); S.render();
});
S.forms.admpromo = (f) => run(f.querySelector("[type=submit]"), async () => {
  const v = (n) => (f.querySelector(`[name="${n}"]`) || {}).value;
  const cfg = Object.fromEntries(Object.keys(st.promo.cfg).map((r) => [r, { pts: v(`pts-${r}`), exam: v(`exam-${r}`), mode: v(`mode-${r}`) }]));
  const acts = Object.fromEntries(st.promo.acts.map((a) => [a.key, v(`act-${a.key}`)]));
  await call("/api/admin/promo", { json: { cfg, acts } }); toast("Систему підвищення збережено"); await S.refreshMe(); S.render();
});
// після зміни пунктів звітів — свіжий довідник (назви й бали у формі звіту)
const reloadMeta = async () => { if (S.reloadMeta) await S.reloadMeta(); await S.refreshMe(); };
document.addEventListener("change", (e) => {  // «Лише обрані відділи…» — показати галочки відділів
  if (e.target.matches(".adm-act [name=scope]")) e.target.closest(".adm-act").querySelector(".adm-checks").hidden = e.target.value !== "list";
});
S.forms.admact = (f) => run(f.querySelector("[type=submit]"), async () => {
  const scope = f.querySelector("[name=scope]").value;
  const body = { key: f.dataset.key || undefined, name: f.querySelector("[name=name]").value.trim(), points: f.querySelector("[name=points]").value,
    depts: scope === "list" ? [...f.querySelectorAll(".adm-checks input:checked")].map((x) => x.value) : scope, art: f.querySelector("[name=art]").checked };
  await call("/api/admin/acts", { json: body }); toast(f.dataset.key ? "Пункт збережено" : "Пункт додано у форму звітів"); await reloadMeta(); S.render();
});
S.forms.admchan =(f) => run(f.querySelector("[type=submit]"), async () => { await call("/api/admin/channels", { json: formData(f) }); toast("Канали збережено"); S.render(); });
// лише змінені поля: решта лишаються стандартними
const changed = (f) => Object.fromEntries([...f.querySelectorAll("[name]")].filter((el) => el.value !== el.defaultValue).map((el) => [el.name, el.value]));
S.forms.admment = (f) => run(f.querySelector("[type=submit]"), async () => { await call("/api/admin/mentions", { json: changed(f) }); toast("Згадки збережено"); S.render(); });
// адреса: #/admin/вкладка
S.routes.admin = { get: () => [st.tab], set: (p) => { st.tab = p[0] || "users"; } };
})();
