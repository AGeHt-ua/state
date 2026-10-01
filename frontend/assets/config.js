/* Адреса Cloudflare Worker зі спільною базою.
   Сайт, відкритий локально (localhost / 127.0.0.1), працює з локальним Worker (worker/dev.cmd, порт 8787) — для розробки й UI-тестів. */
window.STATE_WORKER_URL = /^(localhost|127\.0\.0\.1)$/.test(location.hostname)
  ? "http://localhost:8787"
  : "https://state-ukraine-gta5.d-f-12339.workers.dev";
