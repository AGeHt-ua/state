/**
 * Cloudflare Worker: Discord OAuth + session stub.
 * Secrets: DISCORD_CLIENT_SECRET, DISCORD_BOT_TOKEN, SESSION_SECRET
 */

const DISCORD_AUTH = "https://discord.com/api/oauth2/authorize";
const DISCORD_TOKEN = "https://discord.com/api/oauth2/token";
const DISCORD_API = "https://discord.com/api/v10";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = env.FRONTEND_ORIGIN || "*";

    if (request.method === "OPTIONS") {
      return cors(new Response(null, { status: 204 }), origin);
    }

    if (url.pathname === "/api/health") {
      return cors(json({ ok: true, auth: Boolean(env.DISCORD_CLIENT_ID) }), origin);
    }

    if (url.pathname === "/api/login") {
      if (!env.DISCORD_CLIENT_ID) {
        return cors(json({ error: "DISCORD_CLIENT_ID не задано" }, 501), origin);
      }
      const redirect = `${url.origin}/api/callback`;
      const params = new URLSearchParams({
        client_id: env.DISCORD_CLIENT_ID,
        redirect_uri: redirect,
        response_type: "code",
        scope: "identify guilds guilds.members.read",
        prompt: "consent"
      });
      return Response.redirect(`${DISCORD_AUTH}?${params}`, 302);
    }

    if (url.pathname === "/api/callback") {
      return handleCallback(url, env, origin);
    }

    if (url.pathname === "/api/me") {
      return cors(json({
        id: null,
        username: null,
        roles: [],
        note: "Сесії cookie ще не підключені. Фронт зараз використовує localStorage-заглушку."
      }), origin);
    }

    return cors(json({ error: "Not found" }, 404), origin);
  }
};

async function handleCallback(url, env, origin) {
  const code = url.searchParams.get("code");
  if (!code) {
    return cors(json({ error: "Немає code від Discord" }, 400), origin);
  }
  if (!env.DISCORD_CLIENT_ID || !env.DISCORD_CLIENT_SECRET) {
    return cors(json({ error: "Немає Discord credentials" }, 501), origin);
  }

  const body = new URLSearchParams({
    client_id: env.DISCORD_CLIENT_ID,
    client_secret: env.DISCORD_CLIENT_SECRET,
    grant_type: "authorization_code",
    code,
    redirect_uri: `${url.origin}/api/callback`
  });

  const tokenRes = await fetch(DISCORD_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  const token = await tokenRes.json();
  if (!token.access_token) {
    return cors(json({ error: "Не вдалося обміняти code", details: token }, 401), origin);
  }

  const meRes = await fetch(`${DISCORD_API}/users/@me`, {
    headers: { Authorization: `Bearer ${token.access_token}` }
  });
  const me = await meRes.json();

  let roles = [];
  if (env.DISCORD_BOT_TOKEN && env.DISCORD_GUILD_ID) {
    const memberRes = await fetch(
      `${DISCORD_API}/guilds/${env.DISCORD_GUILD_ID}/members/${me.id}`,
      { headers: { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}` } }
    );
    if (memberRes.ok) {
      const member = await memberRes.json();
      roles = member.roles || [];
    }
  }

  const frontend = env.FRONTEND_ORIGIN || "http://localhost:8080";
  const redirect = new URL("cabinet/", frontend.endsWith("/") ? frontend : frontend + "/");
  redirect.searchParams.set("discord_id", me.id || "");
  redirect.searchParams.set("username", me.username || "");
  redirect.searchParams.set("roles", roles.join(","));
  return Response.redirect(redirect.toString(), 302);
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" }
  });
}

function cors(response, origin) {
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", origin);
  headers.set("Access-Control-Allow-Credentials", "true");
  headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  return new Response(response.body, { status: response.status, headers });
}
