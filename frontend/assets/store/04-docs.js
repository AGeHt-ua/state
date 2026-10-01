/* Сховище порталу (4/5): Документи: шлях погодження, права, Конгрес, типи, звернення, повідомлення.
   Файли assets/store/*.js підключаються саме в цьому порядку й разом утворюють спільні функції сторінок. */

/* ---------- Шлях погодження ----------
   Кожен апарат має простий шлях: [керівник апарату] → [Конгрес — лише для законодавчих типів] → [Губернатор] → публікація.
   Що з цього вмикати, адміністратор задає в картці апарату. Автор не погоджує сам себе: його крок пропускається. */
function officeApproval(officeId) {
  const office = allOffices().find((o) => o.id === officeId);
  const a = (office && office.approval) || {};
  return { head: a.head !== false, governor: a.governor !== false };
}

function activeApprovalRoute(office) {
  const a = officeApproval(office);
  const steps = [];
  if (a.head) steps.push("authorOffice");
  if (a.governor) steps.push("position:governor-chief");
  const names = { authorOffice: "керівник апарату", "position:governor-chief": "Губернатор" };
  return { id: "path-" + (office || "all"), name: "Шлях апарату: " + (steps.map((x) => names[x]).join(" → ") || "без погодження"), ownerOffice: office || "all", steps, active: true, auto: true };
}

// Хто саме зараз займає посаду кроку — щоб у шляху було видно не лише посаду, а й людину
function stepHolders(step) {
  const raw = String(step || "");
  if (raw.startsWith("position:")) return allUsers().filter((u) => u.positionId === raw.slice(9) && isStaff(u)).map((u) => u.name || u.login);
  if (raw.startsWith("user:")) { const u = allUsers().find((x) => x.login === raw.slice(5)); return u ? [u.name || u.login] : []; }
  return [];
}

function stepShortName(step, doc) {
  if (step === "congress") return "Конгрес";
  if (String(step || "").startsWith("user:")) {
    const u = allUsers().find((x) => x.login === String(step).slice(5));
    const p = u && positionById(u.positionId);
    return p ? p.title : "Посадовець";
  }
  return routeStepName(step, doc).split(" · ")[0];
}

/* Шлях документа ланцюжком: Автор → кроки → Публікація. Пройдені кроки — ✓, поточний підсвічено.
   Для попереднього перегляду (ще не відправлено) передайте { approvalSteps, preview: true }. */
function approvalPathHtml(doc, opts = {}) {
  const steps = doc.approvalSteps || [];
  const status = doc.status;
  const current = Number(doc.approvalIndex || 0);
  const inRoute = !opts.preview && (status === "review" || status === "congress");
  const finished = !opts.preview && ["ok", "adopted", "dead"].includes(status);
  const returned = !opts.preview && (status === "draft" || status === "rejected") && (doc.returnedReason || doc.rejectedReason);
  const item = (cls, title, sub) => `<li class="${cls}"><b>${esc(title)}</b>${sub ? `<small>${esc(sub)}</small>` : ""}</li>`;
  const parts = [item("done", opts.authorLabel || "Автор", opts.authorName || doc.author || "")];
  steps.forEach((step, i) => {
    let cls = "wait";
    if (finished || (inRoute && i < current)) cls = "done";
    else if (inRoute && i === current) cls = "current";
    else if (returned && i === current) cls = "back";
    let sub = "";
    if (step === "congress") {
      const t = congressTally(doc);
      sub = inRoute && i === current ? "за " + t.pro + " з " + t.needed + " потрібних" : t.members + " конгресм., потрібно " + t.needed + " «за»";
    } else sub = stepHolders(step).join(", ") || (String(step).startsWith("position:") ? "посада вакантна" : "");
    parts.push(item(cls, stepShortName(step, doc), sub));
  });
  parts.push(item(finished ? "done final" : "wait final", status === "dead" && !opts.preview ? "Втратив чинність" : "Публікація", ""));
  return `<ol class="approval-path${opts.compact ? " compact" : ""}">${parts.join("")}</ol>`;
}

function saveApprovalRoute(route) {
  const ownerOffice = route.ownerOffice || "all";
  const row = {
    id: String(route.id || newDocId()).trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-"),
    name: String(route.name || "").trim(),
    ownerOffice,
    steps: (route.steps || []).map((s) => String(s).trim()).filter((s) => s && (s === "congress" || s === "authorOffice" || s.startsWith("position:") || s.startsWith("user:"))),
    active: !!route.active,
    seeded: false
  };
  if (!row.id || !row.name || !row.steps.length) return null;
  const extra = loadLS("state_approval_routes", []);
  const normalized = row.active
    ? extra.map((r) => (r.ownerOffice || "all") === ownerOffice ? Object.assign({}, r, { active: false }) : r)
    : extra.slice();
  const i = normalized.findIndex((r) => r.id === row.id);
  if (i >= 0) normalized[i] = Object.assign({}, normalized[i], row);
  else normalized.push(row);
  saveLS("state_approval_routes", normalized);
  return row;
}

function approverPositionForOffice(office) {
  const positions = allPositions().filter((p) => p.office === office && (p.permissions || []).includes("approveDocs"))
    .sort((a, b) => (b.level === "head") - (a.level === "head"));
  return positions[0] ? "position:" + positions[0].id : "";
}

function normalizeApprovalStep(step, doc) {
  const raw = String(step || "").trim();
  // Немає керівника з правом погодження — крок пропускається
  if (raw === "authorOffice") return approverPositionForOffice(doc.office || "directors");
  if (raw.startsWith("office:")) return approverPositionForOffice(raw.slice(7)) || raw.slice(7);
  if (raw.startsWith("position:") || raw.startsWith("user:")) return raw;
  if (allOffices().some((office) => office.id === raw)) return approverPositionForOffice(raw) || raw;
  return raw;
}

function resolveApprovalSteps(doc, route) {
  const seen = {};
  const raw = (route && route.steps && route.steps.length ? route.steps : ["position:governor-chief"]);
  // Автор не погоджує власний документ: його посада / він сам у маршруті пропускаються
  const author = doc && doc.ownerLogin ? allUsers().find((u) => u.login === doc.ownerLogin) : null;
  const own = author ? ["user:" + author.login, author.positionId ? "position:" + author.positionId : ""] : [];
  const steps = raw.map((step) => normalizeApprovalStep(step, doc))
    .filter((step) => {
      if (!step || seen[step] || own.includes(step)) return false;
      seen[step] = true;
      return true;
    });
  // Вакантна посада (ніхто її не займає) пропускається, інакше документ застряг би на ній.
  // Якщо вакантне все — лишаємо останній крок: такі документи може погодити адміністратор (approveAnyDocs).
  const staffed = steps.filter((step) => !String(step).startsWith("position:") || stepHolders(step).length);
  return staffed.length ? staffed : steps.slice(-1);
}

