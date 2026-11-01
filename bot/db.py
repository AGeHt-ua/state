"""База даних SQLite. Один файл data/sova.db — його бот і бекапить у Discord."""
import json
import time
import aiosqlite

from config import DB_PATH

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
  sid        INTEGER PRIMARY KEY,          -- Static ID = номер жетона
  name       TEXT NOT NULL,
  discord_id TEXT UNIQUE,
  pw_hash    TEXT,
  pw_set     INTEGER,
  rank       INTEGER DEFAULT 1,
  dept       TEXT DEFAULT 'academy',
  since      INTEGER,                      -- коли отримав поточне звання (мс)
  status     TEXT DEFAULT 'active',        -- active | vacation | dismissed
  created    INTEGER
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  sid        INTEGER NOT NULL,
  created    INTEGER,
  expires    INTEGER
);
CREATE TABLE IF NOT EXISTS acts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  by_sid     INTEGER NOT NULL,
  dept       TEXT,
  type       TEXT NOT NULL,
  qty        INTEGER DEFAULT 1,
  t          INTEGER,
  arts       TEXT DEFAULT '[]',
  subj       TEXT DEFAULT '',
  evidence   TEXT DEFAULT '',
  files      TEXT DEFAULT '[]',
  note       TEXT DEFAULT '',
  status     TEXT DEFAULT 'wait',          -- wait | ok | rej
  reviewer   INTEGER,
  reviewed   INTEGER,
  ch_id      TEXT,
  msg_id     TEXT
);
CREATE TABLE IF NOT EXISTS raps (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  by_sid     INTEGER NOT NULL,
  dept       TEXT,
  type       TEXT NOT NULL,                -- promo | vac | dismiss | transfer
  data       TEXT DEFAULT '{}',
  t          INTEGER,
  status     TEXT DEFAULT 'wait',
  reviewer   INTEGER,
  reviewed   INTEGER,
  ch_id      TEXT,
  msg_id     TEXT
);
CREATE TABLE IF NOT EXISTS files (
  id         TEXT PRIMARY KEY,
  ch_id      TEXT,
  msg_id     TEXT,
  filename   TEXT,
  ctype      TEXT,
  size       INTEGER,
  uploader   INTEGER,
  t          INTEGER
);
CREATE TABLE IF NOT EXISTS audit (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  t          INTEGER,
  actor      INTEGER,                      -- 0 = бот
  action     TEXT,
  target     INTEGER,
  details    TEXT
);
CREATE TABLE IF NOT EXISTS settings (
  k TEXT PRIMARY KEY,
  v TEXT
);
CREATE TABLE IF NOT EXISTS access_requests (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  discord_id TEXT NOT NULL,
  sid        INTEGER NOT NULL,
  name       TEXT NOT NULL,
  t          INTEGER,
  status     TEXT DEFAULT 'wait',          -- wait | ok | rej
  reviewer   TEXT,                         -- Discord ID того, хто розглянув
  reviewed   INTEGER,
  ch_id      TEXT,
  msg_id     TEXT
);
CREATE TABLE IF NOT EXISTS candidates (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  discord_id TEXT NOT NULL,
  sid        INTEGER NOT NULL,
  name       TEXT NOT NULL,
  age        TEXT,
  exp        TEXT,
  motive     TEXT,
  t          INTEGER,
  status     TEXT DEFAULT 'vvb',           -- vvb (перевірка ВВБ) | vkpp (рішення ВКПП) | ok | rej
  vvb_by     TEXT, vvb_t INTEGER,          -- Discord ID і час рішення ВВБ
  vkpp_by    TEXT, vkpp_t INTEGER,
  note       TEXT,
  vvb_ch TEXT, vvb_msg TEXT, vkpp_ch TEXT, vkpp_msg TEXT
);
CREATE TABLE IF NOT EXISTS cases (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  dept     TEXT NOT NULL,                -- orv | deb | atc | alpha
  author   INTEGER NOT NULL,             -- Static ID виконавця
  status   TEXT DEFAULT 'draft',         -- draft | head | chief | prosecutor | approved | rejected
  reached  INTEGER DEFAULT 0,            -- найдальший етап (3 = дійшло до прокурора)
  data     TEXT,                         -- зміст справи (JSON)
  history  TEXT,                         -- рух документа й візи (JSON)
  created  INTEGER, updated INTEGER, approved INTEGER
);
CREATE TABLE IF NOT EXISTS bonuses (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  week       INTEGER UNIQUE,               -- початок тижня (мс)
  status     TEXT DEFAULT 'draft',         -- draft | sent | approved | paid
  rows       TEXT,                         -- рядки відомості (JSON)
  cfg        TEXT,                         -- ліміти на момент формування (JSON)
  history    TEXT,
  created_by INTEGER, created INTEGER, updated INTEGER
);
CREATE TABLE IF NOT EXISTS discipline (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  sid        INTEGER NOT NULL,             -- на кого накладено
  dept       TEXT,
  kind       TEXT NOT NULL,                -- remark | reprimand | severe | fine | demote | dismiss | blacklist
  violation  TEXT,                         -- код порушення з каталогу
  reason     TEXT,
  fine       INTEGER DEFAULT 0,
  status     TEXT DEFAULT 'active',        -- active | lifted | cancelled | deleted
  issued_by  INTEGER, issued INTEGER, expires INTEGER,
  appeal     TEXT,                         -- скарга й рішення (JSON)
  history    TEXT,
  inspection INTEGER
);
CREATE TABLE IF NOT EXISTS inspections (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  sid        INTEGER NOT NULL,             -- щодо кого перевірка
  title      TEXT, materials TEXT, conclusion TEXT, recommend TEXT, files TEXT,
  status     TEXT DEFAULT 'open',          -- open | sent | closed | deleted
  author     INTEGER, created INTEGER, updated INTEGER, order_id INTEGER
);
CREATE TABLE IF NOT EXISTS orders (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  sid        INTEGER NOT NULL,
  kind       TEXT DEFAULT 'appoint',       -- наказ про призначення на посаду
  from_rank  INTEGER, to_rank INTEGER, from_dept TEXT, to_dept TEXT,
  extra      TEXT,                         -- другий відділ начальника відділу
  reason     TEXT,
  by_sid     INTEGER, t INTEGER,
  status     TEXT DEFAULT 'active',        -- active | deleted
  cancelled_by INTEGER, cancelled INTEGER
);
CREATE INDEX IF NOT EXISTS disc_sid ON discipline(sid);
CREATE INDEX IF NOT EXISTS acts_by ON acts(by_sid);
CREATE INDEX IF NOT EXISTS acts_status ON acts(status);
CREATE INDEX IF NOT EXISTS raps_status ON raps(status);
"""


def now_ms() -> int:
    return int(time.time() * 1000)


class DB:
    def __init__(self):
        self.conn: aiosqlite.Connection | None = None

    async def open(self):
        self.conn = await aiosqlite.connect(DB_PATH)
        self.conn.row_factory = aiosqlite.Row
        await self.conn.execute("PRAGMA journal_mode=WAL")
        await self.conn.execute("PRAGMA foreign_keys=ON")
        await self.conn.executescript(SCHEMA)
        for sql in ("ALTER TABLE candidates ADD COLUMN discord_name TEXT", "ALTER TABLE candidates ADD COLUMN extra TEXT",
                    "ALTER TABLE candidates ADD COLUMN photo TEXT",
                    "ALTER TABLE orders ADD COLUMN signed_by INTEGER", "ALTER TABLE orders ADD COLUMN signed INTEGER", "ALTER TABLE orders ADD COLUMN note TEXT",
                    "ALTER TABLE raps ADD COLUMN copies TEXT",
                    "ALTER TABLE orders ADD COLUMN title TEXT", "ALTER TABLE orders ADD COLUMN body TEXT"):
            try:
                await self.conn.execute(sql)
            except Exception:
                pass  # колонка вже є
        await self.conn.commit()

    async def close(self):
        if self.conn:
            await self.conn.close()
            self.conn = None

    async def one(self, sql: str, *args) -> dict | None:
        async with self.conn.execute(sql, args) as cur:
            row = await cur.fetchone()
        return dict(row) if row else None

    async def all(self, sql: str, *args) -> list[dict]:
        async with self.conn.execute(sql, args) as cur:
            rows = await cur.fetchall()
        return [dict(r) for r in rows]

    async def run(self, sql: str, *args) -> int:
        cur = await self.conn.execute(sql, args)
        await self.conn.commit()
        return cur.lastrowid

    async def get_setting(self, key: str, default=None):
        row = await self.one("SELECT v FROM settings WHERE k=?", key)
        return json.loads(row["v"]) if row else default

    async def set_setting(self, key: str, value):
        await self.run("INSERT INTO settings(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v", key, json.dumps(value, ensure_ascii=False))

    async def audit(self, actor: int, action: str, target: int, details: str):
        await self.run("INSERT INTO audit(t,actor,action,target,details) VALUES(?,?,?,?,?)", now_ms(), actor, action, target, details)

    async def snapshot(self, path: str):
        """Цілісна копія бази в окремий файл (для бекапу)."""
        await self.conn.execute("VACUUM INTO ?", (path,))


db = DB()
