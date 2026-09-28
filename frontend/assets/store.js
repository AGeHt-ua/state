const ROLE_LABELS = {
  governor: "Кабінет Губернатора",
  congress: "Конгрес штату",
  official: "Кабінет Директорів Департаменту",
  prosecutor: "Кабінет Прокуратури",
  court: "Кабінет Судової влади",
  citizen: "Кабінет громадянина",
  pending: "Очікує призначення"
};

const OFFICE_BY_ROLE = {
  governor: "governor",
  congress: "congress",
  official: "directors",
  prosecutor: "prosecutor",
  court: "court"
};

const OFFICE_NAMES = {
  governor: "Кабінет Губернатора",
  congress: "Конгрес штату",
  directors: "Кабінет Директорів Департаменту",
  prosecutor: "Кабінет Прокуратури",
  court: "Кабінет Судової влади"
};

const DEFAULT_OFFICES = [
  { id: "governor", name: "Кабінет Губернатора", role: "governor", canApprove: true },
  { id: "congress", name: "Конгрес штату", role: "congress", canApprove: true },
  { id: "directors", name: "Кабінет Директорів Департаменту", role: "official", canApprove: true },
  { id: "prosecutor", name: "Кабінет Прокуратури", role: "prosecutor", canApprove: true },
  { id: "court", name: "Кабінет Судової влади", role: "court", canApprove: true }
];

const PERMISSION_LABELS = {
  createDocs: "Створювати документи",
  publishDocs: "Публікувати без погодження",
  approveDocs: "Погоджувати документи",
  voteCongress: "Голосувати в Конгресі",
  editOwnDocs: "Редагувати свої документи",
  editAllDocs: "Редагувати всі документи",
  managePeople: "Керувати учасниками",
  manageStructure: "Керувати структурою",
  manageRoutes: "Керувати маршрутами погодження",
  approveProfiles: "Підтверджувати зміни профілю"
};

const DEFAULT_POSITIONS = [
  {
    id: "governor-chief",
    office: "governor",
    title: "Губернатор штату",
    permissions: ["createDocs", "publishDocs", "approveDocs", "editOwnDocs", "editAllDocs", "managePeople", "manageStructure", "approveProfiles"],
    approvalRequired: false
  },
  {
    id: "congressman",
    office: "congress",
    title: "Конгресмен",
    permissions: ["createDocs", "approveDocs", "voteCongress", "editOwnDocs"],
    approvalRequired: true,
    approverOffice: "position:governor-chief",
    congressMember: true
  },
  {
    id: "director",
    office: "directors",
    title: "Директор департаменту",
    permissions: ["createDocs", "approveDocs", "editOwnDocs", "manageRoutes"],
    approvalRequired: true,
    approverOffice: "position:governor-chief"
  },
  {
    id: "prosecutor-chief",
    office: "prosecutor",
    title: "Генеральний прокурор",
    permissions: ["createDocs", "approveDocs", "editOwnDocs", "manageRoutes"],
    approvalRequired: true,
    approverOffice: "position:governor-chief"
  },
  {
    id: "court-chief",
    office: "court",
    title: "Голова Верховного Суду",
    permissions: ["createDocs", "approveDocs", "editOwnDocs", "manageRoutes"],
    approvalRequired: true,
    approverOffice: "position:governor-chief"
  }
];

function userOffice(user) {
  if (user && user.office) return user.office;
  const role = ((user && user.roles) || []).find((r) => r !== "pending") || "official";
  return OFFICE_BY_ROLE[role] || "directors";
}

function officeTitle(user) {
  if (user && user.office) return officeName(user.office);
  const role = ((user && user.roles) || [])[0] || "pending";
  return ROLE_LABELS[role] || ROLE_LABELS.pending;
}

