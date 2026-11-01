"""Розділ відділу: контрольна панель для Голови СБУ, його заступника (усі відділи) та начальника відділу (свої відділи)."""
import json
from collections import Counter

import core
from core import ACTS, DAY, Fail
from db import db, now_ms
from roles import DEPTS, OPS_DEPTS, rank_name

CONTROL_DEPTS = [*OPS_DEPTS, "academy", "press"]
INACTIVE_DAYS = 3


def control_depts(u: dict) -> list[str]:
    if u["rank"] >= 14:
        return list(CONTROL_DEPTS)
    if u["rank"] == 12:
        hit = core._roles_cache.get(str(u.get("discord_id")))
        roles = hit[1] if hit and hit[1] else set()
        return [d for d in OPS_DEPTS if d == u["dept"] or DEPTS[d]["role"] in roles]
    return []


async def overview(u: dict, d: str) -> dict:
    if d not in control_depts(u):
        raise Fail("Немає доступу до розділу цього відділу.", 403)
    c = await core.coef()
    ws, pws, now = core.week_start(0), core.week_start(1), now_ms()
    staff = await db.all("SELECT * FROM users WHERE dept=? AND status!='dismissed' ORDER BY rank DESC, sid", d)
    acts = await db.all("SELECT * FROM acts WHERE dept=? AND t>=? AND status!='deleted'", d, pws)
    pts = lambda a: c.get(a["type"], 0) * (a["qty"] or 1)
    last = {r["by_sid"]: r["t"] for r in await db.all("SELECT by_sid, MAX(t) AS t FROM acts WHERE dept=? AND status!='deleted' GROUP BY by_sid", d)}

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
            "last": lt, "inactive": p["status"] == "active" and (not lt or now - lt > INACTIVE_DAYS * DAY),
        })

    week = [a for a in acts if a["t"] >= ws]
    days = []
    for i in range(6, -1, -1):
        start = (now // DAY - i) * DAY
        day = [a for a in acts if start <= a["t"] < start + DAY]
        days.append({"t": start, "pts": sum(pts(a) for a in day if a["status"] == "ok"), "n": len(day)})
    types = Counter(a["type"] for a in week)
    pending_acts = await db.all("SELECT id, by_sid, type, t FROM acts WHERE dept=? AND status='wait' ORDER BY t", d)
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
            "acts": [{**a, "name": names.get(a["by_sid"], f"№{a['by_sid']}"), "what": ACTS[a["type"]][0] if a["type"] in ACTS else a["type"]} for a in pending_acts[:20]],
            "raps": [{**r, "name": names.get(r["by_sid"], f"№{r['by_sid']}")} for r in pending_raps[:20]],
            "cases": [{"id": x["id"], "status": x["status"], "title": json.loads(x["data"] or "{}").get("title", ""), "updated": x["updated"]} for x in cases[:20]],
        },
        "weekStart": ws,
    }
