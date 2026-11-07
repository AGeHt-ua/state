"""Протоколи затримання (ст. 41 ПК штату NG). Складає будь-який співробітник від Молодшого агента; після підпису протокол
одразу зареєстрований (ПЗ-0001), за бажанням автора — разом зі звітом про діяльність. Бачать автор, учасники,
керівництво відділу автора, ВВБ, Голова й Заступник, куратор. Чернетку можна видалити, підписаний — анулювати з причиною."""
import json
import logging

import discord

import core
import docpost
import discipline
import overrides as ov
import style
from core import Fail
from db import db, now_ms
from roles import DEPTS, rank_name

log = logging.getLogger("sova.protocols")
STATUS = {"draft": "Чернетка", "signed": "Зареєстровано", "void": "Анульовано", "deleted": "Видалено"}
BASIS = {"scene": "Затримання на місці вчинення злочину", "traces": "Очевидні сліди злочину на особі, одязі чи при ній",
         "witness": "Свідки / потерпілі прямо вказують на особу", "warrant": "ОРД-АРЕШТ (ордер на арешт)", "orient": "Орієнтування / розшук"}
FORCE = {"none": "Не застосовувалися", "phys": "Фізична сила", "special": "Спецзасоби (кайданки, тайзер)", "weapon": "Вогнепальна зброя"}
DECISION = {"short": "Скорочене провадження — позбавлення волі", "kpz": "Поміщено до КПЗ до рішення суду",
            "dbr": "Передано до ДБР / іншого органу", "released": "Звільнено (підстави відпали / під зобов'язання)"}
MIN_RANK = 2


def no(p: dict) -> str:
    return f"ПЗ-{p['id']:04d}"


def can_create(u: dict) -> bool:
    return u["rank"] >= MIN_RANK and not u.get("curator_ro")


def is_chief(u: dict) -> bool:
    return u["rank"] >= ov.P("rap_override") and not u.get("curator_ro")


def can_view(u: dict, p: dict) -> bool:
    if p["author"] == u["sid"] or u["sid"] in p["data"].get("team", []) or u.get("curator") or u["rank"] >= ov.P("rap_override"):
        return True
    return p["status"] != "draft" and (core.lead_of(u, p["dept"]) or discipline.is_vvb(u))


def rights(u: dict) -> dict:
    return {"create": can_create(u), "chief": is_chief(u), "vvb": discipline.is_vvb(u)}


def _clean(b: dict) -> dict:
    s = lambda k, n=200: str(b.get(k) or "").strip()[:n]
    num = lambda k: max(0, min(10 ** 6, int(float(b.get(k) or 0))))
    return {
        "when": int(b.get("when") or now_ms()), "place": s("place"),
        "team": [int(x) for x in (b.get("team") or []) if str(x).isdigit()][:10],
        "who": s("who", 120), "whoId": s("whoId", 40), "whoMore": s("whoMore", 300), "whoGov": bool(b.get("whoGov")),
        "basis": b.get("basis") if b.get("basis") in BASIS else "scene", "warrant": s("warrant", 60),
        "arts": [str(a).strip()[:12] for a in (b.get("arts") or []) if str(a).strip()][:12],
        "desc": s("desc", 4000), "force": b.get("force") if b.get("force") in FORCE else "none", "forceWhy": s("forceWhy", 600),
        "rights": bool(b.get("rights")), "rightsAt": s("rightsAt", 10),
        "call": bool(b.get("call")), "lawyer": bool(b.get("lawyer")), "prosecutor": bool(b.get("prosecutor")), "prosecutorName": s("prosecutorName", 80),
        "items": [{"name": str(i.get("name") or "").strip()[:120], "qty": str(i.get("qty") or "").strip()[:20]}
                  for i in (b.get("items") or []) if str(i.get("name") or "").strip()][:20],
        "handover": s("handover", 200),
        "video": s("video", 400) if s("video", 400).startswith(("http://", "https://")) else "", "videoAt": s("videoAt", 40),
        "files": [str(f)[:40] for f in (b.get("files") or []) if f][:10],
        "decision": b.get("decision") if b.get("decision") in DECISION else "short", "term": num("term"), "fine": num("fine"),
        "remarks": s("remarks", 1500),
    }


async def _person(sid: int | None) -> dict | None:
    p = await core.user(sid) if sid else None
    return {"sid": p["sid"], "name": p["name"], "rankName": rank_name(p["rank"]), "dept": p["dept"],
            "deptName": DEPTS.get(p["dept"], {}).get("s", "")} if p else None


