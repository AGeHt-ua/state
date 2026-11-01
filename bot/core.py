"""Ядро «Сови»: доступ, звіти, рапорти, файли, картки в Discord. Рішення ухвалюються на сайті, Discord — оформлений журнал."""
import hashlib
import hmac
import io
import json
import logging
import secrets
import time
from datetime import datetime, timedelta, timezone

import discord

import config
import style
from db import db, now_ms
from roles import (ALL_SBU_ROLES, DEPTS, OPS_DEPTS, PRESS_ROLE, RANK_ROLES, RANKS, SBU_ROLE,
                   nickname, rank_name, resolve, roles_for)

log = logging.getLogger("sova")
bot: discord.Client | None = None
DAY = 86_400_000

try:
    from zoneinfo import ZoneInfo
    TZ = ZoneInfo("Europe/Kyiv")
except Exception:  # немає tzdata — рахуємо в UTC
    TZ = None

# ---------------------------------------------------------------- довідники
ACTS = {  # id: (назва, бали, відділи або "all"/"instr", потрібні статті)
    "arrest":    ("Процесуальне затримання", 3, "all", True),
    "warrant":   ("Затримання за ОРД-АРЕШТ", 5, "all", True),
    "patrol":    ("Патрулювання (за 30 хв)", 1, "all", False),
    "interrog":  ("Вербальний допит з протоколом", 2, ["orv", "atc", "alpha", "vvb", "lead"], False),
    "covert":    ("Негласний захід / впровадження", 6, ["orv", "atc"], False),
    "raid":      ("Рейд або спецоперація", 6, ["orv", "atc", "alpha", "deb", "lead"], False),
    "escort":    ("Охорона свідка, судді або конвой", 4, ["alpha"], False),
    "supply":    ("Супровід поставки", 3, ["orv", "atc", "alpha", "deb", "vvb", "lead"], False),
    "block":     ("Блокування рахунку за КФ", 4, ["deb"], False),
    "fin":       ("Фінансовий моніторинг (звіт)", 3, ["deb"], False),
    "check":     ("Службова перевірка ВВБ", 5, ["vvb"], False),
    "interview": ("Співбесіда з кандидатом", 2, "instr", False),
    "lecture":   ("Лекція або тренування", 3, "instr", False),
    "exam":      ("Прийнятий залік у стажера", 2, "instr", False),
    "gov":       ("Оголошення в державну хвилю", 1, ["press"], False),
    "pr":        ("Брифінг або медіаматеріал", 3, ["press"], False),
}
RAP_TYPES = {"promo": "Рапорт на підвищення", "vac": "Рапорт на відпустку",
             "dismiss": "Рапорт на звільнення (ПСЖ)", "transfer": "Рапорт на переведення між відділами",
             "assign": "Рапорт про розподіл до підрозділу"}


class Fail(Exception):
    """Помилка, яку можна показати людині як є."""
    def __init__(self, msg: str, status: int = 400):
        super().__init__(msg)
        self.status = status


