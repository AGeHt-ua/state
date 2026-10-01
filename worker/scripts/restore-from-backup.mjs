// Відновлення бази з щоденної резервної копії (Cloudflare KV, ключ backup:РРРР-ММ-ДД).
//
//   1) список копій:   npx wrangler kv key list --binding BACKUPS --remote --prefix backup:
//   2) завантажити:     npx wrangler kv key get "backup:2026-10-01" --binding BACKUPS --remote > backup.json
//   3) SQL:             node scripts/restore-from-backup.mjs backup.json > restore.sql
//   4) застосувати:     npx wrangler d1 execute state-db --remote --file=restore.sql
//
// Замінює всі записи (rows) і акаунти (accounts) на стан із копії; усі входи завершуються (sessions очищується).
// Журнал дій не видаляється — записи з копії, яких немає в базі, додаються.
// Простіший шлях для недавніх подій — вбудований Time Travel: npx wrangler d1 time-travel restore state-db --timestamp=…
import fs from "node:fs";

const file = process.argv[2];
if (!file) { console.error("Вкажіть файл копії: node scripts/restore-from-backup.mjs backup.json"); process.exit(1); }
const backup = JSON.parse(fs.readFileSync(file, "utf8"));
if (backup.v !== 1 || !Array.isArray(backup.rows) || !Array.isArray(backup.accounts)) { console.error("Це не файл резервної копії порталу."); process.exit(1); }

const q = (v) => v === null || v === undefined ? "NULL" : typeof v === "number" ? String(v) : "'" + String(v).replace(/'/g, "''") + "'";
const out = [
  `-- Відновлення з резервної копії від ${backup.at}: ${backup.rows.length} записів, ${backup.accounts.length} акаунтів`,
  "DELETE FROM rows;",
  "DELETE FROM accounts;",
  "DELETE FROM sessions;",
  "DELETE FROM tombstones;"
];
for (const r of backup.rows) out.push(`INSERT INTO rows (coll, id, data, updated_at) VALUES (${q(r.coll)}, ${q(r.id)}, ${q(r.data)}, ${q(r.updated_at)});`);
for (const a of backup.accounts) out.push(`INSERT INTO accounts (login, salt, hash, created_at, must_change, discord_id, discord_name) VALUES (${q(a.login)}, ${q(a.salt)}, ${q(a.hash)}, ${q(a.created_at)}, ${q(a.must_change || 0)}, ${q(a.discord_id)}, ${q(a.discord_name)});`);
for (const a of backup.audit || []) out.push(`INSERT OR IGNORE INTO audit (id, at, actor, action, target, details) VALUES (${q(a.id)}, ${q(a.at)}, ${q(a.actor)}, ${q(a.action)}, ${q(a.target)}, ${q(a.details)});`);
process.stdout.write(out.join("\n") + "\n");
