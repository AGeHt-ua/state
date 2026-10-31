"""Ядро «Сови»: доступ, звіти, рапорти, файли, картки в Discord. Сайт і кнопки в Discord викликають ті самі функції."""
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
             "dismiss": "Рапорт на звільнення (ПСЖ)", "transfer": "Рапорт на переведення між відділами"}


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


async def member_of(discord_id: str | int) -> discord.Member | None:
    g = guild()
    if not g:
        raise Fail("Бот ще не підключився до Discord. Спробуйте за хвилину.", 503)
    m = g.get_member(int(discord_id))
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
    m = await member_of(discord_id)
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
    if u.get("status") == "dismissed" or not u.get("discord_id"):
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
    keep_dept = u["dept"] == "lead"  # керівництво зберігає роль свого відділу
    remove = {r for r in have - want if not (keep_dept and r in {DEPTS[d]["role"] for d in OPS_DEPTS})}
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


def can_approve_rap(actor: dict, r: dict) -> bool:
    if r["by_sid"] == actor["sid"] or r["status"] != "wait":
        return False
    data = json.loads(r["data"] or "{}")
    if r["type"] == "dismiss":
        return actor["rank"] >= 14
    if r["type"] == "promo" and RANKS[data["to"] - 1][2] is None:
        return actor["rank"] == 15
    if r["type"] == "transfer":
        return actor["rank"] >= 13
    if r["dept"] == "academy":
        return (actor["dept"] == "vkpp" and actor["rank"] >= 11) or actor["rank"] >= 13
    if r["dept"] == "press":
        return actor["rank"] >= 13
    return actor["rank"] >= 11 and (actor["dept"] == r["dept"] or actor["dept"] == "lead")


async def promo_check(u: dict) -> dict | None:
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
    pending = await db.one("SELECT id FROM raps WHERE by_sid=? AND type='promo' AND status='wait'", u["sid"])
    if pending:
        items.append({"ok": False, "t": f"Рапорт №{pending['id']} уже на розгляді"})
    return {"next": nxt, "name": name, "items": items, "eligible": all(i["ok"] for i in items)}


# ---------------------------------------------------------------- канали
CHANNEL_KEYS = list(DEPTS) + ["audit", "files", "backups"]


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


STATUS = {"wait": ("🟡 На перевірці", 0xD9A23D), "ok": ("🟢 Підтверджено", 0x5FB37A), "rej": ("🔴 Відхилено", 0xD4605A)}


async def act_embed(a: dict) -> discord.Embed:
    author = await user(a["by_sid"])
    c = await coef()
    st, color = STATUS[a["status"]]
    e = discord.Embed(title=f"Звіт №{a['id']} · {ACTS[a['type']][0]}", color=DEPTS.get(a["dept"], {}).get("color", color) if a["status"] == "wait" else color)
    e.add_field(name="Співробітник", value=f"{who(author)}\n{rank_name(author['rank']) if author else ''}")
    e.add_field(name="Кількість · бали", value=f"{a['qty']} · {c.get(a['type'], 0) * a['qty']} б.")
    e.add_field(name="Час", value=f"<t:{a['t'] // 1000}:f>")
    arts = json.loads(a["arts"] or "[]")
    if arts:
        e.add_field(name="Статті КК", value=", ".join(arts))
    if a["subj"]:
        e.add_field(name="Фігурант", value=a["subj"][:200])
    if a["evidence"]:
        e.add_field(name="Доказ", value=f"[Відкат]({a['evidence']})", inline=False)
    if a["note"]:
        e.add_field(name="Коментар", value=a["note"][:900], inline=False)
    footer = st
    if a["reviewer"]:
        footer += f" · {who(await user(a['reviewer']))}"
    e.set_footer(text=f"{footer} · {DEPTS.get(a['dept'], {}).get('s', '')}")
    return e


