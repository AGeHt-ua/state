"""Анкети кандидатів на службу: кандидат подає анкету → ВВБ перевіряє й погоджує → ВКПП приймає на службу (ролі, допуск, код)."""
import io
import json
import logging
import re

import discord

import core
import style
from core import Fail
from db import db, now_ms
from roles import DEPTS, RANK_ROLES, resolve

log = logging.getLogger("sova.cand")

STAGE = {  # статус: (напис, колір ANSI, колір embed)
    "vvb": ("ПЕРЕВІРКА ВВБ", "gold", 0xD9A23D),
    "vkpp": ("ПОГОДЖЕНО ВВБ · ОЧІКУЄ ВКПП", "cyan", 0x6F9FD6),
    "ok": ("ПОГОДЖЕНО ВКПП · ЗАПРОСИТИ НА СЕРВЕР", "green", 0x5FB37A),
    "rej": ("ВІДМОВЛЕНО", "red", 0xD4605A),
}


def can_vvb(member: discord.Member) -> bool:
    ids = {r.id for r in member.roles}
    a = resolve(ids)
    return DEPTS["vvb"]["role"] in ids or (a["ok"] and a["rank"] >= 13)


async def find_member(username: str) -> discord.Member | None:
    """Пошук учасника сервера СБУ за ніком Discord (REST, працює без Server Members Intent)."""
    q = username.strip().lstrip("@").lower()
    g = core.guild()
    if not q or not g:
        return None
    if q.isdigit():
        return await core.member_of(q)
    try:
        rows = await core.bot.http.request(discord.http.Route("GET", "/guilds/{guild_id}/members/search", guild_id=g.id),
                                           params={"query": q, "limit": 10})
    except discord.HTTPException as e:
        log.warning("Пошук учасника %s: %s", q, e)
        return None
    for r in rows:
        u = r["user"]
        if q in (u["username"].lower(), (u.get("global_name") or "").lower(), (r.get("nick") or "").lower()):
            return await core.member_of(u["id"])
    return None


async def submit_public(username: str, sid: int, name: str, age: str, exp: str, motive: str) -> int:
    """Анкета з публічної сторінки сайту (без входу): кандидата шукаємо на сервері за ніком Discord."""
    username = username.strip().lstrip("@")[:40]
    if not re.fullmatch(r"[\w.]{2,40}", username):
        raise Fail("Вкажіть нік Discord (username), напр. agent.smith.")
    if len(name.split()) < 2:
        raise Fail("Вкажіть ім'я та прізвище персонажа.")
    if len(motive) < 20:
        raise Fail("Розпишіть мотивацію детальніше (щонайменше 20 символів).")
    return await submit(await find_member(username), sid, name, age, exp, motive, username=username)


IMG_MAGIC = {b"\x89PNG": "png", b"\xff\xd8\xff": "jpg", b"RIFF": "webp"}

# Документи й ліцензії — за Законом «Про державні документи» штату NG
DOCS = {"passport": "Паспорт громадянина", "med": "Медична карта", "military": "Військовий квиток", "idcard": "Посвідчення особи"}
REQUIRED_DOCS = ("passport", "med", "military")  # п. 1.4 Положення про стажування СБУ, ст. 8 Закону «Про державні документи»
DRIVE = {"A": "A", "B": "B", "CD": "C/D", "water": "водний", "air": "повітряний"}
LICS = {"weapon": "на зброю", "hunt": "на полювання", "fish": "на рибальство"}
HOUSING = {"none": "немає", "flat": "квартира", "house": "будинок", "rent": "орендоване"}


