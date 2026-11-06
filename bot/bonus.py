"""Премії: щотижнева відомість преміювання за балами активності.
П. 1.55 Загальних правил держорганізацій: премії — лише за щотижневим звітом, схваленим куратором, у межах лімітів
на організацію та на одного співробітника (керівництво / старший / молодший склад).
Ст. 22 Трудового кодексу: нарахування премії самому собі заборонено — свій рядок формувальник не змінює."""
import json
import logging

import discord

import core
import docpost
import overrides as ov
import style
from core import DAY, Fail
from db import db, now_ms
from roles import DEPTS, rank_name

log = logging.getLogger("sova.bonus")

DEFAULT_CFG = {"rate": 1000, "min_pts": 10, "limit": 500000, "caps": {"lead": 50000, "senior": 35000, "junior": 25000}}
TIERS = {"lead": "Керівний склад", "senior": "Старший склад", "junior": "Молодший склад"}
STATUS = {"draft": "Формується", "sent": "Подано куратору", "approved": "Схвалено куратором", "paid": "Виплачено"}


def tier(rank: int) -> str:
    return "lead" if rank >= 11 else "senior" if rank >= 8 else "junior"


def can_manage(u: dict) -> bool:
    return u["rank"] >= ov.P("bonus_manage") and not u.get("curator_ro")


def can_finalize(u: dict) -> bool:
    return u["rank"] >= ov.P("bonus_finalize")


async def cfg() -> dict:
    saved = await db.get_setting("bonus_cfg", {})
    out = {**DEFAULT_CFG, **{k: v for k, v in saved.items() if k != "caps"}}
    out["caps"] = {**DEFAULT_CFG["caps"], **saved.get("caps", {})}
    return out


async def save_cfg(u: dict, b: dict) -> dict:
    if not can_finalize(u):
        raise Fail("Змінювати ліміти премій може лише Голова СБУ.", 403)
    num = lambda v, lo, hi: max(lo, min(hi, int(float(v or 0))))
    c = {"rate": num(b.get("rate"), 0, 1_000_000), "min_pts": num(b.get("min_pts"), 0, 1000), "limit": num(b.get("limit"), 0, 100_000_000),
         "caps": {k: num((b.get("caps") or {}).get(k), 0, 10_000_000) for k in TIERS}}
    await db.set_setting("bonus_cfg", c)
    await db.audit(u["sid"], "Змінено ліміти премій", 0, f"ставка ${c['rate']}/бал · ліміт ${c['limit']}")
    return c


def week_label(ws: int) -> str:
    return f"{style.when(ws)[:5]}–{style.when(ws + 6 * DAY)[:10]}"


async def calc_rows(ws: int, c: dict) -> list[dict]:
    staff = await db.all("SELECT * FROM users WHERE status NOT IN ('dismissed','removed') AND dept NOT IN ('prosecutor','curator') ORDER BY dept, rank DESC, sid")
    pts = await core.coef()
    acts = await db.all("SELECT by_sid, type, qty FROM acts WHERE status='ok' AND t>=? AND t<?", ws, ws + 7 * DAY)
    by = {}
    for a in acts:
        by[a["by_sid"]] = by.get(a["by_sid"], 0) + pts.get(a["type"], 0) * (a["qty"] or 1)
    # П. 1.2 Регламенту стягнень: активна догана протягом тижня блокує премію
    blocked = {r["sid"] for r in await db.all("SELECT sid FROM discipline WHERE status IN ('active','lifted') AND kind IN ('reprimand','severe') "
                                              "AND issued<? AND expires>?", ws + 7 * DAY, ws)}
    rows = []
    for p in staff:
        pt = by.get(p["sid"], 0)
        if pt <= 0:
            continue  # без жодного підтвердженого бала за тиждень — у відомість не потрапляє
        cap = c["caps"][tier(p["rank"])]
        auto = min(cap, pt * c["rate"]) if pt >= c["min_pts"] and p["sid"] not in blocked else 0
        rows.append({"sid": p["sid"], "name": p["name"], "rank": p["rank"], "dept": p["dept"], "tier": tier(p["rank"]),
                     "pts": pt, "auto": auto, "amount": auto, "note": "активна догана (п. 1.2)" if p["sid"] in blocked and pt
                     else f"менше порогу: {pt} з {c['min_pts']} б." if 0 < pt < c["min_pts"] else ""})
    total = sum(r["amount"] for r in rows)
    if total > c["limit"] > 0:  # пропорційне зменшення до ліміту організації, округлення вниз до $100
        k = c["limit"] / total
        for r in rows:
            r["amount"] = int(r["amount"] * k) // 100 * 100
            r["auto"] = r["amount"]
    return rows


