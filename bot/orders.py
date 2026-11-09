"""Накази про призначення на посаду: звання з 8-го щабля й вище — наказом Голови СБУ (Статут СБУ, р. V; п. 5.2).
Голова обирає співробітника, нове звання й за потреби підрозділ; бот одразу змінює ролі, нікнейм і кадровий аудит.
Скасування наказу повертає попереднє звання й підрозділ, якщо після наказу їх ніхто не змінював."""
import json
import logging

import discord

import core
import docpost
import overrides as ov
import style
from core import Fail
from db import db, now_ms
from roles import DEPTS, OPS_DEPTS, rank_name

log = logging.getLogger("sova.orders")


def can_sign(u: dict) -> bool:
    """Підписують накази Голова СБУ та Заступник Голови (поріг — в адмін-панелі)."""
    return u["rank"] >= ov.P("order_sign")


def can_prepare(u: dict) -> bool:
    """Проєкти наказів готує ВКПП (кадри); Голова й заступник — теж."""
    return can_sign(u) or core.has_dept_role(u, "vkpp")


def can_appoint(u: dict) -> bool:
    return can_prepare(u)


MGMT_MAX = 3  # скільки відділів може вести один начальник управління


def extra_list(extra) -> list[str]:
    """Відділи з поля extra наказу: «deb» (другий відділ начальника відділу) або «atc,alpha» (відділи начальника управління)."""
    raw = extra if isinstance(extra, (list, tuple)) else str(extra or "").split(",")
    return list(dict.fromkeys(k.strip() for k in raw if str(k).strip() in OPS_DEPTS))


def to_label(o: dict) -> str:
    """«Начальник управління · ЦСО «А», АТЦ» / «Начальник відділу · ОРВ + ДЕБ»."""
    xs = [DEPTS[k]["s"] for k in extra_list(o.get("extra"))]
    if o["to_dept"] == "lead":
        return f"{rank_name(o['to_rank'])} · {DEPTS['lead']['s']}" + (f" ({', '.join(xs)})" if xs else "")
    return f"{rank_name(o['to_rank'])} · {DEPTS[o['to_dept']]['s']}" + "".join(f" + {x}" for x in xs)


