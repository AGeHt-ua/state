// Підставний Discord для автотестів (Worker запускається з DISCORD_API_BASE=http://127.0.0.1:9098).
// Код авторизації = Discord ID користувача; ID, що містить «404», — не учасник Discord-сервера.
// /api/oauth2/authorize одразу повертає на redirect_uri з кодом ?as=<ID> (за замовчуванням — сталий тестовий ID),
// тож UI-тест може пройти вхід кліком, як справжня людина.
import http from "node:http";

export const MOCK_DISCORD_PORT = 9098;

export async function startMockDiscord(port = MOCK_DISCORD_PORT) {
  const state = { nextId: "700000000000000001" };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    const send = (status, data) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(data)); };
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      const id = String(req.headers.authorization || "").replace("Bearer tok-", "");
      if (url.pathname === "/api/oauth2/authorize") {
        const back = new URL(url.searchParams.get("redirect_uri"));
        back.searchParams.set("code", state.nextId);
        back.searchParams.set("state", url.searchParams.get("state"));
        res.writeHead(302, { Location: back.toString() });
        return res.end();
      }
      if (url.pathname === "/api/oauth2/token") return send(200, { access_token: "tok-" + new URLSearchParams(body).get("code") });
      if (url.pathname === "/api/v10/users/@me") return send(200, { id, username: "dc_" + id.slice(-6), global_name: "Discord " + id.slice(-4) });
      if (url.pathname.startsWith("/api/v10/users/@me/guilds/")) return id.includes("404") ? send(404, {}) : send(200, { roles: [] });
      send(404, {});
    });
  });
  await new Promise((ok, fail) => { server.once("error", fail); server.listen(port, "127.0.0.1", ok); });
  return { state, close: () => new Promise((ok) => server.close(ok)) };
}
