"""Адмін-панель (Голова СБУ та Куратор): користувачі, ролі Discord, канали й згадки, пороги доступу, стан системи.
Кожна зміна пишеться в аудит з позначкою «⚙» — цей журнал бачать лише адміністратори."""
import collections
import logging
import os
import time

import discord

import backup
import config
import core
import overrides as ov
from core import Fail
from db import db, now_ms
from roles import CURATOR_ROLE, DEPTS, PRESS_ROLE, PROSECUTOR_ROLE, RANK_ROLES, RANKS, SBU_ROLE, rank_name

log = logging.getLogger("sova.admin")
STARTED = time.time()

# останні попередження й помилки бота — для вкладки «Система»
ERRORS: collections.deque = collections.deque(maxlen=60)


class _Catch(logging.Handler):
    def emit(self, rec):
        if rec.levelno >= logging.WARNING:
            ERRORS.append({"t": int(rec.created * 1000), "lvl": rec.levelname, "src": rec.name, "msg": rec.getMessage()[:400]})


# не кореневий логер: інакше logging.basicConfig у main.py вважає логи налаштованими і консоль бота мовчить
for _name in ("sova", "discord", "aiohttp"):
    logging.getLogger(_name).addHandler(_Catch())

CHANNEL_LABELS = {
    "rap:promo": "Рапорти на підвищення", "rap:dismiss": "Рапорти на звільнення", "rap:vac": "Рапорти на відпустку",
    "rap:assign": "Рапорти про розподіл випускників", "rap:refund": "Рапорти на відшкодування коштів", "fin": "Клопотання Мінфіну (інакше — канал ДЕБ)", "audit": "Кадровий аудит", "welcome": "Панель «Отримати допуск»",
    "access": "Заявки на допуск", "cand:vvb": "Анкети кандидатів — ВВБ", "cand:vkpp": "Анкети кандидатів — ВКПП",
    "bonus": "Відомості премій", "disc": "Дисциплінарні накази", "orders": "Накази", "log": "Журнал рішень (#сова-журнал)",
    "backups": "Резервні копії", "files": "Сховище файлів",
    **{f"rapdept:{k}": f"Рапорти на переведення — {DEPTS[k]['s']}" for k in ("orv", "vvb", "deb", "atc", "alpha", "vkpp")},
    **{k: f"Звіти відділу — {DEPTS[k]['s']}" for k in DEPTS if DEPTS[k].get("channel")},
}
MENTION_LABELS = {
    "order": "Підписаний наказ Голови / Заступника", "order:draft": "Проєкт наказу на підпис", "rap:promo": "Рапорт на підвищення",
    "rap:vac": "Рапорт на відпустку", "rap:dismiss": "Рапорт на звільнення", "rap:transfer": "Рапорт на переведення",
    "rap:assign": "Рапорт про розподіл", "rap:refund": "Рапорт на відшкодування коштів", "fin:wait": "Клопотання / звіт Мінфіну на погодженні", "cand:vvb": "Анкета на перевірці ВВБ", "cand:vkpp": "Анкета на рішенні ВКПП",
    "access": "Заявка на допуск", "bonus:paid": "Премії виплачено", "alert3": "Три активні догани", "insp": "Службова перевірка ВВБ",
}


def need(u: dict):
    if not core.is_admin(u):
        raise Fail("Адмін-панель доступна лише Голові СБУ та Куратору.", 403)


async def note(u: dict, action: str, target: int, details: str):
    await db.audit(u["sid"], "⚙ " + action, target, details)


# ---------------------------------------------------------------- користувачі
async def users() -> list[dict]:
    rows = await db.all("SELECT u.*, (SELECT MAX(created) FROM sessions s WHERE s.sid=u.sid) AS last_login, "
                        "(SELECT COUNT(*) FROM sessions s WHERE s.sid=u.sid AND s.expires>?) AS sessions FROM users u WHERE u.status!='removed' ORDER BY u.rank DESC, u.sid",
                        now_ms())
    return [{"sid": r["sid"], "name": r["name"], "rank": r["rank"], "rankName": "Куратор СБУ" if r["dept"] == "curator" else rank_name(r["rank"]),
             "dept": r["dept"], "deptName": DEPTS.get(r["dept"], {}).get("s", r["dept"]), "status": r["status"], "blocked": bool(r.get("blocked")),
             "linked": bool(r["discord_id"]), "created": r["created"], "lastLogin": r["last_login"], "sessions": r["sessions"],
             "inStaff": _in_staff(r)} for r in rows]


def _in_staff(r: dict):
    """Чи є людина в чинному штаті за ролями Discord (None — ще не звірено)."""
    hit = core._roles_cache.get(str(r.get("discord_id")))
    if not r.get("discord_id") or not hit:
        return None
    return bool(hit[1]) and core.resolve(hit[1])["ok"]


