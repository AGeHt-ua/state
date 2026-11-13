"""Статистика відділів: контрольна панель для Голови СБУ, його заступника (усі відділи), начальника управління (підрозділи управління)
та начальника відділу (свої відділи)."""
import asyncio
import json
import logging
from collections import Counter, defaultdict
from datetime import datetime, timezone

import discord

import core
import style
import overrides as ov
from core import ACTS, DAY, Fail
from db import db, now_ms
from roles import DEPTS, OPS_DEPTS, rank_name

log = logging.getLogger("sova.depts")
CONTROL_DEPTS = [*OPS_DEPTS, "academy", "press"]
REPORT_HOUR = 20  # щонеділі з 20:00 (Київ) — тижневі звіти відділів у Discord
INACTIVE_DAYS = 3


def role_depts(u: dict) -> list[str]:
    """Оперативні відділи, ролі яких має людина в Discord (з кешу ролей) + основний відділ картки."""
    hit = core._roles_cache.get(str(u.get("discord_id")))
    roles = hit[1] if hit and hit[1] else set()
    return [d for d in OPS_DEPTS if d == u["dept"] or DEPTS[d]["role"] in roles]


def mgmt_depts(u: dict) -> list[str]:
    """Підрозділи начальника управління: як задано в адмін-панелі (вкладка «Управління»), інакше — за ролями відділів у Discord."""
    custom = ov.mgmt.get(str(u["sid"]))
    if custom is not None:
        return [d for d in CONTROL_DEPTS if d in custom]
    out = role_depts(u)
    return out + ["academy"] if "vkpp" in out else out


def control_depts(u: dict) -> list[str]:
    """З якого звання видно статистику — адмін-панель → «Доступи» (dept_all — усі підрозділи, dept_own — свої)."""
    if u["rank"] >= ov.P("dept_all"):
        return list(CONTROL_DEPTS)
    if u["rank"] == 13:
        return mgmt_depts(u) if u["rank"] >= ov.P("dept_own") else []
    if u["rank"] >= ov.P("dept_own"):
        out = role_depts(u)
        return out + ["academy"] if "vkpp" in out else out  # Начальник ВКПП — він же начальник академії
    return []


async def overview(u: dict, d: str) -> dict:
    if d not in control_depts(u):
        raise Fail("Немає доступу до статистики цього відділу.", 403)
    return {**await week_data(d), "canReport": can_report(u, d)}


def can_report(u: dict, d: str) -> bool:
    """Сформувати тижневий звіт у Discord може той, хто бачить статистику відділу (крім Куратора — лише перегляд)."""
    return d in control_depts(u) and not u.get("curator_ro")


