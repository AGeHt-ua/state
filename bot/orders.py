"""Накази про призначення на посаду: звання з 8-го щабля й вище — наказом Голови СБУ (Статут СБУ, р. V; п. 5.2).
Голова обирає співробітника, нове звання й за потреби підрозділ; бот одразу змінює ролі, нікнейм і кадровий аудит.
Скасування наказу повертає попереднє звання й підрозділ, якщо після наказу їх ніхто не змінював."""
import json
import logging

import discord

import core
import style
from core import Fail
from db import db, now_ms
from roles import DEPTS, OPS_DEPTS, rank_name

log = logging.getLogger("sova.orders")


def can_appoint(u: dict) -> bool:
    return u["rank"] == 15


async def appoint(u: dict, b: dict) -> dict:
    if not can_appoint(u):
        raise Fail("Призначення на посади здійснює Голова СБУ.", 403)
    p = await core.user(int(b.get("sid") or 0))
    if not p or p["status"] == "dismissed" or p["dept"] == "prosecutor":
        raise Fail("Співробітника не знайдено.")
    if p["sid"] == u["sid"]:
        raise Fail("Призначити самого себе не можна.")
    to_rank = int(b.get("rank") or 0)
    if not 1 <= to_rank <= 14:
        raise Fail("Оберіть звання від 1 до 14 (звання Голови наказом не присвоюється).")
    to_dept = b.get("dept") or p["dept"]
    if to_rank >= 13:
        to_dept = "lead"
    elif to_rank <= 4 and to_dept not in OPS_DEPTS:
        to_dept = "academy"
    elif to_dept not in OPS_DEPTS:
        raise Fail("Оберіть підрозділ.")
    extra = b.get("extra") if to_rank == 12 and b.get("extra") in OPS_DEPTS and b.get("extra") != to_dept else None
    if to_rank == p["rank"] and to_dept == p["dept"] and not extra:
        raise Fail("Звання й підрозділ не змінюються.")
    reason = str(b.get("reason") or "").strip()[:800]
    t = now_ms()
    oid = await db.run("INSERT INTO orders(sid,kind,from_rank,to_rank,from_dept,to_dept,extra,reason,by_sid,t,status) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                       p["sid"], "appoint", p["rank"], to_rank, p["dept"], to_dept, extra, reason, u["sid"], t, "active")
    await db.run("UPDATE users SET rank=?, dept=?, since=? WHERE sid=?", to_rank, to_dept, t if to_rank != p["rank"] else p["since"], p["sid"])
    old = p["dept"] if p["dept"] in OPS_DEPTS and p["dept"] not in (to_dept, extra) else None
    await apply_roles(p["sid"], extra, f"Сова: наказ НП-{oid:04d}", drop_extra=old)
    await db.audit(u["sid"], "Призначення на посаду", p["sid"],
                   f"{rank_name(p['rank'])} / {DEPTS[p['dept']]['s']} → {rank_name(to_rank)} / {DEPTS[to_dept]['s']}"
                   + (f" + {DEPTS[extra]['s']}" if extra else "") + f" · НП-{oid:04d}")
    o = await get(oid)
    await journal(o, u, "Оголошено наказ")
    await core.send_audit(await core.user(p["sid"]), u)
    return o


async def apply_roles(sid: int, extra: str | None, reason: str, drop_extra: str | None = None):
    p = await core.user(sid)
    await core.sync_roles(p, reason)
    await core.set_nick(p)
    if not (extra or drop_extra) or not p.get("discord_id"):
        return
    m = await core.member_of(p["discord_id"], fresh=True)
    if not m:
        return
    try:
        if extra and (r := m.guild.get_role(DEPTS[extra]["role"])):
            await m.add_roles(r, reason=reason)  # другий відділ начальника (напр. ОРВ + ДЕБ)
        if drop_extra and (r := m.guild.get_role(DEPTS[drop_extra]["role"])):
            await m.remove_roles(r, reason=reason)
    except discord.Forbidden:
        log.warning("Немає прав змінити ролі %s", m)
    core._roles_cache.pop(str(p["discord_id"]), None)


async def get(oid: int) -> dict:
    o = await db.one("SELECT * FROM orders WHERE id=?", oid)
    if not o or o["status"] == "deleted":
        raise Fail("Наказ не знайдено.", 404)
    return o


async def cancel(u: dict, oid: int) -> dict:
    """Скасування наказу: повертає попереднє звання/підрозділ, якщо поточні ще такі, як призначив наказ."""
    if not can_appoint(u):
        raise Fail("Скасувати наказ може Голова СБУ.", 403)
    o = await get(oid)
    if o["status"] != "active":
        raise Fail("Наказ уже скасовано.")
    p = await core.user(o["sid"])
    reverted = bool(p and p["rank"] == o["to_rank"] and p["dept"] == o["to_dept"] and p["status"] != "dismissed")
    if reverted:
        await db.run("UPDATE users SET rank=?, dept=?, since=? WHERE sid=?", o["from_rank"], o["from_dept"], now_ms(), o["sid"])
        await apply_roles(o["sid"], None, f"Сова: скасування наказу НП-{oid:04d}", drop_extra=o["extra"])
    await db.run("UPDATE orders SET status='deleted', cancelled_by=?, cancelled=? WHERE id=?", u["sid"], now_ms(), oid)
    await db.audit(u["sid"], "Скасовано наказ про призначення", o["sid"],
                   f"НП-{oid:04d}" + (" · звання й підрозділ повернуто" if reverted else " · звання вже змінювалось, повернення не виконано"))
    await journal(o, u, "Наказ скасовано" + (" · попереднє звання повернуто" if reverted else ""))
    return {"reverted": reverted}


async def journal(o: dict, u: dict, label: str):
    ch = await core.channel("audit")
    if not ch:
        return
    p = await core.user(o["sid"])
    lines = [style.kv("НАКАЗ", f"НП-{o['id']:04d} · про призначення на посаду", "white", True),
             style.kv("СПІВРОБІТНИК", f"{p['name']} · №{p['sid']}" if p else f"№{o['sid']}", "white", True),
             style.kv("БУЛО", f"{rank_name(o['from_rank'])} · {DEPTS[o['from_dept']]['s']}", "gray"),
             style.kv("ПРИЗНАЧЕНО", f"{rank_name(o['to_rank'])} · {DEPTS[o['to_dept']]['s']}" + (f" + {DEPTS[o['extra']]['s']}" if o["extra"] else ""), "gold", True)]
    if o["reason"]:
        lines += [style.kv("ПІДСТАВА" if i == 0 else "", s, "white") for i, s in enumerate(style.wrap(o["reason"], 28))]
    lines += [style.rule(), style.kv("ДІЯ", label, "green" if "Оголошено" in label else "cyan", True),
              style.kv("ХТО", f"{u['name']} · №{u['sid']}", "white"), style.kv("ДАТА", style.when(), "gray")]
    e = style.document("НАКАЗ ПРО ПРИЗНАЧЕННЯ НА ПОСАДУ", 0xC9A05A, desc=style.block(*lines), footer="Статут СБУ, р. V · п. 5.2: призначення наказом Голови СБУ")
    try:
        await ch.send(embed=e, allowed_mentions=discord.AllowedMentions.none())
    except discord.HTTPException as ex:
        log.warning("Журнал наказів: %s", ex)


async def listing() -> list[dict]:
    rows = await db.all("SELECT * FROM orders WHERE status!='deleted' ORDER BY t DESC LIMIT 100")
    out = []
    for o in rows:
        p, by = await core.user(o["sid"]), await core.user(o["by_sid"])
        out.append({**o, "name": p["name"] if p else f"№{o['sid']}", "byName": by["name"] if by else "—",
                    "fromRank": rank_name(o["from_rank"]), "toRank": rank_name(o["to_rank"])})
    return out