function routeStepName(step, doc) {
  if (step === "authorOffice") return "Керівник апарату автора";
  if (step === "congress") return "Конгрес";
  if (String(step || "").startsWith("office:")) return officeName(String(step).slice(7));
  if (String(step || "").startsWith("position:")) {
    const id = String(step).slice(9);
    const position = positionById(id);
    return position ? (position.title + " · " + officeName(position.office)) : id;
  }
  if (String(step || "").startsWith("user:")) {
    const login = String(step).slice(5);
    const user = allUsers().find((u) => u.login === login);
    return user ? (user.name || user.login) : login;
  }
  return officeName(step || (doc && doc.approverOffice));
}

function routeProgressLabel(doc) {
  const steps = doc.approvalSteps || [];
  if (!steps.length) return doc.approverOffice ? officeName(doc.approverOffice) : "Погодження";
  const current = Math.min(Number(doc.approvalIndex || 0), steps.length - 1);
  const who = stepHolders(steps[current]).join(", ");
  return "Зараз у: " + stepShortName(steps[current], doc) + (who ? " (" + who + ")" : "") + " · крок " + (current + 1) + " з " + steps.length;
}

// Права = права посади + особисті права, видані в адмін-панелі (лише посадовцям)
function userPermissions(user) {
  if (!user) return [];
  if (((user.roles || [])[0]) === "governor") return Object.keys(PERMISSION_LABELS);
  if (!isStaff(user)) return [];
  const position = positionById(user.positionId);
  const own = position ? (position.permissions || []) : [];
  const full = "extraPermissions" in user ? user : allUsers().find((u) => u.login === (user.login || user.id));
  const extra = ((full && full.extraPermissions) || []).filter((p) => PERMISSION_LABELS[p]);
  return own.concat(extra.filter((p) => !own.includes(p)));
}

function isFullAdmin(user) {
  return Object.keys(PERMISSION_LABELS).every((p) => hasPermission(user, p));
}

// Особисті права: видати можна лише ті, що є в самого адміністратора
function setUserPermissions(login, permissions, byUser) {
  if (!byUser || !hasPermission(byUser, "managePeople")) return null;
  const user = allUsers().find((u) => u.login === login);
  if (!user) return null;
  const allowed = (permissions || []).filter((p) => PERMISSION_LABELS[p] && hasPermission(byUser, p));
  // Права, яких адміністратор не має, він і не може забрати
  const kept = (user.extraPermissions || []).filter((p) => PERMISSION_LABELS[p] && !hasPermission(byUser, p));
  const next = Object.assign({}, user, { extraPermissions: kept.concat(allowed.filter((p) => !kept.includes(p))) });
  saveUser(next);
  return next;
}

function hasPermission(user, permission) {
  return userPermissions(user).includes(permission);
}

function isCongressPosition(position) {
  return !!(position && (position.congressMember || (position.permissions || []).includes("voteCongress")));
}

// Конгресмен — статус конкретної людини (ставиться в адмін-панелі), а не посада чи роль
function isCongressMember(user) {
  if (!user) return false;
  if ("congressMember" in user) return !!user.congressMember;
  const full = allUsers().find((u) => u.login === (user.login || user.id));
  return !!(full && full.congressMember);
}

function congressMembers() {
  return allUsers().filter((user) => isCongressMember(user));
}

function congressPositions() {
  return allPositions().filter(isCongressPosition);
}

function isStaff(user) {
  const roles = (user && user.roles) || [];
  return ["governor", "official", "prosecutor", "court"].some((r) => roles.includes(r));
}

function isCitizen(user) {
  return ((user && user.roles) || []).includes("citizen");
}

function isCabinetUser(user) {
  return isStaff(user) || isCitizen(user);
}

function requireAuth(neededRole) {
  const user = currentUser();
  if (!user) {
    location.href = pathTo("cabinet/portal/");
    return null;
  }
  if (!isCabinetUser(user)) {
    location.href = pathTo("cabinet/pending/");
    return null;
  }
  if (neededRole && !hasRole(user, neededRole)) {
    location.href = pathTo("denied/");
    return null;
  }
  return user;
}

function requireGovernor() {
  return requireAuth("governor");
}

