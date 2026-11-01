"""Тренажер «Штурм»: люди в грі (заручники — колеги, напарник із відділу), рейтинги (особистий, відділів, операція тижня),
нагороди на посвідченні, стрічка «вас урятували» і щотижневі підсумки в Discord. На бали підвищення й премії не впливає."""
import asyncio
import json
import logging
import random

import discord

import core
import style
from core import DAY, Fail
from db import db, now_ms
from roles import DEPTS, OPS_DEPTS, rank_name, rank_short

log = logging.getLogger("sova.games")
GAME = "assault"
WEEKLY = 3  # рівень «Операція тижня»


def _who(u: dict) -> dict:
    return {"sid": u["sid"], "name": u["name"], "rank": u["rank"], "rankShort": rank_short(u["rank"]), "rankName": rank_name(u["rank"]),
            "dept": u["dept"], "deptS": DEPTS.get(u["dept"], {}).get("s", ""), "callsign": u.get("callsign")}


async def people(u: dict) -> dict:
    """Хто з'явиться в грі: ви, кандидати в напарники (свій відділ), заручники — випадкові колеги з чинного складу."""
    rows = await db.all("SELECT * FROM users WHERE status='active' AND dept NOT IN ('prosecutor','curator') AND sid!=?", u["sid"])
    team = [_who(r) for r in rows if r["dept"] == u["dept"]]
    if len(team) < 3:  # у малому відділі — колеги з інших оперативних відділів
        team += [_who(r) for r in rows if r["dept"] in OPS_DEPTS and r["dept"] != u["dept"]][: 6 - len(team)]
    pool = [_who(r) for r in rows]
    random.shuffle(pool)
    return {"me": _who(u), "team": sorted(team, key=lambda x: -x["rank"])[:12], "hostages": pool[:8]}


def week_seed(offset: int = 0) -> int:
    return core.week_start(offset) // DAY


async def save(u: dict, b: dict) -> dict:
    lvl, sc, ms = int(b.get("level") or 0), int(b.get("score") or 0), int(b.get("ms") or 0)
    if not 0 <= lvl <= WEEKLY or not 0 <= sc <= 15000 or ms < 8000:  # грубий захист від підробки
        raise Fail("Некоректний результат.")
    d = b.get("data") or {}
    data = {k: d.get(k) for k in ("fired", "hits", "kills", "arrests", "hostages", "civHit", "hostHit", "grade", "partner", "partnerHit")}
    data["rescued"] = [int(x) for x in (d.get("rescued") or []) if str(x).isdigit()][:8]
    data["dept"] = u["dept"]
    if lvl == WEEKLY:
        data["week"] = week_seed()
    prev = await db.one("SELECT MAX(score) AS m FROM game_scores WHERE game=? AND sid=? AND level=?" + (" AND t>=?" if lvl == WEEKLY else ""),
                        GAME, u["sid"], lvl, *([core.week_start(0)] if lvl == WEEKLY else []))
    await db.run("INSERT INTO game_scores(sid,game,level,score,ms,data,t) VALUES(?,?,?,?,?,?,?)", u["sid"], GAME, lvl, sc, ms,
                 json.dumps(data, ensure_ascii=False), now_ms())
    return {"ok": True, "record": sc > ((prev or {}).get("m") or 0)}


async def _board(since: int = 0, levels=(0, 1, 2)) -> list[dict]:
    q = ",".join("?" * len(levels))
    rows = await db.all(f"SELECT sid, SUM(best) AS score FROM (SELECT sid, level, MAX(score) AS best FROM game_scores WHERE game=? AND t>=? AND level IN ({q}) "
                        "GROUP BY sid, level) GROUP BY sid ORDER BY score DESC LIMIT 10", GAME, since, *levels)
    out = []
    for r in rows:
        p = await core.user(r["sid"])
        if p and p["dept"] != "curator":
            out.append({"sid": r["sid"], "score": r["score"], "name": p["name"], "rankShort": rank_short(p["rank"]), "deptS": DEPTS.get(p["dept"], {}).get("s", "")})
    return out


async def dept_board(since: int) -> list[dict]:
    """Підрозділи: середня сума найкращих результатів учасників (щоб малий відділ не програвав великому)."""
    rows = await db.all("SELECT b.sid, SUM(b.best) AS score, u.dept FROM (SELECT sid, level, MAX(score) AS best FROM game_scores WHERE game=? AND t>=? AND level<3 "
                        "GROUP BY sid, level) b JOIN users u ON u.sid=b.sid WHERE u.dept NOT IN ('curator','prosecutor') GROUP BY b.sid", GAME, since)
    agg = {}
    for r in rows:
        a = agg.setdefault(r["dept"], [0, 0])
        a[0] += r["score"]; a[1] += 1
    out = [{"dept": d, "s": DEPTS.get(d, {}).get("s", d), "n": DEPTS.get(d, {}).get("n", d), "avg": round(s / n), "players": n} for d, (s, n) in agg.items()]
    return sorted(out, key=lambda x: -x["avg"])


