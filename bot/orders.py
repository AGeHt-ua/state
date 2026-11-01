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


def can_sign(u: dict) -> bool:
    """Підписують накази Голова СБУ та Заступник Голови."""
    return u["rank"] >= 14


def can_prepare(u: dict) -> bool:
    """Проєкти наказів готує ВКПП (кадри); Голова й заступник — теж."""
    return can_sign(u) or core.has_dept_role(u, "vkpp")


def can_appoint(u: dict) -> bool:
    return can_prepare(u)


async def appoint(u: dict, b: dict) -> dict:
    """Проєкт наказу. Якщо готує Голова чи заступник і просить підписати одразу — наказ одразу набирає чинності."""
    if not can_prepare(u):
        raise Fail("Проєкти наказів про призначення готує ВКПП.", 403)
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
    if await db.one("SELECT id FROM orders WHERE sid=? AND status='draft'", p["sid"]):
        raise Fail("На цього співробітника вже є проєкт наказу на підписі.")
    reason = str(b.get("reason") or "").strip()[:800]
    oid = await db.run("INSERT INTO orders(sid,kind,from_rank,to_rank,from_dept,to_dept,extra,reason,by_sid,t,status) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                       p["sid"], "appoint", p["rank"], to_rank, p["dept"], to_dept, extra, reason, u["sid"], now_ms(), "draft")
    if b.get("sign") and can_sign(u):
        return await sign(u, oid)
    o = await get(oid)
    await journal(o, u, "Проєкт наказу підготовлено · на підписі Голови")
    return o


async def sign(u: dict, oid: int) -> dict:
    """Підпис наказу Головою або заступником: звання, підрозділ, ролі й нікнейм змінюються одразу."""
    if not can_sign(u):
        raise Fail("Підписують накази Голова СБУ та Заступник Голови.", 403)
    o = await get(oid)
    if o["status"] != "draft":
        raise Fail("Цей проєкт уже розглянуто.")
    p = await core.user(o["sid"])
    if not p or p["status"] == "dismissed":
        raise Fail("Співробітника вже немає у складі.")
    if p["sid"] == u["sid"]:
        raise Fail("Підписати наказ щодо себе не можна.")
    t = now_ms()
    # «Було» фіксуємо на момент підпису — з проєкту звання могло змінитися
    await db.run("UPDATE orders SET status='active', from_rank=?, from_dept=?, signed_by=?, signed=? WHERE id=?", p["rank"], p["dept"], u["sid"], t, oid)
    await db.run("UPDATE users SET rank=?, dept=?, since=? WHERE sid=?", o["to_rank"], o["to_dept"], t if o["to_rank"] != p["rank"] else p["since"], p["sid"])
    old = p["dept"] if p["dept"] in OPS_DEPTS and p["dept"] not in (o["to_dept"], o["extra"]) else None
    await apply_roles(p["sid"], o["extra"], f"Сова: наказ НП-{oid:04d}", drop_extra=old)
    await db.audit(u["sid"], "Призначення на посаду", p["sid"],
                   f"{rank_name(p['rank'])} / {DEPTS[p['dept']]['s']} → {rank_name(o['to_rank'])} / {DEPTS[o['to_dept']]['s']}"
                   + (f" + {DEPTS[o['extra']]['s']}" if o["extra"] else "") + f" · НП-{oid:04d}")
    o = await get(oid)
    await journal(o, u, "Наказ підписано й оголошено")
    await core.send_audit(await core.user(p["sid"]), u)
    return o


async def reject(u: dict, oid: int, note: str) -> dict:
    if not can_sign(u):
        raise Fail("Відхиляють проєкти Голова СБУ та Заступник Голови.", 403)
    o = await get(oid)
    if o["status"] != "draft":
        raise Fail("Цей проєкт уже розглянуто.")
    await db.run("UPDATE orders SET status='rejected', signed_by=?, signed=?, note=? WHERE id=?", u["sid"], now_ms(), (note or "")[:300], oid)
    o = await get(oid)
    await journal(o, u, "Проєкт наказу відхилено" + (f": {note}" if note else ""))
    return o


async def delete_draft(u: dict, oid: int):
    o = await get(oid)
    if o["status"] not in ("draft", "rejected"):
        raise Fail("Підписаний наказ не видаляється — його можна лише скасувати.")
    if not (o["by_sid"] == u["sid"] or can_sign(u)):
        raise Fail("Видалити проєкт може той, хто його підготував, або Голова й заступник.", 403)
    await db.run("UPDATE orders SET status='deleted', cancelled_by=?, cancelled=? WHERE id=?", u["sid"], now_ms(), oid)


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
    if not can_sign(u):
        raise Fail("Скасувати наказ може Голова СБУ або Заступник Голови.", 403)
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
    ch = await core.channel("orders")
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
        # підписаний наказ Голови / Заступника — згадка ролі СБУ; проєкти й відхилення — без згадок
        await ch.send(embed=e, **(core.mention("order") if o["status"] == "active" and "підписано" in label
                                  else core.mention("order:draft") if o["status"] == "draft"
                                  else {"allowed_mentions": discord.AllowedMentions.none()}))
    except discord.HTTPException as ex:
        log.warning("Журнал наказів: %s", ex)


async def listing() -> list[dict]:
    rows = await db.all("SELECT * FROM orders WHERE kind='appoint' AND status!='deleted' ORDER BY t DESC LIMIT 100")
    out = []
    for o in rows:
        p, by = await core.user(o["sid"]), await core.user(o["by_sid"])
        sg = await core.user(o["signed_by"]) if o.get("signed_by") else None
        out.append({**o, "name": p["name"] if p else f"№{o['sid']}", "byName": by["name"] if by else "—", "signedName": sg["name"] if sg else None,
                    "curRank": rank_name(p["rank"]) if p else "",
                    "fromRank": rank_name(o["from_rank"]), "toRank": rank_name(o["to_rank"])})
    return out


# ---------------------------------------------------------------- довільні накази Голови / Заступника (НГ-…)
async def create_free(u: dict, b: dict) -> dict:
    if not can_sign(u):
        raise Fail("Накази видають Голова СБУ та Заступник Голови.", 403)
    title = str(b.get("title") or "").strip()[:150]
    text = str(b.get("body") or "").strip()[:3500]
    if not title or len(text) < 10:
        raise Fail("Вкажіть назву наказу й текст.")
    oid = await db.run("INSERT INTO orders(sid,kind,title,body,by_sid,t,status) VALUES(?,?,?,?,?,?,?)",
                       u["sid"], "free", title, text, u["sid"], now_ms(), "active")
    o = await get(oid)
    await free_post(o, u)
    await db.audit(u["sid"], "Наказ Голови СБУ", 0, f"НГ-{oid:04d} · {title[:80]}")
    return o


async def free_post(o: dict, u: dict, cancelled: bool = False):
    ch = await core.channel("orders")
    if not ch:
        return
    if cancelled:
        e = style.document(f"НАКАЗ НГ-{o['id']:04d} СКАСОВАНО", 0x5F6A7A, desc=f"«{o['title']}»\nСкасував: {u['name']} · {style.when()}")
        kw = {"allowed_mentions": discord.AllowedMentions.none()}
    else:
        e = style.document(f"НАКАЗ № НГ-{o['id']:04d}", 0xC9A05A,
                           desc=f"**{o['title'].upper()}**\n\n{o['body']}\n\n*{rank_name(u['rank'])} {u['name']}* · {style.when(o['t'])}",
                           footer="Наказ обов'язковий до виконання всім особовим складом СБУ")
        kw = core.mention("order")
    try:
        await ch.send(embed=e, **kw)
    except discord.HTTPException as ex:
        log.warning("Наказ НГ: %s", ex)


async def delete_free(u: dict, oid: int):
    o = await get(oid)
    if o["kind"] != "free":
        raise Fail("Це не наказ Голови.", 400)
    if not (o["by_sid"] == u["sid"] or u["rank"] == 15):
        raise Fail("Скасувати наказ може той, хто його видав, або Голова СБУ.", 403)
    await db.run("UPDATE orders SET status='deleted', cancelled_by=?, cancelled=? WHERE id=?", u["sid"], now_ms(), oid)
    await db.audit(u["sid"], "Наказ Голови скасовано", 0, f"НГ-{oid:04d}")
    await free_post(o, u, cancelled=True)


async def listing_free() -> list[dict]:
    rows = await db.all("SELECT * FROM orders WHERE kind='free' AND status!='deleted' ORDER BY t DESC LIMIT 100")
    out = []
    for o in rows:
        by = await core.user(o["by_sid"])
        out.append({k: o[k] for k in ("id", "title", "body", "t", "by_sid")} | {"byName": by["name"] if by else "—", "byRank": rank_name(by["rank"]) if by else ""})
    return out
