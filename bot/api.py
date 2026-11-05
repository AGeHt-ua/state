"""HTTP API для сайту (GitHub Pages). Сайт не має своєї бази — усе тут."""
import asyncio
import json
import logging
import secrets
import time

from aiohttp import web

import admin
import callsigns
import games
import promo
import finance
import protocols
import candidates
import bonus
import cases
import depts
import discipline
import docpost
import kb
import library
import orders
import config
import core
import overrides as ov
from core import ACTS, RAP_TYPES, Fail
from db import db, now_ms
from roles import DEPTS, OPS_DEPTS, PRESS_ROLE, RANK_ROLES, RANKS, SBU_ROLE, nickname, rank_name

log = logging.getLogger("sova.api")
routes = web.RouteTableDef()
_attempts: dict[str, list[float]] = {}


# ---------------------------------------------------------------- службове
@web.middleware
async def cors_and_errors(request: web.Request, handler):
    origin = request.headers.get("Origin", "")
    allowed = origin if origin in config.SITE_ORIGINS else ""
    if request.method == "OPTIONS":
        resp = web.Response(status=204)
    else:
        try:
            resp = await handler(request)
        except Fail as e:
            resp = web.json_response({"error": str(e)}, status=e.status)
        except web.HTTPException as e:
            resp = e
        except Exception:
            log.exception("Помилка API %s %s", request.method, request.path)
            resp = web.json_response({"error": "Внутрішня помилка сервера. Спробуйте ще раз."}, status=500)
    if allowed:
        resp.headers["Access-Control-Allow-Origin"] = allowed
        resp.headers["Vary"] = "Origin"
        resp.headers["Access-Control-Allow-Headers"] = "Authorization, Content-Type"
        resp.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
        resp.headers["Access-Control-Max-Age"] = "600"
    return resp


def token_of(request: web.Request) -> str | None:
    h = request.headers.get("Authorization", "")
    return h[7:] if h.startswith("Bearer ") else request.query.get("t")


async def auth(request: web.Request) -> dict:
    u = await core.session_user(token_of(request))
    if not u:
        raise Fail("Сесія завершилась. Увійдіть знову.", 401)
    a = await core.access(u)
    if not a["ok"]:
        raise Fail(f"Доступ закрито: {a['why']}.", 403)
    if u["dept"] == "curator":
        # Куратор: бачить усе як Голова, але лише переглядає; змінювати може тільки адмін-панель і схвалення премій
        u = {**u, "rank": 15, "curator": True, "curator_ro": True}
        if request.method != "GET" and not (request.path.startswith("/api/admin") or request.path in ("/api/logout",)
                                             or (request.path.startswith("/api/bonus/") and request.path.endswith("/status"))):
            raise Fail("Куратор має наглядовий доступ: лише перегляд.", 403)
    return u


async def body(request: web.Request) -> dict:
    try:
        return await request.json()
    except (json.JSONDecodeError, UnicodeDecodeError):
        raise Fail("Некоректний запит.")


def public_user(u: dict) -> dict:
    if u["dept"] == "curator":  # куратор ніде не світиться: у журналах — лише посада
        return {"sid": u["sid"], "name": "Куратор СБУ", "rank": 0, "rankName": "Куратор СБУ", "dept": "curator",
                "deptName": "Куратор СБУ", "since": u["since"], "status": u["status"]}
    return {"sid": u["sid"], "name": u["name"], "rank": u["rank"], "rankName": rank_name(u["rank"]),
            "dept": u["dept"], "deptName": DEPTS[u["dept"]]["n"], "since": u["since"], "status": u["status"]}


async def people_map(sids) -> dict:
    sids = list({s for s in sids if s})
    if not sids:
        return {}
    rows = await db.all(f"SELECT * FROM users WHERE sid IN ({','.join('?' * len(sids))})", *sids)
    return {r["sid"]: public_user(r) for r in rows}


def limit_login(key: str):
    now = time.time()
    hits = [t for t in _attempts.get(key, []) if now - t < 600]
    if len(hits) >= 10:
        raise Fail("Забагато спроб входу. Зачекайте 10 хвилин.", 429)
    hits.append(now)
    _attempts[key] = hits


# ---------------------------------------------------------------- вхід
@routes.get("/api/health")
async def health(request):
    return web.json_response({"ok": True, "discord": bool(core.guild()), "time": now_ms()})


@routes.get("/api/relay-key")
async def relay_key(request):
    import tunnel
    return web.json_response({"key": tunnel.public_key_b64()})


@routes.get("/api/meta")
async def meta(request):
    c = await core.coef()
    return web.json_response({
        "ranks": [{"n": n, "g": g, "days": d} for n, g, d in RANKS],
        "depts": {k: {"s": v["s"], "n": v["n"], "color": f"#{v['color']:06x}"} for k, v in DEPTS.items()},
        "opsDepts": OPS_DEPTS,
        "acts": {k: {"n": v[0], "p": c[k], "d": v[2], "art": v[3]} for k, v in ACTS.items()},
        "rapTypes": RAP_TYPES,
    })


@routes.post("/api/login")
async def login(request):
    b = await body(request)
    sid = str(b.get("sid", "")).strip()
    limit_login(f"{request.remote}:{sid}")
    u = await db.one("SELECT * FROM users WHERE sid=?", int(sid)) if sid.isdigit() else None
    if not u or not core.check_password(str(b.get("password", "")), u["pw_hash"]):
        raise Fail("Невірний номер жетона або код доступу.", 401)
    a = await core.access(u, fresh=True)
    if not a["ok"]:
        raise Fail(f"Вхід відхилено: {a['why']}.", 403)
    token = await core.new_session(u["sid"])
    return web.json_response({"token": token, "me": public_user(u), "multi": a.get("multi", False)})


@routes.post("/api/logout")
async def logout(request):
    t = token_of(request)
    if t:
        await core.end_session(t)
    return web.json_response({"ok": True})


@routes.get("/api/me")
async def me(request):
    u = await auth(request)
    return web.json_response({
        "me": public_user(u),
        "points": await core.week_points(u["sid"]), "pointsPrev": await core.week_points(u["sid"], 1),
        "promo": await core.promo_check(u),
        "allowedActs": [k for k in ACTS if core.act_allowed(u, k)],
        "pending": {
            "acts": len([a for a in await db.all("SELECT * FROM acts WHERE status='wait'") if core.can_approve_act(u, a)]),
            "raps": len([r for r in await db.all("SELECT * FROM raps WHERE status='wait'") if core.can_approve_rap(u, r)]),
            "hr": await hr_pending(u),
            "cases": await cases.pending(u),
            "disc": await disc_pending(u),
            "exams": (await db.one("SELECT COUNT(*) AS n FROM attempts WHERE status='submitted'"))["n"] if library.is_examiner(u) else 0,
            "orders": (await db.one("SELECT COUNT(*) AS n FROM orders WHERE status='draft'"))["n"] if orders.can_sign(u) else 0,
            "callsign": await callsigns.pending(u),
            "fin": await finance.pending(u) if finance.can_view(u) else 0,
        },
        "fin": finance.rights(u),
        "callsign": {"eligible": callsigns.eligible(u), "current": u.get("callsign")},
        "hr": hr_rights(u),
        "cases": cases.rights(u),
        "control": depts.control_depts(u),
        "admin": core.is_admin(u), "curator": bool(u.get("curator_ro")),
        "kb": {"sync": u["rank"] >= ov.P("kb_sync"), "lib": library.can_edit_lib(u), "exam": library.is_examiner(u)},
        "appoint": {"prepare": orders.can_prepare(u), "sign": orders.can_sign(u)} if orders.can_prepare(u) else None,
        "disc": {"active": len(await discipline.active_blocking(u["sid"])), "journal": discipline.can_journal(u), "vvb": discipline.is_vvb(u)},
        "bonus": {"manage": bonus.can_manage(u) or bool(u.get("curator")), "finalize": bonus.can_finalize(u)},
        "gameBadges": await games.badges(u["sid"]),
    })