function allDocs() {
  const extra = loadLS("state_docs", []);
  const byId = {};
  SEED_DOCS.forEach((d) => { byId[d.id] = d; });
  extra.forEach((d) => { byId[d.id] = d; });
  return Object.values(byId)
    .filter((d) => d.status !== "deleted")
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

function publishedDocs() {
  return allDocs().filter((d) => d.status === "ok" || d.status === "dead");
}

function isLegislativeDoc(doc) {
  return ["Конституція штату", "Кодекс", "Закон"].includes(doc && doc.type) ||
    customDocTypes().some((t) => t.congress && t.label === (doc && doc.type));
}

// Публічна база: чинні й архівні акти будь-якого виду; проєкти (у т.ч. на погодженні) — лише законодавчі
function publicLegislativeDocs() {
  return allDocs().filter((d) =>
    d.status === "ok" || d.status === "dead" ||
    (isLegislativeDoc(d) && ["review", "congress", "adopted", "draft"].includes(d.status))
  );
}

function homeDocs() {
  return allDocs()
    .filter((d) => d.publishHome === true && d.status !== "trash" && d.status !== "rejected")
    .sort((a, b) => String(b.publishedAt || b.date).localeCompare(String(a.publishedAt || a.date)));
}

// «Основний закон штату»: Конституція та інші основоположні акти (позначка в редакторі) — окремий блок на головній
function fundamentalDocs() {
  return allDocs()
    .filter((d) => d.fundamental === true && (d.status === "ok" || d.status === "adopted"))
    .sort((a, b) => String(a.publishedAt || a.date).localeCompare(String(b.publishedAt || b.date)));
}

// Позначки документа, які адміністратор перемикає прямо в реєстрі (без нової редакції тексту)
function setDocFlag(id, user, flag, value) {
  const doc = getDoc(id);
  if (!doc || !canManageDocs(user) || !["fundamental", "publishHome"].includes(flag)) return null;
  const labels = { fundamental: "«Основний закон штату»", publishHome: "«На головній»" };
  return saveDoc(Object.assign({}, doc, { [flag]: !!value, seeded: false }), {
    user,
    action: value ? "Додано до розділу " + labels[flag] : "Прибрано з розділу " + labels[flag],
    summary: (value ? "Документ додано до розділу " : "Документ прибрано з розділу ") + labels[flag] + "."
  });
}

// Хто підписує документ: проєкт готує автор, а підписує той, хто його остаточно погодив
// (останнє особисте рішення маршруту; голосування Конгресу — колегіальне, підписом не є).
// Якщо документ автор опублікував сам — підписує автор (null).
function docSigner(doc) {
  if (!doc || !["ok", "dead", "adopted"].includes(doc.status)) return null;
  const done = (doc.approvals || []).filter((a) => a && a.decision === "approved" && a.step !== "congress" && a.by);
  const last = done[done.length - 1];
  if (!last || last.by === doc.ownerLogin) return null;
  const person = allUsers().find((u) => u.login === last.by);
  return { login: last.by, name: (person && person.name) || last.byName || last.by, post: last.post || (person && person.post) || "" };
}

// Вигляд документа з підписом того, хто погодив: поля «ПІБ підписанта», «Розчерк», «Посада підписанта»
function signedDocHtml(doc) {
  const html = (doc && doc.docHtml) || "";
  const signer = docSigner(doc);
  if (!signer || !html) return html;
  const box = new DOMParser().parseFromString("<div>" + html + "</div>", "text/html").body.firstChild;
  box.querySelectorAll('.fld[data-f="signer"], .fld[data-f="signText"]').forEach((el) => { el.textContent = signer.name; el.classList.remove("empty"); });
  if (signer.post) box.querySelectorAll('.fld[data-f="officer"]').forEach((el) => { el.textContent = signer.post; el.classList.remove("empty"); });
  return box.innerHTML;
}

// Порівняння редакцій по словах: [{ t: "same"|"add"|"del", s: "текст" }]. Для дуже великих текстів — по абзацах.
function diffWords(a, b) {
  const split = (x, byLine) => byLine ? String(x || "").split(/(\n)/) : String(x || "").split(/(\s+)/);
  let byLine = false;
  let A = split(a), B = split(b);
  if (A.length * B.length > 4000000) { byLine = true; A = split(a, true); B = split(b, true); }
  if (A.length * B.length > 4000000) return [{ t: "del", s: String(a || "") }, { t: "add", s: String(b || "") }];
  const n = A.length, m = B.length;
  const L = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out = [];
  const push = (t, s) => { if (out.length && out[out.length - 1].t === t) out[out.length - 1].s += s; else out.push({ t, s }); };
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) { push("same", A[i]); i++; j++; }
    else if (L[i + 1][j] >= L[i][j + 1]) push("del", A[i++]);
    else push("add", B[j++]);
  }
  while (i < n) push("del", A[i++]);
  while (j < m) push("add", B[j++]);
  return out;
}

function cabinetCreatedDocs() {
  return allDocs()
    .filter((d) => !d.seeded && d.status !== "trash")
    .sort((a, b) => String(b.publishedAt || b.date).localeCompare(String(a.publishedAt || a.date)));
}

function reviewDocsFor(user) {
  if (!user || !isStaff(user)) return [];
  const office = userOffice(user);
  const positionStep = "position:" + (user.positionId || "");
  return allDocs().filter((d) => {
    if (d.status !== "review" && d.status !== "congress") return false;
    // Голосування Конгресу: показуємо членам, які ще не голосували
    if (d.approverOffice === "congress") return isCongressMember(user) && !((d.votes || {})[user.login]);
    return d.approverOffice === office ||
      d.approverOffice === positionStep ||
      d.approverOffice === "user:" + user.login ||
      d.approverLogin === user.login;
  });
}

function approvalNewsFor(user) {
  return reviewDocsFor(user).map((doc) => ({
    id: "approval-" + doc.id,
    at: doc.updatedAt || doc.publishedAt || doc.date || new Date().toISOString(),
    title: "Надійшов документ на погодження",
    text: (doc.type || "Документ") + " · " + (doc.title || "Без назви"),
    href: pathTo("cabinet/inbox/"),
    docId: doc.id
  }));
}

function allAppeals() {
  return loadLS("state_appeals", []).sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)));
}

function appealNumber() {
  const year = new Date().getFullYear();
  const n = allAppeals().filter((a) => String(a.number || "").includes("-" + year + "-")).length + 1;
  return "ZV-" + year + "-" + String(n).padStart(4, "0");
}

function appealsForUser(user) {
  if (!user) return [];
  if (isCitizen(user)) return allAppeals().filter((a) => a.ownerLogin === user.login);
  if (isStaff(user)) return allAppeals().filter((a) => a.ownerLogin === user.login || a.office === userOffice(user) || canSeeAllAppeals(user));
  return [];
}

function canSeeAllAppeals(user) {
  return hasPermission(user, "manageAppeals") || hasPermission(user, "managePeople");
}

function citizenAppealsFor(user) {
  return allAppeals().filter((a) => a.ownerLogin === (user && user.login));
}

function officeAppealsFor(user) {
  if (!isStaff(user)) return [];
  return allAppeals().filter((a) => a.office === userOffice(user) || canSeeAllAppeals(user));
}

function saveAppeal(appeal, meta = {}) {
  const previous = allAppeals().find((a) => a.id === appeal.id);
  const now = new Date().toISOString();
  const actor = meta.user || currentUser();
  const next = Object.assign({}, previous || {}, appeal, {
    id: appeal.id || ("appeal-" + Date.now().toString(36)),
    number: appeal.number || (previous && previous.number) || appealNumber(),
    status: appeal.status || (previous && previous.status) || "waiting",
    createdAt: (previous && previous.createdAt) || appeal.createdAt || now,
    updatedAt: now
  });
  const thread = (previous && previous.thread) || appeal.thread || [];
  if (meta.message || (meta.attachments && meta.attachments.length)) {
    thread.push(Object.assign({
      at: now,
      by: actor && (actor.login || actor.id),
      byName: actorName(actor),
      text: String(meta.message || "").trim()
    }, Array.isArray(meta.attachments) && meta.attachments.length ? { attachments: meta.attachments } : {}));
  }
  next.thread = thread;
  const items = allAppeals().filter((a) => a.id !== next.id);
  items.push(next);
  saveLS("state_appeals", items);
  return next;
}

