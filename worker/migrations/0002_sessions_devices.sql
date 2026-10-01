-- 2026-10-01: «Активні входи» — коли й з якого пристрою увійшли.
-- Застосувати до наявної бази один раз: npx wrangler d1 execute state-db --remote --file=migrations/0002_sessions_devices.sql
ALTER TABLE sessions ADD COLUMN created_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN last_seen INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN ua TEXT NOT NULL DEFAULT '';
