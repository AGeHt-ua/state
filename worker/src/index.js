/**
 * Cloudflare Worker: спільна база порталу (D1, вхід за логіном і паролем) + Discord OAuth.
 * Binding: DB (D1, схема — schema.sql)
 * Secrets: SEED_ACCOUNTS (JSON {"login":"пароль"} для службових акаунтів з accounts.js),
 *          DISCORD_CLIENT_SECRET, DISCORD_BOT_TOKEN, SESSION_SECRET (≥ 32 випадкові символи)
 * Vars: FRONTEND_ORIGIN — один або кілька origin через кому (напр. "https://user.github.io,http://localhost:8080")
 *
 * Захист:
 * - CORS лише для origin із FRONTEND_ORIGIN (жодного віддзеркалення довільного Origin);
 * - OAuth `state` у HttpOnly-cookie проти CSRF / підміни входу;
 * - сесія — HMAC-SHA256-підписаний токен у HttpOnly Secure cookie, а не параметри в URL;
 * - Discord-токени й деталі помилок не віддаються клієнту.
 */

const DISCORD_AUTH = "https://discord.com/api/oauth2/authorize";
const DISCORD_TOKEN = "https://discord.com/api/oauth2/token";
const DISCORD_API = "https://discord.com/api/v10";

const SESSION_COOKIE = "state_session";
const STATE_COOKIE = "state_oauth";
const SESSION_TTL = 7 * 24 * 3600; // секунд
const STATE_TTL = 600;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = allowedOrigin(request, env);

    if (request.method === "OPTIONS") {
      return cors(new Response(null, { status: 204 }), origin);
    }

    try {
      if (url.pathname === "/api/health") {
        return cors(json({ ok: true, auth: Boolean(env.DISCORD_CLIENT_ID && env.SESSION_SECRET) }), origin);
      }
      if (url.pathname === "/api/state" && request.method === "GET") {
        return cors(await handleState(request, env), origin);
      }
      if (url.pathname === "/api/register" && request.method === "POST") {
        return cors(await handleRegister(request, env), origin);
      }
      if (url.pathname === "/api/auth" && request.method === "POST") {
        return cors(await handlePasswordLogin(request, env), origin);
      }
      if (url.pathname === "/api/signout" && request.method === "POST") {
        return cors(await handleSignout(request, env), origin);
      }
      if (url.pathname === "/api/password" && request.method === "POST") {
        return cors(await handlePasswordChange(request, env), origin);
      }
      if (url.pathname === "/api/delete-user" && request.method === "POST") {
        return cors(await handleDeleteUser(request, env), origin);
      }
      if (url.pathname === "/api/sync" && request.method === "POST") {
        return cors(await handleSync(request, env), origin);
      }
      if (url.pathname === "/api/login" && request.method === "GET") {
        return handleLogin(url, env);
      }
      if (url.pathname === "/api/callback" && request.method === "GET") {
        return handleCallback(request, url, env);
      }
      if (url.pathname === "/api/me" && request.method === "GET") {
        const session = await readSession(request, env);
        return cors(json(session ? { id: session.id, username: session.username, roles: session.roles } : { id: null }, session ? 200 : 401), origin);
      }
      if (url.pathname === "/api/logout" && request.method === "POST") {
        // POST + перевірка Origin: вийти з чужого сайту примусово не вийде
        if (!origin) return json({ error: "Forbidden" }, 403);
        const res = cors(json({ ok: true }), origin);
        res.headers.append("Set-Cookie", clearCookie(SESSION_COOKIE, "/"));
        return res;
      }
      return cors(json({ error: "Not found" }, 404), origin);
    } catch (err) {
      console.error(err);
      return cors(json({ error: "Внутрішня помилка" }, 500), origin);
    }
  }
};

