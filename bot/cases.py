"""Кейс-файли: оперативні справи ОРВ, ДЕБ, АТЦ, ЦСО «А».
Маршрут: виконавець → начальник відділу → Голова СБУ або заступник → Генеральний прокурор → затверджено.
Зміст справи бачать лише учасники маршруту; у Discord іде тільки журнал руху документа, без змісту."""
import json
import logging

import discord

import core
import overrides as ov
import style
from core import Fail
from db import db, now_ms
from roles import DEPTS

log = logging.getLogger("sova.cases")

CASE_DEPTS = ("orv", "deb", "atc", "alpha")
STAGES = ("draft", "head", "chief", "prosecutor", "approved", "rejected")
STAGE_NAME = {"deleted": "Видалено", "draft": "Чернетка виконавця", "head": "Погодження начальника відділу", "chief": "Погодження Голови СБУ",
              "prosecutor": "Розгляд Генерального прокурора", "approved": "Затверджено", "rejected": "Відмовлено"}
REACH = {"deleted": 0, "draft": 0, "head": 1, "chief": 2, "prosecutor": 3, "approved": 4, "rejected": 0}
GRIF = {"dsk": "ДЛЯ СЛУЖБОВОГО КОРИСТУВАННЯ", "secret": "ТАЄМНО", "top": "ЦІЛКОМ ТАЄМНО"}
REQUESTS = {"search": "Ордер на обшук", "arrest": "Ордер на арешт (затримання)", "op": "Санкція на проведення спецоперації",
            "surv": "Санкція на негласне стеження та прослуховування", "suspect": "Повідомлення про підозру", "other": "Інше клопотання"}
ROLES = ("підозрюваний", "фігурант", "свідок", "потерпілий", "джерело")


def depts_of(u: dict) -> set[str]:
    """Відділи, ролі яких має співробітник (з кешу ролей Discord) + основний відділ картки."""
    out = {u["dept"]}
    hit = core._roles_cache.get(str(u.get("discord_id")))
    if hit and hit[1]:
        out |= {k for k in CASE_DEPTS if DEPTS[k]["role"] in hit[1]}
    return out


def is_head_for(u: dict, dept: str) -> bool:
    """Начальник відділу з роллю цього відділу; у ОРВ — ще й заступник начальника з роллю ОРВ."""
    mine = depts_of(u)
    return (u["rank"] == 12 and dept in mine) or (dept == "orv" and u["rank"] == 11 and "orv" in mine)


def is_chief(u: dict) -> bool:
    return u["rank"] >= ov.P("case_chief")


def is_prosecutor(u: dict) -> bool:
    return u["dept"] == "prosecutor"


def can_create(u: dict) -> list[str]:
    """Відділи, від імені яких співробітник може заводити кейс-файл."""
    if is_prosecutor(u):
        return []
    if is_chief(u):
        return list(CASE_DEPTS)
    return [d for d in CASE_DEPTS if d in depts_of(u)]


def can_view(u: dict, c: dict) -> bool:
    if c["author"] == u["sid"] or is_chief(u) or is_head_for(u, c["dept"]):
        return True
    return is_prosecutor(u) and c["reached"] >= 3


def can_decide(u: dict, c: dict) -> bool:
    if c["author"] == u["sid"]:
        return False
    return {"head": is_head_for(u, c["dept"]), "chief": is_chief(u), "prosecutor": is_prosecutor(u)}.get(c["status"], False)


def rights(u: dict) -> dict:
    return {"create": can_create(u), "view": bool(can_create(u)) or is_chief(u) or is_prosecutor(u)
            or any(is_head_for(u, d) for d in CASE_DEPTS)}


def clean(b: dict) -> dict:
    s = lambda v, n: str(v or "").strip()[:n]
    persons = [{"name": s(p.get("name"), 60), "sid": s(p.get("sid"), 10), "role": p.get("role") if p.get("role") in ROLES else "фігурант",
                "org": s(p.get("org"), 80), "note": s(p.get("note"), 300)} for p in (b.get("persons") or [])[:30] if s(p.get("name"), 60)]
    evidence = [{"desc": s(e.get("desc"), 300), "url": s(e.get("url"), 400), "files": [str(f)[:40] for f in (e.get("files") or [])[:5]]}
                for e in (b.get("evidence") or [])[:40] if s(e.get("desc"), 300) or e.get("files") or s(e.get("url"), 400)]
    return {
        "title": s(b.get("title"), 80), "org": s(b.get("org"), 120), "grif": b.get("grif") if b.get("grif") in GRIF else "secret",
        "summary": s(b.get("summary"), 6000), "measures": s(b.get("measures"), 4000),
        "arts": [s(a, 12) for a in (b.get("arts") or [])[:20] if s(a, 12)],
        "persons": persons, "evidence": evidence,
        "request": {"type": (b.get("request") or {}).get("type") if (b.get("request") or {}).get("type") in REQUESTS else "search",
                    "text": s((b.get("request") or {}).get("text"), 3000)},
    }