async def get(pid: int, u: dict | None = None) -> dict:
    p = await db.one("SELECT * FROM protocols WHERE id=? AND status!='deleted'", pid)
    if not p:
        raise Fail("Протокол не знайдено.", 404)
    p["data"] = json.loads(p["data"] or "{}")
    p["history"] = json.loads(p["history"] or "[]")
    if u and not can_view(u, p):
        raise Fail("Протокол доступний автору, учасникам, керівництву відділу, ВВБ і керівництву СБУ.", 403)
    p["no"] = no(p)
    p["statusName"] = STATUS.get(p["status"], p["status"])
    p["authorUser"] = await _person(p["author"])
    p["teamUsers"] = [x for x in [await _person(s) for s in p["data"].get("team", [])] if x]
    return p


async def listing(u: dict) -> list[dict]:
    rows = await db.all("SELECT id FROM protocols WHERE status!='deleted' ORDER BY id DESC LIMIT 300")
    out = []
    for r in rows:
        try:
            out.append(await get(r["id"], u))
        except Fail:
            continue
    return out


async def people() -> list[dict]:
    rows = await db.all("SELECT sid, name, rank, dept FROM users WHERE status NOT IN ('dismissed','removed') AND dept!='curator' AND rank>0 ORDER BY rank DESC, sid")
    return [{"sid": r["sid"], "name": r["name"], "rankName": rank_name(r["rank"])} for r in rows]


def _hist(p: dict | None, u: dict, action: str, note: str = "") -> str:
    h = (p or {}).get("history", []) + [{"t": now_ms(), "sid": u["sid"], "name": u["name"], "rank": rank_name(u["rank"]), "action": action, "note": note[:300]}]
    return json.dumps(h, ensure_ascii=False)


def problems(x: dict) -> list[str]:
    """Що не дає підписати протокол (обов'язкові реквізити ст. 41 ПК)."""
    bad = []
    if not x.get("place"):
        bad.append("місце затримання")
    if not x.get("who"):
        bad.append("ПІБ затриманого")
    if not x.get("arts"):
        bad.append("статті КК, що інкримінуються")
    if len(x.get("desc", "")) < 20:
        bad.append("опис обставин (від 20 символів)")
    if x.get("basis") == "warrant" and not x.get("warrant"):
        bad.append("номер ОРД-АРЕШТ")
    if x.get("force") != "none" and not x.get("forceWhy"):
        bad.append("обґрунтування застосування сили")
    if not x.get("rights"):
        bad.append("позначку про роз'яснення прав")
    if not (x.get("video") or x.get("files")):
        bad.append("відеофіксацію (посилання) або файл")
    if x.get("decision") == "short" and not x.get("term"):
        bad.append("строк позбавлення волі")
    return bad


async def save(u: dict, b: dict) -> dict:
    if not can_create(u):
        raise Fail("Протокол затримання складає співробітник від звання Молодшого агента.", 403)
    data = json.dumps(_clean(b.get("data") or {}), ensure_ascii=False)
    if b.get("id"):
        p = await get(int(b["id"]), u)
        if p["author"] != u["sid"] or p["status"] != "draft":
            raise Fail("Редагувати можна лише власну чернетку.", 403)
        await db.run("UPDATE protocols SET data=?, updated=? WHERE id=?", data, now_ms(), p["id"])
        return await get(p["id"], u)
    pid = await db.run("INSERT INTO protocols(author,dept,status,data,history,created,updated) VALUES(?,?,?,?,?,?,?)",
                       u["sid"], u["dept"], "draft", data, _hist(None, u, "create"), now_ms(), now_ms())
    return await get(pid, u)


