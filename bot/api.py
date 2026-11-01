"""HTTP API для сайту (GitHub Pages). Сайт не має своєї бази — усе тут."""
import json
import logging
import time

from aiohttp import web

import candidates
import cases
import config
import core
from core import ACTS, RAP_TYPES, Fail
from db import db, now_ms
from roles import DEPTS, OPS_DEPTS, RANKS, rank_name

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
    return u


async def body(request: web.Request) -> dict:
    try:
        return await request.json()
    except (json.JSONDecodeError, UnicodeDecodeError):
        raise Fail("Некоректний запит.")


def public_user(u: dict) -> dict:
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
        },
        "hr": hr_rights(u),
        "cases": cases.rights(u),
    })


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
    else:
        rows = await db.all("SELECT * FROM acts WHERE by_sid=? ORDER BY t DESC LIMIT 200", u["sid"])
    people = await people_map([r["by_sid"] for r in rows] + [r["reviewer"] for r in rows])
    return web.json_response([act_out(r, people) for r in rows])


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
        rows = [r for r in await db.all("SELECT * FROM raps WHERE status='wait' ORDER BY t") if core.can_approve_rap(u, r)]
    else:
        rows = await db.all("SELECT * FROM raps WHERE by_sid=? ORDER BY t DESC LIMIT 100", u["sid"])
    people = await people_map([r["by_sid"] for r in rows] + [r["reviewer"] for r in rows])
    return web.json_response([rap_out(r, people) for r in rows])


@routes.post("/api/raps")
async def raps_create(request):
    u = await auth(request)
    row = await core.create_rap(u, await body(request))
    return web.json_response(rap_out(row, await people_map([u["sid"]])), status=201)


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
    rows = await db.all("SELECT * FROM users WHERE status!='dismissed' ORDER BY rank DESC, sid")
    if u["dept"] != "lead":
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


@routes.post("/api/cases/{id}/decision")
async def cases_decide(request):
    u = await auth(request)
    b = await body(request)
    c = await cases.decide(u, int(request.match_info["id"]), b.get("decision"), str(b.get("note") or ""))
    return web.json_response(cases.out(c, u))


@routes.get("/api/structure")
async def structure(request):
    """Штатна структура: увесь чинний склад (без балів) — для схеми ієрархії відділів."""
    await auth(request)
    rows = await db.all("SELECT * FROM users WHERE status!='dismissed' ORDER BY rank DESC, sid")
    return web.json_response([public_user(r) for r in rows])


@routes.get("/api/audit")
async def audit(request):
    u = await auth(request)
    if u["rank"] < 12 and not hr_rights(u)["vkpp"]:
        raise Fail("Недостатній рівень допуску.", 403)
    rows = await db.all("SELECT * FROM audit ORDER BY id DESC LIMIT 200")
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
    b, photo = {}, None
    reader = await request.multipart()
    while (part := await reader.next()) is not None:
        if part.name == "data":
            try:
                b = json.loads(await part.text())
            except ValueError:
                raise Fail("Пошкоджені дані анкети.")
        elif part.name == "photo":
            data = bytearray()
            while chunk := await part.read_chunk(64 * 1024):
                data.extend(chunk)
                if len(data) > 5 * 1024 * 1024:
                    raise Fail("Фото більше за 5 МБ.", 413)
            photo = (bytes(data), part.filename or "photo")
    cid = await candidates.submit_form(str(b.get("discord") or ""), b, photo)
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
    acc_done = await db.all("SELECT * FROM access_requests WHERE status!='wait' ORDER BY reviewed DESC LIMIT 30") if r["vkpp"] else []
    nm = await names([c["vvb_by"] for c in cand + done] + [c["vkpp_by"] for c in cand + done] + [a["reviewer"] for a in acc_done])
    for c in cand + done:
        c["vvbName"], c["vkppName"] = nm.get(c["vvb_by"]), nm.get(c["vkpp_by"])
        c["extra"] = json.loads(c.get("extra") or "null")
        try:
            c["photoUrl"] = await core.file_url(c["photo"]) if c.get("photo") else None
        except Fail:
            c["photoUrl"] = None
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
    return runner