@routes.get("/api/fin")
async def fin_list(request):
    u = await auth(request)
    return web.json_response({"docs": await finance.listing(u), "rights": finance.rights(u), "purposes": finance.PURPOSES})


@routes.get("/api/fin/{id}")
async def fin_one(request):
    u = await auth(request)
    if not finance.can_view(u):
        raise Fail("Немає доступу.", 403)
    return web.json_response(await finance.get(int(request.match_info["id"])))


@routes.post("/api/fin")
async def fin_save(request):
    u = await auth(request)
    return web.json_response(await finance.save(u, await body(request)))


@routes.post("/api/fin/{id}/{action}")
async def fin_act(request):
    u = await auth(request)
    return web.json_response(await finance.act(u, int(request.match_info["id"]), request.match_info["action"], await body(request)))


@routes.get("/api/protocols")
async def prot_list(request):
    u = await auth(request)
    return web.json_response({"items": await protocols.listing(u), "rights": protocols.rights(u), "people": await protocols.people(),
                              "basis": protocols.BASIS, "force": protocols.FORCE, "decision": protocols.DECISION})


@routes.get("/api/protocols/{id}")
async def prot_one(request):
    u = await auth(request)
    return web.json_response(await protocols.get(int(request.match_info["id"]), u))


@routes.post("/api/protocols")
async def prot_save(request):
    u = await auth(request)
    return web.json_response(await protocols.save(u, await body(request)))


@routes.post("/api/protocols/{id}/{action}")
async def prot_act(request):
    u = await auth(request)
    return web.json_response(await protocols.act(u, int(request.match_info["id"]), request.match_info["action"], await body(request)))


# ---------------------------------------------------------------- тренажер «Штурм»: рейтинг (на бали підвищення й премії не впливає)
async def _game_board(game: str, since: int = 0) -> list[dict]:
    rows = await db.all("SELECT sid, SUM(best) AS score FROM (SELECT sid, level, MAX(score) AS best FROM game_scores WHERE game=? AND t>=? GROUP BY sid, level) "
                        "GROUP BY sid ORDER BY score DESC LIMIT 10", game, since)
    people = await people_map([r["sid"] for r in rows])
    return [{"sid": r["sid"], "score": r["score"], "name": (people.get(r["sid"]) or {}).get("name", f"№{r['sid']}")} for r in rows]


@routes.get("/api/game/people")
async def game_people(request):
    return web.json_response(await games.people(await auth(request)))


@routes.get("/api/game/{game}")
async def game_board(request):
    return web.json_response(await games.board(await auth(request)))


@routes.post("/api/game/score")
async def game_score(request):
    u = await auth(request)
    return web.json_response(await games.save(u, await body(request)))


@routes.get("/api/callsign")
async def callsign_home(request):
    return web.json_response(await callsigns.home(await auth(request)))


@routes.post("/api/callsign")
async def callsign_request(request):
    u = await auth(request)
    return web.json_response(await callsigns.request(u, (await body(request)).get("callsign")), status=201)


@routes.post("/api/callsign/{id}/withdraw")
async def callsign_withdraw(request):
    u = await auth(request)
    await callsigns.withdraw(u, int(request.match_info["id"]))
    return web.json_response({"ok": True})


@routes.post("/api/callsign/{id}/decide")
async def callsign_decide(request):
    u = await auth(request)
    b = await body(request)
    return web.json_response(await callsigns.decide(u, int(request.match_info["id"]), b.get("decision") == "ok", str(b.get("note") or "")))


@routes.get("/api/me/verify")
async def me_verify(request):
    """Звірка службового посвідчення з Discord: свіжі ролі, звання, відділ, нікнейм (нікнейм за потреби виправляється)."""
    u = await auth(request)
    if u.get("curator") or u["dept"] == "prosecutor":
        return web.json_response({"ok": True, "items": [], "t": now_ms(), "changed": False})
    before = (u["rank"], u["dept"])
    m = await core.member_of(u["discord_id"], fresh=True) if u["discord_id"] else None
    roles = {r.id for r in m.roles} if m else set()
    core._roles_cache[str(u["discord_id"])] = (time.time(), roles if m else None)
    a = await core.apply_roles(u, roles) if m else {"ok": False}
    nick_ok = bool(m) and m.nick == nickname(u["rank"], u["name"], u["sid"], u["dept"], u.get("callsign"))
    if m and not nick_ok:
        nick_ok = await core.set_nick(u, m)
    rank_roles = [i + 1 for i, rid in enumerate(RANK_ROLES) if rid in roles]
    depts_in = [DEPTS[d]["s"] for d in OPS_DEPTS if DEPTS[d]["role"] in roles] + (["Прес-служба"] if PRESS_ROLE in roles else [])
    items = [
        {"t": "Учасник Discord-сервера СБУ", "ok": bool(m)},
        {"t": "Основна роль СБУ", "ok": SBU_ROLE in roles},
        {"t": f"Роль звання: {rank_name(max(rank_roles))}" if rank_roles else "Роль звання відсутня", "ok": bool(rank_roles) and max(rank_roles) == u["rank"]},
        {"t": f"Роль підрозділу: {', '.join(depts_in)}" if depts_in else (f"Підрозділ: {DEPTS[u['dept']]['n']} (за званням)" if u["dept"] in ("academy", "lead") else "Роль підрозділу відсутня"),
         "ok": bool(depts_in) or u["dept"] in ("academy", "lead")},
        {"t": "Службовий нікнейм" + (f": {m.nick or m.display_name}" if m else ""), "ok": nick_ok, "soft": True},
    ]
    return web.json_response({"ok": all(i["ok"] for i in items if not i.get("soft")), "items": items, "t": now_ms(),
                              "changed": (u["rank"], u["dept"]) != before, "why": None if a.get("ok") else a.get("why")})


# ---------------------------------------------------------------- звіти
def act_out(a: dict, people: dict) -> dict:
    return {**{k: a[k] for k in ("id", "type", "qty", "t", "subj", "evidence", "note", "status", "reviewed", "dept")},
            "arts": json.loads(a["arts"] or "[]"), "files": json.loads(a["files"] or "[]"),
            "by": people.get(a["by_sid"]), "reviewer": people.get(a["reviewer"])}