async def get(bid: int) -> dict:
    s = await db.one("SELECT * FROM bonuses WHERE id=?", bid)
    if not s:
        raise Fail("Відомість не знайдено.", 404)
    s["rows"] = json.loads(s["rows"] or "[]")
    s["history"] = json.loads(s["history"] or "[]")
    s["cfg"] = json.loads(s["cfg"] or "{}")
    s["total"] = sum(r["amount"] for r in s["rows"])
    s["label"] = week_label(s["week"])
    return s


async def create(u: dict, offset: int) -> dict:
    if not can_manage(u):
        raise Fail("Формувати відомість може Голова СБУ або Заступник.", 403)
    ws = core.week_start(max(0, min(4, offset)))
    row = await db.one("SELECT id FROM bonuses WHERE week=?", ws)
    if row:
        return await get(row["id"])
    c = await cfg()
    rows = await calc_rows(ws, c)
    h = [{"t": now_ms(), "sid": u["sid"], "name": u["name"], "action": "create"}]
    bid = await db.run("INSERT INTO bonuses(week,status,rows,cfg,history,created_by,created,updated) VALUES(?,?,?,?,?,?,?,?)",
                       ws, "draft", json.dumps(rows, ensure_ascii=False), json.dumps(c), json.dumps(h, ensure_ascii=False), u["sid"], now_ms(), now_ms())
    return await get(bid)


async def recalc(u: dict, bid: int) -> dict:
    s = await get(bid)
    if not can_manage(u) or s["status"] != "draft":
        raise Fail("Перерахувати можна лише відомість, що формується.", 403)
    c = await cfg()
    rows = await calc_rows(s["week"], c)
    await db.run("UPDATE bonuses SET rows=?, cfg=?, updated=? WHERE id=?", json.dumps(rows, ensure_ascii=False), json.dumps(c), now_ms(), bid)
    return await get(bid)


async def update(u: dict, bid: int, b: dict) -> dict:
    s = await get(bid)
    if not can_manage(u) or s["status"] != "draft":
        raise Fail("Змінювати можна лише відомість, що формується.", 403)
    c = s["cfg"]
    changes = {int(k): v for k, v in (b.get("rows") or {}).items()}
    for r in s["rows"]:
        ch = changes.get(r["sid"])
        if not ch:
            continue
        if r["sid"] == u["sid"] and int(ch.get("amount", r["amount"])) != r["amount"]:
            raise Fail("Нараховувати премію самому собі заборонено (ст. 22 Трудового кодексу). Ваш рядок змінює інший керівник.", 403)
        amt = max(0, int(float(ch.get("amount", r["amount"]) or 0)))
        cap = c["caps"][r["tier"]]
        if amt and "догана" in (r.get("note") or "") and r["auto"] == 0 and not ch.get("force"):
            raise Fail(f"{r['name']}: активна догана блокує премію (п. 1.2 Регламенту стягнень).")
        if amt > cap:
            raise Fail(f"{r['name']}: сума ${amt:,} перевищує ліміт для категорії «{TIERS[r['tier']]}» (${cap:,}).".replace(",", " "))
        r["amount"] = amt
        r["note"] = str(ch.get("note", r["note"]) or "")[:120]
    total = sum(r["amount"] for r in s["rows"])
    if c["limit"] and total > c["limit"]:
        raise Fail(f"Разом ${total:,} — більше за ліміт організації ${c['limit']:,}.".replace(",", " "))
    await db.run("UPDATE bonuses SET rows=?, updated=? WHERE id=?", json.dumps(s["rows"], ensure_ascii=False), now_ms(), bid)
    return await get(bid)


async def delete(u: dict, bid: int):
    s = await get(bid)
    if not can_manage(u) or s["status"] != "draft":
        raise Fail("Видалити можна лише відомість, що формується. Подану спершу поверніть на доопрацювання.", 403)
    await db.run("DELETE FROM bonuses WHERE id=?", bid)  # чернетка ще нікуди не подавалась


FLOW = {"sent": ("draft", can_manage, "Подано куратору на схвалення"), "draft": ("sent", can_manage, "Повернуто на доопрацювання"),
        "approved": ("sent", can_finalize, "Схвалено куратором"), "paid": ("approved", can_finalize, "Премії виплачено")}