async def get(cid: int) -> dict:
    c = await db.one("SELECT * FROM cases WHERE id=?", cid)
    if not c:
        raise Fail("Кейс-файл не знайдено.", 404)
    c["data"] = json.loads(c["data"] or "{}")
    c["history"] = json.loads(c["history"] or "[]")
    return c


def out(c: dict, u: dict) -> dict:
    return {**c, "canEdit": c["author"] == u["sid"] and c["status"] == "draft", "canDecide": can_decide(u, c),
            "canWithdraw": c["author"] == u["sid"] and c["status"] in ("head", "chief", "prosecutor"),
            "canDelete": (c["author"] == u["sid"] and c["status"] == "draft") or is_chief(u),
            "stageName": STAGE_NAME[c["status"]]}


async def _hist(c: dict, u: dict, action: str, note: str = "") -> list:
    h = c["history"] + [{"t": now_ms(), "sid": u["sid"], "name": u["name"], "rank": u["rank"], "dept": u["dept"],
                         "stage": c["status"], "action": action, "note": note[:500]}]
    return h


async def create(u: dict, b: dict) -> dict:
    allowed = can_create(u)
    dept = b.get("dept") if b.get("dept") in allowed else (allowed[0] if allowed else None)
    if not dept:
        raise Fail("Кейс-файли ведуть ОРВ, ДЕБ, АТЦ та ЦСО «А».", 403)
    data = clean(b)
    if not data["title"]:
        raise Fail("Вкажіть кодову назву операції.")
    t = now_ms()
    h = [{"t": t, "sid": u["sid"], "name": u["name"], "rank": u["rank"], "dept": u["dept"], "stage": "draft", "action": "create", "note": ""}]
    cid = await db.run("INSERT INTO cases(dept,author,status,reached,data,history,created,updated) VALUES(?,?,?,?,?,?,?,?)",
                       dept, u["sid"], "draft", 0, json.dumps(data, ensure_ascii=False), json.dumps(h, ensure_ascii=False), t, t)
    return await get(cid)


async def update(u: dict, cid: int, b: dict) -> dict:
    c = await get(cid)
    if c["author"] != u["sid"] or c["status"] != "draft":
        raise Fail("Редагувати можна лише власну чернетку.", 403)
    data = clean(b)
    if not data["title"]:
        raise Fail("Вкажіть кодову назву операції.")
    dept = b.get("dept") if b.get("dept") in can_create(u) else c["dept"]
    await db.run("UPDATE cases SET data=?, dept=?, updated=? WHERE id=?", json.dumps(data, ensure_ascii=False), dept, now_ms(), cid)
    return await get(cid)


def _next_after_draft(u: dict, dept: str) -> str:
    """Начальник відділу сам собі не погоджує: його справа йде одразу до Голови; справа Голови/заступника — до прокурора."""
    if is_chief(u):
        return "prosecutor"
    if is_head_for(u, dept):
        return "chief"
    return "head"


async def submit(u: dict, cid: int) -> dict:
    c = await get(cid)
    if c["author"] != u["sid"] or c["status"] != "draft":
        raise Fail("Подати можна лише власну чернетку.", 403)
    d = c["data"]
    missing = [n for n, ok in (("фабула", d.get("summary")), ("фігуранти", d.get("persons")), ("докази", d.get("evidence")),
                               ("кваліфікація (статті)", d.get("arts")), ("клопотання", d.get("request", {}).get("text"))) if not ok]
    if missing:
        raise Fail("Не заповнено: " + ", ".join(missing) + ".")
    nxt = _next_after_draft(u, c["dept"])
    h = await _hist(c, u, "submit")
    await db.run("UPDATE cases SET status=?, reached=MAX(reached, ?), history=?, updated=? WHERE id=?",
                 nxt, REACH[nxt], json.dumps(h, ensure_ascii=False), now_ms(), cid)
    c = await get(cid)
    await journal(c, u, "Передано на погодження")
    return c