async def week_data(d: str) -> dict:
    c = await core.coef()
    ws, pws, now = core.week_start(0), core.week_start(1), now_ms()
    staff = await db.all("SELECT * FROM users WHERE dept=? AND status NOT IN ('dismissed','removed') ORDER BY rank DESC, sid", d)
    acts = await db.all("SELECT * FROM acts WHERE dept=? AND t>=? AND status!='deleted'", d, pws)
    pts = lambda a: c.get(a["type"], 0) * (a["qty"] or 1)
    last = {r["by_sid"]: r["t"] for r in await db.all("SELECT by_sid, MAX(t) AS t FROM acts WHERE dept=? AND status!='deleted' GROUP BY by_sid", d)}

    reps = {r["sid"]: r["n"] for r in await db.all("SELECT sid, COUNT(*) AS n FROM discipline WHERE status='active' AND kind IN ('reprimand','severe') "
                                                  "AND expires>? GROUP BY sid", now)}
    people = []
    for p in staff:
        mine = [a for a in acts if a["by_sid"] == p["sid"]]
        week = [a for a in mine if a["t"] >= ws]
        lt = last.get(p["sid"])
        people.append({
            "sid": p["sid"], "name": p["name"], "rank": p["rank"], "rankName": rank_name(p["rank"]), "status": p["status"], "since": p["since"],
            "pts": sum(pts(a) for a in week if a["status"] == "ok"),
            "ptsPrev": sum(pts(a) for a in mine if a["t"] < ws and a["status"] == "ok"),
            "acts": len(week), "wait": len([a for a in week if a["status"] == "wait"]),
            "reps": reps.get(p["sid"], 0), "last": lt, "inactive": p["status"] == "active" and (not lt or now - lt > INACTIVE_DAYS * DAY),
        })

    week = [a for a in acts if a["t"] >= ws]
    days = []
    for i in range(6, -1, -1):
        start = (now // DAY - i) * DAY
        day = [a for a in acts if start <= a["t"] < start + DAY]
        days.append({"t": start, "pts": sum(pts(a) for a in day if a["status"] == "ok"), "n": len(day)})
    types = Counter(a["type"] for a in week)
    pending_acts = await db.all("SELECT id, by_sid, type, custom, t FROM acts WHERE dept=? AND status='wait' ORDER BY t", d)
    pending_raps = await db.all("SELECT id, by_sid, type, t FROM raps WHERE dept=? AND status='wait' ORDER BY t", d)
    cases = await db.all("SELECT id, status, data, updated FROM cases WHERE dept=? AND status NOT IN ('approved','rejected','deleted') ORDER BY updated DESC", d) \
        if d in ("orv", "deb", "atc", "alpha") else []
    names = {p["sid"]: p["name"] for p in staff}
    head = next((p for p in staff if p["rank"] == 12), None)
    deputy = next((p for p in staff if p["rank"] == 11), None)
    return {
        "dept": d, "head": head and {"sid": head["sid"], "name": head["name"]}, "deputy": deputy and {"sid": deputy["sid"], "name": deputy["name"]},
        "people": sorted(people, key=lambda p: (-p["pts"], -p["rank"])),
        "totals": {
            "staff": len(staff), "vacation": len([p for p in staff if p["status"] == "vacation"]),
            "inactive": len([p for p in people if p["inactive"]]),
            "pts": sum(pts(a) for a in week if a["status"] == "ok"),
            "ptsPrev": sum(pts(a) for a in acts if a["t"] < ws and a["status"] == "ok"),
            "submitted": len(week), "approved": len([a for a in week if a["status"] == "ok"]),
            "rejected": len([a for a in week if a["status"] == "rej"]), "pending": len(pending_acts),
        },
        "days": days,
        "types": [{"type": k, "n": n, "name": ACTS[k][0] if k in ACTS else k} for k, n in types.most_common(6)],
        "queue": {
            "acts": [{**a, "name": names.get(a["by_sid"], f"№{a['by_sid']}"), "what": core.act_name(a)} for a in pending_acts[:20]],
            "raps": [{**r, "name": names.get(r["by_sid"], f"№{r['by_sid']}")} for r in pending_raps[:20]],
            "cases": [{"id": x["id"], "status": x["status"], "title": json.loads(x["data"] or "{}").get("title", ""), "updated": x["updated"]} for x in cases[:20]],
        },
        "weekStart": ws,
    }


async def alltime(u: dict, d: str) -> dict:
    """Активність відділу за весь час: бали, звіти, тижні, види дій, рейтинг особового складу."""
    if d not in control_depts(u):
        raise Fail("Немає доступу до статистики цього відділу.", 403)
    c = await core.coef()
    pts = lambda a: c.get(a["type"], 0) * (a["qty"] or 1)
    rows = await db.all("SELECT by_sid, type, qty, status, t, custom FROM acts WHERE dept=? AND status!='deleted' ORDER BY t", d)
    ok = [a for a in rows if a["status"] == "ok"]
    rej = len([a for a in rows if a["status"] == "rej"])
    ws0, week = core.week_start(0), 7 * DAY
    wk = lambda t: (ws0 - t + week - 1) // week if t < ws0 else 0
    by_week = defaultdict(lambda: [0, 0])
    for a in ok:
        b = by_week[wk(a["t"])]; b[0] += pts(a); b[1] += 1
    best = max(by_week.items(), key=lambda kv: kv[1][0], default=None)
    types = defaultdict(lambda: [0, 0])
    for a in ok:
        k = core.act_name(a) if a["type"] != core.OTHER else "Інше (свій тип дії)"
        types[k][0] += 1; types[k][1] += pts(a)
    staff = await db.all("SELECT * FROM users WHERE dept=? AND status NOT IN ('dismissed','removed') ORDER BY rank DESC, sid", d)
    per = defaultdict(lambda: {"pts": 0, "ok": 0, "rej": 0, "last": None})
    for a in rows:
        p = per[a["by_sid"]]
        if a["status"] == "ok":
            p["pts"] += pts(a); p["ok"] += 1
        elif a["status"] == "rej":
            p["rej"] += 1
        p["last"] = max(p["last"] or 0, a["t"])
    people = sorted(({"sid": p["sid"], "name": p["name"], "rank": p["rank"], "rankName": rank_name(p["rank"]), "status": p["status"], "since": p["since"],
                      **per[p["sid"]]} for p in staff), key=lambda x: (-x["pts"], -x["rank"]))
    total = sum(pts(a) for a in ok)
    n_weeks = max(1, wk(ok[0]["t"]) + 1) if ok else 1
    return {
        "totals": {"pts": total, "submitted": len(rows), "approved": len(ok), "rejected": rej, "quality": round(100 * len(ok) / max(1, len(ok) + rej)),
                   "staff": len(staff), "contributors": len([p for p in people if p["pts"] > 0]), "avgWeek": round(total / n_weeks, 1),
                   "avgPerson": round(total / max(1, len(staff)), 1), "first": ok[0]["t"] if ok else None,
                   "best": {"t": ws0 - best[0] * week, "pts": best[1][0], "n": best[1][1]} if best else None},
        "weeks": [{"t": ws0 - i * week, "pts": by_week[i][0], "n": by_week[i][1]} for i in range(11, -1, -1)],
        "types": sorted(({"name": k, "n": v[0], "pts": v[1]} for k, v in types.items()), key=lambda x: -x["pts"])[:10],
        "people": people,
    }


# ---------------------------------------------------------------- тижневий звіт підрозділу в Discord
async def report_embed(d: str, by: dict | None = None) -> discord.Embed:
    o = await week_data(d)
    t, dp = o["totals"], DEPTS[d]
    ws = o["weekStart"]
    fmt = lambda ms: datetime.fromtimestamp(ms / 1000, core.TZ or timezone.utc).strftime("%d.%m")
    diff = t["pts"] - t["ptsPrev"]
    quality = round(100 * t["approved"] / (t["approved"] + t["rejected"])) if t["approved"] + t["rejected"] else 0  # з розглянутих
    e = style.document(f"ЗВІТ ПІДРОЗДІЛУ ЗА ТИЖДЕНЬ · {dp['s']}", dp["color"], no=f"Тиждень {fmt(ws)}–{fmt(ws + 6 * DAY)}",
                       footer=("сформував " + by["name"]) if by else "автоматично щонеділі",
                       desc=style.block(
                           style.kv("ПІДРОЗДІЛ", dp["n"], bold=True),
                           style.kv("НАЧАЛЬНИК", o["head"]["name"] if o["head"] else "вакантно"),
                           style.kv("ЗАСТУПНИК", o["deputy"]["name"] if o["deputy"] else "вакантно"),
                           style.kv("ОСОБОВИЙ СКЛАД", f"{t['staff']} · у відпустці {t['vacation']}"),
                           style.rule(),
                           style.kv("БАЛИ ТИЖНЯ", f"{t['pts']} ({'+' if diff >= 0 else '−'}{abs(diff)} до минулого: {t['ptsPrev']})", bold=True),
                           style.kv("ЗВІТІВ ПОДАНО", f"{t['submitted']} · підтверджено {t['approved']} · відхилено {t['rejected']}"),
                           style.kv("ЯКІСТЬ ЗВІТІВ", f"{quality}%"),
                           style.kv("НА ПЕРЕВІРЦІ", t["pending"]),
                           style.kv("НЕАКТИВНІ >3 ДІБ", t["inactive"])))
    top = [p for p in o["people"] if p["pts"] > 0][:5]
    medal = ["🥇", "🥈", "🥉", "4.", "5."]
    e.add_field(name="🏆 Найкращі за тиждень", value="\n".join(f"{medal[i]} {style.esc(p['rankName'])} **{style.esc(p['name'])}** — {p['pts']} б. ({p['acts']} зв.)"
                                                          for i, p in enumerate(top)) or "Підтверджених звітів цього тижня немає.", inline=False)
    if o["types"]:
        e.add_field(name="📋 Структура роботи", value="\n".join(f"• {style.esc(x['name'])} — {x['n']}" for x in o["types"]), inline=True)
    idle = [p for p in o["people"] if p["inactive"]]
    if idle:
        e.add_field(name=f"⚠ Неактивні понад 3 доби · {len(idle)}", value="\n".join(f"• {style.esc(p['name'])}" for p in idle[:12]) + (f"\n… ще {len(idle) - 12}" if len(idle) > 12 else ""), inline=True)
    return e


async def post_report(d: str, by: dict | None = None) -> bool:
    ch = await core.channel("dept_report")
    if not ch:
        return False
    await ch.send(embed=await report_embed(d, by), view=style.site_view("Статистика відділів у «Сові»"), allowed_mentions=discord.AllowedMentions.none())
    return True


async def report_now(u: dict, d: str) -> dict:
    if not can_report(u, d):
        raise Fail("Сформувати звіт може той, хто має доступ до статистики цього відділу.", 403)
    if not await post_report(d, u):
        raise Fail("Канал тижневих звітів не налаштовано (адмін-панель → Канали → «Тижневі звіти відділів»).")
    await db.audit(u["sid"], "Тижневий звіт підрозділу в Discord", None, DEPTS[d]["n"])
    return {"ok": True}


async def weekly_loop():
    """Щонеділі ввечері — звіт кожного підрозділу окремим повідомленням (один раз за тиждень)."""
    await asyncio.sleep(90)
    while True:
        try:
            now = datetime.now(core.TZ or timezone.utc)
            ws = core.week_start(0)
            if now.weekday() == 6 and now.hour >= REPORT_HOUR and await db.get_setting("dept_report_posted") != ws:
                await db.set_setting("dept_report_posted", ws)
                for d in CONTROL_DEPTS:
                    if await db.one("SELECT sid FROM users WHERE dept=? AND status NOT IN ('dismissed','removed') LIMIT 1", d):
                        await post_report(d)
                        await asyncio.sleep(2)
        except Exception:
            log.exception("Тижневі звіти відділів")
        await asyncio.sleep(600)
