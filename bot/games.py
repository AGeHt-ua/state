"""Тренажери СБУ: «Штурм» (ЦСО «Альфа»), «Хвіст» (ОРВ, негласне стеження) і «Перевірка» (ВВБ, службове розслідування).
Люди в грі (заручники й напарник — колеги зі складу), рейтинги кожної гри (особистий, відділів, операція тижня),
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
WEEKLY = 3  # рівень «Операція тижня» (в обох іграх)
# Ігри: назва, межа балів (грубий захист від підробки), які поля результату зберігати, підсумки тижня в Discord
GAMES = {
    "assault": {"title": "ТРЕНАЖЕР «АЛЬФА» · «ШТУРМ»", "max": 15000, "posted": "game_posted", "best": "Найкращий штурмовик тижня",
                "footer": "ЦСО «Альфа» · рейтинг у ЄІС «Сова» → Тренажери",
                "fields": ("fired", "hits", "kills", "arrests", "hostages", "civHit", "hostHit", "grade", "partner", "partnerHit")},
    "tail": {"title": "ТРЕНАЖЕР ОРВ · «ХВІСТ»", "max": 12000, "posted": "game_posted_tail", "best": "Найкращий оперативник стеження тижня",
             "footer": "Оперативно-розшуковий відділ · рейтинг у ЄІС «Сова» → Тренажери",
             "fields": ("photos", "contacts", "exchange", "audio", "watchers", "maxSusp", "swaps", "disguise", "grade", "partner", "film")},
    "audit": {"title": "ТРЕНАЖЕР ВВБ · «ПЕРЕВІРКА»", "max": 12000, "posted": "game_posted_audit", "best": "Найкращий інспектор ВВБ тижня",
              "footer": "Відділ внутрішньої безпеки · рейтинг у ЄІС «Сова» → Тренажери",
              "fields": ("right", "falseAccuse", "found", "missed", "falseMarks", "pins", "grade", "tpl", "qual", "sanct")},
}
GAME = "assault"


def game_key(g) -> str:
    if g not in GAMES:
        raise Fail("Невідома гра.", 404)
    return g


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
    game = game_key(b.get("game") or "assault")
    lvl, sc, ms = int(b.get("level") or 0), int(b.get("score") or 0), int(b.get("ms") or 0)
    if not 0 <= lvl <= WEEKLY or not 0 <= sc <= GAMES[game]["max"] or ms < 8000:  # грубий захист від підробки
        raise Fail("Некоректний результат.")
    d = b.get("data") or {}
    data = {k: d.get(k) for k in GAMES[game]["fields"]}
    if game == "assault":
        data["rescued"] = [int(x) for x in (d.get("rescued") or []) if str(x).isdigit()][:8]
    data["dept"] = u["dept"]
    if lvl == WEEKLY:
        data["week"] = week_seed()
    prev = await db.one("SELECT MAX(score) AS m FROM game_scores WHERE game=? AND sid=? AND level=?" + (" AND t>=?" if lvl == WEEKLY else ""),
                        game, u["sid"], lvl, *([core.week_start(0)] if lvl == WEEKLY else []))
    await db.run("INSERT INTO game_scores(sid,game,level,score,ms,data,t) VALUES(?,?,?,?,?,?,?)", u["sid"], game, lvl, sc, ms,
                 json.dumps(data, ensure_ascii=False), now_ms())
    return {"ok": True, "record": sc > ((prev or {}).get("m") or 0)}


async def _board(since: int = 0, levels=(0, 1, 2), game: str = GAME) -> list[dict]:
    q = ",".join("?" * len(levels))
    rows = await db.all(f"SELECT sid, SUM(best) AS score FROM (SELECT sid, level, MAX(score) AS best FROM game_scores WHERE game=? AND t>=? AND level IN ({q}) "
                        "GROUP BY sid, level) GROUP BY sid ORDER BY score DESC LIMIT 10", game, since, *levels)
    out = []
    for r in rows:
        p = await core.user(r["sid"])
        if p and p["dept"] != "curator":
            out.append({"sid": r["sid"], "score": r["score"], "name": p["name"], "rankShort": rank_short(p["rank"]), "deptS": DEPTS.get(p["dept"], {}).get("s", "")})
    return out


async def dept_board(since: int, game: str = GAME) -> list[dict]:
    """Підрозділи: середня сума найкращих результатів учасників (щоб малий відділ не програвав великому)."""
    rows = await db.all("SELECT b.sid, SUM(b.best) AS score, u.dept FROM (SELECT sid, level, MAX(score) AS best FROM game_scores WHERE game=? AND t>=? AND level<3 "
                        "GROUP BY sid, level) b JOIN users u ON u.sid=b.sid WHERE u.dept NOT IN ('curator','prosecutor') GROUP BY b.sid", game, since)
    agg = {}
    for r in rows:
        a = agg.setdefault(r["dept"], [0, 0])
        a[0] += r["score"]; a[1] += 1
    out = [{"dept": d, "s": DEPTS.get(d, {}).get("s", d), "n": DEPTS.get(d, {}).get("n", d), "avg": round(s / n), "players": n} for d, (s, n) in agg.items()]
    return sorted(out, key=lambda x: -x["avg"])


async def board(u: dict, game: str = GAME) -> dict:
    game = game_key(game)
    mine = await db.all("SELECT level, MAX(score) AS best FROM game_scores WHERE game=? AND sid=? AND (level<3 OR t>=?) GROUP BY level", game, u["sid"], core.week_start(0))
    ws = core.week_start(0)
    return {"week": await _board(ws, game=game), "all": await _board(game=game), "weekly": await _board(ws, (WEEKLY,), game), "depts": await dept_board(ws, game),
            "deptsAll": await dept_board(0, game), "mine": {r["level"]: r["best"] for r in mine}, "seed": week_seed(),
            "badges": await badges(u["sid"], game), "rescues": await rescues(u["sid"]) if game == "assault" else []}


async def hub(u: dict) -> dict:
    """Головна вкладки «Тренажери»: по кожній грі — ваш рекорд, лідер тижня й кількість учасників."""
    ws, out = core.week_start(0), {}
    for g in GAMES:
        mine = await db.one("SELECT SUM(best) AS s FROM (SELECT level, MAX(score) AS best FROM game_scores WHERE game=? AND sid=? AND level<3 GROUP BY level)", g, u["sid"])
        n = await db.one("SELECT COUNT(DISTINCT sid) AS n FROM game_scores WHERE game=? AND t>=?", g, ws)
        top = await _board(ws, game=g)
        out[g] = {"mine": (mine or {}).get("s") or 0, "players": (n or {}).get("n") or 0, "leader": top[0] if top else None}
    return {"games": out, "badges": await badges(u["sid"])}


async def badges(sid: int, game: str | None = None) -> list[dict]:
    """Нагороди тренажерів для посвідчення (усіх ігор або однієї)."""
    out = []
    if game in (None, "assault"):
        out += await _badges_assault(sid)
    if game in (None, "tail"):
        out += await _badges_tail(sid)
    if game in (None, "audit"):
        out += await _badges_audit(sid)
    return out


async def _badges_audit(sid: int) -> list[dict]:
    """Нагороди «Перевірки» (ВВБ)."""
    out = []
    rows = await db.all("SELECT level, data FROM game_scores WHERE game='audit' AND sid=?", sid)
    if not rows:
        return out
    datas = [(r["level"], json.loads(r["data"] or "{}")) for r in rows]
    wk = await db.all("SELECT sid, SUM(best) AS s FROM (SELECT sid, level, MAX(score) AS best FROM game_scores WHERE game='audit' AND t>=? AND t<? AND level<3 "
                      "GROUP BY sid, level) GROUP BY sid ORDER BY s DESC LIMIT 1", core.week_start(1), core.week_start(0))
    if wk and wk[0]["sid"] == sid:
        out.append({"k": "aweek", "icon": "🔎", "t": GAMES["audit"]["best"]})
    if len(datas) >= 5 and not any(d.get("falseAccuse") for _, d in datas):
        out.append({"k": "fair", "icon": "⚖", "t": "Жодного хибного звинувачення"})
    if all(any(lvl == i and d.get("grade") == "S" for lvl, d in datas) for i in (0, 1, 2)):
        out.append({"k": "as", "icon": "⭐", "t": "S-ранг на всіх перевірках"})
    return out


async def _badges_tail(sid: int) -> list[dict]:
    """Нагороди «Хвоста»."""
    out = []
    rows = await db.all("SELECT level, score, data FROM game_scores WHERE game='tail' AND sid=?", sid)
    if not rows:
        return out
    datas = [(r["level"], json.loads(r["data"] or "{}")) for r in rows]
    wk = await db.all("SELECT sid, SUM(best) AS s FROM (SELECT sid, level, MAX(score) AS best FROM game_scores WHERE game='tail' AND t>=? AND t<? AND level<3 "
                      "GROUP BY sid, level) GROUP BY sid ORDER BY s DESC LIMIT 1", core.week_start(1), core.week_start(0))
    if wk and wk[0]["sid"] == sid:
        out.append({"k": "tweek", "icon": "🕵", "t": GAMES["tail"]["best"]})
    if any(lvl == 2 and (d.get("maxSusp") or 0) < 25 for lvl, d in datas):
        out.append({"k": "ghost", "icon": "👻", "t": "Тінь: «Резидент» непоміченим"})
    if any(d.get("audio") for _, d in datas) and any(d.get("exchange") for _, d in datas):
        out.append({"k": "proof", "icon": "🎙", "t": "Фото передачі й запис розмови"})
    if all(any(lvl == i and d.get("grade") == "S" for lvl, d in datas) for i in (0, 1, 2)):
        out.append({"k": "ts", "icon": "⭐", "t": "S-ранг на всіх розробках"})
    return out


async def _badges_assault(sid: int) -> list[dict]:
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
    """Щонеділі ввечері (після початку нового тижня) — підсумки минулого тижня в Discord, окремо по кожній грі."""
    await asyncio.sleep(120)
    while True:
        for game, G in GAMES.items():
            await _weekly_post(game, G)
        await asyncio.sleep(3600)


async def _weekly_post(game: str, G: dict):
    try:
        ws = core.week_start(0)
        if await db.get_setting(G["posted"]) != ws:
            prev = core.week_start(1)
            top = await _board(prev, (0, 1, 2), game)
            top = top[:3]
            rows = await db.all("SELECT COUNT(DISTINCT sid) AS n FROM game_scores WHERE game=? AND t>=? AND t<?", game, prev, ws)
            await db.set_setting(G["posted"], ws)
            if top:
                depts = await dept_board(prev, game)
                ch = await core.channel("game") or await core.channel("log")
                if ch:
                    medal = ["🥇", "🥈", "🥉"]
                    lines = [style.kv("УЧАСНИКІВ", str(rows[0]["n"]), "white", True), style.rule()]
                    lines += [style.kv(f"{i + 1} МІСЦЕ", f"{t['rankShort']} {t['name']} · {t['score']}", "gold" if i == 0 else "white", i == 0) for i, t in enumerate(top)]
                    if depts:
                        lines += [style.rule(), style.kv("ПІДРОЗДІЛ ТИЖНЯ", f"{depts[0]['s']} · середнє {depts[0]['avg']}", "green", True)]
                    e = style.document(f"{G['title']} · ПІДСУМКИ ТИЖНЯ", 0xC9A05A, desc=style.block(*lines), footer=G["footer"])
                    e.description = "\n".join(f"{medal[i]} **{t['name']}** ({t['deptS']}) — {t['score']}" for i, t in enumerate(top)) + "\n" + e.description
                    await ch.send(embed=e, allowed_mentions=discord.AllowedMentions.none())
    except Exception:
        log.exception("Підсумки тижня тренажера %s", game)