function appealStatusLabel(status) {
  return {
    waiting: "Очікує відповіді",
    answered: "Відповідь надана",
    closed: "Закрито"
  }[status] || status;
}

function pendingAppealsFor(user) {
  return officeAppealsFor(user).filter((a) => a.status === "waiting" && a.ownerLogin !== (user && user.login));
}

function allProfileRequests() {
  return loadLS("state_profile_requests", []).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

function pendingProfileRequests() {
  return allProfileRequests().filter((r) => r.status === "pending");
}

function profileRequestsForUser(user) {
  return allProfileRequests().filter((r) => r.login === (user && user.login));
}

function saveProfileRequest(request) {
  const now = new Date().toISOString();
  const row = Object.assign({}, request, {
    id: request.id || ("profile-" + Date.now().toString(36)),
    status: request.status || "pending",
    createdAt: request.createdAt || now,
    updatedAt: now
  });
  const items = allProfileRequests().filter((r) => r.id !== row.id);
  items.push(row);
  saveLS("state_profile_requests", items);
  return row;
}

function decideProfileRequest(id, admin, approved) {
  const request = allProfileRequests().find((r) => r.id === id);
  if (!request) return null;
  const user = allUsers().find((u) => u.login === request.login);
  const next = Object.assign({}, request, {
    status: approved ? "approved" : "rejected",
    decidedAt: new Date().toISOString(),
    decidedBy: admin && admin.login
  });
  saveProfileRequest(next);
  if (approved && user) {
    const patch = {
      name: request.name || user.name,
      photo: request.photo || user.photo,
      contact: request.contact || user.contact,
      statId: request.statId || user.statId,
      post: request.post || user.post
    };
    saveUser(Object.assign({}, user, patch));
    const current = currentUser();
    if (current && current.login === user.login) saveLS("state_session", Object.assign(current, patch, { username: patch.name }));
  }
  return next;
}

function formatDocWhen(doc) {
  const raw = doc.publishedAt || doc.date || "";
  if (/^\d{2}\.\d{2}\.\d{4}$/.test(raw)) return raw;
  const d = new Date(raw);
  if (!isNaN(d.getTime()) && String(raw).includes("T")) {
    const pad = (n) => String(n).padStart(2, "0");
    return pad(d.getDate()) + "." + pad(d.getMonth() + 1) + "." + d.getFullYear() +
      " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const [y, m, day] = raw.split("-");
    return day + "." + m + "." + y;
  }
  return raw;
}

const ACT_SECTIONS = [
  { key: "all", label: "Усі акти" },
  { key: "Конституція штату", label: "Конституція" },
  { key: "Кодекс", label: "Кодекси" },
  { key: "Закон", label: "Закони" },
  { key: "Наказ", label: "Накази" },
  { key: "Указ", label: "Укази" },
  { key: "Розпорядження", label: "Розпорядження" },
  { key: "Постанова", label: "Постанови" },
  { key: "Доручення", label: "Доручення" },
  { key: "Ордер", label: "Ордери" },
  { key: "Наказ Голови ВС", label: "Накази ВС" },
  { key: "Повістка", label: "Повістки" },
  { key: "Ухвала суду", label: "Ухвали" }
];

/* ---------- Типи документів, створені в адмін-панелі (state_doc_types) ----------
   { id, label: «Постанова», section: «Постанови» (розділ у законодавчій базі), offices: [апарати, порожньо — усі],
     title / subject / preamble / effective — тексти шаблону в редакторі, congress: іде через голосування Конгресу,
     showInBase: окремий розділ у законодавчій базі } */
function customDocTypes() {
  return loadLS("state_doc_types", []);
}

function isBuiltinDocType(label) {
  return ACT_SECTIONS.some((s) => s.key === label) || DOC_TYPES.includes(label) ||
    ["Наказ суду", "Статут органу"].includes(label);
}

function saveDocType(type) {
  const label = String(type.label || "").trim().slice(0, 60);
  if (!label) return { ok: false, error: "Вкажіть назву типу." };
  const items = customDocTypes();
  const id = type.id || uniqueId(slugId(label) || "type", items.map((t) => t.id));
  if (isBuiltinDocType(label) || items.some((t) => t.id !== id && t.label.toLowerCase() === label.toLowerCase())) {
    return { ok: false, error: "Тип «" + label + "» уже існує." };
  }
  const row = {
    id,
    label,
    section: String(type.section || "").trim().slice(0, 60) || label,
    offices: (type.offices || []).filter((o) => allOffices().some((x) => x.id === o)),
    title: String(type.title || "").trim().slice(0, 200) || label + " №{НОМЕР}",
    subject: String(type.subject || "").trim().slice(0, 300),
    preamble: String(type.preamble || "").trim().slice(0, 1000),
    effective: String(type.effective || "").trim().slice(0, 500),
    congress: !!type.congress,
    showInBase: type.showInBase !== false
  };
  const i = items.findIndex((t) => t.id === id);
  if (i >= 0) items[i] = row;
  else items.push(row);
  return saveLS("state_doc_types", items) ? { ok: true, type: row } : { ok: false, error: "Не вдалося зберегти тип." };
}

function deleteDocType(id) {
  return saveLS("state_doc_types", customDocTypes().filter((t) => t.id !== id));
}

function docTypeUsage(label) {
  return allDocs().filter((d) => d.type === label).length;
}

// Розділи законодавчої бази: вбудовані + створені адміністратором
function actSections() {
  const custom = customDocTypes()
    .filter((t) => t.showInBase !== false && !ACT_SECTIONS.some((s) => s.key === t.label))
    .map((t) => ({ key: t.label, label: t.section || t.label }));
  return ACT_SECTIONS.concat(custom);
}

function docsBySection(section) {
  const list = publicLegislativeDocs();
  if (!section || section === "all") return list;
  if (section === "Ордер") return list.filter((d) => /ордер/i.test(d.type));
  return list.filter((d) => d.type === section);
}

function getDoc(id) {
  return allDocs().find((d) => d.id === id) || null;
}

function actorName(user) {
  return (user && (user.username || user.name || user.login)) || "Система";
}

function docVersionLabel(doc) {
  return VERSION_LABELS[doc.status] || "Редакція";
}

function describeDocChange(prev, next) {
  if (!prev) return "Створено документ.";
  const changes = [];
  const fields = [
    ["type", "вид"],
    ["number", "номер"],
    ["date", "дату"],
    ["title", "назву"],
    ["status", "статус"],
    ["publishHome", "публікацію на головній"],
    ["office", "апарат"]
  ];
  fields.forEach(([key, label]) => {
    if (String(prev[key] == null ? "" : prev[key]) !== String(next[key] == null ? "" : next[key])) changes.push("змінено " + label);
  });
  if (String(prev.text || "") !== String(next.text || "") || String(prev.docHtml || "") !== String(next.docHtml || "")) {
    changes.push("оновлено текст A4-документа");
  }
  if (String(prev.approverOffice || "") !== String(next.approverOffice || "")) changes.push("змінено поточний крок погодження");
  return changes.length ? changes.join(", ") + "." : "Без змін.";
}

function makeDocVersion(doc, actor, label) {
  return {
    id: "ver-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 6),
    at: new Date().toISOString(),
    by: actor && (actor.login || actor.id),
    byName: actorName(actor),
    label: label || docVersionLabel(doc),
    status: doc.status || "draft",
    title: doc.title || "",
    number: doc.number || "",
    date: doc.date || "",
    text: doc.text || "",
    docHtml: doc.docHtml || ""
  };
}

function saveDoc(doc, meta = {}) {
  if ((doc.status === "ok" || doc.status === "dead") && !doc.publishedAt) doc.publishedAt = new Date().toISOString();
  // Крок «Конгрес» завжди має статус голосування, інші кроки — «На погодженні»
  if (doc.status === "review" || doc.status === "congress") doc.status = doc.approverOffice === "congress" ? "congress" : "review";
  const previous = getDoc(doc.id);
  const actor = meta.user || currentUser();
  const summary = meta.summary || describeDocChange(previous, doc);
  const action = meta.action || (previous ? "Оновлено" : "Створено");
  const next = Object.assign({}, doc);
  next.updatedAt = new Date().toISOString();
  const history = (previous && previous.history) || doc.history || [];
  const versions = (previous && previous.versions) || doc.versions || [];
  next.history = history.concat([{
    at: new Date().toISOString(),
    by: actor && (actor.login || actor.id),
    byName: actorName(actor),
    action,
    summary
  }]).slice(-80);
  const shouldVersion = meta.forceVersion || !previous || summary !== "Без змін.";
  next.versions = shouldVersion ? versions.concat([makeDocVersion(next, actor, meta.versionLabel)]).slice(-30) : versions;
  const extra = loadLS("state_docs", []);
  const i = extra.findIndex((d) => d.id === next.id);
  if (i >= 0) extra[i] = next;
  else extra.push(next);
  saveLS("state_docs", extra);
  return next;
}

function trashDoc(id, byUser) {
  const doc = getDoc(id);
  if (!doc) return null;
  return saveDoc(Object.assign({}, doc, {
    status: "trash",
    previousStatus: doc.status || "draft",
    trashedAt: new Date().toISOString(),
    trashedBy: byUser && byUser.login,
    seeded: false
  }), { user: byUser, action: "Перенесено в кошик", summary: "Документ перенесено в кошик.", versionLabel: "Архів" });
}

function restoreDoc(id, byUser) {
  const doc = getDoc(id);
  if (!doc) return null;
  return saveDoc(Object.assign({}, doc, {
    status: doc.previousStatus || "draft",
    trashedAt: "",
    trashedBy: "",
    seeded: false
  }), { user: byUser, action: "Відновлено", summary: "Документ відновлено з кошика." });
}

function deleteDoc(id) {
  const extra = loadLS("state_docs", []);
  const doc = getDoc(id);
  if (!doc) return false;
  const isSeedDoc = SEED_DOCS.some((seed) => seed.id === id);
  if (isSeedDoc) {
    saveDoc(Object.assign({}, doc, { status: "deleted", seeded: false, deletedAt: new Date().toISOString() }));
    return true;
  }
  saveLS("state_docs", extra.filter((d) => d.id !== id));
  return true;
}

/* ---------- Погодження ----------
   Документ іде кроками approvalSteps; поточний крок — approverOffice (approvalIndex).
   Крок "congress" — колегіальне голосування: статус "congress", рішення більшістю членів Конгресу.
   Кожне рішення пишеться в doc.approvals — з цього будується блок «Підписанти». */
function docSteps(doc) {
  return doc.approvalSteps || (doc.approverOffice ? [doc.approverOffice] : []);
}

function canApproveDoc(doc, user) {
  if (!doc || !user || (doc.status !== "review" && doc.status !== "congress")) return false;
  if (reviewDocsFor(user).some((d) => d.id === doc.id)) return true;
  // Адміністратор погоджує будь-який крок поза чергою; голос Конгресу — лише особисто
  return doc.status === "review" && hasPermission(user, "approveAnyDocs");
}

/* ---------- Права адміністратора над документами ---------- */
// Документи на погодженні, що чекають не цього користувача, але він може втрутитися
function overrideDocsFor(user) {
  if (!isStaff(user) || !hasPermission(user, "approveAnyDocs")) return [];
  const own = reviewDocsFor(user).map((d) => d.id);
  return allDocs().filter((d) => (d.status === "review" || d.status === "congress") && !own.includes(d.id));
}

function canReturnDoc(doc, user) {
  return canApproveDoc(doc, user) || !!(doc && user && doc.status === "congress" && hasPermission(user, "approveAnyDocs"));
}

function canForcePublish(doc, user) {
  if (!doc || !user || !hasPermission(user, "publishDocs")) return false;
  if (!["draft", "review", "congress", "adopted"].includes(doc.status)) return false;
  return doc.ownerLogin === user.login || hasPermission(user, "approveAnyDocs");
}

// Публікація одразу, без решти маршруту
function forcePublishDoc(id, user) {
  const doc = getDoc(id);
  if (!canForcePublish(doc, user)) return null;
  const now = new Date().toISOString();
  return saveDoc(Object.assign({}, doc, {
    status: "ok",
    approverOffice: "",
    approverLogin: "",
    approvals: (doc.approvals || []).concat([{ step: "admin", by: user.login, byName: actorName(user), post: user.post || "", at: now, decision: "approved" }]),
    approvedAt: now,
    approvedBy: user.login,
    publishedAt: doc.publishedAt || now,
    seeded: false
  }), { user, action: "Опубліковано адміністратором", summary: "Документ опубліковано без решти маршруту погодження.", versionLabel: "Чинна версія" });
}

function canManageDocs(user) {
  return ((user && user.roles) || [])[0] === "governor" || hasPermission(user, "manageDocs") || hasPermission(user, "editAllDocs");
}

// Чинний ↔ втратив чинність
function setDocValidity(id, user, active) {
  const doc = getDoc(id);
  if (!doc || !canManageDocs(user)) return null;
  if (active ? doc.status !== "dead" : doc.status !== "ok") return null;
  return saveDoc(Object.assign({}, doc, { status: active ? "ok" : "dead", seeded: false }), {
    user,
    action: active ? "Відновлено чинність" : "Втратив чинність",
    summary: active ? "Документ знову чинний." : "Документ переведено в архів як такий, що втратив чинність.",
    versionLabel: active ? "Чинна версія" : "Архів"
  });
}

function congressTally(doc) {
  const votes = (doc && doc.votes) || {};
  const members = congressMembers().length;
  const values = Object.keys(votes).map((k) => votes[k].vote);
  const pro = values.filter((v) => v === "for").length;
  const contra = values.filter((v) => v === "against").length;
  return { pro, contra, voted: values.length, members, needed: Math.floor(Math.max(members, 1) / 2) + 1 };
}

function advanceDoc(doc, user, meta) {
  const steps = docSteps(doc);
  const index = Number(doc.approvalIndex || 0);
  const now = new Date().toISOString();
  const approvals = (doc.approvals || []).concat([{
    step: steps[index] || doc.approverOffice || "",
    by: user && user.login,
    byName: meta.byName || actorName(user),
    post: meta.post != null ? meta.post : ((user && user.post) || ""),
    at: now,
    decision: "approved"
  }]);
  if (steps.length && index + 1 < steps.length) {
    const nextStep = steps[index + 1];
    return saveDoc(Object.assign({}, doc, {
      status: nextStep === "congress" ? "congress" : "review",
      approvalIndex: index + 1,
      approverOffice: nextStep,
      approverLogin: String(nextStep).startsWith("user:") ? String(nextStep).slice(5) : "",
      votes: {},
      approvals,
      lastApprovedAt: now,
      lastApprovedBy: user && user.login
    }), {
      user,
      action: meta.action || "Погоджено крок маршруту",
      summary: (meta.summaryPrefix || "Погоджено: " + routeStepName(steps[index], doc) + ".") + " Наступний крок: " + routeStepName(nextStep, doc) + ".",
      versionLabel: "Редакція"
    });
  }
  return saveDoc(Object.assign({}, doc, {
    status: "ok",
    approvalIndex: steps.length ? steps.length - 1 : 0,
    approverOffice: "",
    approverLogin: "",
    approvals,
    approvedAt: now,
    approvedBy: user && user.login,
    publishedAt: doc.publishedAt || now
  }), {
    user,
    action: "Опубліковано",
    summary: (meta.summaryPrefix ? meta.summaryPrefix + " " : "") + (steps.length ? "Фінальний крок погоджено, документ опубліковано." : "Документ погоджено й опубліковано."),
    versionLabel: "Чинна версія"
  });
}

function approveDoc(id, user) {
  const doc = getDoc(id);
  if (!doc || !canApproveDoc(doc, user)) return null;
  if (doc.approverOffice === "congress") return voteDoc(id, user, "for");
  const inQueue = reviewDocsFor(user).some((d) => d.id === doc.id);
  if (inQueue) return advanceDoc(doc, user, {});
  const step = docSteps(doc)[Number(doc.approvalIndex || 0)] || doc.approverOffice;
  return advanceDoc(doc, user, {
    action: "Погоджено адміністратором поза чергою",
    summaryPrefix: "Адміністратор погодив крок «" + routeStepName(step, doc) + "» поза чергою."
  });
}

function voteDoc(id, user, vote) {
  const doc = getDoc(id);
  if (!doc || !canApproveDoc(doc, user) || doc.approverOffice !== "congress") return null;
  // На сервері голос дописується до документа атомарно — одночасні голоси не затирають один одного
  const res = apiRequest("POST", "/api/vote", { id, vote: vote === "against" ? "against" : "for" });
  if (res.data && res.data.doc) mergeRemoteRows({ state_docs: [res.data.doc] });
  if (!res.ok) { alert(res.data.error || "Не вдалося зарахувати голос."); return null; }
  return congressOutcome(getDoc(id), user) || getDoc(id);
}

// Підсумок голосування: більшість «за» — документ іде далі шляхом, більшість «проти» — відхилено; інакше null
function congressOutcome(next, user) {
  if (!next || next.approverOffice !== "congress") return null;
  const t = congressTally(next);
  if (t.pro >= t.needed) {
    return advanceDoc(next, user, {
      byName: "Конгрес штату",
      post: "За — " + t.pro + ", проти — " + t.contra + " з " + t.members,
      action: "Конгрес підтримав документ",
      summaryPrefix: "Конгрес проголосував «за» (" + t.pro + " з " + t.members + ")."
    });
  }
  if (t.contra >= t.needed) {
    return saveDoc(Object.assign({}, next, {
      status: "rejected",
      approverOffice: "",
      approverLogin: "",
      rejectedAt: new Date().toISOString(),
      rejectedReason: "Конгрес проголосував проти (" + t.contra + " з " + t.members + ").",
      approvals: (next.approvals || []).concat([{ step: "congress", byName: "Конгрес штату", post: "За — " + t.pro + ", проти — " + t.contra, at: new Date().toISOString(), decision: "rejected" }])
    }), { user, action: "Конгрес відхилив документ", summary: "Більшість членів Конгресу проголосувала проти.", versionLabel: "Відхилено" });
  }
  return null;
}

function returnDoc(id, user, reason) {
  const doc = getDoc(id);
  if (!doc || !canReturnDoc(doc, user)) return null;
  const now = new Date().toISOString();
  const text = String(reason || "").trim();
  return saveDoc(Object.assign({}, doc, {
    status: "draft",
    returnedAt: now,
    returnedBy: user.login,
    returnedByName: actorName(user),
    returnedReason: text,
    approverOffice: "",
    approverLogin: "",
    approvalIndex: 0,
    votes: {},
    approvals: (doc.approvals || []).concat([{ step: doc.approverOffice || "", by: user.login, byName: actorName(user), post: user.post || "", at: now, decision: "returned", comment: text }])
  }), {
    user,
    action: "Повернено на доопрацювання",
    summary: "Документ повернено автору" + (text ? ": " + text : "."),
    versionLabel: "Проєкт"
  });
}

/* Сповіщення кабінету: що чекає дії користувача і що сталося з його документами та зверненнями */
function notificationsFor(user) {
  if (!user) return [];
  const items = [];
  const weekAgo = Date.now() - 7 * 24 * 3600 * 1000;
  const recent = (iso) => iso && new Date(iso).getTime() > weekAgo;
  if (isStaff(user)) {
    reviewDocsFor(user).forEach((doc) => items.push({
      kind: doc.approverOffice === "congress" ? "vote" : "approve",
      attention: true,
      at: doc.updatedAt || doc.publishedAt || doc.date,
      title: doc.approverOffice === "congress" ? "Голосування Конгресу" : "Потрібне ваше погодження",
      text: (doc.type || "Документ") + " · " + (doc.title || "Без назви"),
      doc
    }));
    allDocs().filter((d) => d.ownerLogin === user.login).forEach((doc) => {
      if (doc.status === "draft" && doc.returnedAt && recent(doc.returnedAt)) items.push({ kind: "returned", attention: true, at: doc.returnedAt, title: "Документ повернено на доопрацювання", text: (doc.title || "") + (doc.returnedReason ? " — " + doc.returnedReason : ""), doc });
      else if (doc.status === "rejected" && recent(doc.rejectedAt || doc.updatedAt)) items.push({ kind: "rejected", attention: true, at: doc.rejectedAt || doc.updatedAt, title: "Документ відхилено", text: (doc.title || "") + (doc.rejectedReason ? " — " + doc.rejectedReason : ""), doc });
      else if (doc.status === "ok" && doc.approvedAt && recent(doc.approvedAt)) items.push({ kind: "published", at: doc.approvedAt, title: "Документ погоджено й опубліковано", text: doc.title || "", doc });
      else if (doc.status === "review" || doc.status === "congress") items.push({ kind: "progress", at: doc.updatedAt, title: "Ваш документ на погодженні", text: (doc.title || "") + " · " + routeProgressLabel(doc), doc });
    });
    pendingAppealsFor(user).forEach((a) => items.push({ kind: "appeal", attention: true, at: a.updatedAt || a.createdAt, title: "Нове звернення до апарату", text: a.number + " · " + (a.name || "") , appeal: a }));
    if (hasPermission(user, "approveProfiles") || hasPermission(user, "managePeople")) {
      const n = pendingProfileRequests().length;
      if (n) items.push({ kind: "profile", attention: true, at: new Date().toISOString(), title: "Заявки на зміну профілю", text: "Очікують підтвердження: " + n });
      const pend = allUsers().filter((u) => (u.roles || []).includes("pending")).length;
      if (pend) items.push({ kind: "people", attention: true, at: new Date().toISOString(), title: "Нові учасники без ролі", text: "Очікують призначення: " + pend });
    }
  }
  citizenAppealsFor(user).filter((a) => a.status === "answered").forEach((a) => items.push({ kind: "answer", attention: true, at: a.updatedAt, title: "Відповідь на звернення", text: a.number + " · " + officeName(a.office), appeal: a }));
  return items.sort((a, b) => (b.attention ? 1 : 0) - (a.attention ? 1 : 0) || String(b.at || "").localeCompare(String(a.at || "")));
}

function newDocId() {
  return "act-" + Date.now().toString(36);
}

function roleLabel(code) {
  return ROLE_LABELS[code] || code;
}

function badgeClass(status) {
  return status === "ok" || status === "adopted" ? "ok" : status === "draft" || status === "review" || status === "congress" ? "draft" : "dead";
}

function docHref(doc) {
  return pathTo("acts/view/?id=" + encodeURIComponent(doc.id));
}

function officeName(code) {
  const custom = allOffices().find((o) => o.id === code);
  return (custom && custom.name) || OFFICE_NAMES[code] || code || "—";
}


/* ---------- Судові справи ----------
   Справа: номер, вид, сторони (позивач / відповідач — людина порталу або просто ім'я), суддя, статус, засідання, рішення,
   матеріали (events: події та повідомлення сторін із вкладеннями). Пов'язані документи — doc.caseId.
   Права (так само перевіряє сервер): судова влада й повні адміністратори ведуть усі справи; сторони — бачать свої й додають матеріали. */
const CASE_STATUSES = {
  new: "Подано",
  open: "Відкрито провадження",
  hearing: "Призначено засідання",
  decided: "Винесено рішення",
  closed: "Закрито",
  rejected: "Відмовлено у відкритті"
};
const CASE_KINDS = ["Цивільна", "Кримінальна", "Адміністративна"];
const CASE_RESULTS = ["Позов задоволено", "Позов задоволено частково", "У позові відмовлено", "Визнано винним", "Виправдано", "Провадження закрито"];

function canManageCases(user) {
  return !!user && (isFullAdmin(user) || (isStaff(user) && userOffice(user) === "court"));
}
function allCases() {
  return loadLS("state_cases", []).slice()
    .sort((a, b) => String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || "")));
}
function getCase(id) {
  return allCases().find((c) => c.id === id) || null;
}
function isCaseParty(c, user) {
  const me = user && user.login;
  return !!me && ((c.plaintiff && c.plaintiff.login === me) || (c.defendant && c.defendant.login === me) || c.createdBy === me);
}
function casesForUser(user) {
  if (!user) return [];
  return canManageCases(user) ? allCases() : allCases().filter((c) => isCaseParty(c, user));
}
function caseNumber() {
  const year = new Date().getFullYear();
  const n = allCases().filter((c) => String(c.number || "").includes("-" + year + "-")).length + 1;
  return "С-" + year + "-" + String(n).padStart(4, "0");
}
function caseStatusClass(status) {
  return status === "decided" ? "ok" : status === "closed" || status === "rejected" ? "dead" : "draft";
}
function caseDocs(c) {
  return allDocs().filter((d) => d.caseId === c.id && d.status !== "trash");
}
// Зберегти справу; meta.event — подія в матеріалах (kind, text, attachments). Автора й час події ставить сервер.
function saveCase(c, meta = {}) {
  const previous = getCase(c.id);
  const now = new Date().toISOString();
  const next = Object.assign({}, previous || {}, c, {
    id: c.id || ("case-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5)),
    number: c.number || (previous && previous.number) || caseNumber(),
    // Сторона справи додає лише матеріали — решту полів (і час оновлення) змінює тільки суд
    updatedAt: !previous || canManageCases(meta.user || currentUser()) ? now : previous.updatedAt
  });
  const events = ((previous && previous.events) || c.events || []).slice();
  if (meta.event) {
    const user = meta.user || currentUser();
    events.push(Object.assign({ at: now, by: user && user.login, byName: actorName(user) }, meta.event));
  }
  next.events = events;
  const items = loadLS("state_cases", []).filter((x) => x.id !== next.id);
  items.push(next);
  saveLS("state_cases", items);
  return getCase(next.id) || next;
}
function formatHearing(at) {
  if (!at) return "";
  const m = String(at).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  return m ? m[3] + "." + m[2] + "." + m[1] + " " + m[4] + ":" + m[5] : String(at);
}

/* ---------- Вкладення: фото, скріни, PDF ----------
   Фото стискаються в браузері (до 1600 px, JPEG), PDF — як є (до 1,3 МБ). Файл належить зверненню чи справі (parent),
   відкрити його може лише той, хто має до них доступ. */
const ATTACH_LIMIT = 1300 * 1024;
function fileToBase64(blob) {
  return new Promise((done) => {
    const r = new FileReader();
    r.onerror = () => done("");
    r.onload = () => done(String(r.result || "").replace(/^data:[^,]*,/, ""));
    r.readAsDataURL(blob);
  });
}
async function uploadAttachment(parent, file) {
  let type = String(file.type || "");
  let data = "";
  let name = file.name || "файл";
  if (type.startsWith("image/") && type !== "image/gif") {
    const url = await new Promise((done) => shrinkImage(file, 1600, done));
    if (!url) return { ok: false, error: "Не вдалося прочитати зображення «" + name + "»." };
    data = url.replace(/^data:[^,]*,/, "");
    type = "image/jpeg";
    name = name.replace(/\.(png|webp|bmp|heic|jpe?g)$/i, "") + ".jpg";
  } else if (type === "application/pdf" || type === "image/gif") {
    if (file.size > ATTACH_LIMIT) return { ok: false, error: "«" + name + "» завеликий (до 1,3 МБ)." };
    data = await fileToBase64(file);
  } else {
    return { ok: false, error: "«" + name + "»: можна додавати фото й PDF." };
  }
  if (data.length * 3 / 4 > ATTACH_LIMIT) return { ok: false, error: "«" + name + "» завеликий навіть після стиснення (до 1,3 МБ)." };
  const res = await apiFetch("POST", "/api/attach", { parent, name, type, data });
  return res.ok ? { ok: true, meta: res.data } : { ok: false, error: res.data.error || "Не вдалося завантажити «" + name + "»." };
}
const ATTACH_URLS = {};
async function attachmentUrl(id) {
  if (ATTACH_URLS[id]) return ATTACH_URLS[id];
  try {
    const r = await fetch(REMOTE.url + "/api/attach/" + encodeURIComponent(id), { headers: { Authorization: "Bearer " + apiToken() } });
    if (!r.ok) return "";
    ATTACH_URLS[id] = URL.createObjectURL(await r.blob());
    return ATTACH_URLS[id];
  } catch (err) {
    return "";
  }
}
function attachSize(n) {
  return n > 1024 * 1024 ? (n / 1024 / 1024).toFixed(1) + " МБ" : Math.max(1, Math.round(n / 1024)) + " КБ";
}
// Розмітка вкладень повідомлення; мініатюри підвантажує hydrateAttachments(контейнер)
function attachmentsHtml(list) {
  if (!Array.isArray(list) || !list.length) return "";
  return `<div class="att-list">${list.map((a) => a.type && a.type.startsWith("image/")
    ? `<button type="button" class="att att-img" data-att="${attr(a.id)}" title="${attr(a.name)}"><span class="att-ph">🖼</span></button>`
    : `<button type="button" class="att att-file" data-att="${attr(a.id)}" title="Відкрити"><span>📄</span><b>${esc(a.name)}</b><small>${esc(attachSize(a.size || 0))}</small></button>`).join("")}</div>`;
}
function hydrateAttachments(root) {
  (root || document).querySelectorAll(".att-img[data-att]:not([data-ready])").forEach(async (b) => {
    b.dataset.ready = "1";
    const url = await attachmentUrl(b.dataset.att);
    b.innerHTML = url ? `<img src="${attr(url)}" alt="">` : `<span class="att-ph">⚠</span>`;
  });
}
// Один обробник на сторінку: клік по вкладенню відкриває файл у новій вкладці
document.addEventListener("click", async (e) => {
  const b = e.target.closest && e.target.closest("[data-att]");
  if (!b) return;
  e.preventDefault();
  const win = window.open("", "_blank");
  const url = await attachmentUrl(b.dataset.att);
  if (!url) { if (win) win.close(); alert("Не вдалося відкрити файл: немає доступу або зв'язку з сервером."); return; }
  if (win) win.location.href = url; else location.href = url;
});
// Вибір файлів для повідомлення: список «чипів» із можливістю прибрати
function attachPicker(input, box) {
  const files = [];
  const draw = () => {
    box.innerHTML = files.map((f, i) => `<span class="att-chip">${f.type === "application/pdf" ? "📄" : "🖼"} ${esc(f.name)} <button type="button" data-rm="${i}" aria-label="Прибрати">×</button></span>`).join("");
    box.hidden = !files.length;
  };
  input.addEventListener("change", () => {
    Array.from(input.files || []).forEach((f) => { if (files.length < 5) files.push(f); });
    input.value = "";
    draw();
  });
  box.addEventListener("click", (e) => {
    const b = e.target.closest("[data-rm]");
    if (b) { files.splice(Number(b.dataset.rm), 1); draw(); }
  });
  return {
    files,
    clear() { files.length = 0; draw(); },
    // Завантажити всі вибрані; помилка будь-якого файла зупиняє надсилання
    async upload(parent) {
      const out = [];
      for (const f of files) {
        const res = await uploadAttachment(parent, f);
        if (!res.ok) return { ok: false, error: res.error };
        out.push(res.meta);
      }
      return { ok: true, list: out };
    }
  };
}