def clean_extra(b: dict) -> dict:
    """Розширена анкета з сайту: лише відомі поля, обрізані до розумної довжини."""
    s = lambda k, n=200: str(b.get(k) or "").strip()[:n]
    pick = lambda k, allowed: [v for v in (b.get(k) or []) if v in allowed]
    return {
        "birth": s("birth", 20), "phone": s("phone", 20), "gender": s("gender", 10),
        "docs": pick("docs", DOCS), "drive": pick("drive", DRIVE), "lics": pick("lics", LICS),
        "housing": s("housing", 10) if b.get("housing") in HOUSING else "none", "housing_note": s("housing_note"),
        "cars": s("cars"), "business": s("business"),
        "record": bool(b.get("record")), "record_note": s("record_note", 400), "admin_note": s("admin_note", 300),
        "wanted": bool(b.get("wanted")), "warn": bool(b.get("warn")), "fired_1d": bool(b.get("fired_1d")),
        "online": s("online", 60), "tz": s("tz", 30),
    }


async def submit_form(username: str, b: dict, photo: tuple[bytes, str] | None) -> int:
    """Розширена анкета з публічної сторінки сайту."""
    sid = str(b.get("sid") or "").strip()
    if not sid.isdigit() or len(sid) > 8:
        raise Fail("Static ID — лише цифри.")
    extra = clean_extra(b)
    if not photo:
        raise Fail("Додайте фото персонажа (IC).")
    data, _ = photo
    ext = next((e for m, e in IMG_MAGIC.items() if data.startswith(m)), None)
    if not ext:
        raise Fail("Фото має бути PNG, JPG або WEBP.")
    if len(data) > 5 * 1024 * 1024:
        raise Fail("Фото більше за 5 МБ.")
    name = str(b.get("name") or "").strip()
    username = username.strip().lstrip("@")[:40]
    if not re.fullmatch(r"[\w.]{2,40}", username):
        raise Fail("Вкажіть нік Discord (username), напр. agent.smith.")
    if len(name.split()) < 2:
        raise Fail("Вкажіть ім'я та прізвище персонажа.")
    motive = str(b.get("motive") or "").strip()
    if len(motive) < 20:
        raise Fail("Розпишіть мотивацію детальніше (щонайменше 20 символів).")
    extra["photo_name"] = f"photo.{ext}"
    fid = await core.store_file(data, extra["photo_name"], f"image/{'jpeg' if ext == 'jpg' else ext}", 0)
    return await submit(None, int(sid), name, str(b.get("age") or "").strip(), str(b.get("exp") or "").strip(),
                        motive, username=username, extra=extra, photo=fid)


async def photo_file(c: dict) -> discord.File | None:
    """Фото кандидата як вкладення для картки в Discord (береться зі сховища файлів)."""
    if not c.get("photo"):
        return None
    try:
        row = await db.one("SELECT * FROM files WHERE id=?", c["photo"])
        ch = core.bot.get_channel(int(row["ch_id"])) or await core.bot.fetch_channel(int(row["ch_id"]))
        msg = await ch.fetch_message(int(row["msg_id"]))
        return discord.File(io.BytesIO(await msg.attachments[0].read()), filename=row["filename"])
    except Exception as e:
        log.warning("Фото анкети №%s недоступне: %s", c["id"], e)
        return None


async def submit(member: discord.Member | None, sid: int, name: str, age: str, exp: str, motive: str, username: str | None = None,
                 extra: dict | None = None, photo: str | None = None) -> int:
    did = str(member.id) if member else ""
    if member and await db.one("SELECT sid FROM users WHERE discord_id=?", did):
        raise Fail("Ви вже у складі СБУ й маєте допуск до «Сови».")
    if await db.one("SELECT sid FROM users WHERE sid=?", sid):
        raise Fail("Цей номер жетона вже закріплено за співробітником СБУ.")
    if await db.one("SELECT id FROM candidates WHERE status IN ('vvb','vkpp') AND ((discord_id=? AND discord_id!='') OR sid=?)", did, sid):
        raise Fail("Анкету на цей Static ID або Discord уже розглядають. Рішення надійде в особисті повідомлення.")
    cid = await db.run("INSERT INTO candidates(discord_id,discord_name,sid,name,age,exp,motive,t,extra,photo) VALUES(?,?,?,?,?,?,?,?,?,?)",
                       did, username or (member.name if member else ""), sid, name[:60], age[:60], exp[:500], motive[:800], now_ms(),
                       json.dumps(extra, ensure_ascii=False) if extra else None, photo)
    c = await db.one("SELECT * FROM candidates WHERE id=?", cid)
    ch = await core.channel("vvb")
    if ch:
        f = await photo_file(c)
        msg = await ch.send(embed=await card(c, member), view=view(cid, "vvb"), **({"file": f} if f else {}))
        await db.run("UPDATE candidates SET vvb_ch=?, vvb_msg=? WHERE id=?", str(ch.id), str(msg.id), cid)
    else:
        log.warning("Канал ВВБ не знайдено — анкету №%s збережено без картки", cid)
    return cid


