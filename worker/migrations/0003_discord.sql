-- Вхід через Discord: прив'язка акаунта до Discord ID і одноразові коди OAuth
ALTER TABLE accounts ADD COLUMN discord_id TEXT;
ALTER TABLE accounts ADD COLUMN discord_name TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS accounts_discord ON accounts(discord_id) WHERE discord_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS oauth_states (
  state TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  login TEXT NOT NULL DEFAULT '',
  data TEXT NOT NULL DEFAULT '',
  expires_at INTEGER NOT NULL
);
