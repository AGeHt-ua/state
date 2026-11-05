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
import style
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
        fits = size <= config.MAX_UPLOAD_MB * 1024 * 1024
        users = await db.one("SELECT COUNT(*) AS n FROM users WHERE status NOT IN ('dismissed','removed')")
        lines = [style.kv("АРХІВ", gz.name, "white", True), style.kv("ПІДСТАВА", reason, "white"),
                 style.kv("РОЗМІР", f"{size / 1024:.0f} КБ", "cyan"), style.kv("ОСОБОВИЙ СКЛАД", f"{users['n']} осіб", "white"),
                 style.rule(),
                 style.kv("СТАН", "ЗБЕРЕЖЕНО: DISCORD + ХОСТИНГ" if fits else "ЛИШЕ ХОСТИНГ (завеликий)", "green" if fits else "gold", True)]
        e = style.document("РЕЗЕРВНА КОПІЯ БАЗИ ЄІС «СОВА»", 0x5FB37A if fits else 0xD9A23D, desc=style.block(*lines),
                           footer=f"Зберігається {config.BACKUP_KEEP_DAYS} діб · відновлення: /сова відновити")
        if fits:
            await ch.send(embed=e, file=discord.File(gz))
        else:
            await ch.send(embed=e)
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
    import core  # пункти звітів з адмін-панелі зберігаються в базі — перечитати з відновленої
    await core.load_custom_acts()
    return name