async def _name(discord_id: str | None) -> str:
    if not discord_id:
        return ""
    m = await core.member_of(discord_id)
    return m.display_name if m else f"ID {discord_id}"


async def card(c: dict, member: discord.Member | None) -> discord.Embed:
    label, color, ecolor = STAGE[c["status"]]
    lines = [style.kv("КАНДИДАТ", c["name"], "white", True), style.kv("STATIC ID", f"№{c['sid']}", "cyan", True),
             style.kv("ВІК / ОНЛАЙН", c["age"] or "—", "white")]
    if member:
        days = (discord.utils.utcnow() - member.created_at).days
        lines.append(style.kv("АКАУНТ DISCORD", f"{days} дн." + ("  ⚠ новий" if days < 14 else ""), "red" if days < 14 else "white"))
    lines += [style.kv("ПОДАНО", style.when(c["t"]), "gray"), style.rule()]
    x = json.loads(c.get("extra") or "null")
    if x:
        lines += dossier(x)
    else:
        lines += [style.kv("ДОСВІД" if i == 0 else "", p, "white") for i, p in enumerate(style.wrap(c["exp"] or "—", 28))]
        lines.append(style.rule())
        lines += [style.kv("МОТИВАЦІЯ" if i == 0 else "", p, "white") for i, p in enumerate(style.wrap(c["motive"] or "—", 28))]
        lines.append(style.rule())
    if c["vvb_t"]:
        lines.append(style.kv("ВВБ", f"{'погоджено' if c['status'] != 'rej' or c['vkpp_t'] else 'відмовлено'} · {await _name(c['vvb_by'])}",
                              "green" if c["status"] != "rej" or c["vkpp_t"] else "red"))
    if c["vkpp_t"]:
        lines.append(style.kv("ВКПП", f"{'погоджено' if c['status'] == 'ok' else 'відмовлено'} · {await _name(c['vkpp_by'])}",
                              "green" if c["status"] == "ok" else "red"))
    lines.append(style.kv("СТАН", label, color, True))
    if c["note"]:
        lines += [style.kv("ПРИЧИНА" if i == 0 else "", p, "white") for i, p in enumerate(style.wrap(c["note"], 28))]
    footer = {"vvb": "Перевірка Відділом внутрішньої безпеки", "vkpp": "Рішення Відділу кадрів та підготовки персоналу"}.get(c["status"], "Розгляд завершено")
    who = f"<@{c['discord_id']}>" if c["discord_id"] else f"`{c.get('discord_name') or '—'}`"
    e = style.document("АНКЕТА КАНДИДАТА НА СЛУЖБУ", ecolor, desc=f"Discord для зв'язку: {who}\n" + style.block(*lines),
                       no=style.doc_no("АНК", c["id"]), footer=footer)
    if x:  # довгі тексти — окремими полями, щоб не перевищити ліміт опису Discord
        for title, val in (("⚖️ Судимості та адмінпорушення", "\n".join(v for v in (x.get("record_note"), x.get("admin_note")) if v)),
                           ("🎖️ Досвід у державних структурах", c["exp"]), ("📝 Мотивація", c["motive"])):
            if val:
                e.add_field(name=title, value=val[:1024], inline=False)
    if x and c.get("photo") and x.get("photo_name"):
        e.set_image(url=f"attachment://{x['photo_name']}")
    return e