async def rap_embed(r: dict) -> discord.Embed:
    author = await user(r["by_sid"])
    data = json.loads(r["data"] or "{}")
    st, color = STATUS[r["status"]]
    e = discord.Embed(title=f"Рапорт №{r['id']} · {RAP_TYPES[r['type']]}", color=0xC9A05A if r["status"] == "wait" else color)
    e.add_field(name="Співробітник", value=f"{who(author)}\n{rank_name(author['rank']) if author else ''} · {DEPTS.get(r['dept'], {}).get('s', '')}")
    if r["type"] == "promo":
        e.add_field(name="Підвищення", value=f"{rank_name(data['to'] - 1)} → **{rank_name(data['to'])}**")
        if data.get("points") is not None:
            e.add_field(name="Бали: цей / минулий тиждень", value=f"{data['points']} / {data.get('points_prev', 0)}")
    elif r["type"] == "vac":
        e.add_field(name="Відпустка", value=f"{data.get('days')} діб з {data.get('from', '—')}")
    elif r["type"] == "transfer":
        e.add_field(name="Переведення", value=f"{DEPTS[r['dept']]['s']} → **{DEPTS[data['to']]['s']}**")
    if data.get("reason"):
        e.add_field(name="Обґрунтування", value=data["reason"][:900], inline=False)
    footer = st if r["status"] != "ok" else "🟢 Погоджено"
    if r["reviewer"]:
        footer += f" · {who(await user(r['reviewer']))}"
    e.set_footer(text=footer)
    return e


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
    msg = await ch.send(embed=embed, view=decision_view(kind, row["id"]))
    table = "acts" if kind == "act" else "raps"
    await db.run(f"UPDATE {table} SET ch_id=?, msg_id=? WHERE id=?", str(ch.id), str(msg.id), row["id"])


async def refresh_card(kind: str, row: dict):
    if not row.get("msg_id"):
        return
    try:
        ch = bot.get_channel(int(row["ch_id"])) or await bot.fetch_channel(int(row["ch_id"]))
        msg = await ch.fetch_message(int(row["msg_id"]))
        embed = await (act_embed(row) if kind == "act" else rap_embed(row))
        await msg.edit(embed=embed, view=decision_view(kind, row["id"]) if row["status"] == "wait" else None)
    except (discord.NotFound, discord.Forbidden):
        pass


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
        if to not in OPS_DEPTS or to == u["dept"]:
            raise Fail("Оберіть інший відділ.")
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
    if r["type"] in ("promo", "transfer", "dismiss"):
        await sync_roles(u, f"Сова: рапорт №{r['id']}")
    if r["type"] == "promo":
        await set_nick(u)
    await post_audit(actor, r["type"], u)


async def post_audit(actor: dict, kind: str, u: dict):
    ch = await channel("audit")
    row = await db.one("SELECT * FROM audit ORDER BY id DESC LIMIT 1")
    if ch and row:
        await ch.send(f"**{row['action']}** · {who(u)} · {row['details']}\nРішення: {who(actor)}")


# ---------------------------------------------------------------- самостійна реєстрація
async def register(member: discord.Member, sid: int, name: str) -> tuple[dict, str]:
    """Акаунт створює сама людина кнопкою в Discord. Доступ до кабінету все одно дають лише ролі СБУ."""
    own = await db.one("SELECT sid FROM users WHERE discord_id=?", str(member.id))
    if own:
        raise Fail(f"Допуск уже оформлено на жетон №{own['sid']}. Загубили код доступу — натисніть «Відновити код доступу».")
    if await db.one("SELECT sid FROM users WHERE sid=?", sid):
        raise Fail("На цей номер жетона вже оформлено допуск іншій особі. Якщо це ваш номер — зверніться до Голови СБУ.")
    give = [r for r in (member.guild.get_role(rid) for rid in config.JOIN_ROLES) if r and r not in member.roles]
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
    await db.audit(0, "Оформлено допуск до ЄІС", sid, f"самостійно через Discord · {rank_name(rank) if a['ok'] else 'без ролей СБУ'}")
    if a["ok"]:
        await set_nick({"sid": sid, "name": name[:60], "rank": rank, "discord_id": str(member.id)}, member)
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
    ch = await channel("audit")
    if ch:
        await ch.send(f"**Зміна персональних даних** · №{u['sid']} · {old} → **{u['name']}**")
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
    await db.audit(0, "Вийшов із сервера", u["sid"], "доступ до кабінету закрито")
    ch = await channel("audit")
    if ch:
        await ch.send(f"**Вийшов із сервера** · {who(u)} · {rank_name(u['rank'])} · доступ до кабінету закрито")


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
