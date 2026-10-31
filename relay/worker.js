// Ретранслятор «Сови» на Cloudflare Workers: постійна HTTPS-адреса для сайту.
// Бот на SparkedHost відкриває тунель *.trycloudflare.com (адреса змінюється після перезапуску)
// і повідомляє її сюди, підписавши ключем Ed25519. Worker перевіряє підпис відкритим ключем бота
// (RELAY_PUBKEY у wrangler.toml) і пересилає всі запити сайту на актуальну адресу.

const UPSTREAM_RE = /^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/;
const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*" },
  });
}

async function verify(env, url, ts, sig) {
  if (!UPSTREAM_RE.test(url || "") || Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;
  const key = await crypto.subtle.importKey("raw", b64(env.RELAY_PUBKEY), { name: "Ed25519" }, false, ["verify"]);
  return crypto.subtle.verify({ name: "Ed25519" }, key, b64(sig), new TextEncoder().encode(`${url}|${ts}`));
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/__sova/upstream") {
      if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
      const { url: upstream, ts, sig } = await request.json().catch(() => ({}));
      const ok = await verify(env, upstream, ts, sig).catch(() => false);
      if (!ok) return json({ error: "Bad signature" }, 403);
      await env.SOVA.put("upstream", upstream);
      return json({ ok: true });
    }

    if (url.pathname === "/__sova/status") {
      return json({ upstream: Boolean(await env.SOVA.get("upstream")) });
    }

    const upstream = await env.SOVA.get("upstream", { cacheTtl: 30 });
    if (!upstream) return json({ error: "Бот «Сова» зараз не на зв'язку. Спробуйте за хвилину." }, 503);

    const init = { method: request.method, headers: request.headers, redirect: "manual" };
    if (!["GET", "HEAD"].includes(request.method)) {
      init.body = request.body;
      init.duplex = "half";
    }
    try {
      const resp = await fetch(upstream + url.pathname + url.search, init);
      return new Response(resp.body, resp);
    } catch {
      return json({ error: "Бот «Сова» не відповідає. Спробуйте за хвилину." }, 502);
    }
  },
};
