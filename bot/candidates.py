"""Анкети кандидатів на службу: кандидат подає анкету → ВВБ перевіряє й погоджує → ВКПП приймає на службу (ролі, допуск, код)."""
import logging

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
    "ok": ("ПРИЙНЯТО НА СЛУЖБУ", "green", 0x5FB37A),
    "rej": ("ВІДМОВЛЕНО", "red", 0xD4605A),
}


def can_vvb(member: discord.Member) -> bool:
    ids = {r.id for r in member.roles}
    a = resolve(ids)
    return DEPTS["vvb"]["role"] in ids or (a["ok"] and a["rank"] >= 13)


async def submit(member: discord.Member, sid: int, name: str, age: str, exp: str, motive: str) -> int:
    if await db.one("SELECT sid FROM users WHERE discord_id=?", str(member.id)):
        raise Fail("Ви вже у складі СБУ й маєте допуск до «Сови».")
    if await db.one("SELECT sid FROM users WHERE sid=?", sid):
        raise Fail("Цей номер жетона вже закріплено за співробітником СБУ.")
    if await db.one("SELECT id FROM candidates WHERE status IN ('vvb','vkpp') AND (discord_id=? OR sid=?)", str(member.id), sid):
        raise Fail("Вашу анкету вже розглядають. Рішення надійде в особисті повідомлення.")
    cid = await db.run("INSERT INTO candidates(discord_id,sid,name,age,exp,motive,t) VALUES(?,?,?,?,?,?,?)",
                       str(member.id), sid, name[:60], age[:60], exp[:500], motive[:800], now_ms())
    c = await db.one("SELECT * FROM candidates WHERE id=?", cid)
    ch = await core.channel("vvb")
    if ch:
        msg = await ch.send(embed=await card(c, member), view=view(cid, "vvb"))
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
    lines += [style.kv("ДОСВІД" if i == 0 else "", p, "white") for i, p in enumerate(style.wrap(c["exp"] or "—", 28))]
    lines.append(style.rule())
    lines += [style.kv("МОТИВАЦІЯ" if i == 0 else "", p, "white") for i, p in enumerate(style.wrap(c["motive"] or "—", 28))]
    lines.append(style.rule())
    if c["vvb_t"]:
        lines.append(style.kv("ВВБ", f"{'погоджено' if c['status'] != 'rej' or c['vkpp_t'] else 'відмовлено'} · {await _name(c['vvb_by'])}",
                              "green" if c["status"] != "rej" or c["vkpp_t"] else "red"))
    if c["vkpp_t"]:
        lines.append(style.kv("ВКПП", f"{'прийнято' if c['status'] == 'ok' else 'відмовлено'} · {await _name(c['vkpp_by'])}",
                              "green" if c["status"] == "ok" else "red"))
    lines.append(style.kv("СТАН", label, color, True))
    if c["note"]:
        lines += [style.kv("ПРИЧИНА" if i == 0 else "", p, "white") for i, p in enumerate(style.wrap(c["note"], 28))]
    footer = {"vvb": "Перевірка Відділом внутрішньої безпеки", "vkpp": "Рішення Відділу кадрів та підготовки персоналу"}.get(c["status"], "Розгляд завершено")
    return style.document("АНКЕТА КАНДИДАТА НА СЛУЖБУ", ecolor, desc=f"Discord: <@{c['discord_id']}>\n" + style.block(*lines),
                          no=style.doc_no("АНК", c["id"]), footer=footer)


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
    member = await core.member_of(c["discord_id"])
    t = now_ms()
    col = "vvb" if stage == "vvb" else "vkpp"
    pw = None
    if decision == "ok" and not member:
        decision, note = "rej", "Кандидат уже не на сервері."
    if decision == "ok" and stage == "vkpp":
        try:
            _, pw = await core.register(member, c["sid"], c["name"], reviewer, extra_roles=(RANK_ROLES[0],))
        except Fail as e:
            decision, note = "rej", str(e)
    new = ("vkpp" if stage == "vvb" else "ok") if decision == "ok" else "rej"
    await db.run(f"UPDATE candidates SET status=?, {col}_by=?, {col}_t=?, note=? WHERE id=?", new, str(reviewer.id), t, note[:300] or None, cid)
    c = await db.one("SELECT * FROM candidates WHERE id=?", cid)
    await _refresh(c, member)

    if new == "vkpp":
        ch = await core.channel("access")
        if ch:
            msg = await ch.send(embed=await card(c, member), view=view(cid, "vkpp"))
            await db.run("UPDATE candidates SET vkpp_ch=?, vkpp_msg=? WHERE id=?", str(ch.id), str(msg.id), cid)
        await _dm(member, embed=_notice(c, "Анкету перевірено Відділом внутрішньої безпеки та передано до ВКПП. Очікуйте рішення про прийом."))
        return "Анкету погоджено й передано до ВКПП."
    if new == "ok":
        sent = await _dm(member, embed=core.credentials_embed(c["sid"], pw, c["name"], title="ВАС ПРИЙНЯТО НА СЛУЖБУ ДО СБУ"),
                         view=style.site_view())
        return "Кандидата прийнято: видано ролі «СБУ» і «Стажер», допуск оформлено" + (", код надіслано в особисті." if sent else
               ", але особисті закриті — нехай натисне «Відновити код доступу».")
    await db.audit(0, "Відмова кандидату", c["sid"], f"{'ВВБ' if stage == 'vvb' else 'ВКПП'} · {reviewer.display_name}" + (f" · {note}" if note else ""))
    await _dm(member, embed=core.rejection_embed(c["name"], note))
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
        label = ("Погодити й передати до ВКПП" if stage == "vvb" else "Прийняти на службу") if decision == "ok" else "Відмовити"
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