async def move(u: dict, bid: int, to: str, tag: str | None = None) -> dict:
    s = await get(bid)
    if to not in FLOW or s["status"] != FLOW[to][0]:
        raise Fail("Такий перехід неможливий.")
    if not FLOW[to][1](u):
        raise Fail("Недостатньо повноважень.", 403)
    if u.get("curator_ro") and to != "approved":
        raise Fail("Куратор лише схвалює відомість; виплату позначає Голова СБУ.", 403)
    h = s["history"] + [{"t": now_ms(), "sid": u["sid"], "name": u["name"], "action": to}]
    await db.run("UPDATE bonuses SET status=?, history=?, updated=? WHERE id=?", to, json.dumps(h, ensure_ascii=False), now_ms(), bid)
    s = await get(bid)
    if to in ("sent", "paid"):
        await journal(s, u, FLOW[to][2], tag=tag)
    if to == "paid":
        await db.audit(u["sid"], "Виплачено премії", 0, f"тиждень {s['label']} · ${s['total']:,}".replace(",", " "))
    return s


async def journal(s: dict, u: dict, label: str, tag: str | None = None):
    """Відомість премій — одне повідомлення: при поданні — картка з аркушем А4 і тегами, виплата оновлює її з відповіддю (роль СБУ)."""
    ch = await core.channel("bonus")
    paid = [r for r in s["rows"] if r["amount"] > 0]
    by_dept = {}
    for r in paid:
        by_dept[r["dept"]] = by_dept.get(r["dept"], 0) + r["amount"]
    money = lambda v: f"${v:,}".replace(",", " ")
    lines = [style.kv("ВІДОМІСТЬ", f"ВП-{s['id']:04d} · тиждень {s['label']}", "white", True),
             style.kv("ДІЯ", label, "green" if s["status"] == "paid" else "cyan", True),
             style.kv("ПРЕМІЙОВАНО", f"{len(paid)} осіб", "white"),
             style.kv("РАЗОМ", money(s["total"]), "gold", True),
             style.kv("ЛІМІТ", money(s["cfg"].get("limit", 0)), "gray"), style.rule()]
    lines += [style.kv(DEPTS[d]["s"].upper(), money(v), "white") for d, v in sorted(by_dept.items(), key=lambda x: -x[1])]
    lines += [style.rule(), style.kv("ХТО", f"{u['name']} · №{u['sid']}", "white"), style.kv("ДАТА", style.when(), "gray")]
    e = style.document(f"ВІДОМІСТЬ ПРЕМІЮВАННЯ ВП-{s['id']:04d}", 0x5FB37A if s["status"] == "paid" else 0xC9A05A, desc=style.block(*lines),
                       footer="П. 1.55 Загальних правил держорганізацій · деталі в ЄІС «Сова»")
    paid_now = s["status"] == "paid"
    await docpost.journal("bn", s["id"], ch, e, users=await docpost.people(s.get("created_by")), tag=tag,
                          roles=docpost.key_roles("bonus:paid") if paid_now else None,
                          ping=f"🔔 {label}." , ping_roles=docpost.key_roles("bonus:paid") if paid_now else None)


def report_text(s: dict) -> str:
    """Текст щотижневого звіту для куратора (п. 1.55)."""
    money = lambda v: f"${v:,}".replace(",", " ")
    out = [f"ЩОТИЖНЕВИЙ ЗВІТ ПРО ПРЕМІЮВАННЯ · СБУ штату NG", f"Відомість ВП-{s['id']:04d} · тиждень {s['label']}", ""]
    for d in DEPTS:
        rows = [r for r in s["rows"] if r["dept"] == d and r["amount"] > 0]
        if not rows:
            continue
        out.append(f"{DEPTS[d]['n']}:")
        out += [f"  • {r['name']} (№{r['sid']}, {rank_name(r['rank'])}) — {r['pts']} б. — {money(r['amount'])}" + (f" ({r['note']})" if r["note"] else "") for r in rows]
    out += ["", f"Разом: {money(s['total'])} при ліміті {money(s['cfg'].get('limit', 0))}"]
    return "\n".join(out)


async def mine(u: dict) -> dict:
    rows = await db.all("SELECT * FROM bonuses WHERE status!='draft' ORDER BY week DESC LIMIT 12")
    hist = []
    for s in rows:
        r = next((x for x in json.loads(s["rows"] or "[]") if x["sid"] == u["sid"]), None)
        if r:
            hist.append({"week": s["week"], "label": week_label(s["week"]), "status": s["status"], "amount": r["amount"], "pts": r["pts"], "note": r["note"]})
    c = await cfg()
    pts = await core.week_points(u["sid"])
    cap = c["caps"][tier(u["rank"])] if u["rank"] else 0
    return {"history": hist, "estimate": {"pts": pts, "amount": min(cap, pts * c["rate"]) if pts >= c["min_pts"] else 0, "cap": cap,
                                           "min": c["min_pts"], "rate": c["rate"], "tier": TIERS[tier(u["rank"])] if u["rank"] else ""}}
