"""Зв'язок із CASTRO CONTROL (програма для гри): хто зі співробітників може надсилати оголошення на екрани СБУ.

Самі оголошення зберігає сервер CASTRO (Cloudflare Worker `auth.family-castro.fun`), «Сова» лише вирішує, кому
це дозволено: адмін-панель → Права, «castro_broadcast» (стандартно з 14 звання). Worker питає
POST /api/castro/access {"discord_id": "…"} і підписує запит HMAC-SHA256 спільним ключем CASTRO_API_SECRET
(у .env «Сови» і в секретах Worker) — так само, як із ботом сім'ї CASTRO. Відповідь теж підписана.
"""
import base64
import hashlib
import hmac
import json
import logging
import time

from aiohttp import web

import config
import core
import overrides as ov
from db import db
from roles import rank_name

log = logging.getLogger("sova.castro")

MAX_CLOCK_SKEW = 60
NONCE_TTL = 120
_nonces: dict[str, float] = {}
_started = time.time()


def _signature(secret: str, value: str) -> str:
    digest = hmac.new(secret.encode(), value.encode(), hashlib.sha256).digest()
    return base64.urlsafe_b64encode(digest).decode("ascii").rstrip("=")


def authenticate(request: web.Request, raw: bytes) -> tuple[str, str] | None:
    """Перевіряє підпис Worker; повертає (timestamp, nonce) або None."""
    secret = config.CASTRO_API_SECRET
    if len(secret) < 32:
        return None
    timestamp = request.headers.get("X-Castro-Timestamp", "")
    nonce = request.headers.get("X-Castro-Nonce", "")
    supplied = request.headers.get("X-Castro-Signature", "")
    try:
        sent = int(timestamp)
    except ValueError:
        return None
    now = time.time()
    # Одноразові nonce живуть лише в пам'яті: запит, підписаний до запуску бота, може бути повтором.
    if abs(now - sent) > MAX_CLOCK_SKEW or sent < _started - 1 or not nonce or len(nonce) > 128:
        return None
    for key in [key for key, expires in _nonces.items() if expires <= now]:
        _nonces.pop(key, None)
    if nonce in _nonces:
        return None
    try:
        body = raw.decode("utf-8")
    except UnicodeDecodeError:
        return None
    canonical = f"{timestamp}\n{nonce}\n{request.method}\n{request.path}\n{body}"
    if not hmac.compare_digest(supplied, _signature(secret, canonical)):
        log.warning("CASTRO: неправильний підпис запиту")
        return None
    _nonces[nonce] = now + NONCE_TTL
    return timestamp, nonce


def signed_json(data: dict, status: int, timestamp: str, nonce: str) -> web.Response:
    body = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    return web.Response(text=body, status=status, content_type="application/json", charset="utf-8", headers={
        "Cache-Control": "no-store",
        "X-Castro-Response-Signature": _signature(config.CASTRO_API_SECRET, f"{status}\n{timestamp}\n{nonce}\n{body}"),
    })


async def access_for(discord_id: str) -> dict:
    """Чи може співробітник із цим Discord ID надсилати оголошення в CASTRO CONTROL."""
    need = ov.P("castro_broadcast")
    u = await db.one("SELECT * FROM users WHERE discord_id=? AND status NOT IN ('removed','dismissed')", str(discord_id))
    if not u:
        return {"ok": True, "allowed": False, "why": "немає облікового запису в «Сові»"}
    a = await core.access(u)
    if not a["ok"]:
        return {"ok": True, "allowed": False, "why": a["why"]}
    if u["dept"] == "curator":   # Куратор має лише наглядовий доступ
        return {"ok": True, "allowed": False, "why": "наглядовий доступ куратора"}
    allowed = u["rank"] >= need
    return {"ok": True, "allowed": allowed, "sid": u["sid"], "name": u["name"], "rank_name": rank_name(u["rank"]),
            "why": "" if allowed else f"потрібне звання від «{rank_name(need)}»"}


async def handle_access(request: web.Request) -> web.Response:
    raw = await request.read()
    auth = authenticate(request, raw)
    if auth is None:
        return web.json_response({"error": "unauthorized"}, status=401)
    timestamp, nonce = auth
    try:
        data = json.loads(raw or b"{}")
        discord_id = str(int(str(data.get("discord_id", ""))))
    except (ValueError, TypeError, AttributeError, json.JSONDecodeError):
        return signed_json({"error": "invalid_user"}, 400, timestamp, nonce)
    return signed_json(await access_for(discord_id), 200, timestamp, nonce)