const DOC_TYPES = ["Конституція штату", "Закон", "Указ", "Розпорядження", "Статут органу"];
const DOC_STATUSES = {
  ok: "Чинний",
  draft: "Проєкт",
  review: "На погодженні",
  congress: "На голосуванні Конгресу",
  adopted: "Прийнято Конгресом",
  rejected: "Відхилено",
  dead: "Втратив чинність",
  trash: "У кошику"
};

const VERSION_LABELS = {
  draft: "Проєкт",
  review: "Редакція",
  congress: "Голосування Конгресу",
  adopted: "Прийнято",
  rejected: "Відхилено",
  ok: "Чинна версія",
  dead: "Архів",
  trash: "Архів"
};

const DEFAULT_APPROVAL_ROUTES = [
  {
    id: "standard",
    name: "Автор → губернатор → публікація",
    ownerOffice: "all",
    steps: ["position:governor-chief"],
    active: true,
    seeded: true
  }
];

function esc(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function attr(value) {
  return esc(value).replace(/`/g, "&#96;");
}

function sanitizeDocHtml(html) {
  const parsed = new DOMParser().parseFromString(String(html || ""), "text/html");
  parsed.querySelectorAll("script, style, iframe, object, embed, link, meta").forEach((el) => el.remove());
  parsed.body.querySelectorAll("*").forEach((el) => {
    Array.from(el.attributes).forEach((a) => {
      if (/^on/i.test(a.name) || a.name === "contenteditable") el.removeAttribute(a.name);
      if ((a.name === "href" || a.name === "src") && /^\s*javascript:/i.test(a.value)) el.removeAttribute(a.name);
    });
  });
  return parsed.body.innerHTML;
}

const SEED_DOCS = [
  {
    id: "const-sa-01",
    type: "Конституція штату",
    number: "КС-01",
    date: "2026-09-08",
    publishedAt: "2026-09-08T12:00:00",
    status: "ok",
    body: "Уряд штату Сан-Андреас",
    title: "Конституція штату Сан-Андреас",
    text: "Ми, народ штату San Andreas (Ukraine GTA 5), розуміючи цінність свободи, порядку та справедливості, ухвалюємо цю Конституцію.",
    publishHome: true,
    seeded: true
  },
  {
    id: "law-gov-01",
    type: "Закон",
    number: "З-17",
    date: "2026-09-09",
    publishedAt: "2026-09-09T10:30:00",
    status: "ok",
    body: "Уряд штату Сан-Андреас",
    title: "Закон про діяльність Уряду",
    text: "Цей Закон визначає організацію роботи Уряду штату.",
    publishHome: true,
    seeded: true
  },
  {
    id: "decree-warrant-01",
    type: "Указ",
    number: "У-04",
    date: "2026-09-09",
    status: "draft",
    body: "Апарат Уряду",
    title: "Порядок видачі ордерів",
    text: "Ордер — службовий документ, що уповноважує визначену дію.",
    seeded: true
  },
  {
    id: "project-congress-law-01",
    type: "Закон",
    number: "ПЗ-01",
    date: "2026-09-11",
    publishedAt: "2026-09-11T09:00:00",
    status: "review",
    body: "Конгрес штату Сан-Андреас",
    title: "Проєкт Закону про порядок розгляду актів Конгресом",
    text: "Цей проєкт визначає, як Конституція, кодекси та закони проходять погодження і голосування Конгресу перед набранням чинності.",
    author: "Кабінет Губернатора",
    office: "governor",
    publishHome: true,
    approvalRouteName: "Автор → Конгрес → публікація",
    approvalSteps: ["congress"],
    approvalIndex: 0,
    approverOffice: "congress",
    seeded: true
  }
];

function loadLS(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

// Сховище браузера ~5 МБ; фото профілю й зображення в документах швидко його заповнюють.
// Запис ніколи не кидає помилку: при переповненні пробуємо зберегти без фото, інакше повертаємо false.
function saveLS(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (err) {
    try {
      if (key === "state_session" && value && typeof value === "object") {
        const slim = Object.assign({}, value);
        delete slim.photo;
        localStorage.setItem(key, JSON.stringify(slim));
        return true;
      }
      if (key === "state_users" && Array.isArray(value)) {
        localStorage.setItem(key, JSON.stringify(value.map((u) => {
          const row = Object.assign({}, u);
          delete row.photo;
          return row;
        })));
        return true;
      }
    } catch (e2) { /* місця немає навіть без фото */ }
    console.warn("localStorage full", key, err);
    return false;
  }
}

function allUsers() {
  const extra = loadLS("state_users", []);
  const seed = (window.STATE_ACCOUNTS || []).map((a) => ({
    login: a.login,
    password: a.password,
    name: a.name || a.login,
    roles: a.roles && a.roles.includes("governor") ? a.roles : remapSeedRoles(a),
    office: a.office || OFFICE_BY_ROLE[(a.roles || [])[0]] || "",
    positionId: a.positionId || defaultPositionForAccount(a),
    post: a.post || "",
    statId: a.statId || "",
    contact: a.contact || "",
    photo: a.photo || "",
    seeded: true
  }));
  const byLogin = {};
  seed.forEach((u) => { byLogin[u.login] = u; });
  extra.forEach((u) => { byLogin[u.login] = Object.assign({}, byLogin[u.login] || {}, u); });
  return Object.values(byLogin);
}

function remapSeedRoles(a) {
  const roles = a.roles || [];
  if (roles.includes("governor")) return roles;
  if (a.login === "castro" || a.login === "admin") return ["governor"];
  if (roles.includes("court")) return ["court"];
  if (roles.includes("admin_stub")) return ["official"];
  return roles.length ? roles : ["pending"];
}

function defaultPositionForAccount(a) {
  const roles = a.roles || [];
  if (roles.includes("governor") || a.login === "castro" || a.login === "admin") return "governor-chief";
  if (roles.includes("congress")) return "congressman";
  if (roles.includes("prosecutor")) return "prosecutor-chief";
  if (roles.includes("court")) return "court-chief";
  if (roles.includes("official")) return "director";
  return "";
}

function saveUser(user) {
  const extra = loadLS("state_users", []);
  const i = extra.findIndex((u) => u.login === user.login);
  const row = {
    login: user.login,
    password: user.password,
    name: user.name,
    roles: user.roles || ["pending"],
    office: user.office || userOffice(user),
    positionId: user.positionId || "",
    post: user.post || "",
    statId: user.statId || "",
    contact: user.contact || "",
    photo: user.photo || ""
  };
  if (i >= 0) extra[i] = Object.assign({}, extra[i], row);
  else extra.push(row);
  saveLS("state_users", extra);
}

function registerUser({ login, password, name, post, accountType, statId, contact }) {
  login = String(login || "").trim().toLowerCase();
  if (!login || !password || !name) return { ok: false, error: "Заповни всі поля." };
  if (allUsers().some((u) => u.login === login)) return { ok: false, error: "Такий логін уже зайнятий." };
  const isCitizenAccount = accountType === "citizen";
  saveUser({
    login,
    password,
    name: String(name).trim(),
    statId: String(statId || "").trim(),
    contact: String(contact || "").trim(),
    post: String(post || "").trim(),
    roles: isCitizenAccount ? ["citizen"] : ["pending"],
    office: isCitizenAccount ? "citizens" : ""
  });
  return { ok: true };
}

function loginWithPassword(login, password) {
  const found = allUsers().find(
    (a) => a.login === String(login).trim().toLowerCase() && a.password === String(password)
  );
  if (!found) return null;
  const session = {
    id: found.login,
    login: found.login,
    username: found.name || found.login,
    roles: found.roles || ["pending"],
    office: found.office || userOffice(found),
    positionId: found.positionId || "",
    post: found.post || "",
    statId: found.statId || "",
    contact: found.contact || "",
    source: "manual"
  };
  saveLS("state_session", session);
  session.photo = found.photo || "";
  return session;
}

function currentUser() {
  const raw = loadLS("state_session", null);
  if (!raw || !raw.login && !raw.id) return null;
  const fresh = allUsers().find((u) => u.login === (raw.login || raw.id));
  if (!fresh) return raw;
  const session = {
    id: fresh.login,
    login: fresh.login,
    username: fresh.name,
    roles: fresh.roles || [],
    office: fresh.office || userOffice(fresh),
    positionId: fresh.positionId || "",
    post: fresh.post || "",
    statId: fresh.statId || "",
    contact: fresh.contact || "",
    source: "manual"
  };
  // Фото береться з профілю й у сесію не пишеться; сесію перезаписуємо лише коли вона змінилась
  const stored = Object.assign({}, raw);
  delete stored.photo;
  if (JSON.stringify(stored) !== JSON.stringify(session)) saveLS("state_session", session);
  session.photo = fresh.photo || "";
  return session;
}

function logout() {
  localStorage.removeItem("state_session");
}

function hasRole(user, role) {
  const roles = (user && user.roles) || [];
  if (roles.includes("governor")) return true;
  return roles.includes(role);
}

function allOffices() {
  const extra = loadLS("state_offices", []);
  const byId = {};
  DEFAULT_OFFICES.forEach((o) => { byId[o.id] = o; });
  extra.forEach((o) => { byId[o.id] = Object.assign({}, byId[o.id] || {}, o); });
  return Object.values(byId);
}

function saveOffice(office) {
  const extra = loadLS("state_offices", []);
  const row = {
    id: String(office.id || newDocId()).trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-"),
    name: String(office.name || "").trim(),
    role: office.role || "official",
    canApprove: !!office.canApprove
  };
  if (!row.id || !row.name) return null;
  const i = extra.findIndex((o) => o.id === row.id);
  if (i >= 0) extra[i] = Object.assign({}, extra[i], row);
  else extra.push(row);
  saveLS("state_offices", extra);
  return row;
}

function allPositions() {
  const extra = loadLS("state_positions", []);
  const byId = {};
  DEFAULT_POSITIONS.forEach((p) => { byId[p.id] = p; });
  extra.forEach((p) => { byId[p.id] = Object.assign({}, byId[p.id] || {}, p); });
  return Object.values(byId);
}

function positionById(id) {
  return allPositions().find((p) => p.id === id) || null;
}

function savePosition(position) {
  const row = {
    id: String(position.id || newDocId()).trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-"),
    office: position.office || "directors",
    title: String(position.title || "").trim(),
    permissions: position.permissions || [],
    approvalRequired: !!position.approvalRequired,
    approverOffice: position.approverOffice || "position:governor-chief",
    congressMember: !!position.congressMember
  };
  if (!row.id || !row.title) return null;
  const extra = loadLS("state_positions", []);
  const i = extra.findIndex((p) => p.id === row.id);
  if (i >= 0) extra[i] = Object.assign({}, extra[i], row);
  else extra.push(row);
  saveLS("state_positions", extra);
  return row;
}

function allApprovalRoutes() {
  const extra = loadLS("state_approval_routes", []);
  const byId = {};
  DEFAULT_APPROVAL_ROUTES.forEach((r) => { byId[r.id] = r; });
  extra.forEach((r) => { byId[r.id] = Object.assign({}, byId[r.id] || {}, r); });
  return Object.values(byId);
}

function routesForOffice(office) {
  return allApprovalRoutes().filter((r) => !r.ownerOffice || r.ownerOffice === "all" || r.ownerOffice === office);
}

function activeApprovalRoute(office) {
  const routes = routesForOffice(office);
  return routes.find((r) => r.active && r.ownerOffice === office) ||
    routes.find((r) => r.active && (!r.ownerOffice || r.ownerOffice === "all")) ||
    routes[0] ||
    DEFAULT_APPROVAL_ROUTES[0];
}

function saveApprovalRoute(route) {
  const ownerOffice = route.ownerOffice || "all";
  const row = {
    id: String(route.id || newDocId()).trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-"),
    name: String(route.name || "").trim(),
    ownerOffice,
    steps: (route.steps || []).map((s) => String(s).trim()).filter((s) => s && (s === "congress" || s.startsWith("position:") || s.startsWith("user:"))),
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
  const positions = allPositions().filter((p) => p.office === office && (p.permissions || []).includes("approveDocs"));
  return positions[0] ? "position:" + positions[0].id : "";
}

function normalizeApprovalStep(step, doc) {
  const raw = String(step || "").trim();
  if (raw === "authorOffice") return approverPositionForOffice(doc.office || "directors") || doc.office || "directors";
  if (raw.startsWith("office:")) return approverPositionForOffice(raw.slice(7)) || raw.slice(7);
  if (raw.startsWith("position:") || raw.startsWith("user:")) return raw;
  if (allOffices().some((office) => office.id === raw)) return approverPositionForOffice(raw) || raw;
  return raw;
}

function resolveApprovalSteps(doc, route) {
  const seen = {};
  const raw = (route && route.steps && route.steps.length ? route.steps : ["position:governor-chief"]);
  return raw.map((step) => normalizeApprovalStep(step, doc))
    .filter((step) => {
      if (!step || seen[step]) return false;
      seen[step] = true;
      return true;
    });
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
  return "Крок " + (current + 1) + " з " + steps.length + ": " + routeStepName(steps[current], doc);
}

function userPermissions(user) {
  if (!user) return [];
  if (((user.roles || [])[0]) === "governor") return Object.keys(PERMISSION_LABELS);
  const position = positionById(user.positionId);
  return position ? (position.permissions || []) : [];
}

function hasPermission(user, permission) {
  return userPermissions(user).includes(permission);
}

function isCongressPosition(position) {
  return !!(position && (position.congressMember || (position.permissions || []).includes("voteCongress")));
}

function isCongressMember(user) {
  const position = positionById(user && user.positionId);
  return isCongressPosition(position);
}

function congressMembers() {
  return allUsers().filter((user) => isCongressMember(user));
}

function congressPositions() {
  return allPositions().filter(isCongressPosition);
}

function isStaff(user) {
  const roles = (user && user.roles) || [];
  return ["governor", "congress", "official", "prosecutor", "court"].some((r) => roles.includes(r));
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
  return ["Конституція штату", "Кодекс", "Закон"].includes(doc && doc.type);
}

function publicLegislativeDocs() {
  return allDocs().filter((d) =>
    d.status !== "trash" &&
    (d.status === "ok" || d.status === "dead" || d.status === "review" || d.status === "congress" || d.status === "adopted" || (d.status === "draft" && isLegislativeDoc(d)))
  );
}

function homeDocs() {
  return allDocs()
    .filter((d) => d.publishHome === true && d.status !== "trash" && d.status !== "rejected")
    .sort((a, b) => String(b.publishedAt || b.date).localeCompare(String(a.publishedAt || a.date)));
}

function cabinetCreatedDocs() {
  return allDocs()
    .filter((d) => !d.seeded && d.status !== "trash")
    .sort((a, b) => String(b.publishedAt || b.date).localeCompare(String(a.publishedAt || a.date)));
}

function reviewDocsFor(user) {
  const office = userOffice(user);
  const positionStep = "position:" + ((user && user.positionId) || "");
  return allDocs().filter((d) =>
    d.status === "review" && (
      d.approverOffice === office ||
      d.approverOffice === positionStep ||
      (d.approverOffice === "congress" && isCongressMember(user)) ||
      d.approverOffice === "user:" + (user && user.login) ||
      d.approverLogin === (user && user.login)
    )
  );
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
  if (isStaff(user)) return allAppeals().filter((a) => a.ownerLogin === user.login || a.office === userOffice(user) || hasPermission(user, "managePeople"));
  return [];
}

function citizenAppealsFor(user) {
  return allAppeals().filter((a) => a.ownerLogin === (user && user.login));
}

function officeAppealsFor(user) {
  if (!isStaff(user)) return [];
  return allAppeals().filter((a) => a.office === userOffice(user) || hasPermission(user, "managePeople"));
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
  if (meta.message) {
    thread.push({
      at: now,
      by: actor && (actor.login || actor.id),
      byName: actorName(actor),
      text: String(meta.message || "").trim()
    });
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

function approveDoc(id, user) {
  const doc = getDoc(id);
  if (!doc) return null;
  const steps = doc.approvalSteps || (doc.approverOffice ? [doc.approverOffice] : []);
  const index = Number(doc.approvalIndex || 0);
  if (steps.length && index + 1 < steps.length) {
    const nextStep = steps[index + 1];
    return saveDoc(Object.assign({}, doc, {
      status: "review",
      approvalIndex: index + 1,
      approverOffice: nextStep,
      approverLogin: String(nextStep).startsWith("user:") ? String(nextStep).slice(5) : "",
      lastApprovedAt: new Date().toISOString(),
      lastApprovedBy: user && user.login
    }), {
      user,
      action: "Погоджено крок маршруту",
      summary: "Погоджено: " + routeStepName(steps[index], doc) + ". Наступний крок: " + routeStepName(nextStep, doc) + ".",
      versionLabel: "Редакція"
    });
  }
  return saveDoc(Object.assign({}, doc, {
    status: "ok",
    approvalIndex: steps.length ? steps.length - 1 : 0,
    approverOffice: "",
    approverLogin: "",
    approvedAt: new Date().toISOString(),
    approvedBy: user && user.login,
    publishedAt: doc.publishedAt || new Date().toISOString()
  }), {
    user,
    action: "Опубліковано",
    summary: steps.length ? "Фінальний крок погоджено, документ опубліковано." : "Документ погоджено й опубліковано.",
    versionLabel: "Чинна версія"
  });
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

function renderActList(targetId, query = "") {
  const root = document.getElementById(targetId);
  if (!root) return;
  const params = new URLSearchParams(location.search);
  const q = (query || params.get("q") || "").trim().toLowerCase();
  const section = params.get("type") || "all";
  const office = params.get("office") || "all";
  const sort = params.get("sort") || "date-desc";
  let items = docsBySection(section).filter((a) =>
    !q || `${a.title} ${a.number} ${a.type} ${a.body || ""} ${a.author || ""}`.toLowerCase().includes(q)
  );
  if (office !== "all") items = items.filter((a) => (a.office || "") === office);
  items.sort((a, b) => {
    if (sort === "date-asc") return String(a.publishedAt || a.date).localeCompare(String(b.publishedAt || b.date));
    if (sort === "title") return String(a.title).localeCompare(String(b.title), "uk");
    if (sort === "office") return String(officeName(a.office) + a.title).localeCompare(officeName(b.office) + b.title, "uk");
    if (sort === "type") return String(a.type + a.title).localeCompare(b.type + b.title, "uk");
    return String(b.publishedAt || b.date).localeCompare(String(a.publishedAt || a.date));
  });
  if (!items.length) {
    root.innerHTML = "<p class='lead'>Документів не знайдено.</p>";
    return;
  }
  root.innerHTML = items.map((a) => `
    <article class="act-row">
      <div class="act-num">${esc(a.number)}<br>${esc(formatDocWhen(a))}</div>
      <div>
        <h3><a href="${attr(docHref(a))}">${esc(a.title)}</a></h3>
        <div class="act-meta">${esc(a.type)} · ${esc(officeName(a.office) !== "—" ? officeName(a.office) : (a.body || ""))}</div>
      </div>
      <span class="badge ${attr(badgeClass(a.status))}">${esc(DOC_STATUSES[a.status] || a.status)}</span>
    </article>
  `).join("");
}