async def appoint(u: dict, b: dict) -> dict:
    """Проєкт наказу. Якщо готує Голова чи заступник і просить підписати одразу — наказ одразу набирає чинності."""
    if not can_prepare(u):
        raise Fail("Проєкти наказів про призначення готує ВКПП.", 403)
    p = await core.user(int(b.get("sid") or 0))
    if not p or p["status"] == "dismissed" or p["dept"] in ("prosecutor", "curator"):
        raise Fail("Співробітника не знайдено.")
    if p["sid"] == u["sid"]:
        raise Fail("Призначити самого себе не можна.")
    if p["rank"] == 15:
        raise Fail("Звання Голови СБУ наказом про призначення не змінюється.", 403)
    try:
        to_rank = int(b.get("rank") or 0)
    except (TypeError, ValueError):
        to_rank = 0
    if not 1 <= to_rank <= 14:
        raise Fail("Оберіть звання від 1 до 14 (звання Голови наказом не присвоюється).")
    to_dept = b.get("dept") or p["dept"]
    if to_rank >= 13:
        to_dept = "lead"
    elif to_rank <= 4 and to_dept not in OPS_DEPTS:
        to_dept = "academy"
    elif to_dept not in OPS_DEPTS:
        raise Fail("Оберіть підрозділ.")
    if to_rank == 13:
        # Начальник управління веде свої відділи (напр. ЦСО «А» + АТЦ або ОРВ + ДЕБ): бот видасть ролі саме цих відділів
        extra = ",".join(extra_list(b.get("extra"))[:MGMT_MAX]) or None
        if not extra:
            raise Fail("Оберіть відділи, якими керуватиме начальник управління.")
    else:
        extra = b.get("extra") if to_rank == 12 and b.get("extra") in OPS_DEPTS and b.get("extra") != to_dept else None
    if to_rank == p["rank"] and to_dept == p["dept"] and not extra:
        raise Fail("Звання й підрозділ не змінюються.")
    if await db.one("SELECT id FROM orders WHERE sid=? AND status='draft'", p["sid"]):
        raise Fail("На цього співробітника вже є проєкт наказу на підписі.")
    reason = str(b.get("reason") or "").strip()[:800]
    oid = await db.run("INSERT INTO orders(sid,kind,from_rank,to_rank,from_dept,to_dept,extra,reason,by_sid,t,status) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                       p["sid"], "appoint", p["rank"], to_rank, p["dept"], to_dept, extra, reason, u["sid"], now_ms(), "draft")
    if b.get("sign") and can_sign(u):
        return await sign(u, oid, tag=b.get("tag"))
    o = await get(oid)
    await journal(o, u, "Проєкт наказу підготовлено · на підписі Голови", tag=b.get("tag"))
    return o


@core.serialized("np")
async def sign(u: dict, oid: int, tag: str | None = None) -> dict:
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
    if u["rank"] != 15 and (p["rank"] >= u["rank"] or o["to_rank"] >= u["rank"]):
        # Заступник Голови не змінює звання рівних і старших і не призначає на звання, рівне своєму
        raise Fail("Цей наказ (щодо рівного чи старшого за званням або на звання не нижче вашого) підписує Голова СБУ.", 403)
    t = now_ms()
    # «Було» фіксуємо на момент підпису — з проєкту звання могло змінитися
    await db.run("UPDATE orders SET status='active', from_rank=?, from_dept=?, signed_by=?, signed=? WHERE id=?", p["rank"], p["dept"], u["sid"], t, oid)
    await db.run("UPDATE users SET rank=?, dept=?, since=? WHERE sid=?", o["to_rank"], o["to_dept"], t if o["to_rank"] != p["rank"] else p["since"], p["sid"])
    keep = {o["to_dept"], *extra_list(o["extra"])}
    if o["to_rank"] == 13 and o["extra"]:
        drop = [k for k in OPS_DEPTS if k not in keep]  # начальник управління — ролі лише своїх відділів, інші знімаємо
    else:
        drop = [p["dept"]] if p["dept"] in OPS_DEPTS and p["dept"] not in keep else []
    roles_res = await apply_roles(p["sid"], o["extra"], f"Сова: наказ НП-{oid:04d}", drop_extra=drop)
    await db.audit(u["sid"], "Призначення на посаду", p["sid"],
                   f"{rank_name(p['rank'])} / {DEPTS[p['dept']]['s']} → {to_label(o).replace(' · ', ' / ', 1)} · НП-{oid:04d}")
    o = await get(oid)
    await journal(o, u, "Наказ підписано й оголошено", tag=tag)
    await core.send_audit(await core.user(p["sid"]), u)
    if warn := core.roles_problem(roles_res):
        await db.audit(u["sid"], "⚠ Ролі не збігаються з наказом", p["sid"], f"НП-{oid:04d}: {warn}"[:500])
    return {**o, "rolesWarning": warn}


@core.serialized("np")
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


@core.serialized("np")
async def delete_draft(u: dict, oid: int):
    o = await get(oid)
    if o["status"] not in ("draft", "rejected"):
        raise Fail("Підписаний наказ не видаляється — його можна лише скасувати.")
    if not (o["by_sid"] == u["sid"] or can_sign(u)):
        raise Fail("Видалити проєкт може той, хто його підготував, або Голова й заступник.", 403)
    await db.run("UPDATE orders SET status='deleted', cancelled_by=?, cancelled=? WHERE id=?", u["sid"], now_ms(), oid)
    await docpost.remove("np", oid)  # проєкт видалено — і його повідомлення в Discord


async def apply_roles(sid: int, extra, reason: str, drop_extra=None) -> dict:
    """Ролі за наказом: звання й відділ з картки + додаткові відділи (extra: другий відділ начальника відділу
    або відділи начальника управління) / зняти колишні (drop_extra). Ролі, потрібні за карткою, не знімаються ніколи.
    Одна сувора синхронізація з перевіркою після змін (core.sync_roles)."""
    p = await core.user(sid)
    role = lambda ks: {DEPTS[k]["role"] for k in extra_list(ks) if DEPTS[k].get("role")}
    add = role(extra)
    drop = role(drop_extra) - add - core.roles_for(p["rank"], p["dept"])
    return await core.sync_roles(p, reason, extra_add=add, extra_remove=drop)


async def get(oid: int) -> dict:
    o = await db.one("SELECT * FROM orders WHERE id=?", oid)
    if not o or o["status"] == "deleted":
        raise Fail("Наказ не знайдено.", 404)
    return o


@core.serialized("np")
async def cancel(u: dict, oid: int) -> dict:
    """Скасування наказу: повертає попереднє звання/підрозділ, якщо поточні ще такі, як призначив наказ."""
    if not can_sign(u):
        raise Fail("Скасувати наказ може Голова СБУ або Заступник Голови.", 403)
    o = await get(oid)
    if o["status"] != "active":
        raise Fail("Наказ уже скасовано.")
    p = await core.user(o["sid"])
    if u["rank"] != 15 and p and (p["rank"] >= u["rank"] or (o["from_rank"] or 0) >= u["rank"]):
        raise Fail("Скасувати наказ щодо рівного чи старшого за званням може лише Голова СБУ.", 403)
    reverted = bool(p and p["rank"] == o["to_rank"] and p["dept"] == o["to_dept"] and p["status"] != "dismissed")
    warn = None
    if reverted:
        await db.run("UPDATE users SET rank=?, dept=?, since=? WHERE sid=?", o["from_rank"], o["from_dept"], now_ms(), o["sid"])
        warn = core.roles_problem(await apply_roles(o["sid"], None, f"Сова: скасування наказу НП-{oid:04d}", drop_extra=o["extra"]))
    await db.run("UPDATE orders SET status='deleted', cancelled_by=?, cancelled=? WHERE id=?", u["sid"], now_ms(), oid)
    await db.audit(u["sid"], "Скасовано наказ про призначення", o["sid"],
                   f"НП-{oid:04d}" + (" · звання й підрозділ повернуто" if reverted else " · звання вже змінювалось, повернення не виконано"))
    await journal(o, u, "Наказ скасовано" + (" · попереднє звання повернуто" if reverted else ""))
    return {"reverted": reverted, "rolesWarning": warn}


NP_STATE = {"draft": ("🕓 Проєкт · на підписі", style.GOLD), "active": ("✅ Підписано · чинний", style.GREEN),
            "rejected": ("⛔ Проєкт відхилено", style.RED), "deleted": ("↩ Наказ скасовано", style.GRAY)}


async def np_embed(o: dict, label: str) -> discord.Embed:
    """Картка наказу про призначення — єдиний зразок документа (style.card)."""
    p, by = await core.user(o["sid"]), await core.user(o["by_sid"])
    sg = await core.user(o["signed_by"]) if o.get("signed_by") else None
    state, color = NP_STATE.get(o["status"], NP_STATE["draft"])
    if sg:
        state += f" · {style.esc(sg['name'])} · {style.when(o.get('signed'))}"
    to = to_label(o)
    return style.card(f"НП-{o['id']:04d}", "Наказ про призначення на посаду", state, color, t=o.get("signed") or o["t"],
                      note=f"Причина: {style.esc(o['note'])}" if o["status"] == "rejected" and o.get("note") else None, fields=[
        ("Співробітник", style.person(p) if p else f"№{o['sid']}"),
        ("Було", f"{rank_name(o['from_rank'])} · {DEPTS[o['from_dept']]['s']}"),
        ("Призначено", f"**{to}**"),
        ("Підготував", style.person(by)),
        ("Підстава", style.esc(o["reason"][:300]) if o.get("reason") else None, False),
    ])


async def journal(o: dict, u: dict, label: str, tag: str | None = None):
    """Одне повідомлення на наказ: створюється з тегами (автор, співробітник, обрана роль/відділ), далі лише оновлюється.
    Підпис, відхилення й скасування — ще й коротка відповідь зі сповіщенням."""
    o = await db.one("SELECT * FROM orders WHERE id=?", o["id"]) or o
    st = o["status"]
    await docpost.journal("np", o["id"], await core.channel("orders"), await np_embed(o, label),
                          users=await docpost.people(o["by_sid"], o["sid"]), tag=tag,
                          roles=docpost.key_roles("order" if st == "active" else "order:draft" if st == "draft" else None),
                          ping={"active": "✅ Наказ підписано.", "rejected": "⛔ Проєкт наказу відхилено.", "deleted": "↩ Наказ скасовано."}.get(st),
                          ping_roles=docpost.key_roles("order") if st == "active" else None)


async def listing() -> list[dict]:
    rows = await db.all("SELECT * FROM orders WHERE kind='appoint' AND status!='deleted' ORDER BY t DESC LIMIT 100")
    out = []
    for o in rows:
        p, by = await core.user(o["sid"]), await core.user(o["by_sid"])
        sg = await core.user(o["signed_by"]) if o.get("signed_by") else None
        out.append({**o, "name": p["name"] if p else f"№{o['sid']}", "byName": by["name"] if by else "—", "signedName": sg["name"] if sg else None,
                    "curRank": rank_name(p["rank"]) if p else "",
                    "fromRank": rank_name(o["from_rank"]), "toRank": rank_name(o["to_rank"]), "extras": extra_list(o.get("extra"))})
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
    await free_post(o, u, tag=b.get("tag"))
    await db.audit(u["sid"], "Наказ Голови СБУ", 0, f"НГ-{oid:04d} · {title[:80]}")
    return o


def ng_embed(o: dict, by: dict | None, cancelled_by: dict | None = None) -> discord.Embed:
    """Картка наказу Голови — єдиний зразок документа; повний текст — на аркуші А4 у картці."""
    state, color = ("↩ Наказ скасовано", style.GRAY) if cancelled_by else ("✅ Підписано · обов'язковий до виконання", style.GREEN)
    if cancelled_by:
        state += f" · {style.esc(cancelled_by['name'])} · {style.when()}"
    return style.card(f"НГ-{o['id']:04d}", "Наказ Голови СБУ", state, color, t=o["t"], fields=[
        ("Назва", f"**«{style.esc(o['title'])}»**", False),
        ("Підписав", style.person(by)),
        ("Дата", style.when(o["t"])),
    ])


async def free_post(o: dict, u: dict, cancelled: bool = False, tag: str | None = None):
    """Одне повідомлення на наказ Голови: при оголошенні — теги (автор, «order» з панелі, обрана роль/відділ), скасування — оновлення картки."""
    by = await core.user(o["by_sid"])
    await docpost.journal("ng", o["id"], await core.channel("orders"), ng_embed(o, by, u if cancelled else None),
                          users=await docpost.people(o["by_sid"]), tag=tag, roles=docpost.key_roles(None if cancelled else "order"),
                          ping="↩ Наказ скасовано." if cancelled else None)


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
