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

## Cloudflare Worker

```bash
cd worker
npx wrangler login
npx wrangler dev
```

Секрети (пізніше):

```bash
npx wrangler secret put DISCORD_CLIENT_ID
npx wrangler secret put DISCORD_CLIENT_SECRET
npx wrangler secret put DISCORD_BOT_TOKEN
npx wrangler secret put DISCORD_GUILD_ID
npx wrangler secret put SESSION_SECRET
```

Redirect URI в Discord Developer Portal:

`https://<worker>.workers.dev/api/callback`

## Деплой Pages

Корінь Pages вказати як `frontend`.
