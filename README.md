# State | Ukraine GTA 5 RP

Офіційний портал Уряду штату Сан-Андреас (Ukraine GTA 5 RP).

- Фронт: GitHub Pages (`frontend/`)
- Сервер: Cloudflare Workers + база D1 (`worker/`)
- Мова: українська
- Референс структури: спрощений zakon.rada.gov.ua
- Палітра: темно-синій + золото, є темна тема

## Як це влаштовано

- Сайт — статичні сторінки (`frontend/`), дані бере з Worker (`frontend/assets/config.js`; відкритий локально — з `http://localhost:8787`).
- Worker (`worker/src/index.js`) — акаунти (паролі PBKDF2), входи (у базі лише SHA-256 токена), права й ієрархія ролей,
  погодження документів, Конгрес, журнали (їх підписує сервер), журнал дій адміністрації.
- Єдиний головний акаунт — `admin`: лише він видає повний доступ адміністратора, і ніхто не може змінити, видалити чи понизити його.
  Решта діє за рангом: не можна чіпати рівного чи старшого й видавати права, яких не маєш сам.
- Сайт має сувору політику безпеки (CSP): жодних вбудованих скриптів, лише файли з самого сайту.

## Локальна розробка

```bash
cd frontend
python3 -m http.server 8080
```

і Worker з локальною базою (`worker/dev.cmd` на Windows):

```bash
npm run db:local
npm run dev:worker
```

Секрети для локального Worker — у `worker/.dev.vars` (у git не потрапляє), напр.:

```
SEED_ACCOUNTS={"admin":"локальний-пароль"}
FRONTEND_ORIGIN=http://localhost:8080,http://127.0.0.1:8080
FRONTEND_URL=http://localhost:8080/
DISCORD_CLIENT_ID=test-client
DISCORD_CLIENT_SECRET=test-secret
DISCORD_GUILD_ID=123
DISCORD_API_BASE=http://127.0.0.1:9098
DISCORD_CDN_BASE=http://127.0.0.1:9098
```

(останні п'ять рядків — підставний Discord з автотестів, `tests/mock-discord.mjs`).

## Cloudflare Worker (живий сервер)

Перший запуск (з папки `worker`):

```bash
npx wrangler login
npx wrangler d1 create state-db
npx wrangler kv namespace create BACKUPS
```

Отримані `database_id` і `id` вставити в `wrangler.toml`, далі:

```bash
npx wrangler d1 execute state-db --remote --file=schema.sql
npx wrangler secret put SEED_ACCOUNTS
npx wrangler deploy
```

`SEED_ACCOUNTS` — пароль акаунта `admin` у форматі `{"admin":"пароль"}`.
Адреси сайту — у `wrangler.toml`: `FRONTEND_ORIGIN` (кому дозволено звертатися до сервера) і `FRONTEND_URL` (посилання у сповіщеннях).

## Вхід через Discord

1. https://discord.com/developers/applications → **New Application** → вкладка **OAuth2**.
2. **Redirects** → додати `https://state-ukraine-gta5.d-f-12339.workers.dev/api/discord/callback`.
3. Скопіювати **Client ID** у `DISCORD_CLIENT_ID` в `worker/wrangler.toml`.
4. **Reset Secret** → скопіювати й зберегти секретом:
   ```bash
   cd worker
   npx wrangler secret put DISCORD_CLIENT_SECRET
   ```
5. Щоб входили лише учасники вашого Discord-сервера: у Discord увімкнути режим розробника (Налаштування → Розширені),
   ПКМ по серверу → **Копіювати ID** → вставити в `DISCORD_GUILD_ID` у `wrangler.toml`.
6. Щоб нові акаунти створювались **лише** через Discord (жодних анонімних реєстрацій): `REQUIRE_DISCORD = "1"` у `wrangler.toml`.
7. `npx wrangler deploy`.

Після цього на сторінках входу й реєстрації з'явиться кнопка «Увійти через Discord». Нова людина отримує акаунт громадянина
(логін — з Discord-імені), посадовцю адміністратор потім призначає апарат. Наявний акаунт можна прив'язати в кабінеті:
«Редагувати профіль» → «Discord».

## Сповіщення в Discord і моніторинг

Вебхук створюється в Discord: налаштування каналу → Інтеграція → Вебхуки → Новий вебхук → Копіювати URL.

```bash
cd worker
npx wrangler secret put DISCORD_NOTIFY_WEBHOOK   # канал документів: на погодженні, опубліковано, відхилено, щоденне нагадування
npx wrangler secret put DISCORD_ALERT_WEBHOOK    # канал адміністрації: помилки сервера (однакові — не частіше разу на 10 хв)
```

Журнали запитів і помилок: Cloudflare → Workers → state-ukraine-gta5 → **Observability**.

## Резервні копії

- Щодня о 06:00 UTC уся база копіюється в KV (`backup:РРРР-ММ-ДД`, зберігається 31 день) — крім вкладень (фото й PDF у зверненнях і справах): вони завеликі для KV і зберігаються лише в самій базі (їх відновлює Time Travel нижче).
  Відновлення — інструкція в `worker/scripts/restore-from-backup.mjs`.
- D1 сам дозволяє відкотити базу на будь-який момент за останні 30 днів:
  `npx wrangler d1 time-travel restore state-db --timestamp=2026-10-01T10:00:00Z`.

## Зміни схеми бази (міграції)

Нові таблиці й колонки для вже наявної бази — у `worker/migrations/`. Кожну застосувати до живої бази **один раз**, по черзі:

```bash
cd worker
npx wrangler d1 execute state-db --remote --file=migrations/0001_audit_reset_tombstones.sql
npx wrangler d1 execute state-db --remote --file=migrations/0002_sessions_devices.sql
npx wrangler d1 execute state-db --remote --file=migrations/0003_discord.sql
```

Для нової порожньої бази достатньо `schema.sql` — він уже містить усе.

## Автотести

- `tests/api.test.mjs` — сервер: вхід і обмеження спроб, права й ієрархія, повний цикл погодження, Конгрес, захист від перезапису,
  підписи в журналах, активні входи, вхід через Discord (підставний), скидання пароля, журнал дій, скасування актів, кеш змін.
- `tests/ui/` — браузер (Playwright): сторінки без помилок і порушень CSP, темна тема, вхід паролем і через Discord,
  документ від співробітника через директора й губернатора до законодавчої бази й пошуку, ієрархія в адмін-панелі.

Запускати проти локального Worker із **чистою** базою (див. «Локальна розробка»):

```bash
npm test
npm run test:ui
```

(перед першим UI-запуском: `npm install` і `npx playwright install chromium`).

## Автоматична перевірка й деплой (GitHub Actions)

`.github/workflows/worker.yml`: на кожен push GitHub піднімає Worker із чистою базою й проганяє обидва набори тестів
(при провалі UI-тестів — звіт зі скріншотами в артефактах запуску).
Якщо тести пройшли — Worker деплоїться автоматично, **якщо** в репозиторії додано секрети `CLOUDFLARE_API_TOKEN`
(Cloudflare → My Profile → API Tokens → шаблон «Edit Cloudflare Workers» + доступ до D1) і `CLOUDFLARE_ACCOUNT_ID`
(GitHub → Settings → Secrets and variables → Actions). Без секретів — лише тести.

Міграції бази автоматично не запускаються — їх застосовують вручну (див. вище).

## Деплой Pages

Сайт публікується з гілки `main`; адреса — https://ageht-ua.github.io/state/frontend/.
Після змін у `frontend/assets` підніміть версію `?v=…` у підключеннях, щоб браузери взяли нові файли.