async function handleLogin(url, env) {
  if (!env.DISCORD_CLIENT_ID || !env.SESSION_SECRET) {
    return json({ error: "Вхід через Discord ще не налаштовано" }, 501);
  }
  const state = randomToken(32);
  const params = new URLSearchParams({
    client_id: env.DISCORD_CLIENT_ID,
    redirect_uri: `${url.origin}/api/callback`,
    response_type: "code",
    scope: "identify guilds.members.read",
    state,
    prompt: "consent"
  });
  const res = redirect(`${DISCORD_AUTH}?${params}`);
  res.headers.append("Set-Cookie", cookie(STATE_COOKIE, state, { path: "/api/callback", maxAge: STATE_TTL, sameSite: "Lax" }));
  return res;
}

async function handleCallback(request, url, env) {
  if (!env.DISCORD_CLIENT_ID || !env.DISCORD_CLIENT_SECRET || !env.SESSION_SECRET) {
    return json({ error: "Вхід через Discord ще не налаштовано" }, 501);
  }
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const expected = getCookie(request, STATE_COOKIE);
  if (!code || !state || !expected || !timingSafeEqual(state, expected)) {
    return json({ error: "Недійсний запит входу. Спробуйте ще раз." }, 400);
  }

  const tokenRes = await fetch(DISCORD_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.DISCORD_CLIENT_ID,
      client_secret: env.DISCORD_CLIENT_SECRET,
      grant_type: "authorization_code",
      code,
      redirect_uri: `${url.origin}/api/callback`
    })
  });
  const token = await tokenRes.json().catch(() => ({}));
  if (!tokenRes.ok || !token.access_token) {
    console.warn("discord token exchange failed", tokenRes.status);
    return json({ error: "Не вдалося увійти через Discord" }, 401);
  }

  const meRes = await fetch(`${DISCORD_API}/users/@me`, {
    headers: { Authorization: `Bearer ${token.access_token}` }
  });
  if (!meRes.ok) return json({ error: "Не вдалося отримати профіль Discord" }, 502);
  const me = await meRes.json();

  // Ролі беремо з сервера Discord від імені бота — клієнт не може їх підмінити
  let roles = [];
  if (env.DISCORD_BOT_TOKEN && env.DISCORD_GUILD_ID) {
    const memberRes = await fetch(`${DISCORD_API}/guilds/${env.DISCORD_GUILD_ID}/members/${me.id}`, {
      headers: { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}` }
    });
    if (memberRes.ok) roles = (await memberRes.json()).roles || [];
  }

  const now = Math.floor(Date.now() / 1000);
  const session = await signSession({ id: String(me.id), username: String(me.username || ""), roles, iat: now, exp: now + SESSION_TTL }, env.SESSION_SECRET);

  const frontend = firstOrigin(env) || "http://localhost:8080";
  const res = redirect(new URL("cabinet/", frontend.endsWith("/") ? frontend : frontend + "/").toString());
  // SameSite=None потрібен, бо фронт (GitHub Pages) і Worker на різних сайтах; краще — спільний домен і SameSite=Lax
  res.headers.append("Set-Cookie", cookie(SESSION_COOKIE, session, { path: "/", maxAge: SESSION_TTL, sameSite: "None" }));
  res.headers.append("Set-Cookie", clearCookie(STATE_COOKIE, "/api/callback"));
  return res;
}

/* ---------- Спільна база порталу (D1): акаунти з паролем і колекції сайту ----------
   Сервер сам перевіряє права кожного запису й фільтрує, що кому віддавати — за тими ж правилами, що й store.js:
   - люди (state_users) — лише адміністратори (managePeople / approveProfiles / manageCongress);
   - апарати, посади, маршрути — manageStructure / manageRoutes;
   - документи й фони — посадовці (governor / official / prosecutor / court);
   - звернення й заявки на зміну профілю — посадовці будь-які, інші — лише свої. */
const COLLECTIONS = [
  "state_users", "state_offices", "state_positions", "state_approval_routes",
  "state_docs", "state_appeals", "state_profile_requests", "state_doc_backgrounds"
];
const PUBLIC_USER_FIELDS = ["login", "name", "roles", "office", "positionId", "post", "photo", "congressMember"];
const STAFF_ROLES = ["governor", "official", "prosecutor", "court"];
const LEGISLATIVE_TYPES = ["Конституція штату", "Кодекс", "Закон"];

// Має збігатися з PERMISSION_LABELS / ACCESS_LEVELS / DEFAULT_POSITIONS у store.js
const ALL_PERMISSIONS = [
  "createDocs", "publishDocs", "approveDocs", "approveAnyDocs", "editOwnDocs", "editAllDocs", "manageDocs",
  "manageAppeals", "managePeople", "manageStructure", "manageRoutes", "approveProfiles", "manageCongress"
];
const LEVEL_PERMISSIONS = {
  head: ["createDocs", "approveDocs", "editOwnDocs"],
  staff: ["createDocs", "editOwnDocs"],
  admin: ALL_PERMISSIONS,
  viewer: []
};
const DEFAULT_POSITIONS = {
  "governor-chief": "admin",
  "director": "head", "directors-staff": "staff",
  "prosecutor-chief": "head", "prosecutor-staff": "staff",
  "court-chief": "head", "court-staff": "staff"
};
// Службовий акаунт з frontend/assets/accounts.js (його профіль може й не лежати в базі)
const SEED_PROFILES = {
  admin: { roles: ["governor"], office: "governor", positionId: "governor-chief" }
};
const USER_ADMIN_PERMS = ["managePeople", "approveProfiles", "manageCongress"];
const STRUCTURE_PERMS = ["manageStructure", "manageRoutes"];
const LOGIN_RE = /^[a-z0-9_.-]{3,32}$/;
const TOKEN_TTL = 30 * 24 * 3600;
const PBKDF2_ITERATIONS = 100000; // максимум, який дозволяє Workers
const MAX_BODY = 8 * 1024 * 1024;
const MAX_ROW = 1900 * 1024; // ліміт рядка D1 — 2 МБ

async function handleState(request, env) {
  const login = await tokenLogin(request, env);
  const actor = login ? await loadActor(env, login) : null;
  return json({ user: login, data: await readCollections(env, COLLECTIONS, actor) });
}

async function handleRegister(request, env) {
  const body = await readJson(request);
  if (!body) return json({ error: "Невірний запит." }, 400);
  const login = String(body.login || "").trim().toLowerCase();
  const password = String(body.password || "");
  const name = String(body.name || "").trim();
  if (!login || !password || !name) return json({ error: "Заповни всі поля." }, 400);
  if (!LOGIN_RE.test(login)) return json({ error: "Логін: 3–32 символи, лише латиниця, цифри, крапка, дефіс і підкреслення." }, 400);
  if (password.length < 4 || password.length > 128) return json({ error: "Пароль: від 4 до 128 символів." }, 400);
  if (name.length > 64) return json({ error: "Ім'я занадто довге (до 64 символів)." }, 400);

  const taken = login in seedAccounts(env) ||
    await env.DB.prepare("SELECT 1 FROM accounts WHERE login = ?").bind(login).first() ||
    await env.DB.prepare("SELECT 1 FROM rows WHERE coll = 'state_users' AND id = ?").bind(login).first();
  if (taken) return json({ error: "Такий логін уже зайнятий." }, 409);

  const citizen = body.accountType === "citizen";
  const profile = {
    login,
    name,
    statId: String(body.statId || "").trim().slice(0, 64),
    contact: String(body.contact || "").trim().slice(0, 128),
    post: String(body.post || "").trim().slice(0, 128),
    roles: citizen ? ["citizen"] : ["pending"],
    office: citizen ? "citizens" : "",
    positionId: "",
    photo: ""
  };
  const { salt, hash } = await hashPassword(password);
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO accounts (login, salt, hash, created_at) VALUES (?, ?, ?, ?)").bind(login, salt, hash, now),
    env.DB.prepare("INSERT INTO rows (coll, id, data, updated_at) VALUES ('state_users', ?, ?, ?)").bind(login, JSON.stringify(profile), now)
  ]);
  return json({ ok: true });
}

async function handlePasswordLogin(request, env) {
  const body = await readJson(request);
  const login = String((body && body.login) || "").trim().toLowerCase();
  const password = String((body && body.password) || "");
  const fail = json({ error: "Невірний логін або пароль." }, 401);
  if (!login || !password) return fail;

  const account = await env.DB.prepare("SELECT salt, hash FROM accounts WHERE login = ?").bind(login).first();
  if (account) {
    const { hash } = await hashPassword(password, account.salt);
    if (!timingSafeEqual(hash, account.hash)) return fail;
  } else {
    // Службові акаунти з accounts.js: пароль задається секретом SEED_ACCOUNTS і при першому вході переходить у базу
    const seedPassword = seedAccounts(env)[login];
    if (typeof seedPassword !== "string" || !timingSafeEqual(password, seedPassword)) return fail;
    const { salt, hash } = await hashPassword(password);
    await env.DB.prepare("INSERT INTO accounts (login, salt, hash, created_at) VALUES (?, ?, ?, ?)").bind(login, salt, hash, Date.now()).run();
  }

  const token = randomToken(32);
  const now = Math.floor(Date.now() / 1000);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(now),
    env.DB.prepare("INSERT INTO sessions (token_hash, login, expires_at) VALUES (?, ?, ?)").bind(await sha256(token), login, now + TOKEN_TTL)
  ]);
  return json({ ok: true, login, token, data: await readCollections(env, COLLECTIONS, await loadActor(env, login)) });
}

async function handleSignout(request, env) {
  const token = bearer(request);
  if (token) await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256(token)).run();
  return json({ ok: true });
}

// Зміна власного пароля: потрібен чинний пароль; інші сесії цього акаунта завершуються
async function handlePasswordChange(request, env) {
  const token = bearer(request);
  const login = await tokenLogin(request, env);
  if (!login) return json({ error: "Сесія завершилась. Увійдіть знову." }, 401);
  const body = await readJson(request);
  const oldPassword = String((body && body.oldPassword) || "");
  const newPassword = String((body && body.newPassword) || "");
  if (newPassword.length < 4 || newPassword.length > 128) return json({ error: "Новий пароль: від 4 до 128 символів." }, 400);
  const account = await env.DB.prepare("SELECT salt, hash FROM accounts WHERE login = ?").bind(login).first();
  if (!account) return json({ error: "Акаунт не знайдено." }, 404);
  const { hash: oldHash } = await hashPassword(oldPassword, account.salt);
  if (!timingSafeEqual(oldHash, account.hash)) return json({ error: "Поточний пароль невірний." }, 403);
  const { salt, hash } = await hashPassword(newPassword);
  await env.DB.batch([
    env.DB.prepare("UPDATE accounts SET salt = ?, hash = ? WHERE login = ?").bind(salt, hash, login),
    env.DB.prepare("DELETE FROM sessions WHERE login = ? AND token_hash != ?").bind(login, await sha256(token))
  ]);
  return json({ ok: true });
}

// Видалення акаунта адміністратором (managePeople): вхід, сесії, профіль і заявки на зміну профілю.
// Документи й звернення людини лишаються в реєстрі як історія. Себе й службові акаунти видалити не можна.
async function handleDeleteUser(request, env) {
  const login = await tokenLogin(request, env);
  if (!login) return json({ error: "Сесія завершилась. Увійдіть знову." }, 401);
  const actor = await loadActor(env, login);
  if (!actor.can(["managePeople"])) return json({ error: "Недостатньо прав для цієї дії." }, 403);
  const body = await readJson(request);
  const target = String((body && body.login) || "").trim().toLowerCase();
  if (!target) return json({ error: "Не вказано акаунт." }, 400);
  if (target === login) return json({ error: "Свій акаунт видалити не можна." }, 400);
  if (SEED_PROFILES[target] || target in seedAccounts(env)) return json({ error: "Службовий акаунт видалити не можна." }, 400);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM accounts WHERE login = ?").bind(target),
    env.DB.prepare("DELETE FROM sessions WHERE login = ?").bind(target),
    env.DB.prepare("DELETE FROM rows WHERE coll = 'state_users' AND id = ?").bind(target),
    env.DB.prepare("DELETE FROM rows WHERE coll = 'state_profile_requests' AND json_extract(data, '$.login') = ?").bind(target)
  ]);
  return json({ ok: true, data: await readCollections(env, ["state_users", "state_profile_requests"], actor) });
}

// Зміни приходять як різниця: які елементи колекції додано/змінено і які видалено
async function handleSync(request, env) {
  const login = await tokenLogin(request, env);
  if (!login) return json({ error: "Сесія завершилась. Увійдіть знову." }, 401);
  const body = await readJson(request);
  const ops = body && Array.isArray(body.ops) ? body.ops : null;
  if (!ops || !ops.length || ops.length > COLLECTIONS.length) return json({ error: "Невірний запит." }, 400);

  const actor = await loadActor(env, login);
  const now = Date.now();
  const statements = [];
  const touched = new Set();
  for (const op of ops) {
    const coll = op && op.coll;
    if (!COLLECTIONS.includes(coll)) return json({ error: "Невідома колекція." }, 400);
    touched.add(coll);
    const upserts = [];
    for (const item of Array.isArray(op.upsert) ? op.upsert : []) {
      if (!item || typeof item !== "object" || Array.isArray(item)) return json({ error: "Невірний запис." }, 400);
      const row = Object.assign({}, item);
      if (coll === "state_users") delete row.password; // паролі живуть лише в accounts
      const id = rowId(coll, row);
      if (!id) return json({ error: "Запис без id." }, 400);
      const data = JSON.stringify(row);
      if (data.length > MAX_ROW) return json({ error: "Запис завеликий (понад 1.9 МБ). Зменште зображення." }, 413);
      upserts.push({ id, row, data });
    }
    const removes = (Array.isArray(op.remove) ? op.remove : []).map((raw) => String(raw || "").slice(0, 128)).filter(Boolean);

    const denied = await checkWrite(env, actor, coll, upserts, removes);
    if (denied) return json({ error: denied }, 403);

    upserts.forEach(({ id, data }) => statements.push(env.DB.prepare(
      "INSERT INTO rows (coll, id, data, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT (coll, id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at"
    ).bind(coll, id, data, now)));
    removes.forEach((id) => statements.push(env.DB.prepare("DELETE FROM rows WHERE coll = ? AND id = ?").bind(coll, id)));
  }
  if (statements.length > 500) return json({ error: "Забагато змін за раз." }, 400);
  if (statements.length) await env.DB.batch(statements);
  return json({ ok: true, data: await readCollections(env, [...touched], actor) });
}

// Повертає текст помилки, якщо запис заборонений, інакше порожньо
async function checkWrite(env, actor, coll, upserts, removes) {
  const noRights = "Недостатньо прав для цієї дії.";
  if (!upserts.length && !removes.length) return "";
  if (coll === "state_users") return actor.can(USER_ADMIN_PERMS) ? "" : noRights;
  if (coll === "state_offices" || coll === "state_positions" || coll === "state_approval_routes") return actor.can(STRUCTURE_PERMS) ? "" : noRights;
  if (coll === "state_docs" || coll === "state_doc_backgrounds") return actor.staff ? "" : noRights;

  // Звернення й заявки на зміну профілю: посадовець (або адміністратор профілів) — будь-які, інші — лише свої
  const ownerField = coll === "state_appeals" ? "ownerLogin" : "login";
  if (coll === "state_appeals" && actor.staff) return "";
  if (coll === "state_profile_requests" && actor.can(["approveProfiles"])) return "";
  const existing = await readRows(env, coll, upserts.map((u) => u.id).concat(removes));
  const own = (row) => row && row[ownerField] === actor.login;
  for (const { id, row } of upserts) {
    if (!own(row) || (existing[id] && !own(existing[id]))) return noRights;
    // Сам собі заявку не підтвердиш
    if (coll === "state_profile_requests" && row.status !== "pending") return noRights;
  }
  for (const id of removes) if (existing[id] && !own(existing[id])) return noRights;
  return "";
}

async function readRows(env, coll, ids) {
  const out = {};
  const unique = [...new Set(ids)];
  for (let i = 0; i < unique.length; i += 50) {
    const chunk = unique.slice(i, i + 50);
    const { results } = await env.DB.prepare(`SELECT id, data FROM rows WHERE coll = ? AND id IN (${chunk.map(() => "?").join(",")})`).bind(coll, ...chunk).all();
    results.forEach((r) => { try { out[r.id] = JSON.parse(r.data); } catch { /* зіпсований рядок */ } });
  }
  return out;
}

// Хто робить запит: профіль (з урахуванням службових акаунтів), роль посадовця і права — як userPermissions() у store.js
async function loadActor(env, login) {
  const row = await env.DB.prepare("SELECT data FROM rows WHERE coll = 'state_users' AND id = ?").bind(login).first();
  let stored = {};
  try { stored = row ? JSON.parse(row.data) : {}; } catch { /* зіпсований рядок */ }
  const user = Object.assign({ login }, SEED_PROFILES[login] || {}, stored);
  const roles = Array.isArray(user.roles) ? user.roles : [];
  const staff = STAFF_ROLES.some((r) => roles.includes(r));
  let perms = [];
  if (roles[0] === "governor") perms = ALL_PERMISSIONS;
  else if (staff) {
    const position = await positionFor(env, user.positionId);
    const own = position ? (position.level === "admin" ? ALL_PERMISSIONS : (position.permissions || [])) : [];
    const extra = (Array.isArray(user.extraPermissions) ? user.extraPermissions : []).filter((p) => ALL_PERMISSIONS.includes(p));
    perms = [...new Set(own.concat(extra))];
  }
  return { login, staff, perms, can: (list) => list.some((p) => perms.includes(p)) };
}

async function positionFor(env, id) {
  if (!id) return null;
  const level = DEFAULT_POSITIONS[id];
  const base = level ? { id, level, permissions: LEVEL_PERMISSIONS[level] } : null;
  const row = await env.DB.prepare("SELECT data FROM rows WHERE coll = 'state_positions' AND id = ?").bind(String(id)).first();
  if (!row) return base;
  try { return Object.assign({}, base || {}, JSON.parse(row.data)); } catch { return base; }
}

function rowId(coll, row) {
  const id = String((coll === "state_users" ? row.login : row.id) || "").trim();
  return id && id.length <= 128 ? id : "";
}

// Публічна база бачить те саме, що показують publicLegislativeDocs() і homeDocs() у store.js
function isPublicDoc(doc) {
  const status = doc && doc.status;
  if (status === "ok" || status === "dead") return true;
  if (LEGISLATIVE_TYPES.includes(doc.type) && ["review", "congress", "adopted", "draft"].includes(status)) return true;
  return doc.publishHome === true && !["trash", "rejected", "deleted"].includes(status);
}

// actor = null — анонім. Посадовці бачать усе; громадяни й анонім — публічне плюс свої звернення, заявки й профіль
async function readCollections(env, colls, actor) {
  const data = {};
  colls.forEach((c) => { data[c] = []; });
  const placeholders = colls.map(() => "?").join(",");
  const { results } = await env.DB.prepare(`SELECT coll, data FROM rows WHERE coll IN (${placeholders}) ORDER BY rowid`).bind(...colls).all();
  const full = !!(actor && actor.staff);
  const me = actor && actor.login;
  for (const r of results) {
    let item;
    try { item = JSON.parse(r.data); } catch { continue; }
    if (!full) {
      if (r.coll === "state_appeals" && !(me && item.ownerLogin === me)) continue;
      if (r.coll === "state_profile_requests" && !(me && item.login === me)) continue;
      if (r.coll === "state_docs" && !isPublicDoc(item)) continue;
      if (r.coll === "state_users" && item.login !== me) {
        const slim = {};
        PUBLIC_USER_FIELDS.forEach((k) => { if (k in item) slim[k] = item[k]; });
        item = slim;
      }
    }
    data[r.coll].push(item);
  }
  return data;
}

async function tokenLogin(request, env) {
  const token = bearer(request);
  if (!token) return null;
  const row = await env.DB.prepare("SELECT login, expires_at FROM sessions WHERE token_hash = ?").bind(await sha256(token)).first();
  return row && row.expires_at > Math.floor(Date.now() / 1000) ? row.login : null;
}

function bearer(request) {
  const m = /^Bearer\s+([A-Za-z0-9_-]{20,100})$/.exec(request.headers.get("Authorization") || "");
  return m ? m[1] : "";
}

function seedAccounts(env) {
  try {
    const parsed = JSON.parse(env.SEED_ACCOUNTS || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

async function readJson(request) {
  const len = Number(request.headers.get("Content-Length") || 0);
  if (len > MAX_BODY) return null;
  try {
    const text = await request.text();
    return text.length > MAX_BODY ? null : JSON.parse(text);
  } catch {
    return null;
  }
}

async function hashPassword(password, saltB64) {
  const salt = saltB64 ? fromB64url(saltB64) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: PBKDF2_ITERATIONS }, key, 256);
  return { salt: b64url(salt), hash: b64url(new Uint8Array(bits)) };
}

async function sha256(text) {
  return b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))));
}

/* ---------- Сесія: base64url(payload).base64url(HMAC-SHA256) ---------- */
async function hmacKey(secret) {
  return crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

async function signSession(payload, secret) {
  const body = b64url(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret), new TextEncoder().encode(body));
  return body + "." + b64url(new Uint8Array(sig));
}

async function readSession(request, env) {
  const raw = getCookie(request, SESSION_COOKIE);
  if (!raw || !env.SESSION_SECRET) return null;
  const [body, sig] = raw.split(".");
  if (!body || !sig) return null;
  let ok = false;
  try {
    ok = await crypto.subtle.verify("HMAC", await hmacKey(env.SESSION_SECRET), fromB64url(sig), new TextEncoder().encode(body));
  } catch {
    return null;
  }
  if (!ok) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(fromB64url(body)));
    return payload.exp > Math.floor(Date.now() / 1000) ? payload : null;
  } catch {
    return null;
  }
}

/* ---------- Допоміжне ---------- */
function origins(env) {
  return String(env.FRONTEND_ORIGIN || "").split(",").map((s) => s.trim().replace(/\/$/, "")).filter(Boolean);
}

function firstOrigin(env) {
  return origins(env)[0] || "";
}

function allowedOrigin(request, env) {
  const origin = request.headers.get("Origin");
  return origin && origins(env).includes(origin) ? origin : "";
}

function randomToken(bytes) {
  return b64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

function b64url(bytes) {
  let s = "";
  bytes.forEach((b) => { s += String.fromCharCode(b); });
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(str) {
  const s = str.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(s + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function getCookie(request, name) {
  const header = request.headers.get("Cookie") || "";
  const hit = header.split(/;\s*/).find((c) => c.startsWith(name + "="));
  return hit ? decodeURIComponent(hit.slice(name.length + 1)) : "";
}

function cookie(name, value, { path, maxAge, sameSite }) {
  return `${name}=${encodeURIComponent(value)}; Path=${path}; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=${sameSite}`;
}

function clearCookie(name, path) {
  return `${name}=; Path=${path}; Max-Age=0; HttpOnly; Secure; SameSite=None`;
}

function securityHeaders(headers) {
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("Cache-Control", "no-store");
  return headers;
}

function redirect(location) {
  return new Response(null, { status: 302, headers: securityHeaders(new Headers({ Location: location })) });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: securityHeaders(new Headers({ "Content-Type": "application/json; charset=utf-8" }))
  });
}

function cors(response, origin) {
  const headers = new Headers(response.headers);
  if (origin) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Credentials", "true");
    headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    headers.set("Access-Control-Max-Age", "86400");
    headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  }
  headers.append("Vary", "Origin");
  return new Response(response.body, { status: response.status, headers });
}