async def user_action(u: dict, sid: int, act: str, b: dict | None = None) -> dict:
    t = await db.one("SELECT * FROM users WHERE sid=?", sid)
    if not t:
        raise Fail("Користувача не знайдено.", 404)
    if t["sid"] == u["sid"] and act in ("block", "unlink", "archive"):
        raise Fail("Цю дію не можна застосувати до себе.")
    out = {"ok": True}
    if act == "block":
        await db.run("UPDATE users SET blocked=1 WHERE sid=?", sid)
        await db.run("DELETE FROM sessions WHERE sid=?", sid)
        await note(u, "Заблоковано доступ до сайту", sid, t["name"])
    elif act == "unblock":
        await db.run("UPDATE users SET blocked=0 WHERE sid=?", sid)
        await note(u, "Розблоковано доступ до сайту", sid, t["name"])
    elif act == "logout":
        await db.run("DELETE FROM sessions WHERE sid=?", sid)
        await note(u, "Завершено всі сесії", sid, t["name"])
    elif act == "reset":
        if not t["discord_id"]:
            raise Fail("Обліковий запис не прив'язано до Discord — новий код нікуди надіслати.")
        import slash  # тут, щоб не тягнути команди бота під час імпорту API
        pw = core.new_password()
        await db.run("UPDATE users SET pw_hash=?, pw_set=? WHERE sid=?", core.hash_password(pw), now_ms(), sid)
        await db.run("DELETE FROM sessions WHERE sid=?", sid)
        m = await core.member_of(t["discord_id"])
        sent = bool(m) and await slash.send_credentials(m, sid, pw, t["name"], title="НОВИЙ КОД ДОСТУПУ ДО ЄІС «СОВА»")
        await note(u, "Видано новий код доступу", sid, "надіслано в особисті Discord" if sent else "особисті закриті — код показано адміністратору")
        out = {"ok": True, "sent": sent, **({} if sent else {"code": pw})}
    elif act == "unlink":
        await db.run("UPDATE users SET discord_id=NULL WHERE sid=?", sid)
        await db.run("DELETE FROM sessions WHERE sid=?", sid)
        await note(u, "Відв'язано Discord", sid, t["name"])
    elif act == "rename":
        name = " ".join(str((b or {}).get("name") or "").split())[:60]
        if len(name) < 3:
            raise Fail("Вкажіть ім'я та прізвище персонажа (IC).")
        await db.run("UPDATE users SET name=? WHERE sid=?", name, sid)
        await core.set_nick({**t, "name": name})
        await note(u, "Змінено ім'я", sid, f"{t['name']} → {name}")
    elif act == "archive":
        await db.run("UPDATE users SET status='dismissed' WHERE sid=?", sid)
        await db.run("DELETE FROM sessions WHERE sid=?", sid)
        await note(u, "Перенесено в архів (звільнено)", sid, t["name"])
    elif act == "restore":
        await db.run("UPDATE users SET status='active' WHERE sid=?", sid)
        await note(u, "Відновлено з архіву", sid, t["name"])
    elif act == "sync":
        a = await core.access(t, fresh=True)
        out = {"ok": True, "result": "доступ є" if a["ok"] else a["why"], "rankName": rank_name(t["rank"])}
        await note(u, "Синхронізовано ролі", sid, out["result"])
    else:
        raise Fail("Невідома дія.")
    return out


# ---------------------------------------------------------------- ролі Discord
def roles_report() -> list[dict]:
    g = core.guild()
    me = g.me if g else None
    items = [("SBU", "Основна роль СБУ", SBU_ROLE), ("CUR", "Куратор СБУ (прихована)", CURATOR_ROLE),
             ("PRS", "Генеральний прокурор", PROSECUTOR_ROLE), ("PRESS", "Прес-служба", PRESS_ROLE)]
    items += [(f"R{i + 1}", f"Звання {i + 1}: {RANKS[i][0]}", rid) for i, rid in enumerate(RANK_ROLES)]
    items += [(k, f"Відділ: {d['n']}", d["role"]) for k, d in DEPTS.items() if d.get("role")]
    out = []
    for key, label, rid in items:
        r = g.get_role(rid) if g else None
        out.append({"key": key, "label": label, "id": str(rid), "exists": bool(r), "name": r.name if r else None,
                    "color": f"#{r.color.value:06x}" if r and r.color.value else None,
                    "manageable": bool(r and me and r < me.top_role)})
    return out


# ---------------------------------------------------------------- канали й згадки
def _chan(cid) -> str | None:
    ch = core.bot.get_channel(int(cid)) if cid else None
    return f"#{ch.name}" if ch else None