@routes.get("/api/acts")
async def acts_list(request):
    u = await auth(request)
    if request.query.get("scope") == "review":
        rows = [a for a in await db.all("SELECT * FROM acts WHERE status='wait' ORDER BY t") if core.can_approve_act(u, a)]
    elif request.query.get("scope") == "journal":  # журнал звітів підрозділів для керівників
        rows = [a for a in await db.all("SELECT * FROM acts WHERE status!='deleted' ORDER BY t DESC LIMIT 600") if a["by_sid"] != u["sid"] and core.can_view_act(u, a)][:200]
    else:
        rows = await db.all("SELECT * FROM acts WHERE by_sid=? AND status!='deleted' ORDER BY t DESC LIMIT 200", u["sid"])
    people = await people_map([r["by_sid"] for r in rows] + [r["reviewer"] for r in rows])
    return web.json_response([act_out(r, people) for r in rows])


@routes.get("/api/acts/{id}")
async def acts_one(request):
    u = await auth(request)
    a = await db.one("SELECT * FROM acts WHERE id=? AND status!='deleted'", int(request.match_info["id"]))
    if not a or not core.can_view_act(u, a):
        raise Fail("Звіт не знайдено або немає допуску.", 404)
    out = act_out(a, await people_map([a["by_sid"], a["reviewer"]]))
    return web.json_response({**out, "canDecide": core.can_approve_act(u, a), "mine": a["by_sid"] == u["sid"]})


@routes.post("/api/acts")
async def acts_create(request):
    u = await auth(request)
    row = await core.create_act(u, await body(request))
    return web.json_response(act_out(row, await people_map([u["sid"]])), status=201)


@routes.post("/api/acts/{id}/decision")
async def acts_decide(request):
    u = await auth(request)
    row = await core.decide_act(u, int(request.match_info["id"]), (await body(request)).get("decision"))
    return web.json_response(act_out(row, await people_map([row["by_sid"], row["reviewer"]])))


# ---------------------------------------------------------------- рапорти
def rap_out(r: dict, people: dict) -> dict:
    return {**{k: r[k] for k in ("id", "type", "t", "status", "reviewed", "dept")}, "data": json.loads(r["data"] or "{}"),
            "by": people.get(r["by_sid"]), "reviewer": people.get(r["reviewer"])}


@routes.get("/api/raps")
async def raps_list(request):
    u = await auth(request)
    if request.query.get("scope") == "review":
        # на розгляд: що можу погодити зараз + переведення / розподіл мого відділу, які чекають іншу сторону (обидва начальники бачать рапорт)
        rows = []
        for r in await db.all("SELECT * FROM raps WHERE status='wait' ORDER BY t"):
            mine = r["type"] in core.STAGES and r["by_sid"] != u["sid"] and (core.lead_of(u, r["dept"]) or core.lead_of(u, json.loads(r["data"] or "{}").get("to")))
            if core.can_approve_rap(u, r) or mine:
                rows.append(r)
    else:
        rows = await db.all("SELECT * FROM raps WHERE by_sid=? AND status!='deleted' ORDER BY t DESC LIMIT 100", u["sid"])
    people = await people_map([r["by_sid"] for r in rows] + [r["reviewer"] for r in rows])
    return web.json_response([{**rap_out(r, people), "canDecide": core.can_approve_rap(u, r),
                               "stageLabel": core.transfer_label(r, json.loads(r["data"] or "{}").get("stage", "from")) if r["type"] in core.STAGES and r["status"] == "wait" else None}
                              for r in rows])


@routes.post("/api/raps")
async def raps_create(request):
    u = await auth(request)
    row = await core.create_rap(u, await body(request))
    return web.json_response(rap_out(row, await people_map([u["sid"]])), status=201)


@routes.get("/api/raps/{id}")
async def raps_get(request):
    """Повний текст рапорту для перегляду: автор, той, хто розглядає, ВКПП і керівництво."""
    u = await auth(request)
    r = await db.one("SELECT * FROM raps WHERE id=?", int(request.match_info["id"]))
    if not r or r["status"] == "deleted":
        raise Fail("Рапорт не знайдено.", 404)
    if not (r["by_sid"] == u["sid"] or core.can_approve_rap(u, r) or u["rank"] >= 13 or core.has_dept_role(u, "vkpp")
            or core.lead_of(u, r["dept"]) or core.lead_of(u, json.loads(r["data"] or "{}").get("to"))):
        raise Fail("Немає доступу до цього рапорту.", 403)
    data = json.loads(r["data"] or "{}")
    out = rap_out(r, await people_map([r["by_sid"], r["reviewer"]]))
    return web.json_response({**out, "text": core.rap_text(r, data), "canDecide": core.can_approve_rap(u, r), "mine": r["by_sid"] == u["sid"],
                              "stageLabel": core.transfer_label(r, data.get("stage", "from")) if r["type"] in core.STAGES and r["status"] == "wait" else None})


@routes.post("/api/raps/{id}/decision")
async def raps_decide(request):
    u = await auth(request)
    row = await core.decide_rap(u, int(request.match_info["id"]), (await body(request)).get("decision"))
    return web.json_response(rap_out(row, await people_map([row["by_sid"], row["reviewer"]])))


# ---------------------------------------------------------------- склад і аудит
@routes.get("/api/staff")
async def staff(request):
    u = await auth(request)
    if u["rank"] < 8:
        raise Fail("Недостатній рівень допуску.", 403)
    rows = await db.all("SELECT * FROM users WHERE status NOT IN ('dismissed','removed') AND dept!='curator' ORDER BY rank DESC, sid")
    if _structure_cache[1] is not None:  # картки звіряються з Discord у build_structure: беремо свіжі звання й лише чинний склад
        live = {x["sid"]: x for x in _structure_cache[1]}
        rows = [{**r, "rank": live[r["sid"]]["rank"], "dept": live[r["sid"]]["dept"]} for r in rows if r["sid"] in live]
    if u["dept"] != "lead" and not u.get("curator"):
        rows = [r for r in rows if r["dept"] == u["dept"]]
    out = []
    for r in rows:
        out.append({**public_user(r), "points": await core.week_points(r["sid"])})
    return web.json_response(out)


# ---------------------------------------------------------------- кейс-файли
async def case_people(rows: list[dict]) -> dict:
    return await people_map([c["author"] for c in rows])


@routes.get("/api/cases")
async def cases_list(request):
    u = await auth(request)
    rows = await cases.visible(u)
    people = await case_people(rows)
    return web.json_response([{**cases.out(c, u), "authorUser": people.get(c["author"]), "history": c["history"][-1:]} for c in rows])


@routes.get("/api/cases/{id}")
async def cases_get(request):
    u = await auth(request)
    c = await cases.get(int(request.match_info["id"]))
    if not cases.can_view(u, c):
        raise Fail("Немає доступу до цього кейс-файлу.", 403)
    return web.json_response({**cases.out(c, u), "authorUser": (await case_people([c])).get(c["author"])})


@routes.post("/api/cases")
async def cases_create(request):
    u = await auth(request)
    c = await cases.create(u, await body(request))
    return web.json_response({**cases.out(c, u), "authorUser": public_user(u)}, status=201)


@routes.post("/api/cases/{id}")
async def cases_update(request):
    u = await auth(request)
    c = await cases.update(u, int(request.match_info["id"]), await body(request))
    return web.json_response({**cases.out(c, u), "authorUser": public_user(u)})


@routes.post("/api/cases/{id}/submit")
async def cases_submit(request):
    u = await auth(request)
    c = await cases.submit(u, int(request.match_info["id"]))
    return web.json_response(cases.out(c, u))


