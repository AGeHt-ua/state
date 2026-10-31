// Ретранслятор «Сови» на Cloudflare Workers: постійна HTTPS-адреса для сайту.
// Бот на SparkedHost відкриває тунель *.trycloudflare.com (адреса змінюється після перезапуску)
// і повідомляє її сюди; Worker пересилає всі запити сайту на актуальну адресу.
//
// Потрібно у Worker: KV-простір із прив'язкою SOVA і секрет RELAY_SECRET (той самий, що в .env бота).

const UPSTREAM_RE = /^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*" },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/__sova/upstream") {
      if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
      if (request.headers.get("Authorization") !== `Bearer ${env.RELAY_SECRET}`) return json({ error: "Forbidden" }, 403);
      const { url: upstream } = await request.json().catch(() => ({}));
      if (!UPSTREAM_RE.test(upstream || "")) return json({ error: "Bad upstream" }, 400);
      await env.SOVA.put("upstream", upstream);
      return json({ ok: true });
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
