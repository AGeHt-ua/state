-- Спільна база порталу (Cloudflare D1)
-- Застосувати: npx wrangler d1 execute state-db --remote --file=schema.sql

-- Паролі акаунтів (лише хеш PBKDF2), профіль лежить у rows (coll = 'state_users')
CREATE TABLE IF NOT EXISTS accounts (
  login TEXT PRIMARY KEY,
  salt TEXT NOT NULL,
  hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- Сесії входу: у базі лише SHA-256 від токена
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  login TEXT NOT NULL,
  expires_at INTEGER NOT NULL
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
