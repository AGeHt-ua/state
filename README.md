# State | Ukraine GTA 5 RP

Офіційний портал Уряду штату Сан-Андреас (Ukraine GTA 5 RP).

- Фронт: GitHub Pages (`frontend/`)
- API / Discord OAuth: Cloudflare Workers (`worker/`)
- Мова: українська
- Референс структури: спрощений zakon.rada.gov.ua
- Палітра: темно-синій + золото

## Статус

Етап 1 — каркас. Discord-ролі ще не підключені (заглушки в кабінеті).

## Локальний перегляд фронту

```bash
cd frontend
python3 -m http.server 8080
```

Головна: `http://localhost:8080/`

Маршрути:
- `/` — головна
- `/acts/` — законодавча база
- `/acts/<id>/` — картка акта
- `/structure/` — органи влади
- `/login/` — вхід
- `/cabinet/` — кабінет
- `/cabinet/acts/` — чернетки
- `/cabinet/court/` — суд

## Cloudflare Worker (спільна база)

Worker зберігає акаунти й дані порталу в базі D1, тож усі користувачі бачать одне й те саме.
Поки `STATE_WORKER_URL` у `frontend/assets/config.js` порожній, дані живуть лише в браузері.

Перший запуск (з папки `worker`):

```bash
npx wrangler login
npx wrangler d1 create state-db
```

Отриманий `database_id` вставити в `wrangler.toml`, далі:

```bash
npx wrangler d1 execute state-db --remote --file=schema.sql
npx wrangler secret put SEED_ACCOUNTS
npx wrangler deploy
```

`SEED_ACCOUNTS` — паролі службових акаунтів з `accounts.js` у форматі `{"castro":"пароль","admin":"пароль"}`
(паролі в `accounts.js` публічні й у режимі сервера не працюють).

Після деплою:
- адресу Worker (`https://state-ukraine-gta5.<акаунт>.workers.dev`) вписати в `STATE_WORKER_URL` у `frontend/assets/config.js`;
- адресу GitHub Pages додати до `FRONTEND_ORIGIN` у `wrangler.toml` і знову `npx wrangler deploy`.

Локально: `worker/dev.cmd` (або `npx wrangler dev`) — Worker на `http://localhost:8787` з локальною базою
(схема: `npx wrangler d1 execute state-db --local --file=schema.sql`, секрети — у `worker/.dev.vars`).

Бета-обмеження: права (хто що може редагувати) поки перевіряє лише фронт; сервер перевіряє вхід.

Discord OAuth (пізніше):

```bash
npx wrangler secret put DISCORD_CLIENT_ID
npx wrangler secret put DISCORD_CLIENT_SECRET
npx wrangler secret put DISCORD_BOT_TOKEN
npx wrangler secret put DISCORD_GUILD_ID
npx wrangler secret put SESSION_SECRET
```

Redirect URI в Discord Developer Portal: `https://<worker>.workers.dev/api/callback`

## Деплой Pages

Корінь Pages вказати як `frontend`.
