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
   Бета-тест: права доступу (хто що може редагувати) поки перевіряє лише фронт.
   Сервер гарантує вхід (хеш пароля, токен сесії) і не віддає приватні колекції без входу. */
const COLLECTIONS = [
  "state_users", "state_offices", "state_positions", "state_approval_routes",
  "state_docs", "state_appeals", "state_profile_requests", "state_doc_backgrounds"
];
// Без входу видно лише те, що й так показують публічні сторінки
const PUBLIC_COLLECTIONS = ["state_offices", "state_positions", "state_approval_routes", "state_docs", "state_doc_backgrounds"];
const PUBLIC_USER_FIELDS = ["login", "name", "roles", "office", "positionId", "post", "photo", "congressMember"];
const LOGIN_RE = /^[a-z0-9_.-]{3,32}$/;
const TOKEN_TTL = 30 * 24 * 3600;
const PBKDF2_ITERATIONS = 100000; // максимум, який дозволяє Workers
const MAX_BODY = 8 * 1024 * 1024;
const MAX_ROW = 1900 * 1024; // ліміт рядка D1 — 2 МБ

async function handleState(request, env) {
  const login = await tokenLogin(request, env);
  return json({ user: login, data: await readCollections(env, login ? COLLECTIONS : PUBLIC_COLLECTIONS.concat("state_users"), !login) });
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
  return json({ ok: true, login, token, data: await readCollections(env, COLLECTIONS, false) });
}

async function handleSignout(request, env) {
  const token = bearer(request);
  if (token) await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256(token)).run();
  return json({ ok: true });
}

// Зміни приходять як різниця: які елементи колекції додано/змінено і які видалено
async function handleSync(request, env) {
  const login = await tokenLogin(request, env);
  if (!login) return json({ error: "Сесія завершилась. Увійдіть знову." }, 401);
  const body = await readJson(request);
  const ops = body && Array.isArray(body.ops) ? body.ops : null;
  if (!ops || !ops.length || ops.length > COLLECTIONS.length) return json({ error: "Невірний запит." }, 400);

  const now = Date.now();
  const statements = [];
  const touched = new Set();
  for (const op of ops) {
    const coll = op && op.coll;
    if (!COLLECTIONS.includes(coll)) return json({ error: "Невідома колекція." }, 400);
    touched.add(coll);
    for (const item of Array.isArray(op.upsert) ? op.upsert : []) {
      if (!item || typeof item !== "object" || Array.isArray(item)) return json({ error: "Невірний запис." }, 400);
      const row = Object.assign({}, item);
      if (coll === "state_users") delete row.password; // паролі живуть лише в accounts
      const id = rowId(coll, row);
      if (!id) return json({ error: "Запис без id." }, 400);
      const data = JSON.stringify(row);
      if (data.length > MAX_ROW) return json({ error: "Запис завеликий (понад 1.9 МБ). Зменште зображення." }, 413);
      statements.push(env.DB.prepare(
        "INSERT INTO rows (coll, id, data, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT (coll, id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at"
      ).bind(coll, id, data, now));
    }
    for (const rawId of Array.isArray(op.remove) ? op.remove : []) {
      const id = String(rawId || "").slice(0, 128);
      if (id) statements.push(env.DB.prepare("DELETE FROM rows WHERE coll = ? AND id = ?").bind(coll, id));
    }
  }
  if (statements.length > 500) return json({ error: "Забагато змін за раз." }, 400);
  if (statements.length) await env.DB.batch(statements);
  return json({ ok: true, data: await readCollections(env, [...touched], false) });
}

function rowId(coll, row) {
  const id = String((coll === "state_users" ? row.login : row.id) || "").trim();
  return id && id.length <= 128 ? id : "";
}

async function readCollections(env, colls, publicOnly) {
  const data = {};
  colls.forEach((c) => { data[c] = []; });
  const placeholders = colls.map(() => "?").join(",");
  const { results } = await env.DB.prepare(`SELECT coll, data FROM rows WHERE coll IN (${placeholders}) ORDER BY rowid`).bind(...colls).all();
  for (const r of results) {
    let item;
    try { item = JSON.parse(r.data); } catch { continue; }
    if (publicOnly && r.coll === "state_users") {
      const slim = {};
      PUBLIC_USER_FIELDS.forEach((k) => { if (k in item) slim[k] = item[k]; });
      item = slim;
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