def dossier(x: dict) -> list[str]:
    """Розширені дані анкети: особа, документи (з перевіркою вимог закону), майно, правова історія."""
    yn = lambda ok: ("✔", "green") if ok else ("✖", "red")
    out = []
    if x.get("birth"):
        out.append(style.kv("ДАТА НАРОДЖ.", x["birth"], "white"))
    if x.get("phone"):
        out.append(style.kv("ТЕЛЕФОН (IC)", x["phone"], "white"))
    if x.get("online") or x.get("tz"):
        out.append(style.kv("ОНЛАЙН / ПОЯС", " · ".join(v for v in (x.get("online"), x.get("tz")) if v), "white"))
    out.append(style.rule())
    out.append(style.c("ДОКУМЕНТИ", "gold", True))
    for k, label in DOCS.items():
        mark, col = yn(k in x.get("docs", []))
        if k in REQUIRED_DOCS or k in x.get("docs", []):
            out.append(style.c(f" {mark} ", col, True) + style.c(label + (" *" if k in REQUIRED_DOCS else ""), "white"))
    out.append(style.kv("ПОСВ. ВОДІЯ", ", ".join(DRIVE[d] for d in x.get("drive", [])) or "немає", "white"))
    out.append(style.kv("ЛІЦЕНЗІЇ", ", ".join(LICS[l] for l in x.get("lics", [])) or "немає", "white"))
    missing = [DOCS[d] for d in REQUIRED_DOCS if d not in x.get("docs", [])]
    if missing:
        out.append(style.c("⚠ Не відповідає вимогам: " + ", ".join(missing).lower(), "red", True))
    out += [style.rule(), style.c("МАЙНО", "gold", True),
            style.kv("ЖИТЛО", HOUSING.get(x.get("housing"), "—") + (f" · {x['housing_note']}" if x.get("housing_note") else ""), "white")]
    out += [style.kv("ТРАНСПОРТ" if i == 0 else "", p, "white") for i, p in enumerate(style.wrap(x.get("cars") or "немає", 28))]
    out += [style.kv("БІЗНЕС" if i == 0 else "", p, "white") for i, p in enumerate(style.wrap(x.get("business") or "немає", 28))]
    out += [style.rule(), style.c("ПРАВОВА ІСТОРІЯ", "gold", True)]
    out.append(style.kv("СУДИМОСТІ", "є" if x.get("record") else "немає", "red" if x.get("record") else "green", True))
    out.append(style.kv("У РОЗШУКУ", "так" if x.get("wanted") else "ні", "red" if x.get("wanted") else "green", True))
    flags = [t for k, t in (("warn", "активний Warn (п. 1.38)"), ("fired_1d", "звільнення з держструктури < 1 доби (п. 1.35/1.37)")) if x.get(k)]
    for t in flags:
        out.append(style.c("⚠ " + t, "red", True))
    out.append(style.rule())
    return out


async def _refresh(c: dict, member: discord.Member | None):
    for chk, mk in (("vvb_ch", "vvb_msg"), ("vkpp_ch", "vkpp_msg")):
        if not c[chk] or not c[mk]:
            continue
        stage = {"vvb_ch": "vvb", "vkpp_ch": "vkpp"}[chk]
        try:
            ch = core.bot.get_channel(int(c[chk])) or await core.bot.fetch_channel(int(c[chk]))
            msg = await ch.fetch_message(int(c[mk]))
            await msg.edit(embed=await card(c, member), view=view(c["id"], stage) if c["status"] == stage else None)
        except (discord.NotFound, discord.Forbidden):
            pass


async def _dm(member: discord.Member | None, **kw):
    if not member:
        return False
    try:
        await member.send(**kw)
        return True
    except discord.Forbidden:
        return False


