/**
 * Cloudflare Worker: Discord OAuth + підписана сесія.
 * Secrets: DISCORD_CLIENT_SECRET, DISCORD_BOT_TOKEN, SESSION_SECRET (≥ 32 випадкові символи)
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
    headers.set("Access-Control-Allow-Headers", "Content-Type");
    headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  }
  headers.append("Vary", "Origin");
  return new Response(response.body, { status: response.status, headers });
}