async def withdraw(u: dict, cid: int) -> dict:
    """Виконавець відкликає справу з погодження назад у свою чернетку (поки її не затвердили чи не відмовили)."""
    c = await get(cid)
    if c["author"] != u["sid"]:
        raise Fail("Відкликати може лише виконавець справи.", 403)
    if c["status"] not in ("head", "chief", "prosecutor"):
        raise Fail("Справа зараз не на погодженні.")
    h = await _hist(c, u, "withdraw")
    await db.run("UPDATE cases SET status='draft', reached=0, history=?, updated=? WHERE id=?", json.dumps(h, ensure_ascii=False), now_ms(), cid)
    c = await get(cid)
    await journal(c, u, "Відкликано виконавцем з погодження")
    return c


async def delete(u: dict, cid: int):
    """Видалення справи: виконавець — свою чернетку (з погодження спершу відкликати); Голова й заступник — будь-яку."""
    c = await get(cid)
    if c["status"] == "deleted":
        raise Fail("Справу вже видалено.", 404)
    if not ((c["author"] == u["sid"] and c["status"] == "draft") or is_chief(u)):
        raise Fail("Видалити можна власну чернетку. Якщо справа на погодженні — спершу відкличте її.", 403)
    h = await _hist(c, u, "delete")
    await db.run("UPDATE cases SET status='deleted', history=?, updated=? WHERE id=?", json.dumps(h, ensure_ascii=False), now_ms(), cid)
    c = await get(cid)
    await journal(c, u, "Справу видалено")


async def decide(u: dict, cid: int, decision: str, note: str = "") -> dict:
    c = await get(cid)
    if not can_decide(u, c):
        raise Fail("Цей кейс-файл зараз не на вашому погодженні.", 403)
    if decision in ("return", "rej") and not note.strip():
        raise Fail("Вкажіть причину.")
    if decision == "ok":
        nxt = {"head": "chief", "chief": "prosecutor", "prosecutor": "approved"}[c["status"]]
        action, label = "ok", ("Затверджено Генеральним прокурором" if nxt == "approved" else "Погоджено")
    elif decision == "return":
        nxt, action, label = "draft", "return", "Повернуто на доопрацювання"
    else:
        nxt, action, label = "rejected", "rej", "Відмовлено"
    h = await _hist(c, u, action, note)
    await db.run("UPDATE cases SET status=?, reached=MAX(reached, ?), history=?, updated=?, approved=? WHERE id=?",
                 nxt, REACH[nxt], json.dumps(h, ensure_ascii=False), now_ms(), now_ms() if nxt == "approved" else None, cid)
    c = await get(cid)
    await journal(c, u, label)
    return c


async def journal(c: dict, u: dict, label: str):
    """Журнал руху в Discord-каналі відділу: лише номер, кодова назва, етап і хто — без змісту справи."""
    ch = await core.channel(c["dept"])
    if not ch:
        return
    st = c["status"]
    col = {"approved": ("green", 0x5FB37A), "rejected": ("red", 0xD4605A), "draft": ("gold", 0xD9A23D)}.get(st, ("cyan", 0x6F9FD6))
    lines = [style.kv("СПРАВА", f"КФ-{c['id']:04d} · «{c['data'].get('title', '')}»", "white", True),
             style.kv("ГРИФ", GRIF[c["data"].get("grif", "secret")], "red", True),
             style.kv("ДІЯ", label, col[0], True),
             style.kv("ХТО", f"{u['name']} · №{u['sid']}" if u["dept"] != "prosecutor" else f"{u['name']} · Генеральний прокурор", "white"),
             style.kv("ЕТАП", STAGE_NAME[st], "white"),
             style.kv("ДАТА", style.when(), "gray")]
    e = style.document("КЕЙС-ФАЙЛ · ЖУРНАЛ РУХУ", col[1], desc=style.block(*lines), footer="Зміст справи доступний лише в ЄІС «Сова»")
    try:
        await ch.send(embed=e, allowed_mentions=discord.AllowedMentions.none())
    except discord.HTTPException as ex:
        log.warning("Журнал кейс-файлу: %s", ex)


async def visible(u: dict) -> list[dict]:
    rows = await db.all("SELECT * FROM cases WHERE status!='deleted' ORDER BY updated DESC LIMIT 300")
    res = []
    for c in rows:
        c["data"] = json.loads(c["data"] or "{}")
        c["history"] = json.loads(c["history"] or "[]")
        if can_view(u, c):
            res.append(c)
    return res


async def pending(u: dict) -> int:
    return len([c for c in await visible(u) if can_decide(u, c)])