async def decide(cid: int, reviewer: discord.Member, decision: str, note: str = "") -> str:
    c = await db.one("SELECT * FROM candidates WHERE id=?", cid)
    if not c or c["status"] not in ("vvb", "vkpp"):
        raise Fail("Цю анкету вже розглянуто.")
    stage = c["status"]
    if stage == "vvb" and not can_vvb(reviewer):
        raise Fail("Перевіряти анкети кандидатів може лише ВВБ або керівництво СБУ.")
    if stage == "vkpp" and not core.can_approve_access(reviewer):
        raise Fail("Приймати кандидатів на службу може лише ВКПП або керівництво СБУ.")
    # Анкета не прив'язана до Discord-сервера: кандидату ніхто нічого не надсилає.
    # Після погодження ВКПП саме зв'язується з кандидатом і запрошує на сервер, а там він оформлює допуск («Отримати допуск»).
    t = now_ms()
    col = "vvb" if stage == "vvb" else "vkpp"
    new = ("vkpp" if stage == "vvb" else "ok") if decision == "ok" else "rej"
    await db.run(f"UPDATE candidates SET status=?, {col}_by=?, {col}_t=?, note=? WHERE id=?", new, str(reviewer.id), t, note[:300] or None, cid)
    c = await db.one("SELECT * FROM candidates WHERE id=?", cid)
    await _refresh(c, None)

    if new == "vkpp":
        ch = await core.channel("access")
        if ch:
            f = await photo_file(c)
            msg = await ch.send(embed=await card(c, None), view=view(cid, "vkpp"), **({"file": f} if f else {}))
            await db.run("UPDATE candidates SET vkpp_ch=?, vkpp_msg=? WHERE id=?", str(ch.id), str(msg.id), cid)
        return "Анкету погоджено й передано до ВКПП."
    if new == "ok":
        await db.audit(0, "Кандидата допущено до зарахування", c["sid"], f"{c['name']} · АНК-{cid:04d} · ВКПП: {reviewer.display_name}")
        return (f"Зарахування погоджено. Зв'яжіться з кандидатом (Discord: {c.get('discord_name') or '—'}) і запросіть на сервер. "
                f"Коли він натисне «Отримати допуск» зі Static ID №{c['sid']}, бот видасть і роль «Стажер».")
    await db.audit(0, "Відмова кандидату", c["sid"], f"{'ВВБ' if stage == 'vvb' else 'ВКПП'} · {reviewer.display_name}" + (f" · {note}" if note else ""))
    return "Кандидату відмовлено."


def _notice(c: dict, text: str) -> discord.Embed:
    lines = [style.kv("КАНДИДАТ", c["name"], "white", True), style.kv("СТАН", STAGE[c["status"]][0], STAGE[c["status"]][1], True), style.rule()]
    lines += [style.c(p, "gray") for p in style.wrap(text, 44)]
    return style.document("АНКЕТА КАНДИДАТА: ХІД РОЗГЛЯДУ", STAGE[c["status"]][2], desc=style.block(*lines), no=style.doc_no("АНК", c["id"]))


class ReasonModal(discord.ui.Modal, title="Відмова кандидату"):
    reason = discord.ui.TextInput(label="Причина відмови (кандидат її побачить)", style=discord.TextStyle.paragraph, max_length=300, required=False)

    def __init__(self, cid: int):
        super().__init__()
        self.cid = cid

    async def on_submit(self, interaction: discord.Interaction):
        await interaction.response.defer(ephemeral=True, thinking=True)
        try:
            text = await decide(self.cid, interaction.user, "rej", str(self.reason.value).strip())
        except Fail as e:
            text = str(e)
        await interaction.followup.send(text, ephemeral=True)


