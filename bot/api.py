"""HTTP API для сайту (GitHub Pages). Сайт не має своєї бази — усе тут."""
import json
import logging
import time

from aiohttp import web

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
        },
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


@routes.get("/api/audit")
async def audit(request):
    u = await auth(request)
    if u["rank"] < 12:
        raise Fail("Недостатній рівень допуску.", 403)
    rows = await db.all("SELECT * FROM audit ORDER BY id DESC LIMIT 200")
    people = await people_map([r["actor"] for r in rows] + [r["target"] for r in rows])
    return web.json_response([{**r, "actorUser": people.get(r["actor"]), "targetUser": people.get(r["target"])} for r in rows])


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
