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
      if (url.pathname === "/api/changes" && request.method === "GET") {
        return cors(await handleChanges(request, env, url), origin);
      }
      if (url.pathname.startsWith("/api/doc/") && request.method === "GET") {
        return cors(await handleDoc(request, env, url), origin);
      }
      if (url.pathname.startsWith("/api/photo/") && request.method === "GET") {
        return handlePhoto(env, url);
      }
      if (url.pathname === "/api/vote" && request.method === "POST") {
        return cors(await handleVote(request, env, url), origin);
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
   - апарати, посади, маршрути, типи документів — manageStructure / manageRoutes;
   - документи й фони — посадовці (governor / official / prosecutor / court);
   - звернення й заявки на зміну профілю — посадовці будь-які, інші — лише свої. */
const COLLECTIONS = [
  "state_users", "state_offices", "state_positions", "state_approval_routes",
  "state_docs", "state_appeals", "state_profile_requests", "state_doc_backgrounds", "state_doc_types"
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
  return json({ user: login, data: await readCollections(env, COLLECTIONS, actor, { base: baseOf(request) }) });
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
  return json({ ok: true, login, token, data: await readCollections(env, COLLECTIONS, await loadActor(env, login), { base: baseOf(request) }) });
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
  return json({ ok: true, data: await readCollections(env, ["state_users", "state_profile_requests"], actor, { base: baseOf(request) }) });
}

// Зміни приходять як різниця: які елементи колекції додано/змінено і які видалено
async function handleSync(request, env) {
  const login = await tokenLogin(request, env);
  if (!login) return json({ error: "Сесія завершилась. Увійдіть знову." }, 401);
  const body = await readJson(request);
  const ops = body && Array.isArray(body.ops) ? body.ops : null;
  if (!ops || !ops.length || ops.length > COLLECTIONS.length) return json({ error: "Невірний запит." }, 400);

  const actor = await loadActor(env, login);
  const base = baseOf(request);
  const prepared = [];
  const touched = new Set();
  let maxRev = 0;
  for (const op of ops) {
    const coll = op && op.coll;
    if (!COLLECTIONS.includes(coll)) return json({ error: "Невідома колекція." }, 400);
    touched.add(coll);
    const upserts = [];
    for (const item of Array.isArray(op.upsert) ? op.upsert : []) {
      if (!item || typeof item !== "object" || Array.isArray(item)) return json({ error: "Невірний запис." }, 400);
      const row = Object.assign({}, item);
      // Службові поля, які додає видача (версія запису, скорочений документ) — у базі не зберігаються
      const rev = row._rev;
      const partial = row._partial === true;
      ["_rev", "_partial", "_versions", "_history", "password"].forEach((k) => { delete row[k]; });
      const id = rowId(coll, row);
      if (!id) return json({ error: "Запис без id." }, 400);
      upserts.push({ id, row, rev: typeof rev === "number" ? rev : null, partial });
    }
    const removes = (Array.isArray(op.remove) ? op.remove : []).map((raw) => String(raw || "").slice(0, 128)).filter(Boolean);

    const denied = await checkWrite(env, actor, coll, upserts, removes);
    if (denied) return json({ error: denied }, 403);

    // Хтось уже змінив запис після того, як його завантажили — не перезаписуємо чужу роботу
    const current = await readRevs(env, coll, upserts.map((u) => u.id));
    const conflict = upserts.find((u) => u.rev === null ? current[u.id] !== undefined : current[u.id] !== u.rev);
    if (conflict) {
      return json({ error: "Цей запис щойно змінив інший користувач. Дані оновлено — перевірте й повторіть дію.", conflict: true,
        data: await readCollections(env, [...touched], actor, { base }) }, 409);
    }
    Object.values(current).forEach((r) => { maxRev = Math.max(maxRev, r); });

    // Скорочений документ (без версій та історії) доповнюємо збереженими в базі; фото профілю, що прийшло посиланням, лишається тим, що в базі
    const needExisting = upserts.filter((u) => (coll === "state_docs" && u.partial) ||
      (coll === "state_users" && typeof u.row.photo === "string" && u.row.photo.includes("/api/photo/")));
    const existing = needExisting.length ? await readRows(env, coll, needExisting.map((u) => u.id)) : {};
    for (const u of upserts) {
      const old = existing[u.id];
      if (coll === "state_docs" && u.partial && old) {
        u.row.history = (old.history || []).concat(u.row.history || []).slice(-80);
        u.row.versions = (old.versions || []).concat(u.row.versions || []).slice(-30);
      }
      if (coll === "state_users" && typeof u.row.photo === "string" && u.row.photo.includes("/api/photo/")) u.row.photo = (old && old.photo) || "";
      u.data = JSON.stringify(u.row);
      if (u.data.length > MAX_ROW) return json({ error: "Запис завеликий (понад 1.9 МБ). Зменште зображення." }, 413);
    }
    prepared.push({ coll, upserts, removes });
  }

  // Версія запису = час зміни; строго більша за попередню, щоб перевірка вище працювала навіть у межах однієї мілісекунди
  const now = Math.max(Date.now(), maxRev + 1);
  const statements = [];
  for (const { coll, upserts, removes } of prepared) {
    upserts.forEach((u) => statements.push(u.rev === null
      ? env.DB.prepare("INSERT INTO rows (coll, id, data, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT (coll, id) DO NOTHING").bind(coll, u.id, u.data, now)
      : env.DB.prepare("UPDATE rows SET data = ?, updated_at = ? WHERE coll = ? AND id = ? AND updated_at = ?").bind(u.data, now, coll, u.id, u.rev)));
    removes.forEach((id) => statements.push(env.DB.prepare("DELETE FROM rows WHERE coll = ? AND id = ?").bind(coll, id)));
  }
  if (statements.length > 500) return json({ error: "Забагато змін за раз." }, 400);
  if (statements.length) await env.DB.batch(statements);
  return json({ ok: true, data: await readCollections(env, [...touched], actor, { base }) });
}

async function readRevs(env, coll, ids) {
  const out = {};
  const unique = [...new Set(ids)];
  for (let i = 0; i < unique.length; i += 50) {
    const chunk = unique.slice(i, i + 50);
    const { results } = await env.DB.prepare(`SELECT id, updated_at FROM rows WHERE coll = ? AND id IN (${chunk.map(() => "?").join(",")})`).bind(coll, ...chunk).all();
    results.forEach((r) => { out[r.id] = r.updated_at; });
  }
  return out;
}

// Повертає текст помилки, якщо запис заборонений, інакше порожньо
async function checkWrite(env, actor, coll, upserts, removes) {
  const noRights = "Недостатньо прав для цієї дії.";
  if (!upserts.length && !removes.length) return "";
  if (coll === "state_users") return actor.can(USER_ADMIN_PERMS) ? "" : noRights;
  if (["state_offices", "state_positions", "state_approval_routes", "state_doc_types"].includes(coll)) return actor.can(STRUCTURE_PERMS) ? "" : noRights;
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
  return { login, staff, perms, profile: user, can: (list) => list.some((p) => perms.includes(p)) };
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

// Що кому віддавати. Фільтрує й обрізає сама база (json_extract), а Worker лише склеює готові рядки:
// розбір і збирання мегабайтів JSON (фото профілів) не вкладалися в ліміт процесорного часу Workers.
// actor = null — анонім. Посадовці бачать усе, крім чужих заявок на зміну профілю (їх бачать ті, хто їх підтверджує);
// громадяни й анонім — публічні документи (як publicLegislativeDocs() і homeDocs() у store.js), свої звернення, заявки й профіль.
// У розглянутих заявок фото не віддається — воно вже в профілі.
// data -> '$.k' повертає JSON-значення (true лишається true, а не 1)
const PUBLIC_USER_SQL = "json_object(" + PUBLIC_USER_FIELDS.map((k) => k === "roles"
  ? `'roles', json(COALESCE(data -> '$.roles', '[]'))`
  : `'${k}', json(data -> '$.${k}')`).join(", ") + ")";
const LEGISLATIVE_SQL = LEGISLATIVE_TYPES.map((t) => `'${t.replace(/'/g, "''")}'`).join(", ");

/* Легка видача: документи — без версій та історії (вони завантажуються на сторінці документа через /api/doc/…),
   фото профілів — посиланням на /api/photo/… (браузер кешує картинку), до кожного запису додається _rev — версія запису
   для захисту від перезапису. opts.since — лише записи, змінені після цієї версії (живе оновлення, /api/changes). */
const DOC_LIST_SQL = "json_set(json_remove(data, '$.versions', '$.history'), '$._partial', json('true'), " +
  "'$._versions', COALESCE(json_array_length(data, '$.versions'), 0), '$._history', COALESCE(json_array_length(data, '$.history'), 0))";

async function readCollections(env, colls, actor, opts = {}) {
  const list = colls.filter((c) => COLLECTIONS.includes(c));
  const full = actor && actor.staff ? 1 : 0;
  const me = (actor && actor.login) || "";
  const reviewer = actor && actor.can(["approveProfiles"]) ? 1 : 0;
  const since = Number(opts.since) || 0;
  const sql = `
    SELECT coll, updated_at, json_set(
      CASE
        WHEN coll = 'state_users' THEN json_set(
          CASE WHEN ?1 = 0 AND id != ?2 THEN ${PUBLIC_USER_SQL} ELSE data END,
          '$.photo', CASE WHEN json_extract(data, '$.photo') LIKE 'data:%' THEN ?4 || '/api/photo/' || id || '?v=' || updated_at
                          ELSE COALESCE(json_extract(data, '$.photo'), '') END)
        WHEN coll = 'state_profile_requests' AND COALESCE(json_extract(data, '$.status'), '') != 'pending' THEN json_remove(data, '$.photo')
        WHEN coll = 'state_docs' THEN ${DOC_LIST_SQL}
        ELSE data
      END, '$._rev', updated_at) AS data
    FROM rows
    WHERE coll IN (${list.map((c) => `'${c}'`).join(", ")})
      AND updated_at > ?5
      AND (coll != 'state_appeals' OR ?1 = 1 OR json_extract(data, '$.ownerLogin') = ?2)
      AND (coll != 'state_profile_requests' OR ?3 = 1 OR json_extract(data, '$.login') = ?2)
      AND (coll != 'state_docs' OR ?1 = 1
        OR json_extract(data, '$.status') IN ('ok', 'dead')
        OR (json_extract(data, '$.status') IN ('review', 'congress', 'adopted', 'draft') AND (
          json_extract(data, '$.type') IN (${LEGISLATIVE_SQL})
          OR json_extract(data, '$.type') IN (SELECT json_extract(t.data, '$.label') FROM rows t WHERE t.coll = 'state_doc_types' AND json_extract(t.data, '$.congress') = 1)))
        OR (json_extract(data, '$.publishHome') = 1 AND COALESCE(json_extract(data, '$.status'), '') NOT IN ('trash', 'rejected', 'deleted')))
    ORDER BY rowid`;
  const { results } = await env.DB.prepare(sql).bind(full, me, reviewer, opts.base || "", since).all();
  const parts = {};
  list.forEach((c) => { parts[c] = []; });
  let maxRev = since;
  results.forEach((r) => { parts[r.coll].push(r.data); maxRev = Math.max(maxRev, r.updated_at); });
  const raw = new RawJson("{" + list.map((c) => JSON.stringify(c) + ":[" + parts[c].join(",") + "]").join(",") + "}");
  raw.maxRev = maxRev;
  return raw;
}

function baseOf(request) {
  return new URL(request.url).origin;
}

// Зміни після версії since — для живого оновлення сторінок (голосування, повідомлення)
async function handleChanges(request, env, url) {
  const since = Number(url.searchParams.get("since")) || 0;
  if (!since) return json({ error: "Потрібен параметр since." }, 400);
  const login = await tokenLogin(request, env);
  const actor = login ? await loadActor(env, login) : null;
  const data = await readCollections(env, COLLECTIONS, actor, { base: baseOf(request), since });
  return json({ user: login, now: data.maxRev, data });
}

// Повний документ з версіями та історією (для сторінки документа) — з тими ж правилами видимості
async function handleDoc(request, env, url) {
  const id = decodeURIComponent(url.pathname.slice("/api/doc/".length)).slice(0, 128);
  const login = await tokenLogin(request, env);
  const actor = login ? await loadActor(env, login) : null;
  const row = await env.DB.prepare(
    "SELECT json_set(data, '$._rev', updated_at) AS data, json_extract(data, '$.status') AS status, json_extract(data, '$.type') AS type, json_extract(data, '$.publishHome') AS home FROM rows WHERE coll = 'state_docs' AND id = ?"
  ).bind(id).first();
  if (!row) return json({ error: "Документ не знайдено." }, 404);
  if (!(actor && actor.staff)) {
    let visible = row.status === "ok" || row.status === "dead" || (row.home === 1 && !["trash", "rejected", "deleted"].includes(row.status));
    if (!visible && ["review", "congress", "adopted", "draft"].includes(row.status)) {
      const custom = await env.DB.prepare("SELECT 1 FROM rows WHERE coll = 'state_doc_types' AND json_extract(data, '$.label') = ? AND json_extract(data, '$.congress') = 1").bind(row.type).first();
      visible = LEGISLATIVE_TYPES.includes(row.type) || !!custom;
    }
    if (!visible) return json({ error: "Документ не знайдено." }, 404);
  }
  return json({ doc: new RawJson(row.data) });
}

// Фото профілю окремою картинкою: браузер кешує її назавжди (адреса змінюється разом із фото — ?v=версія)
async function handlePhoto(env, url) {
  const login = decodeURIComponent(url.pathname.slice("/api/photo/".length)).slice(0, 64);
  const row = await env.DB.prepare("SELECT json_extract(data, '$.photo') AS photo FROM rows WHERE coll = 'state_users' AND id = ?").bind(login).first();
  const m = row && /^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/=]+)$/.exec(row.photo || "");
  if (!m) return new Response("Not found", { status: 404, headers: { "Access-Control-Allow-Origin": "*" } });
  const bytes = Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0));
  return new Response(bytes, {
    headers: {
      "Content-Type": m[1],
      "Cache-Control": "public, max-age=31536000, immutable",
      "Access-Control-Allow-Origin": "*",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

// Голос Конгресу записується одним атомарним оновленням у базі: одночасні голоси не затирають один одного
async function handleVote(request, env, url) {
  const login = await tokenLogin(request, env);
  if (!login) return json({ error: "Сесія завершилась. Увійдіть знову." }, 401);
  const actor = await loadActor(env, login);
  if (!actor.staff || actor.profile.congressMember !== true) return json({ error: "Голосувати можуть лише конгресмени." }, 403);
  const body = await readJson(request);
  const id = String((body && body.id) || "").slice(0, 128);
  const vote = body && body.vote === "against" ? "against" : "for";
  const record = JSON.stringify({ vote, name: String(actor.profile.name || login).slice(0, 64), at: new Date().toISOString() });
  const res = await env.DB.prepare(
    "UPDATE rows SET data = json_set(json_set(data, '$.votes', json(COALESCE(data -> '$.votes', '{}'))), '$.votes.' || json_quote(?1), json(?2)), " +
    "updated_at = MAX(updated_at + 1, ?3) " +
    "WHERE coll = 'state_docs' AND id = ?4 AND json_extract(data, '$.status') = 'congress' AND json_extract(data, '$.approverOffice') = 'congress'"
  ).bind(login, record, Date.now(), id).run();
  const row = await env.DB.prepare(`SELECT json_set(${DOC_LIST_SQL}, '$._rev', updated_at) AS data FROM rows WHERE coll = 'state_docs' AND id = ?`).bind(id).first();
  if (!res.meta.changes) return json({ error: "Голосування за цим документом уже завершене.", doc: row ? new RawJson(row.data) : null }, 409);
  return json({ ok: true, doc: new RawJson(row.data) });
}

// Готовий JSON-текст, який json() вставляє у відповідь без повторного перетворення
class RawJson {
  constructor(text) { this.text = text; }
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
  // RawJson (готові дані з бази) вставляються як є, без повторного JSON.stringify мегабайтного тексту
  const raws = [];
  let text = JSON.stringify(data, (key, value) => {
    if (value instanceof RawJson) { raws.push(value.text); return "__raw_json_" + (raws.length - 1) + "__"; }
    return value;
  });
  raws.forEach((raw, i) => { text = text.replace('"__raw_json_' + i + '__"', () => raw); });
  return new Response(text, {
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