async def channels_view() -> list[dict]:
    auto = await db.get_setting("channels", {})
    keys = list(dict.fromkeys([*CHANNEL_LABELS, *config.CHANNELS, *auto]))
    out = []
    for k in keys:
        cid = ov.channels.get(k) or config.CHANNELS.get(k) or auto.get(k)
        out.append({"key": k, "label": CHANNEL_LABELS.get(k, k), "id": str(cid) if cid else "", "name": _chan(cid),
                    "source": "панель" if k in ov.channels else "код" if k in config.CHANNELS else "авто" if k in auto else "—"})
    return out


def mentions_view() -> list[dict]:
    g = core.guild()
    keys = list(dict.fromkeys([*MENTION_LABELS, *config.MENTIONS]))
    out = []
    for k in keys:
        ids = ov.mentions[k] if k in ov.mentions else config.MENTIONS.get(k, [])
        out.append({"key": k, "label": MENTION_LABELS.get(k, k), "ids": [str(i) for i in ids],
                    "names": [(g.get_role(i).name if g and g.get_role(i) else f"?{i}") for i in ids], "custom": k in ov.mentions})
    return out


def _ids(v) -> list[int]:
    return [int(x) for x in str(v or "").replace(",", " ").split() if x.strip().isdigit()]


async def save_channels(u: dict, data: dict):
    cur = dict(ov.channels)
    for k, v in data.items():
        ids = _ids(v)
        if ids:
            if not core.bot.get_channel(ids[0]):
                raise Fail(f"Канал {ids[0]} не знайдено або бот його не бачить.")
            cur[k] = ids[0]
        else:
            cur.pop(k, None)  # порожнє поле — повернути стандартний канал
    await db.set_setting("admin_channels", cur)
    ov.channels.clear(); ov.channels.update(cur)
    await note(u, "Змінено канали", 0, ", ".join(f"{k}={v}" for k, v in cur.items()) or "усі стандартні")


async def save_mentions(u: dict, data: dict):
    cur = dict(ov.mentions)
    for k, v in data.items():
        if v is None:
            cur.pop(k, None)  # повернути стандартні згадки
        else:
            cur[k] = _ids(v)
    await db.set_setting("admin_mentions", {k: v for k, v in cur.items()})
    ov.mentions.clear(); ov.mentions.update(cur)
    await note(u, "Змінено згадки", 0, ", ".join(f"{k}: {len(v)} рол." for k, v in cur.items()) or "усі стандартні")


async def save_perms(u: dict, data: dict):
    clean = await ov.save_perms(db, data)
    await note(u, "Змінено доступи", 0, ", ".join(f"{ov.PERMS[k][0]} → від {v}" for k, v in clean.items()) or "усі стандартні")


# ---------------------------------------------------------------- система
async def system() -> dict:
    g = core.guild()
    files = sorted(config.BACKUP_DIR.glob("sova-*.db.gz"), key=lambda f: f.stat().st_mtime, reverse=True)
    db_size = os.path.getsize(config.DB_PATH) if os.path.exists(config.DB_PATH) else 0
    warn = []
    if not core.bot.intents.members:
        warn.append("Вимкнено Server Members Intent: не працюють привітання новачків і миттєве закриття доступу при виході з сервера. "
                    "Увімкніть у Discord Developer Portal → Bot → Privileged Gateway Intents.")
    if g and g.me and not g.me.guild_permissions.manage_nicknames:
        warn.append("Бот не має права «Керувати нікнеймами» — службові нікнейми не ставляться.")
    if g and g.me and not g.me.guild_permissions.manage_roles:
        warn.append("Бот не має права «Керувати ролями» — накази не змінюють ролі.")
    if not config.AI_KEY:
        warn.append("Немає ANTHROPIC_API_KEY у .env — ШІ-підсумки змін законодавства вимкнено (необов'язково).")
    return {
        "bot": str(core.bot.user) if core.bot.user else None, "guild": g.name if g else None, "latency": round(core.bot.latency * 1000) if core.bot.latency == core.bot.latency else None,
        "members": g.member_count if g else 0, "uptime": int(time.time() - STARTED), "dbSize": db_size,
        "users": (await db.one("SELECT COUNT(*) AS n FROM users WHERE status NOT IN ('dismissed','removed')"))["n"],
        "sessions": (await db.one("SELECT COUNT(*) AS n FROM sessions WHERE expires>?", now_ms()))["n"],
        "backups": [{"name": f.name, "size": f.stat().st_size, "t": int(f.stat().st_mtime * 1000)} for f in files[:8]],
        "warnings": warn, "errors": list(ERRORS)[::-1][:40],
    }


