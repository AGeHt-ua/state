"""Бекапи бази: кожні N годин стиснена копія йде в канал #сова-бекапи і лишається на диску."""
import gzip
import logging
import os
import shutil
import sqlite3
import time
from datetime import datetime, timezone

import discord

import config
import core
from db import db

log = logging.getLogger("sova.backup")
SQLITE_MAGIC = b"SQLite format 3\x00"


async def make_backup(reason: str) -> tuple[str, int]:
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d_%H-%M")
    raw = config.BACKUP_DIR / f"sova-{stamp}.db"
    if raw.exists():
        raw.unlink()
    await db.snapshot(str(raw))
    gz = raw.with_suffix(".db.gz")
    with open(raw, "rb") as src, gzip.open(gz, "wb", compresslevel=9) as dst:
        shutil.copyfileobj(src, dst)
    raw.unlink()
    size = gz.stat().st_size
    ch = await core.channel("backups")
    if ch:
        if size <= config.MAX_UPLOAD_MB * 1024 * 1024:
            await ch.send(f"Бекап бази · {reason} · {size / 1024:.0f} КБ", file=discord.File(gz))
        else:
            await ch.send(f"Бекап {gz.name} ({size / 1048576:.1f} МБ) завеликий для Discord — збережено лише на хостингу.")
    prune_local()
    log.info("Бекап %s (%s)", gz.name, reason)
    return gz.name, size


def prune_local():
    cutoff = time.time() - config.BACKUP_KEEP_DAYS * 86400
    for f in config.BACKUP_DIR.glob("sova-*.db.gz"):
        if f.stat().st_mtime < cutoff:
            f.unlink()


async def restore(data: bytes, filename: str) -> str:
    """Відновлює базу з бекапу. Поточна база спершу зберігається як sova-before-restore-*.db.gz."""
    if filename.endswith(".gz"):
        data = gzip.decompress(data)
    if not data.startswith(SQLITE_MAGIC):
        raise core.Fail("Це не файл бази «Сови».")
    tmp = config.DATA_DIR / "restore.tmp"
    tmp.write_bytes(data)
    try:
        con = sqlite3.connect(tmp)
        tables = {r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        con.close()
    except sqlite3.DatabaseError:
        tmp.unlink()
        raise core.Fail("Файл бази пошкоджено.")
    if not {"users", "acts", "raps"} <= tables:
        tmp.unlink()
        raise core.Fail("У файлі немає таблиць «Сови».")
    name, _ = await make_backup("перед відновленням")
    await db.close()
    for suffix in ("-wal", "-shm"):
        p = config.DB_PATH.with_name(config.DB_PATH.name + suffix)
        if p.exists():
            p.unlink()
    os.replace(tmp, config.DB_PATH)
    await db.open()
    return name