async def board(u: dict) -> dict:
    mine = await db.all("SELECT level, MAX(score) AS best FROM game_scores WHERE game=? AND sid=? AND (level<3 OR t>=?) GROUP BY level", GAME, u["sid"], core.week_start(0))
    ws = core.week_start(0)
    return {"week": await _board(ws), "all": await _board(), "weekly": await _board(ws, (WEEKLY,)), "depts": await dept_board(ws),
            "deptsAll": await dept_board(0), "mine": {r["level"]: r["best"] for r in mine}, "seed": week_seed(),
            "badges": await badges(u["sid"]), "rescues": await rescues(u["sid"])}


async def badges(sid: int) -> list[dict]:
    """Нагороди «Штурму» для посвідчення."""
    out = []
    prev = core.week_start(1)
    rows = await db.all("SELECT level, score, data FROM game_scores WHERE game=? AND sid=?", GAME, sid)
    if not rows:
        return out
    datas = [(r["level"], json.loads(r["data"] or "{}")) for r in rows]
    # найкращий штурмовик минулого тижня
    wk = await db.all("SELECT sid, SUM(best) AS s FROM (SELECT sid, level, MAX(score) AS best FROM game_scores WHERE game=? AND t>=? AND t<? AND level<3 "
                      "GROUP BY sid, level) GROUP BY sid ORDER BY s DESC LIMIT 1", GAME, prev, core.week_start(0))
    if wk and wk[0]["sid"] == sid:
        out.append({"k": "week", "icon": "🏆", "t": "Найкращий штурмовик тижня"})
    if any(d.get("fired") == 0 and (d.get("arrests") or 0) > 0 for _, d in datas):
        out.append({"k": "nofire", "icon": "🕊", "t": "Без жодного пострілу"})
    if any(lvl == 2 and not d.get("civHit") and not d.get("hostHit") for lvl, d in datas):
        out.append({"k": "clean", "icon": "🛡", "t": "Ніхто не постраждав (особняк)"})
    if all(any(lvl == i and d.get("grade") == "S" for lvl, d in datas) for i in (0, 1, 2)):
        out.append({"k": "s", "icon": "⭐", "t": "S-ранг на всіх операціях"})
    saved = sum(len(d.get("rescued") or []) for _, d in datas)
    if saved >= 10:
        out.append({"k": "saver", "icon": "🤝", "t": f"Врятував колег: {saved}"})
    return out


async def rescues(sid: int) -> list[dict]:
    """Хто вас «урятував» у грі за останні 14 днів."""
    rows = await db.all("SELECT sid, level, t, data FROM game_scores WHERE game=? AND t>=? ORDER BY id DESC LIMIT 400", GAME, now_ms() - 14 * DAY)
    out = []
    for r in rows:
        if r["sid"] != sid and sid in (json.loads(r["data"] or "{}").get("rescued") or []):
            p = await core.user(r["sid"])
            if p:
                out.append({"name": p["name"], "rankShort": rank_short(p["rank"]), "t": r["t"], "level": r["level"]})
        if len(out) >= 5:
            break
    return out


async def weekly_loop():
    """Щонеділі ввечері (після початку нового тижня) — підсумки минулого тижня в Discord."""
    await asyncio.sleep(120)
    while True:
        try:
            ws = core.week_start(0)
            if await db.get_setting("game_posted") != ws:
                prev = core.week_start(1)
                top = await _board(prev, (0, 1, 2))
                top = top[:3]
                rows = await db.all("SELECT COUNT(DISTINCT sid) AS n FROM game_scores WHERE game=? AND t>=? AND t<?", GAME, prev, ws)
                await db.set_setting("game_posted", ws)
                if top:
                    depts = await dept_board(prev)
                    ch = await core.channel("game") or await core.channel("log")
                    if ch:
                        medal = ["🥇", "🥈", "🥉"]
                        lines = [style.kv("УЧАСНИКІВ", str(rows[0]["n"]), "white", True), style.rule()]
                        lines += [style.kv(f"{i + 1} МІСЦЕ", f"{t['rankShort']} {t['name']} · {t['score']}", "gold" if i == 0 else "white", i == 0) for i, t in enumerate(top)]
                        if depts:
                            lines += [style.rule(), style.kv("ПІДРОЗДІЛ ТИЖНЯ", f"{depts[0]['s']} · середнє {depts[0]['avg']}", "green", True)]
                        e = style.document("ТРЕНАЖЕР «ШТУРМ» · ПІДСУМКИ ТИЖНЯ", 0xC9A05A, desc=style.block(*lines),
                                           footer="ЦСО «Альфа» · рейтинг у ЄІС «Сова» → Тренажер «Штурм»")
                        e.description = "\n".join(f"{medal[i]} **{t['name']}** ({t['deptS']}) — {t['score']}" for i, t in enumerate(top)) + "\n" + e.description
                        await ch.send(embed=e, allowed_mentions=discord.AllowedMentions.none())
        except Exception:
            log.exception("Підсумки тижня «Штурму»")
        await asyncio.sleep(3600)