async def make_backup(u: dict) -> dict:
    name, size = await backup.make_backup(f"з адмін-панелі, {u['name'] if u.get('dept') != 'curator' else 'Куратор СБУ'}")
    await note(u, "Резервна копія вручну", 0, name)
    return {"name": name, "size": size}


async def admin_log() -> list[dict]:
    return await db.all("SELECT * FROM audit WHERE action LIKE '⚙%' ORDER BY id DESC LIMIT 150")


# ---------------------------------------------------------------- нікнейми й позивні
async def nick_view() -> dict:
    from roles import CALLSIGN_DEPTS, CALLSIGN_TPL, NICK_TPL, RANK_SHORT, callsign_depts, nickname, rank_short
    rows = await db.all("SELECT * FROM users WHERE status NOT IN ('dismissed','removed') AND dept NOT IN ('prosecutor','curator') ORDER BY rank DESC, sid")
    return {
        "tpl": ov.nick.get("tpl") or NICK_TPL, "callsignTpl": ov.nick.get("callsign_tpl") or CALLSIGN_TPL,
        "defTpl": NICK_TPL, "defCallsignTpl": CALLSIGN_TPL, "defRanks": RANK_SHORT, "defDepts": CALLSIGN_DEPTS,
        "ranks": [rank_short(i + 1) for i in range(15)], "depts": callsign_depts(),
        "allDepts": [{"key": k, "s": DEPTS[k]["s"]} for k in ("orv", "vvb", "atc", "alpha", "deb", "vkpp")],
        "people": [{"sid": r["sid"], "name": r["name"], "rank": r["rank"], "rankName": rank_name(r["rank"]), "dept": r["dept"],
                    "deptS": DEPTS.get(r["dept"], {}).get("s", ""), "callsign": r.get("callsign"),
                    "nick": nickname(r["rank"], r["name"], r["sid"], r["dept"], r.get("callsign"))} for r in rows],
    }


async def save_nick(u: dict, b: dict):
    from roles import CALLSIGN_DEPTS, CALLSIGN_TPL, NICK_TPL, RANK_SHORT
    tpl = str(b.get("tpl") or "").strip()[:60] or NICK_TPL
    ctpl = str(b.get("callsignTpl") or "").strip()[:60] or CALLSIGN_TPL
    if "{name}" not in tpl and "{sid}" not in tpl:
        raise Fail("У шаблоні звичайного нікнейму має бути {name} або {sid}.")
    if "{callsign}" not in ctpl:
        raise Fail("У шаблоні з позивним має бути {callsign}.")
    ranks = [str(x or "").strip()[:16] for x in (b.get("ranks") or [])][:15]
    ranks = ranks + RANK_SHORT[len(ranks):]
    depts = [d for d in (b.get("depts") or []) if d in DEPTS and DEPTS[d].get("role")]
    cfg = {k: v for k, v in {"tpl": tpl if tpl != NICK_TPL else None, "callsign_tpl": ctpl if ctpl != CALLSIGN_TPL else None,
                             "ranks": ranks if ranks != RANK_SHORT else None, "depts": depts if sorted(depts) != sorted(CALLSIGN_DEPTS) else None}.items() if v}
    await db.set_setting("admin_nick", cfg)
    ov.nick.clear(); ov.nick.update(cfg)
    await note(u, "Змінено формат нікнеймів", 0, f"{tpl} · з позивним: {ctpl} · позивні: {', '.join(DEPTS[d]['s'] for d in (depts or CALLSIGN_DEPTS))}")


_applying = {"busy": False, "done": 0, "total": 0}


async def apply_all(u: dict) -> dict:
    """Перейменувати всіх за поточним форматом — у фоні, по одному, щоб не впертися в ліміти Discord."""
    import asyncio
    if _applying["busy"]:
        return dict(_applying)
    rows = await db.all("SELECT * FROM users WHERE status NOT IN ('dismissed','removed') AND discord_id IS NOT NULL AND dept NOT IN ('prosecutor','curator')")
    _applying.update(busy=True, done=0, total=len(rows))

    async def go():
        try:
            for r in rows:
                try:
                    await core.set_nick(r)
                except Exception:
                    log.exception("Нікнейм %s", r["sid"])
                _applying["done"] += 1
                await asyncio.sleep(1.2)
        finally:
            _applying["busy"] = False
    asyncio.get_running_loop().create_task(go())
    await note(u, "Нікнейми застосовано всім", 0, f"{len(rows)} співробітників")
    return dict(_applying)


async def apply_one(u: dict, sid: int) -> dict:
    p = await db.one("SELECT * FROM users WHERE sid=?", sid)
    if not p:
        raise Fail("Співробітника не знайдено.", 404)
    ok = await core.set_nick(p)
    return {"applied": ok}