@routes.post("/api/cases/{id}/withdraw")
async def cases_withdraw(request):
    u = await auth(request)
    return web.json_response(cases.out(await cases.withdraw(u, int(request.match_info["id"])), u))


@routes.post("/api/acts/{id}/withdraw")
async def acts_withdraw(request):
    u = await auth(request)
    row = await core.withdraw(u, "act", int(request.match_info["id"]))
    return web.json_response(act_out(row, await people_map([row["by_sid"]])))


@routes.post("/api/raps/{id}/withdraw")
async def raps_withdraw(request):
    u = await auth(request)
    row = await core.withdraw(u, "rap", int(request.match_info["id"]))
    return web.json_response(rap_out(row, await people_map([row["by_sid"]])))


# ---------------------------------------------------------------- видалення (усе, що створюється, можна видалити)
@routes.post("/api/acts/{id}/delete")
async def acts_delete(request):
    u = await auth(request)
    await core.delete_doc(u, "act", int(request.match_info["id"]))
    return web.json_response({"ok": True})


@routes.post("/api/raps/{id}/delete")
async def raps_delete(request):
    u = await auth(request)
    await core.delete_doc(u, "rap", int(request.match_info["id"]))
    return web.json_response({"ok": True})


@routes.post("/api/cases/{id}/delete")
async def cases_delete(request):
    u = await auth(request)
    await cases.delete(u, int(request.match_info["id"]))
    return web.json_response({"ok": True})


@routes.post("/api/bonus/{id}/delete")
async def bonus_delete(request):
    u = await auth(request)
    await bonus.delete(u, int(request.match_info["id"]))
    return web.json_response({"ok": True})


@routes.post("/api/hr/cand/{id}/delete")
async def hr_cand_delete(request):
    u = await auth(request)
    r = hr_rights(u)
    if not (r["vvb"] or r["vkpp"]):
        raise Fail("Видаляти анкети може ВВБ, ВКПП або керівництво.", 403)
    await candidates.delete(u, int(request.match_info["id"]))
    return web.json_response({"ok": True})


@routes.post("/api/hr/access/{id}/delete")
async def hr_access_delete(request):
    u = await auth(request)
    if not hr_rights(u)["vkpp"]:
        raise Fail("Видаляти заявки на допуск може ВКПП або керівництво.", 403)
    await core.delete_access(u, int(request.match_info["id"]))
    return web.json_response({"ok": True})


@routes.post("/api/files/{id}/delete")
async def files_delete(request):
    u = await auth(request)
    await core.delete_file(u, request.match_info["id"])
    return web.json_response({"ok": True})


@routes.post("/api/cases/{id}/decision")
async def cases_decide(request):
    u = await auth(request)
    b = await body(request)
    c = await cases.decide(u, int(request.match_info["id"]), b.get("decision"), str(b.get("note") or ""))
    return web.json_response(cases.out(c, u))


@routes.post("/api/cases/{id}/archive")
async def cases_archive(request):
    """Затверджений кейс-файл у Discord: PDF бланка (сформований сайтом) у полі pdf."""
    u = await auth(request)
    reader = await request.multipart()
    pdf = bytearray()
    while (part := await reader.next()) is not None:
        if part.name == "pdf":
            while chunk := await part.read_chunk(64 * 1024):
                pdf.extend(chunk)
                if len(pdf) > config.MAX_UPLOAD_MB * 1024 * 1024:
                    raise Fail(f"PDF більший за {config.MAX_UPLOAD_MB:g} МБ.", 413)
    c = await cases.archive(u, int(request.match_info["id"]), bytes(pdf))
    return web.json_response(cases.out(c, u))


@routes.get("/api/dept")
async def dept_overview(request):
    u = await auth(request)
    allowed = depts.control_depts(u)
    if not allowed:
        raise Fail("Розділ відділу доступний начальникам відділів, Заступнику Голови та Голові СБУ.", 403)
    d = request.query.get("d") or (u["dept"] if u["dept"] in allowed else allowed[0])
    return web.json_response({"allowed": allowed, **await depts.overview(u, d)})


# ---------------------------------------------------------------- премії
@routes.get("/api/bonus")
async def bonus_home(request):
    u = await auth(request)
    out = {"mine": await bonus.mine(u)}
    if bonus.can_manage(u) or u.get("curator"):
        rows = await db.all("SELECT * FROM bonuses ORDER BY week DESC LIMIT 20")
        out["list"] = [{k: s[k] for k in ("id", "week", "status", "updated")} | {"label": bonus.week_label(s["week"]),
                        "total": sum(r["amount"] for r in json.loads(s["rows"] or "[]")),
                        "count": len([r for r in json.loads(s["rows"] or "[]") if r["amount"] > 0])} for s in rows]
        out["cfg"] = await bonus.cfg()
        # підказка: хто вже набрав поріг цього тижня (рахуються лише підтверджені звіти)
        cur = await bonus.calc_rows(core.week_start(0), out["cfg"])
        out["now"] = {"active": len([r for r in cur if r["pts"] > 0]), "reached": len([r for r in cur if r["auto"] > 0]),
                      "best": max([r["pts"] for r in cur] or [0]), "total": sum(r["amount"] for r in cur),
                      "wait": (await db.one("SELECT COUNT(*) AS n FROM acts WHERE status='wait' AND t>=?", core.week_start(0)))["n"]}
    return web.json_response(out)


@routes.get("/api/bonus/{id}")
async def bonus_get(request):
    u = await auth(request)
    if not bonus.can_manage(u):
        raise Fail("Відомості премій доступні Голові СБУ та Заступнику.", 403)
    s = await bonus.get(int(request.match_info["id"]))
    return web.json_response({**s, "report": bonus.report_text(s)})


@routes.post("/api/bonus")
async def bonus_create(request):
    u = await auth(request)
    s = await bonus.create(u, int((await body(request)).get("offset") or 0))
    return web.json_response({**s, "report": bonus.report_text(s)}, status=201)


@routes.post("/api/bonus/cfg")
async def bonus_cfg(request):
    u = await auth(request)
    return web.json_response(await bonus.save_cfg(u, await body(request)))


@routes.post("/api/bonus/{id}")
async def bonus_update(request):
    u = await auth(request)
    s = await bonus.update(u, int(request.match_info["id"]), await body(request))
    return web.json_response({**s, "report": bonus.report_text(s)})


@routes.post("/api/bonus/{id}/recalc")
async def bonus_recalc(request):
    u = await auth(request)
    s = await bonus.recalc(u, int(request.match_info["id"]))
    return web.json_response({**s, "report": bonus.report_text(s)})


@routes.post("/api/bonus/{id}/status")
async def bonus_status(request):
    u = await auth(request)
    s = await bonus.move(u, int(request.match_info["id"]), (await body(request)).get("to"))
    return web.json_response({**s, "report": bonus.report_text(s)})


# ---------------------------------------------------------------- дисципліна
async def disc_pending(u: dict) -> int:
    n = 0
    if u["rank"] == 15:
        rows = await db.all("SELECT appeal FROM discipline WHERE status='active' AND appeal IS NOT NULL")
        n += len([r for r in rows if not json.loads(r["appeal"]).get("decision")])
    if u["rank"] >= 14:
        n += (await db.one("SELECT COUNT(*) AS n FROM inspections WHERE status='sent'"))["n"]
    return n


