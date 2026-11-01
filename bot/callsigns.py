"""Позивні для оперативних підрозділів (АТЦ, ДЕБ, ЦСО «А», ВВБ — список змінюється в адмін-панелі).
Співробітник подає позивний на головній → затверджує начальник свого відділу (за відсутності — Голова чи Заступник) →
бот ставить нікнейм «АТЦ | LEO | 256»."""
import logging
import re

import discord

import core
import overrides as ov
import style
from core import Fail
from db import db, now_ms
from roles import DEPTS, callsign_depts, nickname

log = logging.getLogger("sova.callsigns")
VALID = re.compile(r"^[A-ZА-ЯІЇЄҐ0-9][A-ZА-ЯІЇЄҐ0-9\-]{1,15}$")


def eligible(u: dict) -> bool:
    return u.get("dept") in callsign_depts()


def clean(cs: str) -> str:
    cs = re.sub(r"\s+", "", str(cs or "")).upper()
    if not VALID.match(cs):
        raise Fail("Позивний: 2–16 символів, літери або цифри (можна дефіс), без пробілів. Напр. LEO, ВОВК-7.")
    return cs


async def taken(cs: str, sid: int) -> bool:
    a = await db.one("SELECT sid FROM users WHERE upper(callsign)=? AND sid!=? AND status NOT IN ('dismissed','removed')", cs, sid)
    b = await db.one("SELECT sid FROM callsigns WHERE upper(callsign)=? AND sid!=? AND status='wait'", cs, sid)
    return bool(a or b)


def can_decide(actor: dict, r: dict) -> bool:
    if r["status"] != "wait" or r["sid"] == actor["sid"] or actor.get("curator_ro"):
        return False
    return actor["rank"] >= ov.P("rap_override") or core.head_of(actor, r["dept"])


async def request(u: dict, raw: str) -> dict:
    if not eligible(u):
        raise Fail("Позивні мають лише " + ", ".join(DEPTS[d]["s"] for d in callsign_depts()) + ".", 403)
    cs = clean(raw)
    if await db.one("SELECT id FROM callsigns WHERE sid=? AND status='wait'", u["sid"]):
        raise Fail("У вас уже є заявка на розгляді. Відкличте її, щоб подати іншу.")
    if (u.get("callsign") or "").upper() == cs:
        raise Fail("Цей позивний у вас уже затверджено.")
    if await taken(cs, u["sid"]):
        raise Fail(f"Позивний {cs} уже зайнятий.")
    rid = await db.run("INSERT INTO callsigns(sid,dept,callsign,status,t) VALUES(?,?,?,?,?)", u["sid"], u["dept"], cs, "wait", now_ms())
    await journal(u, cs, u["dept"], "Подано на затвердження")
    return {"id": rid}


async def withdraw(u: dict, rid: int):
    r = await db.one("SELECT * FROM callsigns WHERE id=?", rid)
    if not r or r["sid"] != u["sid"] or r["status"] != "wait":
        raise Fail("Заявку не знайдено або її вже розглянуто.", 404)
    await db.run("UPDATE callsigns SET status='cancel', reviewed=? WHERE id=?", now_ms(), rid)


async def decide(actor: dict, rid: int, ok: bool, note: str = "") -> dict:
    r = await db.one("SELECT * FROM callsigns WHERE id=?", rid)
    if not r or not can_decide(actor, r):
        raise Fail("Ця заявка зараз не на вашому розгляді.", 403)
    if not ok and not note.strip():
        raise Fail("Вкажіть причину відмови.")
    if ok and await taken(r["callsign"].upper(), r["sid"]):
        raise Fail("Позивний уже зайнятий.")
    await db.run("UPDATE callsigns SET status=?, reviewer=?, reviewed=?, note=? WHERE id=?", "ok" if ok else "rej", actor["sid"], now_ms(), note[:300], rid)
    p = await core.user(r["sid"])
    if ok and p:
        await db.run("UPDATE users SET callsign=? WHERE sid=?", r["callsign"], r["sid"])
        p["callsign"] = r["callsign"]
        await core.set_nick(p)
        await db.audit(actor["sid"], "Затверджено позивний", r["sid"], r["callsign"])
    if p:
        await journal(p, r["callsign"], r["dept"], "Затверджено" if ok else f"Відмовлено: {note}", actor)
    return {"ok": True}


