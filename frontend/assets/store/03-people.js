/* Сховище порталу (3/5): Люди, апарати, посади, вхід і реєстрація.
   Файли assets/store/*.js підключаються саме в цьому порядку й разом утворюють спільні функції сторінок. */

function allUsers() {
  const extra = loadLS("state_users", []);
  const seed = (window.STATE_ACCOUNTS || []).map((a) => ({
    login: a.login,
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
  return Object.values(byLogin).map(normalizeUser);
}

// Сумісність зі старими даними: колишня роль/посада «Конгрес» → статус конгресмена у звичайного посадовця
function normalizeUser(u) {
  const roles = u.roles || [];
  const legacyPos = u.positionId ? allPositions().find((p) => p.id === u.positionId) : null;
  const legacyCongress = roles.includes("congress") || u.positionId === "congressman" ||
    !!(legacyPos && (legacyPos.congressMember || (legacyPos.permissions || []).includes("voteCongress")));
  let out = u;
  if (!("congressMember" in u) && legacyCongress) out = Object.assign({}, out, { congressMember: true });
  if (roles.includes("congress") || u.office === "congress" || u.positionId === "congressman") {
    out = Object.assign({}, out, {
      roles: roles.includes("congress") ? ["official"] : roles,
      office: !u.office || u.office === "congress" ? "directors" : u.office,
      positionId: !u.positionId || u.positionId === "congressman" ? "directors-staff" : u.positionId
    });
  }
  return out;
}

function roleForOffice(officeId) {
  const office = allOffices().find((o) => o.id === officeId);
  return (office && office.role) || "official";
}

// Призначення людини: роль виводиться з апарату, публічна посада за замовчуванням — назва посади
function assignUser(login, patch, byUser) {
  const user = allUsers().find((u) => u.login === login);
  if (!user) return null;
  const next = Object.assign({}, user);
  if ("office" in patch) {
    if (!patch.office) { next.roles = ["pending"]; next.office = ""; next.positionId = ""; next.extraPermissions = []; }
    else { next.office = patch.office; next.roles = [roleForOffice(patch.office)]; }
  }
  if ("positionId" in patch) next.positionId = patch.positionId || "";
  if ("post" in patch) {
    const pos = positionById(next.positionId);
    next.post = String(patch.post || "").trim() || (pos ? pos.title : "");
  }
  if ("congressMember" in patch && byUser && hasPermission(byUser, "manageCongress")) next.congressMember = !!patch.congressMember;
  saveUser(next);
  return next;
}

function setCongressMember(login, on, byUser) {
  if (!byUser || !hasPermission(byUser, "manageCongress")) return null;
  return assignUser(login, { congressMember: !!on }, byUser);
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
  if (roles.includes("congress")) return "directors-staff";
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
    name: user.name,
    roles: user.roles || ["pending"],
    office: user.office || userOffice(user),
    positionId: user.positionId || "",
    post: user.post || "",
    statId: user.statId || "",
    contact: user.contact || "",
    photo: user.photo || ""
  };
  // Статус конгресмена: зберігаємо, якщо переданий; інакше лишаємо як був
  if ("congressMember" in user) row.congressMember = !!user.congressMember;
  if ("extraPermissions" in user) row.extraPermissions = (user.extraPermissions || []).slice();
  if (i >= 0) extra[i] = Object.assign({}, extra[i], row);
  else extra.push(row);
  saveLS("state_users", extra);
}

// Реєстрація й вхід — лише на сервері; паролі в браузері не зберігаються
const LOGIN_RE = /^[a-z0-9_.-]{3,32}$/;

function registerUser({ login, password, name, post, accountType, statId, contact }) {
  login = String(login || "").trim().toLowerCase();
  name = String(name || "").trim();
  if (!login || !password || !name) return { ok: false, error: "Заповни всі поля." };
  if (!LOGIN_RE.test(login)) return { ok: false, error: "Логін: 3–32 символи, лише латиниця, цифри, крапка, дефіс і підкреслення." };
  if (name.length > 64) return { ok: false, error: "Ім'я занадто довге (до 64 символів)." };
  if (allUsers().some((u) => u.login === login)) return { ok: false, error: "Такий логін уже зайнятий." };
  const res = apiRequest("POST", "/api/register", { login, password, name, post, accountType, statId, contact });
  return res.ok ? { ok: true } : { ok: false, error: res.data.error || "Не вдалося зареєструватися." };
}

function loginWithPassword(login, password) {
  login = String(login || "").trim().toLowerCase();
  return finishLogin(apiRequest("POST", "/api/auth", { login, password: String(password || "") }));
}

// Вхід через Discord: сервер повертає на сайт одноразовий код (#discord_code=…), обмінюємо його на вхід
function loginWithDiscordCode(code) {
  return finishLogin(apiRequest("POST", "/api/discord/exchange", { code: String(code || "") }));
}

// Адреса старту входу / прив'язки Discord (перехід браузера на сервер, звідти — на Discord)
function discordStartUrl(mode, code) {
  return REMOTE.url + "/api/discord/start?mode=" + (mode === "link" ? "link" : "login") + (code ? "&code=" + encodeURIComponent(code) : "");
}

// Чи налаштовано на сервері вхід через Discord (кнопки показуються лише тоді)
async function discordConfig() {
  const res = await apiFetch("GET", "/api/health");
  return { enabled: !!(res.ok && res.data.discord), required: !!(res.ok && res.data.requireDiscord) };
}
function discordStatus() {
  const res = apiRequest("GET", "/api/discord/status");
  return res.ok ? Object.assign({ ok: true }, res.data) : { ok: false, error: res.data.error || "Не вдалося перевірити Discord." };
}
function discordLinkCode() {
  const res = apiRequest("POST", "/api/discord/link-code", {});
  return res.ok ? { ok: true, code: res.data.code } : { ok: false, error: res.data.error || "Не вдалося почати прив'язку." };
}
// Адміністратор: хто прив'язав Discord (login → { name, viaDiscord }) і відв'язка чужого Discord
function loadDiscordLinks() {
  const res = apiRequest("GET", "/api/discord/links");
  if (!res.ok) return { ok: false, error: res.data.error || "Не вдалося завантажити прив'язки Discord.", map: {} };
  const map = {};
  for (const it of res.data.items || []) map[it.login] = it;
  return { ok: true, map };
}
function adminDiscordUnlink(login) {
  const res = apiRequest("POST", "/api/discord/admin-unlink", { login });
  if (!res.ok) return { ok: false, error: res.data.error || "Не вдалося відв'язати Discord." };
  const map = {};
  for (const it of res.data.items || []) map[it.login] = it;
  return { ok: true, map };
}
// Аватар прив'язаного Discord як файл-зображення (сервер бере його з CDN Discord); null + помилка — якщо не вдалося
async function fetchDiscordAvatar() {
  try {
    const r = await fetch(REMOTE.url + "/api/discord/avatar", { headers: { Authorization: "Bearer " + apiToken() } });
    if (!r.ok) {
      const data = await r.json().catch(() => ({}));
      return { ok: false, error: data.error || "Не вдалося отримати аватар з Discord." };
    }
    return { ok: true, blob: await r.blob() };
  } catch (err) {
    return { ok: false, error: "Немає зв'язку з сервером." };
  }
}
function discordUnlink() {
  const res = apiRequest("POST", "/api/discord/unlink", {});
  return res.ok ? Object.assign({ ok: true }, res.data) : { ok: false, error: res.data.error || "Не вдалося відв'язати Discord." };
}
const DISCORD_ERRORS = {
  not_configured: "Вхід через Discord ще не налаштовано.",
  expired: "Час на вхід минув. Спробуйте ще раз.",
  cancelled: "Вхід через Discord скасовано.",
  failed: "Discord не підтвердив вхід. Спробуйте ще раз.",
  bad_secret: "Сервер неправильно налаштований для Discord (невірний Client Secret). Повідомте адміністратора.",
  not_member: "Вхід дозволено лише учасникам Discord-сервера проєкту.",
  already_linked: "Цей Discord уже прив'язаний до іншого акаунта, яким користувались (є документи, звернення чи посада). Попросіть адміністратора відв'язати його: «Адмін-панель» → «Люди» → «Змінити».",
  too_many: "Забагато нових акаунтів з вашої мережі. Спробуйте пізніше."
};

function finishLogin(res) {
  REMOTE.lastError = res.ok ? "" : (res.data.error || "");
  if (!res.ok) return null;
  setApiToken(res.data.token);
  // Вхід віддає всі дані — навіть якщо під час завантаження сторінки сервер не відповідав, тепер зв'язок є
  dropSnapshot();
  applyRemoteData(res.data.data);
  REMOTE.ok = true;
  REMOTE.scope = res.data.scope || "";
  saveSnapshot();
  // Адмін скинув пароль — людина має змінити тимчасовий (банер на всіх сторінках, доки не змінить)
  try {
    if (res.data.mustChangePassword) localStorage.setItem("state_must_change", "1");
    else localStorage.removeItem("state_must_change");
  } catch { /* приватний режим */ }
  const banner = document.getElementById("state-offline");
  if (banner) banner.remove();
  const found = allUsers().find((a) => a.login === res.data.login);
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
  if (apiToken()) apiRequest("POST", "/api/signout", {});
  setApiToken("");
  dropSnapshot();
  try { localStorage.removeItem("state_must_change"); } catch { /* приватний режим */ }
  try { localStorage.removeItem("state_session"); } catch { /* приватний режим */ }
  // Приватні дані попереднього користувача не лишаються в пам'яті сторінки (після виходу сторінка перезавантажується)
  REMOTE.cache = {};
  REMOTE.since = 0;
}

// Фото профілю зберігаємо зменшеним (до 256 px, JPEG): воно їде кожному відвідувачу разом зі списком людей,
// а мегабайтні фото перевантажували сервер. done(dataUrl) або done("") при помилці.
function shrinkImage(file, maxSize, done) {
  const reader = new FileReader();
  reader.onerror = () => done("");
  reader.onload = () => {
    const img = new Image();
    img.onerror = () => done("");
    img.onload = () => {
      const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      done(canvas.toDataURL("image/jpeg", 0.85));
    };
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
}

function changePassword(oldPassword, newPassword) {
  const user = currentUser();
  if (!user) return { ok: false, error: "Спершу увійдіть." };
  newPassword = String(newPassword || "");
  if (newPassword.length < 8 || newPassword.length > 128) return { ok: false, error: "Новий пароль: від 8 до 128 символів." };
  const res = apiRequest("POST", "/api/password", { oldPassword: String(oldPassword || ""), newPassword });
  if (res.ok) { try { localStorage.removeItem("state_must_change"); } catch { /* приватний режим */ } }
  return res.ok ? { ok: true } : { ok: false, error: res.data.error || "Не вдалося змінити пароль." };
}

/* ---------- Ієрархія (так само перевіряє сервер) ----------
   Головний адміністратор (100) > повні права — гілка Губернатора чи всі права (80) > керують людьми чи структурою (60) >
   посадовці (40) > громадяни (0). Змінювати й позбавляти прав можна лише нижчих; підняти до свого рангу — не можна. */
const SUPER_ADMIN = "admin";
const MANAGER_PERMS = ["managePeople", "approveProfiles", "manageCongress", "manageStructure", "manageRoutes"];
function userRank(u) {
  if (!u) return 0;
  if (u.login === SUPER_ADMIN) return 100;
  const perms = userPermissions(u);
  if (((u.roles || [])[0]) === "governor" || Object.keys(PERMISSION_LABELS).every((p) => perms.includes(p))) return 80;
  if (perms.some((p) => MANAGER_PERMS.includes(p))) return 60;
  return isStaff(u) ? 40 : 0;
}
function isSuperAdmin(u) { return !!u && u.login === SUPER_ADMIN; }
function canManageUser(actor, target) {
  if (!actor || !target || target.login === SUPER_ADMIN) return false;
  return isSuperAdmin(actor) || userRank(actor) > userRank(target);
}

// Активні входи: де й коли ви увійшли; завершити окремий вхід або всі, крім поточного
function loadSessions() {
  const res = apiRequest("GET", "/api/sessions");
  return res.ok ? { ok: true, items: res.data.items || [] } : { ok: false, error: res.data.error || "Не вдалося завантажити входи." };
}
function revokeSessions(target) {
  const res = apiRequest("POST", "/api/sessions/revoke", target === "all" ? { all: true } : { id: target });
  return res.ok ? { ok: true, items: res.data.items || [] } : { ok: false, error: res.data.error || "Не вдалося завершити вхід." };
}

// Скидання пароля адміністратором (managePeople): повертає тимчасовий пароль, людина змінить його після входу
function resetUserPassword(login) {
  const res = apiRequest("POST", "/api/reset-password", { login });
  return res.ok ? { ok: true, password: res.data.password } : { ok: false, error: res.data.error || "Не вдалося скинути пароль." };
}

// Журнал дій адміністрації: найновіші 100 записів, далі — сторінками (before = id останнього показаного)
function loadAudit(before) {
  const res = apiRequest("GET", "/api/audit" + (before ? "?before=" + encodeURIComponent(before) : ""));
  return res.ok ? { ok: true, items: res.data.items || [] } : { ok: false, error: res.data.error || "Не вдалося завантажити журнал." };
}

// Зв'язки між документами: що змінює / скасовує цей документ і хто змінив / скасував його
function docLinks(doc) {
  const l = (doc && doc.links) || {};
  return { amends: Array.isArray(l.amends) ? l.amends : [], repeals: Array.isArray(l.repeals) ? l.repeals : [] };
}
function docBacklinks(id) {
  const all = allDocs();
  return {
    amendedBy: all.filter((d) => d.id !== id && d.status === "ok" && docLinks(d).amends.includes(id)),
    repealedBy: all.filter((d) => d.id !== id && ["ok", "review", "congress"].includes(d.status) && docLinks(d).repeals.includes(id))
  };
}

// Видалення акаунта: лише з правом managePeople; себе й службові акаунти (accounts.js) — не можна
function deleteUserAccount(login, byUser) {
  if (!byUser || !hasPermission(byUser, "managePeople")) return { ok: false, error: "Недостатньо прав для цієї дії." };
  const user = allUsers().find((u) => u.login === login);
  if (!user) return { ok: false, error: "Акаунт не знайдено." };
  if (user.login === byUser.login) return { ok: false, error: "Свій акаунт видалити не можна." };
  if (user.seeded) return { ok: false, error: "Службовий акаунт видалити не можна." };
  const res = apiRequest("POST", "/api/delete-user", { login });
  if (!res.ok) return { ok: false, error: res.data.error || "Не вдалося видалити акаунт." };
  applyRemoteData(res.data.data);
  return { ok: true };
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
  if (office.approval) row.approval = { head: office.approval.head !== false, governor: office.approval.governor !== false };
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
  // Рівень «Адміністратор» завжди має всі права, зокрема ті, що з'явилися після збереження посади
  return Object.values(byId).map((p) => p.level === "admin" ? Object.assign({}, p, { permissions: ACCESS_LEVELS.admin.permissions.slice() }) : p);
}

function positionById(id) {
  return allPositions().find((p) => p.id === id) || null;
}

function slugId(value) {
  const map = { а:"a", б:"b", в:"v", г:"h", ґ:"g", д:"d", е:"e", є:"ye", ж:"zh", з:"z", и:"y", і:"i", ї:"yi", й:"y", к:"k", л:"l", м:"m", н:"n", о:"o", п:"p", р:"r", с:"s", т:"t", у:"u", ф:"f", х:"kh", ц:"ts", ч:"ch", ш:"sh", щ:"shch", ю:"yu", я:"ya", ь:"" };
  return String(value || "").toLowerCase().split("").map((ch) => map[ch] != null ? map[ch] : ch).join("")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 36);
}
function uniqueId(base, taken) {
  let id = base || "item";
  let n = 2;
  while (taken.includes(id)) id = base + "-" + n++;
  return id;
}

// Видаляти можна лише створені в адмінці (не вбудовані) і лише коли на них ніхто не призначений
function isDefaultOffice(id) { return DEFAULT_OFFICES.some((o) => o.id === id); }
function isDefaultPosition(id) { return DEFAULT_POSITIONS.some((p) => p.id === id); }
function deletePosition(id) {
  if (isDefaultPosition(id) || allUsers().some((u) => u.positionId === id)) return false;
  saveLS("state_positions", loadLS("state_positions", []).filter((p) => p.id !== id));
  return true;
}
function deleteOffice(id) {
  if (isDefaultOffice(id) || allUsers().some((u) => u.office === id && isStaff(u))) return false;
  saveLS("state_positions", loadLS("state_positions", []).filter((p) => p.office !== id));
  saveLS("state_approval_routes", loadLS("state_approval_routes", []).filter((r) => r.ownerOffice !== id));
  saveLS("state_offices", loadLS("state_offices", []).filter((o) => o.id !== id));
  return true;
}
function deleteApprovalRoute(id) {
  saveLS("state_approval_routes", loadLS("state_approval_routes", []).filter((r) => r.id !== id));
}

// Новий апарат одним кроком: апарат + посади «Керівник» і «Співробітник»
function createOffice({ name, role, approval }) {
  const title = String(name || "").trim();
  if (!title) return null;
  const id = uniqueId(slugId(title) || "office", allOffices().map((o) => o.id));
  const office = saveOffice({ id, name: title, role: role || "official", canApprove: true, approval });
  if (!office) return null;
  const taken = allPositions().map((p) => p.id);
  savePosition({ id: uniqueId(id + "-head", taken), office: id, title: "Керівник · " + title, level: "head" });
  savePosition({ id: uniqueId(id + "-staff", taken), office: id, title: "Співробітник · " + title, level: "staff" });
  return office;
}

function savePosition(position) {
  const level = position.level && ACCESS_LEVELS[position.level] ? position.level : "custom";
  const row = {
    id: String(position.id || uniqueId(slugId(position.title) || "position", allPositions().map((p) => p.id))).trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-"),
    office: position.office || "directors",
    title: String(position.title || "").trim(),
    level,
    permissions: level !== "custom" && !position.permissions ? ACCESS_LEVELS[level].permissions.slice() : (position.permissions || [])
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

// Автоматичний маршрут: керівник апарату автора → Губернатор (кроки, де автор погоджував би сам себе, пропускаються)
function autoApprovalRoute(office) {
  return { id: "auto", name: "Автоматично: керівник апарату → Губернатор", ownerOffice: office || "all", steps: ["authorOffice", "position:governor-chief"], active: true, auto: true };
}

// Закон завжди проходить голосування Конгресу: крок вставляється перед Губернатором (або в кінець маршруту)
function withCongressStep(route) {
  if (!route || (route.steps || []).includes("congress")) return route;
  const steps = (route.steps || []).slice();
  const gov = steps.indexOf("position:governor-chief");
  if (gov >= 0) steps.splice(gov, 0, "congress");
  else steps.push("congress");
  return Object.assign({}, route, { id: route.id + "-congress", name: route.name + " (закон — через Конгрес)", steps });
}