@routes.get("/api/discipline")
async def disc_list(request):
    u = await auth(request)
    return web.json_response(await discipline.listing(u))


@routes.post("/api/discipline")
async def disc_issue(request):
    u = await auth(request)
    o = await discipline.issue(u, await body(request))
    return web.json_response({"id": o["id"]}, status=201)


@routes.post("/api/discipline/{id}/appeal")
async def disc_appeal(request):
    u = await auth(request)
    await discipline.appeal(u, int(request.match_info["id"]), (await body(request)).get("text"))
    return web.json_response({"ok": True})


@routes.post("/api/discipline/{id}/decide")
async def disc_decide(request):
    u = await auth(request)
    b = await body(request)
    await discipline.decide(u, int(request.match_info["id"]), b.get("action"), str(b.get("note") or ""))
    return web.json_response({"ok": True})


@routes.post("/api/discipline/{id}/delete")
async def disc_delete(request):
    u = await auth(request)
    await discipline.delete(u, int(request.match_info["id"]))
    return web.json_response({"ok": True})


@routes.post("/api/inspections")
async def insp_create(request):
    u = await auth(request)
    i = await discipline.insp_save(u, await body(request))
    return web.json_response({"id": i["id"]}, status=201)


@routes.post("/api/inspections/{id}")
async def insp_update(request):
    u = await auth(request)
    i = await discipline.insp_save(u, await body(request), int(request.match_info["id"]))
    return web.json_response({"id": i["id"]})


@routes.post("/api/inspections/{id}/move")
async def insp_move(request):
    u = await auth(request)
    await discipline.insp_move(u, int(request.match_info["id"]), (await body(request)).get("to"))
    return web.json_response({"ok": True})


# ---------------------------------------------------------------- документи в Discord: теги й картинка аркуша А4
# хто може надіслати картинку аркуша для документа цього виду (бачить і веде такі документи)
DOC_IMAGE_RIGHTS = {
    "np": lambda u: orders.can_prepare(u),
    "ng": lambda u: orders.can_sign(u),
}


@routes.get("/api/doc/tags")
async def doc_tags(request):
    """Кого можна тегнути в Discord: відділи й ролі (поле «Тегнути» у формах документів)."""
    await auth(request)
    return web.json_response(docpost.tag_options())


@routes.post("/api/doc/{kind}/{id}/image")
async def doc_image(request):
    """Картинка аркуша А4, сформована сайтом після створення чи зміни документа, — у його картку в Discord."""
    u = await auth(request)
    kind = request.match_info["kind"]
    if kind not in DOC_IMAGE_RIGHTS or not DOC_IMAGE_RIGHTS[kind](u):
        raise Fail("Немає доступу до цього документа.", 403)
    reader = await request.multipart()
    data = bytearray()
    while (part := await reader.next()) is not None:
        if part.name == "img":
            while chunk := await part.read_chunk(64 * 1024):
                data.extend(chunk)
                if len(data) > 9 * 1024 * 1024:
                    raise Fail("Картинка документа завелика.", 413)
    ok = await docpost.set_image(kind, int(request.match_info["id"]), bytes(data), f"{kind}-{request.match_info['id']}")
    return web.json_response({"ok": ok})


# ---------------------------------------------------------------- накази про призначення
@routes.get("/api/orders")
async def orders_list(request):
    u = await auth(request)
    if not orders.can_appoint(u):
        raise Fail("Накази про призначення доступні ВКПП, Голові СБУ та заступнику.", 403)
    return web.json_response(await orders.listing())


@routes.post("/api/orders")
async def orders_create(request):
    u = await auth(request)
    o = await orders.appoint(u, await body(request))
    _structure_cache[0] = 0  # схема оновиться з новим званням
    return web.json_response({"id": o["id"]}, status=201)


@routes.get("/api/orders/free")
async def orders_free_list(request):
    await auth(request)
    return web.json_response(await orders.listing_free())


@routes.post("/api/orders/free")
async def orders_free_create(request):
    u = await auth(request)
    o = await orders.create_free(u, await body(request))
    return web.json_response({"id": o["id"]}, status=201)


@routes.post("/api/orders/free/{id}/delete")
async def orders_free_delete(request):
    u = await auth(request)
    await orders.delete_free(u, int(request.match_info["id"]))
    return web.json_response({"ok": True})


@routes.post("/api/orders/{id}/sign")
async def orders_sign(request):
    u = await auth(request)
    await orders.sign(u, int(request.match_info["id"]))
    _structure_cache[0] = 0
    return web.json_response({"ok": True})


@routes.post("/api/orders/{id}/reject")
async def orders_reject(request):
    u = await auth(request)
    await orders.reject(u, int(request.match_info["id"]), str((await body(request)).get("note") or ""))
    return web.json_response({"ok": True})


@routes.post("/api/orders/{id}/delete")
async def orders_delete(request):
    u = await auth(request)
    await orders.delete_draft(u, int(request.match_info["id"]))
    return web.json_response({"ok": True})


@routes.post("/api/orders/{id}/cancel")
async def orders_cancel(request):
    u = await auth(request)
    r = await orders.cancel(u, int(request.match_info["id"]))
    _structure_cache[0] = 0
    return web.json_response(r)


# ---------------------------------------------------------------- база даних: законодавство, бібліотека, іспити
async def kb_auth(request) -> dict:
    u = await auth(request)
    if u["dept"] == "prosecutor":
        raise Fail("База даних доступна особовому складу СБУ.", 403)
    return u


@routes.get("/api/kb")
async def kb_index(request):
    u = await kb_auth(request)
    rows = await db.all("SELECT slug, title, section, grp, grp_title, faction, faction_abbr, sbu, short, updated, length(text) AS size FROM kb_docs ORDER BY section, grp, title")
    return web.json_response({"docs": rows, "checked": await db.get_setting("kb_checked", None), "syncing": kb._sync_lock.locked(),
                              "canSync": u["rank"] >= ov.P("kb_sync"), "ai": bool(config.AI_KEY),
                              "changes": (await db.one("SELECT COUNT(*) AS n FROM kb_changes"))["n"]})


@routes.get("/api/kb/doc/{slug}")
async def kb_doc(request):
    await kb_auth(request)
    d = await db.one("SELECT slug, title, grp_title, faction_abbr, sbu, html, toc, updated, checked FROM kb_docs WHERE slug=?", request.match_info["slug"])
    if not d:
        raise Fail("Документ не знайдено.", 404)
    d["toc"] = json.loads(d["toc"] or "[]")
    return web.json_response(d)


@routes.get("/api/kb/search")
async def kb_search(request):
    await kb_auth(request)
    return web.json_response(await kb.search(request.query.get("q", ""), request.query.get("sbu") == "1"))


@routes.get("/api/kb/changes")
async def kb_changes(request):
    await kb_auth(request)
    return web.json_response(await db.all("SELECT * FROM kb_changes ORDER BY id DESC LIMIT 100"))


