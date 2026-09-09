const ROLE_LABELS = {
  governor: "Губернатор штату Сан-Андреас",
  official: "Посадовець Уряду",
  court: "Судова гілка",
  pending: "Очікує призначення"
};

const DOC_TYPES = ["Конституція штату", "Закон", "Указ", "Розпорядження", "Статут органу"];
const DOC_STATUSES = {
  ok: "Чинний",
  draft: "Проєкт",
  dead: "Втратив чинність"
};

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

function saveLS(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function allUsers() {
  const extra = loadLS("state_users", []);
  const seed = (window.STATE_ACCOUNTS || []).map((a) => ({
    login: a.login,
    password: a.password,
    name: a.name || a.login,
    roles: a.roles && a.roles.includes("governor") ? a.roles : remapSeedRoles(a),
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

function saveUser(user) {
  const extra = loadLS("state_users", []);
  const i = extra.findIndex((u) => u.login === user.login);
  const row = {
    login: user.login,
    password: user.password,
    name: user.name,
    roles: user.roles || ["pending"]
  };
  if (i >= 0) extra[i] = Object.assign({}, extra[i], row);
  else extra.push(row);
  saveLS("state_users", extra);
}

function registerUser({ login, password, name }) {
  login = String(login || "").trim().toLowerCase();
  if (!login || !password || !name) return { ok: false, error: "Заповни всі поля." };
  if (allUsers().some((u) => u.login === login)) return { ok: false, error: "Такий логін уже зайнятий." };
  saveUser({ login, password, name: String(name).trim(), roles: ["pending"] });
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
    source: "manual"
  };
  saveLS("state_session", session);
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
    source: "manual"
  };
  saveLS("state_session", session);
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

function isStaff(user) {
  const roles = (user && user.roles) || [];
  return roles.includes("governor") || roles.includes("official") || roles.includes("court");
}

function requireAuth(neededRole) {
  const user = currentUser();
  if (!user) {
    location.href = pathTo("login/");
    return null;
  }
  if (!isStaff(user)) {
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
  return Object.values(byId).sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

function publishedDocs() {
  return allDocs().filter((d) => d.status === "ok" || d.status === "draft" || d.status === "dead");
}

function homeDocs() {
  return allDocs()
    .filter((d) => d.status === "ok" && d.publishHome === true)
    .sort((a, b) => String(b.publishedAt || b.date).localeCompare(String(a.publishedAt || a.date)));
}

function cabinetCreatedDocs() {
  return allDocs()
    .filter((d) => !d.seeded)
    .sort((a, b) => String(b.publishedAt || b.date).localeCompare(String(a.publishedAt || a.date)));
}

function formatDocWhen(doc) {
  const raw = doc.publishedAt || doc.date || "";
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
  const list = publishedDocs();
  if (!section || section === "all") return list;
  if (section === "Ордер") return list.filter((d) => /ордер/i.test(d.type));
  return list.filter((d) => d.type === section);
}

function getDoc(id) {
  return allDocs().find((d) => d.id === id) || null;
}

function saveDoc(doc) {
  if (!doc.publishedAt) doc.publishedAt = new Date().toISOString();
  const extra = loadLS("state_docs", []);
  const i = extra.findIndex((d) => d.id === doc.id);
  if (i >= 0) extra[i] = doc;
  else extra.push(doc);
  saveLS("state_docs", extra);
  return doc;
}

function newDocId() {
  return "act-" + Date.now().toString(36);
}

function roleLabel(code) {
  return ROLE_LABELS[code] || code;
}

function badgeClass(status) {
  return status === "ok" ? "ok" : status === "draft" ? "draft" : "dead";
}

function docHref(doc) {
  if (doc.seeded && !loadLS("state_docs", []).some((d) => d.id === doc.id)) {
    return pathTo("acts/" + doc.id + "/");
  }
  return pathTo("acts/view/?id=" + encodeURIComponent(doc.id));
}

function renderActList(targetId, query = "") {
  const root = document.getElementById(targetId);
  if (!root) return;
  const q = query.trim().toLowerCase();
  const section = new URLSearchParams(location.search).get("type") || "all";
  const items = docsBySection(section).filter((a) =>
    !q || `${a.title} ${a.number} ${a.type} ${a.body || ""}`.toLowerCase().includes(q)
  );
  if (!items.length) {
    root.innerHTML = "<p class='lead'>Документів не знайдено.</p>";
    return;
  }
  root.innerHTML = items.map((a) => `
    <article class="act-row">
      <div class="act-num">${a.number}<br>${a.date}</div>
      <div>
        <h3><a href="${docHref(a)}">${a.title}</a></h3>
        <div class="act-meta">${a.type} · ${a.body || ""}</div>
      </div>
      <span class="badge ${badgeClass(a.status)}">${DOC_STATUSES[a.status] || a.status}</span>
    </article>
  `).join("");
}