class CandButton(discord.ui.DynamicItem[discord.ui.Button], template=r"sova:cand:(?P<id>\d+):(?P<s>vvb|vkpp):(?P<d>ok|rej)"):
    def __init__(self, cid: int, stage: str, decision: str):
        label = ("Погодити й передати до ВКПП" if stage == "vvb" else "Погодити зарахування") if decision == "ok" else "Відмовити"
        super().__init__(discord.ui.Button(label=label, emoji="✅" if decision == "ok" else "⛔",
                                           style=discord.ButtonStyle.success if decision == "ok" else discord.ButtonStyle.danger,
                                           custom_id=f"sova:cand:{cid}:{stage}:{decision}"))
        self.cid, self.stage, self.decision = cid, stage, decision

    @classmethod
    async def from_custom_id(cls, interaction, item, match):
        return cls(int(match["id"]), match["s"], match["d"])

    async def callback(self, interaction: discord.Interaction):
        ok = can_vvb(interaction.user) if self.stage == "vvb" else core.can_approve_access(interaction.user)
        if not ok:
            who = "ВВБ" if self.stage == "vvb" else "ВКПП"
            return await interaction.response.send_message(f"Це рішення ухвалює {who} або керівництво СБУ.", ephemeral=True)
        if self.decision == "rej":
            return await interaction.response.send_modal(ReasonModal(self.cid))
        await interaction.response.defer(ephemeral=True, thinking=True)
        try:
            text = await decide(self.cid, interaction.user, "ok")
        except Fail as e:
            text = str(e)
        await interaction.followup.send(text, ephemeral=True)


def view(cid: int, stage: str) -> discord.ui.View:
    v = discord.ui.View(timeout=None)
    v.add_item(CandButton(cid, stage, "ok"))
    v.add_item(CandButton(cid, stage, "rej"))
    return v


class CandidateModal(discord.ui.Modal, title="Анкета кандидата на службу до СБУ"):
    name = discord.ui.TextInput(label="Ім'я та прізвище персонажа (IC)", placeholder="Name Surname", min_length=3, max_length=60)
    sid = discord.ui.TextInput(label="Static ID", placeholder="напр. 3481", min_length=1, max_length=8)
    age = discord.ui.TextInput(label="Ваш вік (OOC) та середній онлайн на день", placeholder="19 років, 4–5 год", max_length=60)
    exp = discord.ui.TextInput(label="Досвід у державних структурах", style=discord.TextStyle.paragraph,
                               placeholder="Де служили, звання, причина звільнення", max_length=500)
    motive = discord.ui.TextInput(label="Чому ви хочете служити в СБУ?", style=discord.TextStyle.paragraph, min_length=20, max_length=800)

    def __init__(self, member: discord.Member):
        super().__init__()
        self.member = member

    async def on_submit(self, interaction: discord.Interaction):
        raw = str(self.sid.value).strip()
        if not raw.isdigit():
            return await interaction.response.send_message("Static ID — лише цифри.", ephemeral=True)
        await interaction.response.defer(ephemeral=True, thinking=True)
        try:
            name = str(self.name.value).strip()
            cid = await submit(self.member, int(raw), name, str(self.age.value).strip(), str(self.exp.value).strip(), str(self.motive.value).strip())
            lines = [style.kv("КАНДИДАТ", name, "white", True), style.kv("STATIC ID", f"№{raw}", "cyan", True),
                     style.kv("СТАН", "ПЕРЕДАНО НА ПЕРЕВІРКУ ВВБ", "gold", True), style.rule(),
                     style.c("Етапи: перевірка ВВБ → рішення ВКПП.", "gray"),
                     style.c("Про кожне рішення бот повідомить в особисті.", "gray")]
            await interaction.followup.send(embed=style.document("АНКЕТУ КАНДИДАТА ЗАРЕЄСТРОВАНО", 0xD9A23D, desc=style.block(*lines),
                                                                 no=style.doc_no("АНК", cid)), ephemeral=True)
        except Fail as e:
            await interaction.followup.send(str(e), ephemeral=True)