@routes.post("/api/kb/sync")
async def kb_sync(request):
    u = await kb_auth(request)
    if u["rank"] != 15:
        raise Fail("Оновлювати законодавчу базу може лише Голова СБУ.", 403)
    if kb._sync_lock.locked():
        raise Fail("Оновлення вже триває.", 409)

    async def run():
        try:
            await db.set_setting("kb_last", await kb.sync(u))
        except Exception as e:
            await db.set_setting("kb_last", {"error": str(e)})
    asyncio.create_task(run())
    return web.json_response({"started": True})


@routes.get("/api/kb/sync")
async def kb_sync_state(request):
    await kb_auth(request)
    return web.json_response({"syncing": kb._sync_lock.locked(), "last": await db.get_setting("kb_last", None)})


@routes.get("/api/lib")
async def lib_list(request):
    await kb_auth(request)
    return web.json_response({"items": await library.lib_list(), "cats": library.CATS})


@routes.get("/api/lib/{id}")
async def lib_get(request):
    await kb_auth(request)
    return web.json_response(await library.lib_get(int(request.match_info["id"])))


@routes.post("/api/lib")
async def lib_create(request):
    u = await kb_auth(request)
    return web.json_response(await library.lib_save(u, await body(request)), status=201)


@routes.post("/api/lib/{id}")
async def lib_update(request):
    u = await kb_auth(request)
    return web.json_response(await library.lib_save(u, await body(request), int(request.match_info["id"])))


@routes.post("/api/lib/{id}/delete")
async def lib_delete(request):
    u = await kb_auth(request)
    await library.lib_delete(u, int(request.match_info["id"]))
    return web.json_response({"ok": True})


@routes.get("/api/exams")
async def exams_home(request):
    u = await kb_auth(request)
    return web.json_response(await library.overview(u))


@routes.get("/api/exams/{id}")
async def exams_get(request):
    u = await kb_auth(request)
    if not library.is_examiner(u):
        raise Fail("Повний іспит із відповідями доступний ВКПП.", 403)
    return web.json_response(await library.exam_get(int(request.match_info["id"])))


@routes.post("/api/exams")
async def exams_create(request):
    u = await kb_auth(request)
    return web.json_response(await library.exam_save(u, await body(request)), status=201)


@routes.post("/api/exams/{id}")
async def exams_update(request):
    u = await kb_auth(request)
    return web.json_response(await library.exam_save(u, await body(request), int(request.match_info["id"])))


@routes.post("/api/exams/{id}/delete")
async def exams_delete(request):
    u = await kb_auth(request)
    await library.exam_delete(u, int(request.match_info["id"]))
    return web.json_response({"ok": True})


@routes.post("/api/exams/{id}/start")
async def exams_start(request):
    u = await kb_auth(request)
    return web.json_response(await library.start(u, int(request.match_info["id"])))


@routes.post("/api/exams/{id}/submit")
async def exams_submit(request):
    u = await kb_auth(request)
    return web.json_response(await library.submit(u, int(request.match_info["id"]), (await body(request)).get("answers") or {}))


@routes.post("/api/attempts/{id}/grade")
async def attempts_grade(request):
    u = await kb_auth(request)
    b = await body(request)
    return web.json_response(await library.grade(u, int(request.match_info["id"]), b.get("points") or {}, str(b.get("note") or "")))


@routes.post("/api/attempts/{id}/delete")
async def attempts_delete(request):
    u = await kb_auth(request)
    await library.attempt_delete(u, int(request.match_info["id"]))
    return web.json_response({"ok": True})


_structure_cache: list = [0.0, None]
_structure_lock = asyncio.Lock()
_gone: dict[int, float] = {}  # Static ID → коли вперше не знайдено на сервері


async def build_structure() -> list:
    """Увесь чинний склад з ролями прес-служби й відділів (ролі тягнемо з Discord, тому результат кешується)."""
    async with _structure_lock:  # одночасні побудови дублювали б записи синхронізації в аудиті
        return await _build_structure()


async def _build_structure() -> list:
    if not core.guild():
        raise Fail("Бот ще не підключився до Discord. Спробуйте за хвилину.", 503)
    rows = await db.all("SELECT * FROM users WHERE status NOT IN ('dismissed','removed') AND dept!='curator' ORDER BY rank DESC, sid")

    gate = asyncio.Semaphore(2)  # не більше 2 запитів до Discord одночасно — інакше ліміти (429) гальмують увесь сайт

    async def roles(r):
        try:
            if not r["discord_id"]:
                return False
            async with gate:
                fresh = core._roles_cache.get(str(r["discord_id"]))
                roles = await core.member_roles(r["discord_id"])  # кеш 60 с, інакше — свіжі ролі з Discord
                if not fresh or time.time() - fresh[0] >= 60:
                    await asyncio.sleep(0.35)  # рівномірно, щоб не впертися в ліміт Discord (429)
                return roles
        except Exception:
            return False  # Discord не відповів — лишаємо дані картки як є
    all_roles = await asyncio.gather(*(roles(r) for r in rows))
    out = []
    now = time.time()
    for r, rs in zip(rows, all_roles):
        if rs is None and r["discord_id"]:
            # немає на сервері: видаляємо, якщо це підтвердилось двічі з інтервалом ≥ 10 хв (захист від збою Discord)
            first = _gone.setdefault(r["sid"], now)
            if now - first >= 600:
                await core.remove_account(r)
                _gone.pop(r["sid"], None)
            continue
        _gone.pop(r["sid"], None)
        if rs is None or (rs is not False and not core.resolve(rs)["ok"]):
            continue  # вийшов із сервера або зняли ролі СБУ — у структурі не показуємо
        rs = rs or set()
        if rs:
            await core.apply_roles(r, rs)  # звання й відділ — як у Discord, навіть якщо людина не заходила на сайт
        out.append({**public_user(r), "press": PRESS_ROLE in rs, "depts": [d for d in OPS_DEPTS if DEPTS[d]["role"] in rs]})
    out.sort(key=lambda x: (-x["rank"], x["sid"]))
    _structure_cache[:] = [time.time(), out]
    return out


async def structure_loop():
    """Фонове оновлення штатної структури кожні 3 хв (і одразу після змін ролей ботом) — сторінка відкривається миттєво."""
    await asyncio.sleep(20)
    while True:
        try:
            await build_structure()
        except Fail:
            pass  # бот ще не на зв'язку з Discord
        except Exception:
            log.exception("Оновлення штатної структури")
        await asyncio.sleep(180)


@routes.get("/api/structure")
async def structure(request):
    """Штатна структура для схеми ієрархії відділів."""
    await auth(request)
    if _structure_cache[1] is None:
        await build_structure()
    elif time.time() - _structure_cache[0] > 240:
        asyncio.create_task(build_structure())  # віддаємо збережене, оновлюємо у фоні
    return web.json_response(_structure_cache[1])


@routes.get("/api/audit")
async def audit(request):
    u = await auth(request)
    if u["rank"] < ov.P("audit_view") and not hr_rights(u)["vkpp"]:
        raise Fail("Недостатній рівень допуску.", 403)
    rows = await db.all("SELECT * FROM audit WHERE action NOT LIKE '⚙%' ORDER BY id DESC LIMIT 200")  # дії адмін-панелі — окремий журнал
    people = await people_map([r["actor"] for r in rows] + [r["target"] for r in rows])
    return web.json_response([{**r, "actorUser": people.get(r["actor"]), "targetUser": people.get(r["target"])} for r in rows])