def week_start(offset: int = 0) -> int:
    now = datetime.now(TZ) if TZ else datetime.now(timezone.utc)
    monday = (now - timedelta(days=now.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)
    return int(monday.timestamp() * 1000) - offset * 7 * DAY


def act_allowed(u: dict, act_id: str) -> bool:
    _, _, depts, _ = ACTS[act_id]
    if u["rank"] == 1:
        return act_id in ("patrol", "lecture")
    if depts == "all":
        return True
    if depts == "instr":
        return u["rank"] == 8 or u["rank"] >= 11 or u["dept"] == "vkpp"
    return u["dept"] in depts


async def coef() -> dict:
    saved = await db.get_setting("coef", {})
    return {k: int(saved.get(k, v[1])) for k, v in ACTS.items()}


async def week_points(sid: int, offset: int = 0) -> int:
    ws = week_start(offset)
    rows = await db.all("SELECT type, qty FROM acts WHERE by_sid=? AND status='ok' AND t>=? AND t<?", sid, ws, ws + 7 * DAY)
    c = await coef()
    return sum(c.get(r["type"], 0) * (r["qty"] or 1) for r in rows)


# ---------------------------------------------------------------- паролі й сесії
def hash_password(pw: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", pw.encode(), salt, 200_000)
    return f"pbkdf2$200000${salt.hex()}${digest.hex()}"


def check_password(pw: str, stored: str | None) -> bool:
    try:
        _, it, salt, digest = (stored or "").split("$")
        calc = hashlib.pbkdf2_hmac("sha256", pw.encode(), bytes.fromhex(salt), int(it))
        return hmac.compare_digest(calc.hex(), digest)
    except ValueError:
        return False


def new_password() -> str:
    alphabet = "abcdefghjkmnpqrstuvwxyz23456789"
    return "".join(secrets.choice(alphabet) for _ in range(10))


async def new_session(sid: int) -> str:
    raw = secrets.token_urlsafe(32)
    t = now_ms()
    await db.run("INSERT INTO sessions(token_hash,sid,created,expires) VALUES(?,?,?,?)",
                 hashlib.sha256(raw.encode()).hexdigest(), sid, t, t + config.SESSION_DAYS * DAY)
    return raw


async def session_user(raw: str | None) -> dict | None:
    if not raw:
        return None
    row = await db.one("SELECT sid, expires FROM sessions WHERE token_hash=?", hashlib.sha256(raw.encode()).hexdigest())
    if not row or row["expires"] < now_ms():
        return None
    return await db.one("SELECT * FROM users WHERE sid=?", row["sid"])


async def end_session(raw: str):
    await db.run("DELETE FROM sessions WHERE token_hash=?", hashlib.sha256(raw.encode()).hexdigest())


# ---------------------------------------------------------------- Discord-ролі
_roles_cache: dict[str, tuple[float, set[int] | None]] = {}


def guild() -> discord.Guild | None:
    """Сервер СБУ: з GUILD_ID, а якщо його не задано — єдиний сервер, де є бот."""
    if not bot:
        return None
    if config.GUILD_ID:
        return bot.get_guild(config.GUILD_ID)
    return bot.guilds[0] if len(bot.guilds) == 1 else None


async def member_of(discord_id: str | int, fresh: bool = False) -> discord.Member | None:
    """Учасник сервера СБУ. fresh=True — завжди свіжі дані з Discord: без Server Members Intent
    бот не отримує подій про зміну ролей, і його локальна копія учасника застаріває."""
    g = guild()
    if not g:
        raise Fail("Бот ще не підключився до Discord. Спробуйте за хвилину.", 503)
    m = None if fresh else g.get_member(int(discord_id))
    if m:
        return m
    try:
        return await g.fetch_member(int(discord_id))
    except discord.NotFound:
        return None


async def member_roles(discord_id: str, fresh: bool = False) -> set[int] | None:
    hit = _roles_cache.get(discord_id)
    if hit and not fresh and time.time() - hit[0] < 60:
        return hit[1]
    m = await member_of(discord_id, fresh=True)
    roles = {r.id for r in m.roles} if m else None
    _roles_cache[discord_id] = (time.time(), roles)
    return roles


async def access(u: dict, fresh: bool = False) -> dict:
    """Звіряє ролі в Discord і синхронізує картку співробітника."""
    if u["status"] == "dismissed":
        return {"ok": False, "why": "Співробітника звільнено"}
    if not u["discord_id"]:
        return {"ok": False, "why": "Обліковий запис не прив'язано до Discord"}
    roles = await member_roles(u["discord_id"], fresh)
    if roles is None:
        return {"ok": False, "why": "Вас немає на Discord-сервері СБУ"}
    a = resolve(roles)
    if a["ok"] and (a["rank"] != u["rank"] or a["dept"] != u["dept"]):
        since = now_ms() if a["rank"] != u["rank"] else u["since"]
        await db.run("UPDATE users SET rank=?, dept=?, since=? WHERE sid=?", a["rank"], a["dept"], since, u["sid"])
        await db.audit(0, "Синхронізація з Discord", u["sid"],
                       f"{rank_name(u['rank'])} / {DEPTS[u['dept']]['s']} → {rank_name(a['rank'])} / {DEPTS[a['dept']]['s']}")
        u.update(rank=a["rank"], dept=a["dept"], since=since)
        await set_nick(u)
    return a


async def set_nick(u: dict, member: discord.Member | None = None) -> bool:
    """Ставить нікнейм «Звання | Ім'я Прізвище | Static ID». Потрібне право бота «Керувати нікнеймами»."""
    if u.get("status") == "dismissed" or not u.get("discord_id") or u.get("dept") == "prosecutor":
        return False
    m = member or await member_of(u["discord_id"])
    if not m:
        return False
    nick = nickname(u["rank"], u["name"], u["sid"])
    if m.nick == nick:
        return True
    try:
        await m.edit(nick=nick, reason="Сова: службовий нікнейм")
        return True
    except discord.Forbidden:
        log.warning("Не можу змінити нікнейм %s: немає права «Керувати нікнеймами» або роль учасника вища за роль бота", m)
        return False


async def sync_roles(u: dict, reason: str):
    """Приводить ролі в Discord до картки (після підвищення, переведення, звільнення)."""
    m = await member_of(u["discord_id"]) if u.get("discord_id") else None
    if not m:
        return
    have = {r.id for r in m.roles} & ALL_SBU_ROLES
    want = set() if u["status"] == "dismissed" else roles_for(u["rank"], u["dept"])
    # керівництво й начальники відділів (можуть вести два відділи) зберігають ролі відділів; прес-служба — позаштатна, роль не чіпаємо
    keep_dept = u["dept"] == "lead" or (u["rank"] >= 12 and u["status"] != "dismissed")
    remove = {r for r in have - want if not (keep_dept and r in {DEPTS[d]["role"] for d in OPS_DEPTS})}
    if u["status"] != "dismissed":
        remove.discard(PRESS_ROLE)
    add = want - have
    g = m.guild
    try:
        if add:
            await m.add_roles(*[g.get_role(r) for r in add if g.get_role(r)], reason=reason)
        if remove:
            await m.remove_roles(*[g.get_role(r) for r in remove if g.get_role(r)], reason=reason)
    except discord.Forbidden:
        log.warning("Немає прав змінити ролі %s — роль бота має бути вище ролей СБУ", m)
    _roles_cache.pop(str(u["discord_id"]), None)


# ---------------------------------------------------------------- права
def can_approve_act(actor: dict, a: dict) -> bool:
    if a["by_sid"] == actor["sid"] or a["status"] != "wait":
        return False
    if a["dept"] == "academy":
        return actor["rank"] == 8 or (actor["dept"] == "vkpp" and actor["rank"] >= 9) or actor["rank"] >= 13
    return actor["rank"] >= 9 and (actor["dept"] == a["dept"] or actor["dept"] == "lead")


# Рапорти з візами: переведення — начальник «звідки» → начальник «куди» → Голова або заступник;
# розподіл випускника Академії — Начальник академії (ВКПП) → начальник відділу, куди проситься
STAGES = {"transfer": ("from", "to", "chief"), "assign": ("from", "to")}
TRANSFER_STAGES = STAGES["transfer"]


def head_of(u: dict, dept: str | None) -> bool:
    dept = "vkpp" if dept == "academy" else dept  # Начальник академії — начальник ВКПП
    return bool(dept) and u["rank"] == 12 and (u["dept"] == dept or has_dept_role(u, dept))


def transfer_stage(r: dict) -> str:
    return json.loads(r["data"] or "{}").get("stage", "from")


def can_approve_rap(actor: dict, r: dict) -> bool:
    if r["by_sid"] == actor["sid"] or r["status"] != "wait":
        return False
    if r["type"] in STAGES:
        st = transfer_stage(r)
        if actor["rank"] >= 14:  # Голова й заступник можуть поставити візу й за відсутності начальника відділу
            return True
        return (st == "from" and head_of(actor, r["dept"])) or (st == "to" and head_of(actor, json.loads(r["data"] or "{}").get("to")))
    # Усі кадрові рапорти розглядає ВКПП або керівництво (Начальник управління, Заступник Голови, Голова)
    return actor["rank"] >= 13 or has_dept_role(actor, "vkpp")


def has_dept_role(u: dict, dept: str) -> bool:
    """Чи є в людини роль відділу (з кешу ролей; навіть якщо основний відділ у картці інший)."""
    if u.get("dept") == dept:
        return True
    hit = _roles_cache.get(str(u.get("discord_id")))
    return bool(hit and hit[1] and DEPTS[dept]["role"] in hit[1])


async def promo_check(u: dict) -> dict | None:
    if u["dept"] == "prosecutor":
        return None
    nxt = u["rank"] + 1
    if nxt > 15:
        return None
    name, _, days = RANKS[nxt - 1]
    items = []
    if days is None:
        items.append({"ok": False, "soft": True, "t": "Посада з 8-го щабля: призначення наказом Голови СБУ за наявності вакансії"})
    else:
        have = (now_ms() - (u["since"] or now_ms())) / DAY
        items.append({"ok": have >= days, "t": f"Вислуга на поточному званні: {have:.1f} з {days} календарних діб",
                      "pct": min(1, have / days) if days else 1})
    blocked = await db.one("SELECT id FROM discipline WHERE sid=? AND status='active' AND kind IN ('reprimand','severe') AND expires>? ORDER BY expires DESC",
                           u["sid"], now_ms())
    if blocked:
        items.append({"ok": False, "t": f"Активна догана НС-{blocked['id']:04d}: підвищення заблоковано (п. 1.2 Регламенту стягнень)"})
    pending = await db.one("SELECT id FROM raps WHERE by_sid=? AND type='promo' AND status='wait'", u["sid"])
    if pending:
        items.append({"ok": False, "t": f"Рапорт №{pending['id']} уже на розгляді"})
    return {"next": nxt, "name": name, "items": items, "eligible": all(i["ok"] for i in items)}


# ---------------------------------------------------------------- канали
CHANNEL_KEYS = [k for k in DEPTS if DEPTS[k]["channel"]] + ["audit", "files", "backups"]


async def channel(key: str) -> discord.TextChannel | None:
    ids = await db.get_setting("channels", {})
    cid = config.CHANNELS.get(key) or ids.get(key)
    if not cid:
        return None
    ch = bot.get_channel(int(cid))
    if ch is None:
        try:
            ch = await bot.fetch_channel(int(cid))
        except (discord.NotFound, discord.Forbidden):
            return None
    return ch


async def ensure_channels(g: discord.Guild):
    """Створює категорію й канали «Сови», якщо їх немає. Видимість — за ролями."""
    ids = await db.get_setting("channels", {})
    cat_id = ids.get("_category")
    category = g.get_channel(int(cat_id)) if cat_id else None
    if category is None:
        category = discord.utils.get(g.categories, name=config.CATEGORY_NAME) or await g.create_category(
            config.CATEGORY_NAME, reason="Сова: канали кабінету",
            overwrites={g.default_role: discord.PermissionOverwrite(view_channel=False),
                        g.me: discord.PermissionOverwrite(view_channel=True, send_messages=True, embed_links=True,
                                                          attach_files=True, read_message_history=True, manage_messages=True)})
        ids["_category"] = str(category.id)

    def role(rid):
        return g.get_role(rid)

    lead_roles = [role(r) for r in RANK_ROLES[12:]]
    see = discord.PermissionOverwrite(view_channel=True, read_message_history=True, send_messages=False)
    names = {k: v["channel"] for k, v in DEPTS.items()} | {"audit": "сова-кадровий-аудит", "files": "сова-сховище-файлів", "backups": "сова-бекапи"}
    for key in CHANNEL_KEYS:
        if key in config.CHANNELS:  # наявний канал сервера, нічого не створюємо
            if not g.get_channel(config.CHANNELS[key]):
                log.warning("Канал %s (%s) не знайдено або бот його не бачить", key, config.CHANNELS[key])
            continue
        existing = g.get_channel(int(ids[key])) if ids.get(key) else None
        if existing:
            continue
        viewers = list(lead_roles)
        if key in OPS_DEPTS:
            viewers.append(role(DEPTS[key]["role"]))
        elif key == "academy":
            viewers += [role(DEPTS["vkpp"]["role"]), role(RANK_ROLES[7]), role(RANK_ROLES[0]), role(RANK_ROLES[1])]
        elif key == "press":
            viewers.append(role(PRESS_ROLE))
        elif key == "audit":
            viewers += [role(RANK_ROLES[11]), role(DEPTS["vkpp"]["role"])]
        elif key in ("files", "backups"):
            viewers = [role(RANK_ROLES[14])]
        overwrites = {g.default_role: discord.PermissionOverwrite(view_channel=False),
                      g.me: discord.PermissionOverwrite(view_channel=True, send_messages=True, embed_links=True,
                                                        attach_files=True, read_message_history=True)}
        for r in viewers:
            if r:
                overwrites[r] = see
        ch = await g.create_text_channel(names[key], category=category, overwrites=overwrites, reason="Сова: канали кабінету")
        ids[key] = str(ch.id)
        log.info("Створено канал #%s", ch.name)
    await db.set_setting("channels", ids)


# ---------------------------------------------------------------- картки
async def user(sid: int) -> dict | None:
    return await db.one("SELECT * FROM users WHERE sid=?", sid)


def who(u: dict | None) -> str:
    return f"{u['name']} · №{u['sid']}" if u else "—"


async def resolution(status: str, reviewer_sid: int | None, reviewed: int | None, ok_word: str = "ПОГОДЖЕНО") -> list[str]:
    """Рядки резолюції під документом."""
    if status == "wait":
        return [style.kv("РЕЗОЛЮЦІЯ", "очікує розгляду", "gold", True)]
    if status == "cancel":
        return [style.kv("РЕЗОЛЮЦІЯ", "ВІДКЛИКАНО ВИКОНАВЦЕМ", "gray", True), style.kv("", style.when(reviewed), "gray")]
    if status == "deleted":
        rev = await user(reviewer_sid) if reviewer_sid else None
        return [style.kv("РЕЗОЛЮЦІЯ", "ДОКУМЕНТ ВИДАЛЕНО", "gray", True)] + ([style.kv("", rev["name"], "white")] if rev else []) + [style.kv("", style.when(reviewed), "gray")]
    rev = await user(reviewer_sid) if reviewer_sid else None
    word, color = (ok_word, "green") if status == "ok" else ("ВІДМОВЛЕНО", "red")
    lines = [style.kv("РЕЗОЛЮЦІЯ", word, color, True)]
    if rev:
        lines.append(style.kv("", f"{rank_name(rev['rank'])} {rev['name']}", "white"))
    lines.append(style.kv("", style.when(reviewed), "gray"))
    return lines


async def act_embed(a: dict) -> discord.Embed:
    author = await user(a["by_sid"]) or {"name": "—", "sid": a["by_sid"], "rank": 1}
    pts = (await coef()).get(a["type"], 0) * a["qty"]
    _, _, color = style.STATUS[a["status"]]
    dept = DEPTS.get(a["dept"], DEPTS["lead"])
    arts = json.loads(a["arts"] or "[]")
    lines = [
        style.kv("ПІДРОЗДІЛ", f"{dept['s']} · {dept['n']}", "gold"),
        style.kv("СПІВРОБІТНИК", f"{rank_name(author['rank'])} {author['name']}", "white", True),
        style.kv("ЖЕТОН", f"№{author['sid']}", "cyan"),
        style.rule(),
        style.kv("ДІЯ", ACTS[a["type"]][0] + (f" ×{a['qty']}" if a["qty"] > 1 else ""), "white", True),
        style.kv("ЧАС", style.when(a["t"]), "white"),
    ]
    if arts:
        lines.append(style.kv("СТАТТІ КК", ", ".join(arts), "red", True))
    if a["subj"]:
        lines.append(style.kv("ФІГУРАНТ", a["subj"][:60], "white"))
    lines.append(style.kv("БАЛИ", f"{pts}", "gold", True))
    lines.append(style.rule())
    lines += await resolution(a["status"], a["reviewer"], a["reviewed"], "ПІДТВЕРДЖЕНО")
    desc = style.block(*lines)
    extra = []
    if a["evidence"]:
        extra.append(f"📎 **Відкат:** [відкрити запис]({a['evidence']})")
    files = json.loads(a["files"] or "[]")
    if files:
        extra.append(f"🗂 **Додано файлів:** {len(files)} — у кабінеті ЄІС")
    if a["note"]:
        extra.append("> " + a["note"][:900].replace("\n", "\n> "))
    if extra:
        desc += "\n" + "\n".join(extra)
    return style.document(f"СЛУЖБОВИЙ ЗВІТ · {ACTS[a['type']][0]}", color if a["status"] != "wait" else dept["color"],
                          desc=desc, no=style.doc_no("ЗВТ", a["id"]), footer=style.STATUS[a["status"]][0])


RAP_HEAD = {"promo": "на підвищення у званні", "vac": "на відпустку", "dismiss": "на звільнення зі служби", "transfer": "на переведення"}


def rap_text(r: dict, data: dict) -> str:
    if r["type"] == "promo":
        return (f"Прошу присвоїти мені чергове спеціальне звання «{rank_name(data['to'])}» у зв'язку з виконанням "
                f"вимог щодо вислуги. Дисциплінарних стягнень не маю. За поточний тиждень набрано {data.get('points', 0)} "
                f"балів, за минулий — {data.get('points_prev', 0)}.")
    if r["type"] == "vac":
        return (f"Прошу надати мені планову відпустку тривалістю {data.get('days')} діб з {data.get('from') or 'дати погодження'}"
                + (f". Причина: {data['reason']}" if data.get("reason") else "")
                + ". Службове посвідчення, табельну зброю та спецзасоби зобов'язуюсь здати на склад.")
    if r["type"] == "dismiss":
        return ("Прошу звільнити мене зі служби в Службі безпеки штату NG за власним бажанням. "
                + (data.get("reason", "") + " " if data.get("reason") else "")
                + "Жетон, посвідчення, табельну зброю та спорядження зобов'язуюсь здати.")
    if r["type"] == "assign":
        return (f"Прошу розподілити мене після закінчення Академії СБУ до підрозділу {DEPTS[data['to']]['s']} ({DEPTS[data['to']]['n']})"
                + (f". Обґрунтування: {data['reason']}" if data.get("reason") else "") + ".")
    if r["type"] == "transfer":
        return (f"Прошу перевести мене з підрозділу {DEPTS[r['dept']]['s']} до підрозділу {DEPTS[data['to']]['s']} "
                f"({DEPTS[data['to']]['n']})" + (f". Обґрунтування: {data['reason']}" if data.get("reason") else "") + ".")
    return data.get("reason", "")


def transfer_label(r: dict, st: str) -> str:
    data = json.loads(r["data"] or "{}")
    return {"from": "начальник академії" if r["dept"] == "academy" else f"начальник {DEPTS.get(r['dept'], DEPTS['lead'])['s']}", "to": f"начальник {DEPTS.get(data.get('to'), DEPTS['lead'])['s']}",
            "chief": "Голова СБУ або заступник"}[st]


def transfer_visas(r: dict) -> list[str]:
    data = json.loads(r["data"] or "{}")
    cur = data.get("stage", "from")
    visas = {v["stage"]: v for v in data.get("visas", [])}
    out = [style.c("ВІЗИ ПОГОДЖЕННЯ", "gold", True)]
    for st in STAGES[r["type"]]:
        label = transfer_label(r, st).upper()[:16]
        v = visas.get(st)
        if v:
            out.append(style.kv(label, f"{'ПОГОДЖЕНО' if v.get('ok', True) else 'ВІДМОВЛЕНО'} · {v['name']}", "green" if v.get("ok", True) else "red"))
        elif r["status"] == "wait" and st == cur:
            out.append(style.kv(label, "очікує візи", "gold", True))
        else:
            out.append(style.kv(label, "—", "gray"))
    return out + [style.rule()]


async def rap_embed(r: dict) -> discord.Embed:
    author = await user(r["by_sid"]) or {"name": "—", "sid": r["by_sid"], "rank": 1}
    data = json.loads(r["data"] or "{}")
    _, _, color = style.STATUS[r["status"]]
    dept = DEPTS.get(r["dept"], DEPTS["lead"])
    pad = " " * 18
    lines = [
        pad + style.c("Голові Служби безпеки", "white"),
        pad + style.c("штату NG", "white"),
        pad + style.c(f"від: {rank_name(author['rank'])}", "gray"),
        pad + style.c(f"{dept['s']} {author['name']}", "white", True),
        pad + style.c(f"жетон №{author['sid']}", "cyan"),
        "",
        " " * 17 + style.c("Р А П О Р Т", "gold", True),
        style.c(f"{RAP_HEAD.get(r['type'], ''):^44}", "gray"),
        "",
        *[style.c(line, "white") for line in style.wrap(rap_text(r, data))],
        "",
        style.c(f"{style.when(r['t'])}", "gray") + " " * 14 + style.c(f"/{author['name']}/", "white"),
        style.rule(),
        *(transfer_visas(r) if r["type"] in STAGES else []),
        *await resolution(r["status"], r["reviewer"], r["reviewed"]),
    ]
    return style.document(f"РАПОРТ · {RAP_TYPES[r['type']].replace('Рапорт ', '')}", color if r["status"] != "wait" else 0xC9A05A,
                          desc=style.block(*lines), no=style.doc_no("РАП", r["id"]), footer=style.STATUS[r["status"]][0])


class ActButton(discord.ui.DynamicItem[discord.ui.Button], template=r"sova:act:(?P<id>\d+):(?P<d>ok|rej)"):
    def __init__(self, act_id: int, decision: str):
        super().__init__(discord.ui.Button(
            label="Підтвердити" if decision == "ok" else "Відхилити",
            style=discord.ButtonStyle.success if decision == "ok" else discord.ButtonStyle.danger,
            custom_id=f"sova:act:{act_id}:{decision}"))
        self.act_id, self.decision = act_id, decision

    @classmethod
    async def from_custom_id(cls, interaction, item, match):
        return cls(int(match["id"]), match["d"])

    async def callback(self, interaction: discord.Interaction):
        await button_decision(interaction, "act", self.act_id, self.decision)


class RapButton(discord.ui.DynamicItem[discord.ui.Button], template=r"sova:rap:(?P<id>\d+):(?P<d>ok|rej)"):
    def __init__(self, rap_id: int, decision: str):
        super().__init__(discord.ui.Button(
            label="Погодити" if decision == "ok" else "Відмовити",
            style=discord.ButtonStyle.success if decision == "ok" else discord.ButtonStyle.danger,
            custom_id=f"sova:rap:{rap_id}:{decision}"))
        self.rap_id, self.decision = rap_id, decision

    @classmethod
    async def from_custom_id(cls, interaction, item, match):
        return cls(int(match["id"]), match["d"])

    async def callback(self, interaction: discord.Interaction):
        await button_decision(interaction, "rap", self.rap_id, self.decision)


def decision_view(kind: str, rid: int) -> discord.ui.View:
    v = discord.ui.View(timeout=None)
    cls = ActButton if kind == "act" else RapButton
    v.add_item(cls(rid, "ok"))
    v.add_item(cls(rid, "rej"))
    return v


async def actor_from_discord(member: discord.Member) -> dict:
    u = await db.one("SELECT * FROM users WHERE discord_id=?", str(member.id))
    if not u:
        raise Fail("У вас немає облікового запису в кабінеті «Сова». Зверніться до Голови СБУ.")
    a = await access(u, fresh=True)
    if not a["ok"]:
        raise Fail(a["why"])
    return u


async def button_decision(interaction: discord.Interaction, kind: str, rid: int, decision: str):
    try:
        actor = await actor_from_discord(interaction.user)
        if kind == "act":
            await decide_act(actor, rid, decision)
        else:
            await decide_rap(actor, rid, decision)
        await interaction.response.send_message("Рішення збережено. Сайт оновлено.", ephemeral=True)
    except Fail as e:
        await interaction.response.send_message(str(e), ephemeral=True)


async def post_card(kind: str, row: dict):
    special = f"rap:{row['type']}" if kind == "rap" else None
    ch = (await channel(special) if special in config.CHANNELS else None) or await channel(row["dept"]) or await channel("lead")
    if not ch:
        return
    embed = await (act_embed(row) if kind == "act" else rap_embed(row))
    msg = await ch.send(embed=embed)  # Discord — журнал: рішення ухвалюються лише в ЄІС «Сова»
    table = "acts" if kind == "act" else "raps"
    await db.run(f"UPDATE {table} SET ch_id=?, msg_id=? WHERE id=?", str(ch.id), str(msg.id), row["id"])


async def refresh_card(kind: str, row: dict):
    if not row.get("msg_id"):
        return
    try:
        ch = bot.get_channel(int(row["ch_id"])) or await bot.fetch_channel(int(row["ch_id"]))
        msg = await ch.fetch_message(int(row["msg_id"]))
        embed = await (act_embed(row) if kind == "act" else rap_embed(row))
        await msg.edit(embed=embed, view=None)
    except (discord.NotFound, discord.Forbidden):
        return
    if row["status"] != "wait":
        reviewer = await user(row["reviewer"]) if row.get("reviewer") else None
        author = await user(row["by_sid"])
        what = ACTS[row["type"]][0] if kind == "act" else RAP_TYPES.get(row["type"], "Рапорт")
        await post_log(row["ch_id"], row["msg_id"], style.doc_no("ЗВТ" if kind == "act" else "РАП", row["id"]), what,
                       who(author), row["status"], who(author if row["status"] == "cancel" else reviewer), row.get("reviewed"))


async def delete_doc(u: dict, kind: str, rid: int) -> dict:
    """Видалення звіту чи рапорту: автор — свій нерозглянутий/відхилений/відкликаний; Голова й заступник — будь-який (анулювання)."""
    table = "acts" if kind == "act" else "raps"
    row = await db.one(f"SELECT * FROM {table} WHERE id=?", rid)
    if not row or row["status"] == "deleted":
        raise Fail("Документ не знайдено.", 404)
    own = row["by_sid"] == u["sid"] and row["status"] in ("wait", "rej", "cancel")
    if not (own or u["rank"] >= 14):
        raise Fail("Видалити можна власний документ до погодження (або після відмови). Погоджені анулює лише керівництво СБУ.", 403)
    await db.run(f"UPDATE {table} SET status='deleted', reviewer=?, reviewed=? WHERE id=?", u["sid"], now_ms(), rid)
    if kind == "act":
        for fid in json.loads(row["files"] or "[]"):
            try:
                await delete_file(u, fid, force=True)
            except Fail:
                pass
    if row["status"] == "ok":
        await db.audit(u["sid"], "Анульовано документ", row["by_sid"], f"{'ЗВТ' if kind == 'act' else 'РАП'}-{rid:04d}")
    row = await db.one(f"SELECT * FROM {table} WHERE id=?", rid)
    await refresh_card(kind, row)
    return row


async def delete_file(u: dict, fid: str, force: bool = False):
    """Видаляє файл зі сховища (повідомлення в каналі файлів) і з бази. Власник або Голова/заступник."""
    row = await db.one("SELECT * FROM files WHERE id=?", fid)
    if not row:
        raise Fail("Файл не знайдено.", 404)
    if not force and row["uploader"] != u["sid"] and u["rank"] < 14:
        raise Fail("Видалити можна лише власний файл.", 403)
    try:
        ch = bot.get_channel(int(row["ch_id"])) or await bot.fetch_channel(int(row["ch_id"]))
        await (await ch.fetch_message(int(row["msg_id"]))).delete()
    except (discord.NotFound, discord.Forbidden, discord.HTTPException):
        pass
    await db.run("DELETE FROM files WHERE id=?", fid)
    _url_cache.pop(fid, None)


async def withdraw(u: dict, kind: str, rid: int) -> dict:
    """Виконавець відкликає власний звіт чи рапорт, поки його ще не розглянули."""
    table = "acts" if kind == "act" else "raps"
    row = await db.one(f"SELECT * FROM {table} WHERE id=?", rid)
    if not row or row["by_sid"] != u["sid"]:
        raise Fail("Відкликати можна лише власний документ.", 403)
    if row["status"] != "wait":
        raise Fail("Документ уже розглянуто — відкликати не можна.")
    await db.run(f"UPDATE {table} SET status='cancel', reviewer=NULL, reviewed=? WHERE id=?", now_ms(), rid)
    row = await db.one(f"SELECT * FROM {table} WHERE id=?", rid)
    await refresh_card(kind, row)
    return row


async def post_log(ch_id, msg_id, no: str, what: str, subject: str, status: str, by: str, t: int | None = None, note: str = ""):
    """Запис журналу про рішення: окреме повідомлення-відповідь на картку документа."""
    try:
        ch = bot.get_channel(int(ch_id)) or await bot.fetch_channel(int(ch_id))
    except (discord.NotFound, discord.Forbidden, TypeError, ValueError):
        return
    label, color, ecolor = style.STATUS.get(status, (status.upper(), "white", 0x8C96A5))
    lines = [style.kv("ДОКУМЕНТ", f"{no} · {what}", "white", True), style.kv("СТОСУЄТЬСЯ", subject, "white"),
             style.kv("РІШЕННЯ", label, color, True), style.kv("УХВАЛИВ", by or "—", "white"), style.kv("ДАТА", style.when(t), "gray")]
    if note:
        lines += [style.rule()] + [style.kv("ПРИЧИНА" if i == 0 else "", p, "white") for i, p in enumerate(style.wrap(note, 28))]
    e = style.document("ЖУРНАЛ РІШЕНЬ", ecolor, desc=style.block(*lines), footer="Рішення ухвалено в ЄІС «Сова»")
    ref = discord.MessageReference(message_id=int(msg_id), channel_id=int(ch_id), fail_if_not_exists=False) if msg_id else None
    try:
        await ch.send(embed=e, reference=ref, mention_author=False, allowed_mentions=discord.AllowedMentions.none())
    except discord.HTTPException as ex:
        log.warning("Журнал рішень: %s", ex)


# ---------------------------------------------------------------- звіти
async def create_act(u: dict, body: dict) -> dict:
    t = body.get("type")
    if t not in ACTS or not act_allowed(u, t):
        raise Fail("Цей тип дії недоступний для вашої посади або відділу.")
    ev = str(body.get("evidence", "")).strip()
    files = [f for f in body.get("files", []) if isinstance(f, str)][:10]
    if not ev.startswith(("http://", "https://")) and not files:
        raise Fail("Додайте посилання на відкат або завантажте файл. Без доказу звіт не зараховується.")
    arts = [str(a).strip() for a in body.get("arts", []) if str(a).strip()][:10]
    if ACTS[t][3] and not arts:
        raise Fail("Для затримання вкажіть статті, які оголошено затриманому.")
    qty = max(1, min(12, int(body.get("qty") or 1)))
    when = int(body.get("t") or now_ms())
    rid = await db.run("INSERT INTO acts(by_sid,dept,type,qty,t,arts,subj,evidence,files,note) VALUES(?,?,?,?,?,?,?,?,?,?)",
                       u["sid"], u["dept"], t, qty, min(when, now_ms()), json.dumps(arts, ensure_ascii=False),
                       str(body.get("subj", ""))[:200], ev[:500], json.dumps(files), str(body.get("note", ""))[:1500])
    row = await db.one("SELECT * FROM acts WHERE id=?", rid)
    await post_card("act", row)
    return row


async def decide_act(actor: dict, act_id: int, decision: str) -> dict:
    a = await db.one("SELECT * FROM acts WHERE id=?", act_id)
    if not a:
        raise Fail("Звіт не знайдено.", 404)
    if not can_approve_act(actor, a):
        raise Fail("Ви не можете розглядати цей звіт (свій звіт, уже розглянутий або інший відділ).", 403)
    await db.run("UPDATE acts SET status=?, reviewer=?, reviewed=? WHERE id=?", "ok" if decision == "ok" else "rej", actor["sid"], now_ms(), act_id)
    a = await db.one("SELECT * FROM acts WHERE id=?", act_id)
    await refresh_card("act", a)
    return a


# ---------------------------------------------------------------- рапорти
async def create_rap(u: dict, body: dict) -> dict:
    t = body.get("type")
    if t not in RAP_TYPES:
        raise Fail("Невідомий тип рапорту.")
    if await db.one("SELECT id FROM raps WHERE by_sid=? AND type=? AND status='wait'", u["sid"], t):
        raise Fail("Такий рапорт уже на розгляді.")
    data = {"reason": str(body.get("reason", ""))[:1500]}
    if t == "promo":
        pc = await promo_check(u)
        if not pc or not pc["eligible"]:
            raise Fail("Умови для підвищення не виконано.")
        data.update(to=pc["next"], points=await week_points(u["sid"]), points_prev=await week_points(u["sid"], 1))
    elif t == "vac":
        data.update(days=max(1, min(7, int(body.get("days") or 1))), **{"from": str(body.get("from", ""))[:20]})
    elif t == "transfer":
        to = body.get("to")
        if u["dept"] == "academy":
            raise Fail("Випускники Академії подають рапорт про розподіл до підрозділу.")
        if to not in OPS_DEPTS or to == u["dept"]:
            raise Fail("Оберіть інший відділ.")
        data["to"] = to
    elif t == "assign":
        if u["dept"] != "academy" or u["rank"] != 4:
            raise Fail("Рапорт про розподіл подає старший агент — випускник Академії.")
        to = body.get("to")
        if to not in OPS_DEPTS:
            raise Fail("Оберіть підрозділ.")
        data["to"] = to
    elif t == "dismiss" and not data["reason"]:
        raise Fail("Напишіть текст рапорту.")
    rid = await db.run("INSERT INTO raps(by_sid,dept,type,data,t) VALUES(?,?,?,?,?)",
                       u["sid"], u["dept"], t, json.dumps(data, ensure_ascii=False), now_ms())
    row = await db.one("SELECT * FROM raps WHERE id=?", rid)
    await post_card("rap", row)
    return row


async def decide_rap(actor: dict, rap_id: int, decision: str) -> dict:
    r = await db.one("SELECT * FROM raps WHERE id=?", rap_id)
    if not r:
        raise Fail("Рапорт не знайдено.", 404)
    if not can_approve_rap(actor, r):
        raise Fail("Ви не можете розглядати цей рапорт.", 403)
    ok = decision == "ok"
    if r["type"] in STAGES:
        data = json.loads(r["data"] or "{}")
        st = data.get("stage", "from")
        chain = STAGES[r["type"]]
        data.setdefault("visas", []).append({"stage": st, "sid": actor["sid"], "name": actor["name"], "rank": actor["rank"],
                                             "t": now_ms(), "ok": ok})
        if ok and st != chain[-1]:
            data["stage"] = chain[chain.index(st) + 1]
            await db.run("UPDATE raps SET data=? WHERE id=?", json.dumps(data, ensure_ascii=False), rap_id)
            r = await db.one("SELECT * FROM raps WHERE id=?", rap_id)
            await refresh_card("rap", r)
            await post_log(r["ch_id"], r["msg_id"], style.doc_no("РАП", rap_id), f"{RAP_TYPES[r['type']]} · віза",
                           who(await user(r["by_sid"])), "ok", who(actor), now_ms(), f"далі: {transfer_label(r, data['stage'])}")
            return r
        await db.run("UPDATE raps SET data=? WHERE id=?", json.dumps(data, ensure_ascii=False), rap_id)
    await db.run("UPDATE raps SET status=?, reviewer=?, reviewed=? WHERE id=?", "ok" if ok else "rej", actor["sid"], now_ms(), rap_id)
    if ok:
        await apply_rap(actor, r)
    r = await db.one("SELECT * FROM raps WHERE id=?", rap_id)
    await refresh_card("rap", r)
    return r


async def apply_rap(actor: dict, r: dict):
    u = await user(r["by_sid"])
    data = json.loads(r["data"] or "{}")
    if r["type"] == "promo":
        await db.run("UPDATE users SET rank=?, since=? WHERE sid=?", data["to"], now_ms(), u["sid"])
        await db.audit(actor["sid"], "Підвищення", u["sid"], f"{rank_name(data['to'] - 1)} → {rank_name(data['to'])}")
    elif r["type"] == "assign":
        await db.run("UPDATE users SET dept=? WHERE sid=?", data["to"], u["sid"])
        await db.audit(actor["sid"], "Розподіл до підрозділу", u["sid"], f"Академія → {DEPTS[data['to']]['s']}")
    elif r["type"] == "transfer":
        await db.run("UPDATE users SET dept=? WHERE sid=?", data["to"], u["sid"])
        await db.audit(actor["sid"], "Переведення", u["sid"], f"{DEPTS[u['dept']]['s']} → {DEPTS[data['to']]['s']}")
    elif r["type"] == "dismiss":
        await db.run("UPDATE users SET status='dismissed' WHERE sid=?", u["sid"])
        await db.run("DELETE FROM sessions WHERE sid=?", u["sid"])
        await db.audit(actor["sid"], "Звільнення (ПСЖ)", u["sid"], "ролі СБУ знято")
    elif r["type"] == "vac":
        await db.run("UPDATE users SET status='vacation' WHERE sid=?", u["sid"])
        await db.audit(actor["sid"], "Відпустка", u["sid"], f"{data.get('days')} діб")
    u = await user(r["by_sid"])
    if r["type"] in ("promo", "transfer", "dismiss", "assign"):
        await sync_roles(u, f"Сова: рапорт №{r['id']}")
    if r["type"] == "promo":
        await set_nick(u)
    await post_audit(actor, r["type"], u)


AUDIT_COLORS = {"Підвищення": 0x5FB37A, "Переведення": 0x6F9FD6, "Звільнення (ПСЖ)": 0xD4605A, "Відпустка": 0x6F9FD6,
                "Вийшов із сервера": 0xD4605A, "Оформлено допуск до ЄІС": 0xC9A05A, "Зміна персональних даних": 0xD9A23D}


def audit_embed(row: dict, u: dict | None, actor: dict | None = None) -> discord.Embed:
    """Запис кадрового аудиту як службовий документ (п. 1.11 Загальних правил держорганізацій)."""
    lines = [
        style.kv("ДІЯ", row["action"].upper(), "gold", True),
        style.kv("СПІВРОБІТНИК", f"{rank_name(u['rank'])} {u['name']}" if u else f"№{row['target']}", "white", True),
    ]
    if u:
        lines.append(style.kv("ЖЕТОН · ВІДДІЛ", f"№{u['sid']} · {DEPTS.get(u['dept'], DEPTS['lead'])['s']}", "cyan"))
    lines += [style.rule()] + [style.kv("ПОДРОБИЦІ" if i == 0 else "", part, "white") for i, part in enumerate(style.wrap(row["details"] or "—", 28))]
    lines += [style.rule(), style.kv("ПІДСТАВА", (f"{rank_name(actor['rank'])} {actor['name']}" if actor else "ЄІС «Сова», автоматично"), "gray"),
              style.kv("ДАТА", style.when(row["t"]), "gray")]
    return style.document("КАДРОВИЙ АУДИТ", AUDIT_COLORS.get(row["action"], 0x8C96A5), desc=style.block(*lines),
                          no=style.doc_no("АУД", row["id"]), footer="Журнал кадрового обліку СБУ")


async def send_audit(u: dict | None, actor: dict | None = None):
    """Надсилає останній запис аудиту в канал кадрового аудиту."""
    ch = await channel("audit")
    row = await db.one("SELECT * FROM audit ORDER BY id DESC LIMIT 1")
    if ch and row:
        await ch.send(embed=audit_embed(row, u, actor))


async def post_audit(actor: dict, kind: str, u: dict):
    await send_audit(u, actor)


def credentials_embed(sid: int, code: str, name: str, *, title: str = "ДОПУСК ДО ЄІС «СОВА» ОФОРМЛЕНО", warn: str | None = None) -> discord.Embed:
    """Службове посвідчення з кодом доступу (особисті повідомлення та приховані відповіді)."""
    lines = [
        style.kv("ВЛАСНИК", name, "white", True),
        style.kv("НОМЕР ЖЕТОНА", f"№{sid}", "cyan", True),
        style.kv("КОД ДОСТУПУ", code, "gold", True),
        style.rule(),
        style.c("Код доступу є службовою таємницею.", "red"),
        style.c("Не передавайте його нікому, зокрема", "gray"),
        style.c("колегам і керівництву.", "gray"),
    ]
    desc = style.block(*lines) + f"\nВхід до кабінету: **{config.SITE_URL}**"
    if warn:
        desc += f"\n\n⚠️ {warn}"
    return style.document(title, 0xC9A05A, desc=desc, footer="Положення про захист службової інформації СБУ")


def rejection_embed(name: str, note: str = "") -> discord.Embed:
    lines = [style.kv("ЗАЯВНИК", name, "white", True), style.kv("РІШЕННЯ", "У ДОПУСКУ ВІДМОВЛЕНО", "red", True)]
    if note:
        lines += [style.rule()] + [style.kv("ПРИЧИНА" if i == 0 else "", p, "white") for i, p in enumerate(style.wrap(note, 28))]
    lines += [style.rule(), style.c("Для з'ясування звертайтесь до ВКПП.", "gray")]
    return style.document("ВІДМОВА У ДОПУСКУ ДО ЄІС «СОВА»", 0xD4605A, desc=style.block(*lines), footer="Відділ кадрів та підготовки персоналу")


# ---------------------------------------------------------------- самостійна реєстрація
async def request_access(member: discord.Member, sid: int, name: str) -> int:
    """Людина подає заявку кнопкою «Отримати допуск»; заявка йде на підтвердження в канал заявок."""
    own = await db.one("SELECT sid FROM users WHERE discord_id=?", str(member.id))
    if own:
        raise Fail(f"Допуск уже оформлено на жетон №{own['sid']}. Загубили код доступу — натисніть «Відновити код доступу».")
    if await db.one("SELECT sid FROM users WHERE sid=?", sid):
        raise Fail("На цей номер жетона вже оформлено допуск іншій особі. Якщо це ваш номер — зверніться до керівництва.")
    if await db.one("SELECT id FROM access_requests WHERE status='wait' AND (discord_id=? OR sid=?)", str(member.id), sid):
        raise Fail("Заявку вже подано й вона очікує підтвердження. Код доступу надійде в особисті повідомлення.")
    rid = await db.run("INSERT INTO access_requests(discord_id,sid,name,t) VALUES(?,?,?,?)", str(member.id), sid, name[:60], now_ms())
    req = await db.one("SELECT * FROM access_requests WHERE id=?", rid)
    req["cand_id"] = await approved_candidate(sid)
    ch = await channel("access")
    if ch:
        msg = await ch.send(embed=access_embed(req, member))
        await db.run("UPDATE access_requests SET ch_id=?, msg_id=? WHERE id=?", str(ch.id), str(msg.id), rid)
    else:
        log.warning("Канал заявок на допуск не знайдено — заявку №%s збережено без картки", rid)
    return rid


async def approved_candidate(sid: int) -> int | None:
    """Номер анкети кандидата з цим Static ID, яку погодили ВВБ і ВКПП (якщо є)."""
    row = await db.one("SELECT id FROM candidates WHERE sid=? AND status='ok' ORDER BY id DESC", sid)
    return row["id"] if row else None


def can_approve_access(member: discord.Member) -> bool:
    ids = {r.id for r in member.roles}
    if ids & set(config.ACCESS_APPROVER_ROLES):
        return True
    a = resolve(ids)
    return a["ok"] and a["rank"] >= 14  # Голова й заступник теж можуть


def access_embed(req: dict, member: discord.Member | None) -> discord.Embed:
    _, _, color = style.STATUS[req["status"]]
    lines = [
        style.kv("ЗАЯВНИК", req["name"], "white", True),
        style.kv("НОМЕР ЖЕТОНА", f"№{req['sid']}", "cyan", True),
    ]
    if member:
        a = resolve({r.id for r in member.roles})
        lines.append(style.kv("СЛУЖБОВИЙ СТАТУС", f"{rank_name(a['rank'])} · {DEPTS[a['dept']]['s']}" if a["ok"] else "не у складі СБУ",
                              "green" if a["ok"] else "gray"))
        age = (discord.utils.utcnow() - member.created_at).days
        lines.append(style.kv("АКАУНТ DISCORD", f"{age} дн." + ("  ⚠ новий" if age < 14 else ""), "red" if age < 14 else "white"))
    if req.get("cand_id"):
        lines.append(style.kv("АНКЕТА", f"АНК-{req['cand_id']:04d} · погоджено ВВБ і ВКПП", "green", True))
    lines += [style.kv("ПОДАНО", style.when(req["t"]), "gray"), style.rule()]
    if req["status"] == "wait":
        lines.append(style.kv("РЕЗОЛЮЦІЯ", "очікує рішення ВКПП", "gold", True))
    else:
        lines.append(style.kv("РЕЗОЛЮЦІЯ", {"ok": "ДОПУСК НАДАНО", "deleted": "ЗАЯВКУ ВИДАЛЕНО"}.get(req["status"], "ВІДМОВЛЕНО"),
                              {"ok": "green", "deleted": "gray"}.get(req["status"], "red"), True))
        if req.get("reviewer_name"):
            lines.append(style.kv("", req["reviewer_name"], "white"))
        lines.append(style.kv("", style.when(req["reviewed"]), "gray"))
    return style.document("ЗАЯВКА НА ДОПУСК ДО ЄІС «СОВА»", color, desc=f"Discord: <@{req['discord_id']}>\n" + style.block(*lines),
                          no=style.doc_no("ЗД", req["id"]), footer="Розгляд ВКПП: ЄІС «Сова» → Кадри")


class AccessButton(discord.ui.DynamicItem[discord.ui.Button], template=r"sova:acc:(?P<id>\d+):(?P<d>ok|rej)"):
    def __init__(self, req_id: int, decision: str):
        super().__init__(discord.ui.Button(
            label="Підтвердити допуск" if decision == "ok" else "Відмовити",
            style=discord.ButtonStyle.success if decision == "ok" else discord.ButtonStyle.danger,
            custom_id=f"sova:acc:{req_id}:{decision}"))
        self.req_id, self.decision = req_id, decision

    @classmethod
    async def from_custom_id(cls, interaction, item, match):
        return cls(int(match["id"]), match["d"])

    async def callback(self, interaction: discord.Interaction):
        try:
            text = await decide_access(self.req_id, interaction.user, self.decision)
            await interaction.response.send_message(text, ephemeral=True)
        except Fail as e:
            await interaction.response.send_message(str(e), ephemeral=True)


def access_view(req_id: int) -> discord.ui.View:
    v = discord.ui.View(timeout=None)
    v.add_item(AccessButton(req_id, "ok"))
    v.add_item(AccessButton(req_id, "rej"))
    return v


async def decide_access(req_id: int, reviewer: discord.Member, decision: str) -> str:
    if not isinstance(reviewer, discord.Member) or not can_approve_access(reviewer):
        raise Fail("Підтверджувати заявки на допуск може лише ВКПП або керівництво СБУ.")
    req = await db.one("SELECT * FROM access_requests WHERE id=?", req_id)
    if not req or req["status"] != "wait":
        raise Fail("Цю заявку вже розглянуто.")
    member = await member_of(req["discord_id"])
    note = ""
    if decision == "ok":
        if not member:
            decision, note = "rej", "Людина вже не на сервері."
        else:
            # Кандидат, чию анкету погодили ВВБ і ВКПП, при оформленні допуску отримує ще й звання «Стажер»
            cand = await approved_candidate(req["sid"])
            try:
                _, pw = await register(member, req["sid"], req["name"], reviewer, extra_roles=(RANK_ROLES[0],) if cand else ())
                if cand:
                    await db.run("UPDATE candidates SET discord_id=? WHERE id=?", str(member.id), cand)
            except Fail as e:
                decision, note = "rej", str(e)
    await db.run("UPDATE access_requests SET status=?, reviewer=?, reviewed=? WHERE id=?",
                 "ok" if decision == "ok" else "rej", str(reviewer.id), now_ms(), req_id)
    req = await db.one("SELECT * FROM access_requests WHERE id=?", req_id)
    req["reviewer_name"] = reviewer.display_name
    req["cand_id"] = await approved_candidate(req["sid"])
    if req["ch_id"] and req["msg_id"]:
        try:
            ch = bot.get_channel(int(req["ch_id"])) or await bot.fetch_channel(int(req["ch_id"]))
            msg = await ch.fetch_message(int(req["msg_id"]))
            await msg.edit(embed=access_embed(req, member), view=None)
        except (discord.NotFound, discord.Forbidden):
            pass
        await post_log(req["ch_id"], req["msg_id"], style.doc_no("ЗД", req_id), "Заявка на допуск до ЄІС",
                       f"{req['name']} · №{req['sid']}", "ok" if decision == "ok" else "rej", reviewer.display_name, req["reviewed"], note)
    if decision == "ok":
        sent = False
        try:
            await member.send(embed=credentials_embed(req["sid"], pw, req["name"], title="ДОПУСК ДО ЄІС «СОВА» ПІДТВЕРДЖЕНО"),
                              view=style.site_view())
            sent = True
        except discord.Forbidden:
            pass
        return ("Допуск видано, код доступу надіслано в особисті." if sent else
                "Допуск видано, але особисті повідомлення закриті. Нехай людина натисне «Відновити код доступу» в панелі.")
    if member:
        try:
            await member.send(embed=rejection_embed(req["name"], note))
        except discord.Forbidden:
            pass
    return "Заявку відхилено." + (f" Причина: {note}" if note else "")


async def delete_access(u: dict, req_id: int):
    """Видалення заявки на допуск (спам, дубль) — ВКПП або керівництво."""
    req = await db.one("SELECT * FROM access_requests WHERE id=?", req_id)
    if not req or req["status"] == "deleted":
        raise Fail("Заявку не знайдено.", 404)
    await db.run("UPDATE access_requests SET status='deleted', reviewed=? WHERE id=?", now_ms(), req_id)
    req = await db.one("SELECT * FROM access_requests WHERE id=?", req_id)
    req["reviewer_name"] = u["name"]
    if req["ch_id"] and req["msg_id"]:
        try:
            ch = bot.get_channel(int(req["ch_id"])) or await bot.fetch_channel(int(req["ch_id"]))
            msg = await ch.fetch_message(int(req["msg_id"]))
            await msg.edit(embed=access_embed(req, await member_of(req["discord_id"])), view=None)
        except (discord.NotFound, discord.Forbidden):
            pass
        await post_log(req["ch_id"], req["msg_id"], style.doc_no("ЗД", req_id), "Заявка на допуск до ЄІС",
                       f"{req['name']} · №{req['sid']}", "deleted", u["name"], req["reviewed"])


async def register(member: discord.Member, sid: int, name: str, reviewer: discord.Member | None = None,
                   extra_roles: tuple[int, ...] = ()) -> tuple[dict, str]:
    """Створює допуск (після підтвердження заявки або командою Голови): ролі, нікнейм, код доступу."""
    if await db.one("SELECT sid FROM users WHERE discord_id=?", str(member.id)):
        raise Fail("Цій людині допуск уже оформлено.")
    if await db.one("SELECT sid FROM users WHERE sid=?", sid):
        raise Fail("На цей номер жетона вже оформлено допуск іншій особі.")
    give = [r for r in (member.guild.get_role(rid) for rid in (*config.JOIN_ROLES, *extra_roles)) if r and r not in member.roles]
    if resolve({r.id for r in member.roles}).get("dept") == "prosecutor":
        give = []  # Генеральному прокурору ролі СБУ не видаються
    if give:
        try:
            await member.add_roles(*give, reason="Сова: оформлено допуск до ЄІС")
        except discord.Forbidden:
            log.warning("Не можу видати ролі %s — роль бота має бути вище цих ролей", member)
    _roles_cache.pop(str(member.id), None)
    a = resolve({r.id for r in member.roles} | {r.id for r in give})
    rank, dept = (a["rank"], a["dept"]) if a["ok"] else (1, "academy")
    pw = new_password()
    t = now_ms()
    await db.run("INSERT INTO users(sid,name,discord_id,pw_hash,pw_set,rank,dept,since,created) VALUES(?,?,?,?,?,?,?,?,?)",
                 sid, name[:60], str(member.id), hash_password(pw), t, rank, dept, t, t)
    approver = await db.one("SELECT sid FROM users WHERE discord_id=?", str(reviewer.id)) if reviewer else None
    await db.audit(approver["sid"] if approver else 0, "Оформлено допуск до ЄІС", sid,
                   f"{'підтвердив ' + reviewer.display_name if reviewer else 'через Discord'} · {rank_name(rank) if a['ok'] else 'без ролей СБУ'}")
    new_u = {"sid": sid, "name": name[:60], "rank": rank, "dept": dept, "discord_id": str(member.id)}
    if a["ok"]:
        await set_nick(new_u, member)
    await send_audit(new_u, await user(approver["sid"]) if approver else None)
    return a, pw


async def change_name(member: discord.Member, name: str) -> dict:
    """Зміна імені персонажа: оновлює картку й нікнейм, повідомляє керівництво через кадровий аудит."""
    u = await db.one("SELECT * FROM users WHERE discord_id=?", str(member.id))
    if not u:
        raise Fail("Допуск ще не оформлено. Натисніть «Отримати допуск».")
    old = u["name"]
    await db.run("UPDATE users SET name=? WHERE sid=?", name[:60], u["sid"])
    u["name"] = name[:60]
    await db.audit(0, "Зміна персональних даних", u["sid"], f"{old} → {u['name']}")
    await send_audit(u)
    await set_nick(u, member)
    return u


async def reset_own_password(member: discord.Member) -> tuple[dict, str]:
    u = await db.one("SELECT * FROM users WHERE discord_id=?", str(member.id))
    if not u:
        raise Fail("Допуск ще не оформлено. Натисніть «Отримати допуск».")
    pw = new_password()
    await db.run("UPDATE users SET pw_hash=?, pw_set=? WHERE sid=?", hash_password(pw), now_ms(), u["sid"])
    await db.run("DELETE FROM sessions WHERE sid=?", u["sid"])
    await db.audit(0, "Новий код доступу", u["sid"], "самостійно через Discord, попередні входи завершено")
    return u, pw


async def member_left(member: discord.Member):
    """Вийшов або кікнули з сервера — усі входи в кабінет завершуються одразу."""
    u = await db.one("SELECT * FROM users WHERE discord_id=?", str(member.id))
    _roles_cache.pop(str(member.id), None)
    if not u:
        return
    await db.run("DELETE FROM sessions WHERE sid=?", u["sid"])
    await db.audit(0, "Вийшов із сервера", u["sid"], "доступ до кабінету закрито автоматично")
    await send_audit(u)


# ---------------------------------------------------------------- файли
_url_cache: dict[str, tuple[float, str]] = {}


async def store_file(data: bytes, filename: str, ctype: str, uploader: int) -> str:
    if len(data) > config.MAX_UPLOAD_MB * 1024 * 1024:
        raise Fail(f"Файл більший за {config.MAX_UPLOAD_MB:g} МБ.", 413)
    ch = await channel("files")
    if not ch:
        raise Fail("Сховище файлів ще не налаштовано.", 503)
    msg = await ch.send(content=f"Файл від №{uploader}", file=discord.File(io.BytesIO(data), filename=filename[:100] or "file"))
    fid = secrets.token_urlsafe(12)
    await db.run("INSERT INTO files(id,ch_id,msg_id,filename,ctype,size,uploader,t) VALUES(?,?,?,?,?,?,?,?)",
                 fid, str(ch.id), str(msg.id), filename[:100], ctype[:100], len(data), uploader, now_ms())
    return fid


async def file_url(fid: str) -> str:
    """Посилання Discord на файл живе ~доба, тож щоразу беремо свіже з повідомлення."""
    hit = _url_cache.get(fid)
    if hit and time.time() - hit[0] < 6 * 3600:
        return hit[1]
    row = await db.one("SELECT * FROM files WHERE id=?", fid)
    if not row:
        raise Fail("Файл не знайдено.", 404)
    ch = bot.get_channel(int(row["ch_id"])) or await bot.fetch_channel(int(row["ch_id"]))
    msg = await ch.fetch_message(int(row["msg_id"]))
    if not msg.attachments:
        raise Fail("Файл видалено з Discord.", 410)
    _url_cache[fid] = (time.time(), msg.attachments[0].url)
    return msg.attachments[0].url