async def set_direct(actor: dict, sid: int, raw: str | None) -> dict:
    """Адмін-панель: призначити або зняти позивний без заявки."""
    p = await core.user(sid)
    if not p:
        raise Fail("Співробітника не знайдено.", 404)
    cs = clean(raw) if raw and str(raw).strip() else None
    if cs and await taken(cs, sid):
        raise Fail(f"Позивний {cs} уже зайнятий.")
    await db.run("UPDATE users SET callsign=? WHERE sid=?", cs, sid)
    await db.run("UPDATE callsigns SET status='cancel', reviewed=? WHERE sid=? AND status='wait'", now_ms(), sid)
    p["callsign"] = cs
    applied = await core.set_nick(p)
    await db.audit(actor["sid"], "⚙ " + ("Призначено позивний" if cs else "Знято позивний"), sid, cs or "")
    return {"callsign": cs, "nick": nickname(p["rank"], p["name"], p["sid"], p["dept"], cs), "applied": applied}


async def home(u: dict) -> dict:
    mine = await db.all("SELECT * FROM callsigns WHERE sid=? AND status!='cancel' ORDER BY id DESC LIMIT 5", u["sid"])
    rows = [r for r in await db.all("SELECT * FROM callsigns WHERE status='wait' ORDER BY id") if can_decide(u, r)]
    people = {r["sid"]: await core.user(r["sid"]) for r in rows}
    revs = {r["reviewer"]: await core.user(r["reviewer"]) for r in mine if r["reviewer"]}
    return {
        "eligible": eligible(u), "depts": [DEPTS[d]["s"] for d in callsign_depts()],
        "sample": nickname(u["rank"], u["name"], u["sid"], u["dept"], "ПОЗИВНИЙ") if u["rank"] else None,
        "current": u.get("callsign"), "nick": nickname(u["rank"], u["name"], u["sid"], u["dept"], u.get("callsign")) if u["rank"] else None,
        "mine": [{**r, "reviewerName": (revs.get(r["reviewer"]) or {}).get("name")} for r in mine],
        "todo": [{**r, "name": (people.get(r["sid"]) or {}).get("name"), "rankName": core.rank_name((people.get(r["sid"]) or {}).get("rank", 0)),
                  "preview": nickname((people.get(r["sid"]) or {}).get("rank", 1), "", r["sid"], r["dept"], r["callsign"])} for r in rows],
    }


async def pending(u: dict) -> int:
    return len([r for r in await db.all("SELECT * FROM callsigns WHERE status='wait'") if can_decide(u, r)])


async def journal(p: dict, cs: str, dept: str, label: str, actor: dict | None = None):
    ch = await core.channel(dept)
    if not ch:
        return
    lines = [style.kv("СПІВРОБІТНИК", f"{p['name']} · №{p['sid']}", "white", True), style.kv("ПОЗИВНИЙ", cs, "gold", True),
             style.kv("НІКНЕЙМ", nickname(p["rank"], p["name"], p["sid"], dept, cs), "cyan"), style.rule(),
             style.kv("ДІЯ", label[:60], "green" if label == "Затверджено" else "red" if label.startswith("Відмовлено") else "cyan", True)]
    if actor:
        lines.append(style.kv("ХТО", f"{actor['name']} · №{actor['sid']}", "white"))
    lines.append(style.kv("ДАТА", style.when(), "gray"))
    e = style.document("ПОЗИВНИЙ СПІВРОБІТНИКА", 0x6F9FD6, desc=style.block(*lines), footer="Затверджує начальник відділу · ЄІС «Сова»")
    try:
        await ch.send(embed=e, allowed_mentions=discord.AllowedMentions.none())
    except discord.HTTPException as ex:
        log.warning("Журнал позивних: %s", ex)