# ---------------------------------------------------------------- публічна анкета кандидата (без входу)
_cand_hits: dict[str, list[float]] = {}


@routes.post("/api/public/candidate")
async def public_candidate(request):
    ip = request.headers.get("CF-Connecting-IP") or request.headers.get("X-Forwarded-For", "").split(",")[0].strip() or request.remote or "?"
    now = time.time()
    for key, cap in ((ip, 3), ("*", 40)):  # не більше 3 анкет з однієї адреси й 40 загалом за годину
        hits = [t for t in _cand_hits.get(key, []) if now - t < 3600]
        if len(hits) >= cap:
            raise Fail("Забагато анкет. Спробуйте пізніше.", 429)
        _cand_hits[key] = hits
    # multipart: поле data (JSON анкети) і photo (фото персонажа, до 5 МБ)
    # і work (скриншот трудової книжки з гри, до 5 МБ)
    b, imgs = {}, {}
    reader = await request.multipart()
    while (part := await reader.next()) is not None:
        if part.name == "data":
            try:
                b = json.loads(await part.text())
            except ValueError:
                raise Fail("Пошкоджені дані анкети.")
        elif part.name in ("photo", "work"):
            data = bytearray()
            while chunk := await part.read_chunk(64 * 1024):
                data.extend(chunk)
                if len(data) > 5 * 1024 * 1024:
                    raise Fail("Фото більше за 5 МБ." if part.name == "photo" else "Скриншот трудової книжки більший за 5 МБ.", 413)
            imgs[part.name] = (bytes(data), part.filename or part.name)
    cid = await candidates.submit_form(str(b.get("discord") or ""), b, imgs.get("photo"), imgs.get("work"))
    for key in (ip, "*"):
        _cand_hits[key].append(now)
    c = await db.one("SELECT discord_id FROM candidates WHERE id=?", cid)
    return web.json_response({"no": f"АНК-{cid:04d}", "found": bool(c["discord_id"])}, status=201)


# ---------------------------------------------------------------- кадри: анкети кандидатів і заявки на допуск
def hr_rights(u: dict) -> dict:
    return {"vvb": u["rank"] >= 13 or core.has_dept_role(u, "vvb"), "vkpp": u["rank"] >= 14 or core.has_dept_role(u, "vkpp")}


async def hr_pending(u: dict) -> int:
    r = hr_rights(u)
    n = 0
    if r["vvb"]:
        n += (await db.one("SELECT COUNT(*) AS n FROM candidates WHERE status='vvb'"))["n"]
    if r["vkpp"]:
        n += (await db.one("SELECT COUNT(*) AS n FROM candidates WHERE status='vkpp'"))["n"]
        n += (await db.one("SELECT COUNT(*) AS n FROM access_requests WHERE status='wait'"))["n"]
    return n


async def reviewer_member(u: dict):
    m = await core.member_of(u["discord_id"], fresh=True) if u["discord_id"] else None
    if not m:
        raise Fail("Вас немає на Discord-сервері СБУ.", 403)
    return m


async def names(ids) -> dict:
    out = {}
    for i in {i for i in ids if i}:
        u = await db.one("SELECT name FROM users WHERE discord_id=?", i)
        out[i] = u["name"] if u else None
    return out


@routes.get("/api/hr")
async def hr_list(request):
    u = await auth(request)
    r = hr_rights(u)
    if not (r["vvb"] or r["vkpp"]):
        raise Fail("Розділ «Кадри» доступний ВВБ, ВКПП і керівництву.", 403)
    stages = [s for s, ok in (("vvb", r["vvb"]), ("vkpp", r["vkpp"])) if ok]
    cand = await db.all(f"SELECT * FROM candidates WHERE status IN ({','.join('?' * len(stages))}) ORDER BY t", *stages)
    done = await db.all("SELECT * FROM candidates WHERE status IN ('ok','rej') ORDER BY COALESCE(vkpp_t, vvb_t) DESC LIMIT 30")
    acc = await db.all("SELECT * FROM access_requests WHERE status='wait' ORDER BY t") if r["vkpp"] else []
    acc_done = await db.all("SELECT * FROM access_requests WHERE status NOT IN ('wait','deleted') ORDER BY reviewed DESC LIMIT 30") if r["vkpp"] else []
    nm = await names([c["vvb_by"] for c in cand + done] + [c["vkpp_by"] for c in cand + done] + [a["reviewer"] for a in acc_done])
    for c in cand + done:
        c["vvbName"], c["vkppName"] = nm.get(c["vvb_by"]), nm.get(c["vkpp_by"])
        c["extra"] = json.loads(c.get("extra") or "null")
        try:
            c["photoUrl"] = await core.file_url(c["photo"]) if c.get("photo") else None
        except Fail:
            c["photoUrl"] = None
        try:
            c["workUrl"] = await core.file_url(c["extra"]["work"]) if c["extra"] and c["extra"].get("work") else None
        except Fail:
            c["workUrl"] = None
    for a in acc_done:
        a["reviewerName"] = nm.get(a["reviewer"])
    return web.json_response({"rights": r, "cand": cand, "candDone": done, "access": acc, "accessDone": acc_done})


@routes.post("/api/hr/cand/{id}")
async def hr_cand(request):
    u = await auth(request)
    b = await body(request)
    text = await candidates.decide(int(request.match_info["id"]), await reviewer_member(u), b.get("decision"), (b.get("note") or "").strip())
    return web.json_response({"text": text})


@routes.post("/api/hr/access/{id}")
async def hr_access(request):
    u = await auth(request)
    text = await core.decide_access(int(request.match_info["id"]), await reviewer_member(u), (await body(request)).get("decision"))
    return web.json_response({"text": text})


# ---------------------------------------------------------------- файли
@routes.post("/api/files")
async def files_upload(request):
    u = await auth(request)
    reader = await request.multipart()
    part = await reader.next()
    if part is None or part.name != "file":
        raise Fail("Додайте файл у поле «file».")
    data = bytearray()
    limit = int(config.MAX_UPLOAD_MB * 1024 * 1024)
    while chunk := await part.read_chunk(64 * 1024):
        data.extend(chunk)
        if len(data) > limit:
            raise Fail(f"Файл більший за {config.MAX_UPLOAD_MB:g} МБ.", 413)
    fid = await core.store_file(bytes(data), part.filename or "file", part.headers.get("Content-Type", ""), u["sid"])
    return web.json_response({"id": fid, "url": f"/api/files/{fid}"}, status=201)


@routes.get("/api/files/{id}/url")
async def files_url(request):
    """Свіже посилання Discord на файл (сайт відкриває його без передачі токена в адресі)."""
    await auth(request)
    return web.json_response({"url": await core.file_url(request.match_info["id"])})


@routes.get("/api/files/{id}")
async def files_get(request):
    await auth(request)
    raise web.HTTPFound(await core.file_url(request.match_info["id"]))


