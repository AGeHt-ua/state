-- Спільна база порталу (Cloudflare D1)
-- Застосувати: npx wrangler d1 execute state-db --remote --file=schema.sql

-- Паролі акаунтів (лише хеш PBKDF2), профіль лежить у rows (coll = 'state_users')
CREATE TABLE IF NOT EXISTS accounts (
  login TEXT PRIMARY KEY,
  salt TEXT NOT NULL,
  hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  must_change INTEGER NOT NULL DEFAULT 0, -- 1 — адмін скинув пароль, людина має змінити тимчасовий
  discord_id TEXT,                       -- прив'язаний Discord (вхід через Discord)
  discord_name TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS accounts_discord ON accounts(discord_id) WHERE discord_id IS NOT NULL;

-- Одноразові коди входу через Discord (state OAuth, коди прив'язки й обміну)
CREATE TABLE IF NOT EXISTS oauth_states (
  state TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  login TEXT NOT NULL DEFAULT '',
  data TEXT NOT NULL DEFAULT '',
  expires_at INTEGER NOT NULL
);

-- Сесії входу: у базі лише SHA-256 від токена
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  login TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT 0, -- коли увійшли
  last_seen INTEGER NOT NULL DEFAULT 0,  -- коли востаннє користувались (з точністю до години)
  ua TEXT NOT NULL DEFAULT ''            -- браузер і система, напр. «Chrome, Windows»
);

-- Записи колекцій сайту (state_docs, state_appeals, …): один рядок = один елемент із його id
CREATE TABLE IF NOT EXISTS rows (
  coll TEXT NOT NULL,
  id TEXT NOT NULL,
  data TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (coll, id)
);

-- Живе оновлення (/api/changes) шукає записи, змінені після певної версії
CREATE INDEX IF NOT EXISTS rows_updated ON rows (updated_at);

-- Обмеження частоти: спроби входу, реєстрації, звернення (ключ → лічильник у вікні часу)
CREATE TABLE IF NOT EXISTS limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  reset_at INTEGER NOT NULL
);

-- Видалені записи: браузери з кешем дізнаються, що запис зник (/api/changes)
CREATE TABLE IF NOT EXISTS tombstones (
  coll TEXT NOT NULL,
  id TEXT NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (coll, id)
);
CREATE INDEX IF NOT EXISTS tombstones_at ON tombstones (at);

-- Журнал дій адміністрації: хто, коли, що зробив
CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT NOT NULL,
  details TEXT NOT NULL
);