@core.serialized("pz")
async def act(u: dict, pid: int, action: str, b: dict) -> dict:
    p = await get(pid, u)
    note = str(b.get("note") or "").strip()
    mine = p["author"] == u["sid"]
    if action == "sign":
        if not mine or p["status"] != "draft":
            raise Fail("Підписати можна власну чернетку.", 403)
        bad = problems(p["data"])
        if bad:
            raise Fail("Не заповнено: " + ", ".join(bad) + ".")
        act_id = None
        if b.get("report"):  # звіт про діяльність одразу з протоколу
            x = p["data"]
            row = await core.create_act(u, {"type": "warrant" if x["basis"] == "warrant" else "arrest", "arts": x["arts"], "t": x["when"],
                                            "subj": x["who"], "evidence": x["video"], "files": x["files"],
                                            "note": f"Протокол затримання {p['no']} · {x['place']}"})
            act_id = row["id"]
        await db.run("UPDATE protocols SET status='signed', signed=?, act_id=?, history=?, updated=? WHERE id=?",
                     now_ms(), act_id, _hist(p, u, "sign", f"звіт №{act_id}" if act_id else ""), now_ms(), p["id"])
        p = await get(p["id"], u)
        await journal(p, u, "ЗАРЕЄСТРОВАНО", tag=b.get("tag"))
        await db.audit(u["sid"], "Складено протокол затримання", None, f"{p['no']} · {p['data']['who']} · ст. {', '.join(p['data']['arts'])} КК")
    elif action == "report":
        if not mine or p["status"] != "signed" or p.get("act_id"):
            raise Fail("Звіт можна створити автору зареєстрованого протоколу, якщо його ще немає.", 403)
        x = p["data"]
        row = await core.create_act(u, {"type": "warrant" if x["basis"] == "warrant" else "arrest", "arts": x["arts"], "t": x["when"],
                                        "subj": x["who"], "evidence": x["video"], "files": x["files"], "note": f"Протокол затримання {p['no']} · {x['place']}"})
        await db.run("UPDATE protocols SET act_id=?, history=? WHERE id=?", row["id"], _hist(p, u, "report", f"звіт №{row['id']}"), p["id"])
        p = await get(p["id"], u)
    elif action == "void":
        if not (mine or is_chief(u) or core.lead_of(u, p["dept"]) or discipline.is_vvb(u)) or p["status"] != "signed":
            raise Fail("Анулювати зареєстрований протокол може автор, керівництво відділу, ВВБ або Голова.", 403)
        if not note:
            raise Fail("Вкажіть причину анулювання.")
        await db.run("UPDATE protocols SET status='void', history=?, updated=? WHERE id=?", _hist(p, u, "void", note), now_ms(), p["id"])
        p = await get(p["id"], u)
        await journal(p, u, f"АНУЛЬОВАНО: {note}")
        await db.audit(u["sid"], "Анульовано протокол затримання", p["author"], f"{p['no']} · {note}")
    elif action == "restore":
        if not (is_chief(u) or discipline.is_vvb(u)) or p["status"] != "void":
            raise Fail("Відновити анульований протокол може ВВБ або Голова.", 403)
        await db.run("UPDATE protocols SET status='signed', history=?, updated=? WHERE id=?", _hist(p, u, "restore", note), now_ms(), p["id"])
        p = await get(p["id"], u)
        await journal(p, u, "ВІДНОВЛЕНО" + (f": {note}" if note else ""))
    elif action == "delete":
        if not ((mine and p["status"] == "draft") or is_chief(u)):
            raise Fail("Видалити можна власну чернетку; зареєстрований протокол — лише Голова або Заступник.", 403)
        await db.run("UPDATE protocols SET status='deleted', history=?, updated=? WHERE id=?", _hist(p, u, "delete", note), now_ms(), p["id"])
        if p["status"] != "draft":
            await db.audit(u["sid"], "Видалено протокол затримання", p["author"], p["no"])
        await docpost.remove("pz", p["id"])  # видалено — прибрати і з Discord
        return {"ok": True}
    else:
        raise Fail("Невідома дія.")
    return p


def pz_embed(p: dict) -> discord.Embed:
    """Картка протоколу затримання — єдиний зразок документа."""
    x = p["data"]
    void = p["status"] == "void"
    term = f" · {x['term']} р." if x.get("decision") == "short" and x.get("term") else ""
    e = style.card(p["no"], "Протокол затримання · ст. 41 ПК", "⛔ Анульовано" if void else "✅ Зареєстровано",
                   style.GRAY if void else style.GREEN, t=x.get("when"), fields=[
        ("Затриманий", f"**{style.esc(x.get('who') or '—')}**"),
        ("Статті КК", style.esc(", ".join(x.get("arts", [])) or "—")),
        ("Склав", style.esc((p.get("authorUser") or {}).get("name", "—"))),
        ("Місце", style.esc(x.get("place") or "—")),
        ("Рішення", f"{DECISION.get(x.get('decision'), '—')}{term}"),
    ])
    return e


async def journal(p: dict, u: dict, label: str, tag: str | None = None):
    """Протокол — одне повідомлення: картка з аркушем А4 і тегами (хто склав, обрана роль/відділ); анулювання й відновлення
    оновлюють картку з короткою відповіддю."""
    ch = await core.channel("prot") or await core.channel(p["dept"]) or await core.channel("log")
    e = pz_embed(p)
    await docpost.journal("pz", p["id"], ch, e, users=await docpost.people(p["author"]), tag=tag,
                          ping=None if label == "ЗАРЕЄСТРОВАНО" else f"🔔 Протокол {p['no']}: {label[:150]}")