# ---------------------------------------------------------------- запуск
async def start() -> web.AppRunner:
    app = web.Application(middlewares=[cors_and_errors], client_max_size=int(config.MAX_UPLOAD_MB * 1024 * 1024) + 65536)
    app.add_routes(routes)
    runner = web.AppRunner(app, access_log=None)
    await runner.setup()
    await web.TCPSite(runner, config.API_HOST, config.API_PORT).start()
    log.info("API слухає %s:%s", config.API_HOST, config.API_PORT)
    await ov.load(db)
    await core.load_custom_acts()
    core.ROLES_CHANGED.append(build_structure)
    asyncio.create_task(finance.reminder_loop())
    asyncio.create_task(games.weekly_loop())
    asyncio.create_task(structure_loop())
    asyncio.create_task(kb.ensure_seeded())
    return runner


# ---------------------------------------------------------------- адмін-панель (Голова СБУ та Куратор)
async def admin_auth(request) -> dict:
    u = await auth(request)
    admin.need(u)
    return u


@routes.get("/api/admin")
async def admin_home(request):
    await admin_auth(request)
    log_rows = await admin.admin_log()
    people = await people_map([r["actor"] for r in log_rows] + [r["target"] for r in log_rows])
    return web.json_response({
        "users": await admin.users(), "roles": admin.roles_report(), "channels": await admin.channels_view(),
        "mentions": admin.mentions_view(), "perms": ov.perms_view(), "system": await admin.system(), "nick": await admin.nick_view(),
        "log": [{**r, "actorUser": people.get(r["actor"]), "targetUser": people.get(r["target"])} for r in log_rows],
        "ranks": [n for n, _, _ in RANKS],
    })


@routes.post("/api/admin/user/{sid}/{act}")
async def admin_user(request):
    u = await admin_auth(request)
    out = await admin.user_action(u, int(request.match_info["sid"]), request.match_info["act"], await body(request))
    asyncio.create_task(build_structure())
    return web.json_response(out)


@routes.post("/api/admin/channels")
async def admin_channels(request):
    u = await admin_auth(request)
    await admin.save_channels(u, await body(request))
    return web.json_response(await admin.channels_view())


@routes.post("/api/admin/mentions")
async def admin_mentions(request):
    u = await admin_auth(request)
    await admin.save_mentions(u, await body(request))
    return web.json_response(admin.mentions_view())


@routes.post("/api/admin/perms")
async def admin_perms(request):
    u = await admin_auth(request)
    await admin.save_perms(u, await body(request))
    return web.json_response(ov.perms_view())


@routes.post("/api/admin/sync")
async def admin_sync(request):
    u = await admin_auth(request)
    s = await build_structure()
    await admin.note(u, "Синхронізація ролей усіх", 0, f"{len(s)} співробітників у штаті")
    return web.json_response({"count": len(s)})


@routes.post("/api/admin/nick")
async def admin_nick(request):
    u = await admin_auth(request)
    await admin.save_nick(u, await body(request))
    return web.json_response(await admin.nick_view())


@routes.post("/api/admin/nick/apply")
async def admin_nick_apply(request):
    u = await admin_auth(request)
    return web.json_response(await admin.apply_all(u))


@routes.post("/api/admin/nick/apply/{sid}")
async def admin_nick_apply_one(request):
    u = await admin_auth(request)
    return web.json_response(await admin.apply_one(u, int(request.match_info["sid"])))


@routes.post("/api/admin/callsign/{sid}")
async def admin_callsign(request):
    u = await admin_auth(request)
    return web.json_response(await callsigns.set_direct(u, int(request.match_info["sid"]), (await body(request)).get("callsign")))


@routes.get("/api/admin/promo")
async def admin_promo(request):
    await admin_auth(request)
    c = await core.coef()
    return web.json_response({"cfg": await promo.cfg(), "ranks": [n for n, _, _ in RANKS],
                              "exams": await db.all("SELECT id, title, status FROM exams WHERE status!='deleted' ORDER BY id"),
                              "acts": [{"key": k, "name": v[0], "default": core.BUILTIN_ACTS[k][1] if k in core.BUILTIN_ACTS else v[1], "value": c[k],
                                        "custom": k not in core.BUILTIN_ACTS, "d": v[2], "art": v[3]}
                                       for k, v in ACTS.items() if k not in core.ACTS_OFF],
                              "actDepts": [{"key": k, "s": DEPTS[k]["s"]} for k in core.ACT_DEPTS]})


@routes.post("/api/admin/acts")
async def admin_acts_save(request):
    """Новий пункт звітів або зміна доданого в панелі: назва, бали, хто подає, чи потрібні статті КК."""
    u = await admin_auth(request)
    b = await body(request)
    name = str(b.get("name") or "").strip()[:60]
    if len(name) < 3:
        raise Fail("Вкажіть назву пункту (від 3 символів).")
    try:
        pts = max(0, min(100, int(float(b.get("points")))))
    except (TypeError, ValueError):
        raise Fail("Вкажіть кількість балів.")
    d = b.get("depts")
    depts = d if d in ("all", "instr") else [x for x in (d or []) if x in core.ACT_DEPTS]
    if not depts:
        raise Fail("Оберіть, хто може подавати такий звіт.")
    custom = await db.get_setting("acts_custom", {})
    key = str(b.get("key") or "")
    if key:
        if key not in custom or custom[key].get("off"):
            raise Fail("Змінювати тут можна лише пункти, додані в панелі.", 404)
    else:
        key = "c" + secrets.token_hex(3)
        if any(v[0].lower() == name.lower() for k, v in ACTS.items() if k not in core.ACTS_OFF):
            raise Fail("Пункт з такою назвою вже є.")
    custom[key] = {"n": name, "p": pts, "d": depts, "art": bool(b.get("art"))}
    await db.set_setting("acts_custom", custom)
    await core.load_custom_acts()
    await db.audit(u["sid"], "⚙ " + ("Змінено пункт звітів" if b.get("key") else "Додано пункт звітів"), 0, f"{name} · {pts} б.")
    return web.json_response({"ok": True, "key": key})


@routes.post("/api/admin/acts/{key}/delete")
async def admin_acts_delete(request):
    """Видалення пункту, доданого в панелі. Якщо за ним уже є звіти — пункт ховається (назва в старих звітах лишається)."""
    u = await admin_auth(request)
    key = request.match_info["key"]
    custom = await db.get_setting("acts_custom", {})
    if key not in custom or custom[key].get("off"):
        raise Fail("Видаляти можна лише пункти, додані в панелі.", 404)
    name = custom[key]["n"]
    used = await db.one("SELECT COUNT(*) AS n FROM acts WHERE type=?", key)
    if used and used["n"]:
        custom[key]["off"] = True
    else:
        del custom[key]
    await db.set_setting("acts_custom", custom)
    await core.load_custom_acts()
    await db.audit(u["sid"], "⚙ Видалено пункт звітів", 0, name)
    return web.json_response({"ok": True})


@routes.post("/api/admin/promo")
async def admin_promo_save(request):
    u = await admin_auth(request)
    b = await body(request)
    await promo.save(u, b.get("cfg") or {})
    if isinstance(b.get("acts"), dict):  # вартість звітів у балах
        clean = {k: max(0, min(100, int(float(v)))) for k, v in b["acts"].items() if k in core.BUILTIN_ACTS and str(v).strip() != ""}
        await db.set_setting("coef", {k: v for k, v in clean.items() if v != ACTS[k][1]})
    return web.json_response({"ok": True})


@routes.post("/api/admin/backup")
async def admin_backup(request):
    u = await admin_auth(request)
    return web.json_response(await admin.make_backup(u))
