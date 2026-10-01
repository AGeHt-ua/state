-- 2026-10-01: скидання пароля адміном, журнал дій, «надгробки» для кешу в браузері.
-- Застосувати до наявної бази один раз: npx wrangler d1 execute state-db --remote --file=migrations/0001_audit_reset_tombstones.sql
ALTER TABLE accounts ADD COLUMN must_change INTEGER NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS tombstones (coll TEXT NOT NULL, id TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (coll, id));
CREATE INDEX IF NOT EXISTS tombstones_at ON tombstones (at);
CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL, target TEXT NOT NULL, details TEXT NOT NULL);
