"""Приватні войс-кімнати: заходиш у «➕ Створити кімнату» — бот створює особистий войс і переносить туди.

Власник керує кімнатою кнопками в її текстовому чаті: закрити/відкрити, сховати/показати, запросити, вигнати,
перейменувати, ліміт місць, передати власника. Порожня кімната видаляється сама; якщо власник пішов, а інші
лишились — власником стає наступний. Кімнати записані в базі (voice_rooms), тож після перезапуску бот їх не губить.

Вмикається в адмін-панелі → «Налаштування» → модулі («Приватні войс-кімнати»). Войс-тригер створюється сам
у категорії «🔊 ПРИВАТНІ КІМНАТИ»; інший войс можна вказати в адмін-панелі → «Канали» (ключ voice_create).
Боту потрібні права «Керувати каналами», «Керувати ролями» й «Переміщати учасників»."""
import asyncio
import logging
import time

import discord

import config
import overrides as ov
from db import db, now_ms

log = logging.getLogger("sova.voice")

KEY = "voice_create"
CATEGORY = "🔊 ПРИВАТНІ КІМНАТИ"
TRIGGER = "➕ Створити кімнату"
COOLDOWN = 10          # секунд між створеннями однією людиною
RENAME_WINDOW = 600    # Discord дозволяє 2 перейменування каналу за 10 хв
_cool: dict[int, float] = {}
_renames: dict[int, list[float]] = {}
_locks: dict[int, asyncio.Lock] = {}
COLOR = 0x5B8DEF


def enabled() -> bool:
    return ov.module_on("voice")


async def trigger(g: discord.Guild) -> discord.VoiceChannel | None:
    ids = await db.get_setting("channels", {})
    cid = ov.channels.get(KEY) or config.CHANNELS.get(KEY) or ids.get(KEY)
    ch = g.get_channel(int(cid)) if cid else None
    return ch if isinstance(ch, discord.VoiceChannel) else None


async def ensure_trigger(g: discord.Guild):
    """Категорія й войс-тригер, якщо модуль увімкнено і їх ще немає."""
    if not enabled() or await trigger(g):
        return
    try:
        cat = discord.utils.get(g.categories, name=CATEGORY) or await g.create_category(CATEGORY, reason="Сова: приватні кімнати")
        ch = await g.create_voice_channel(TRIGGER, category=cat, reason="Сова: войс для створення приватних кімнат")
    except discord.Forbidden:
        log.error("Приватні кімнати: боту бракує права «Керувати каналами» — войс-тригер не створено.")
        return
    ids = await db.get_setting("channels", {})
    ids[KEY] = str(ch.id)
    await db.set_setting("channels", ids)
    log.info("Приватні кімнати: створено войс «%s» (%s)", ch.name, ch.id)


async def cleanup(g: discord.Guild):
    """Після перезапуску: забути зниклі кімнати, видалити порожні."""
    for r in await db.all("SELECT channel_id FROM voice_rooms"):
        ch = g.get_channel(int(r["channel_id"]))
        if not isinstance(ch, discord.VoiceChannel):
            await db.run("DELETE FROM voice_rooms WHERE channel_id=?", r["channel_id"])
        elif not _people(ch):
            await _delete(ch)


# ---------------------------------------------------------------- кімнати
def _people(ch: discord.VoiceChannel) -> list[discord.Member]:
    return [m for m in ch.members if not m.bot]


async def room(cid: int) -> dict | None:
    return await db.one("SELECT * FROM voice_rooms WHERE channel_id=?", str(cid))


async def _delete(ch: discord.VoiceChannel):
    await db.run("DELETE FROM voice_rooms WHERE channel_id=?", str(ch.id))
    try:
        await ch.delete(reason="Сова: приватна кімната порожня")
    except discord.NotFound:
        pass
    except discord.HTTPException as e:
        log.warning("Не вдалося видалити кімнату %s: %s", ch.id, e)


OWNER_PERMS = dict(view_channel=True, connect=True, speak=True, stream=True, move_members=True)


async def _create(member: discord.Member, trig: discord.VoiceChannel):
    lock = _locks.setdefault(member.id, asyncio.Lock())
    async with lock:
        if member.voice is None or member.voice.channel != trig:
            return  # уже вийшов або перейшов, поки чекали
        own = await db.one("SELECT channel_id FROM voice_rooms WHERE owner=?", str(member.id))
        old = member.guild.get_channel(int(own["channel_id"])) if own else None
        if isinstance(old, discord.VoiceChannel):  # одна кімната на людину — повертаємо в свою
            await member.move_to(old, reason="Сова: повернення у власну кімнату")
            return
        if own:
            await db.run("DELETE FROM voice_rooms WHERE owner=?", str(member.id))
        if time.monotonic() - _cool.get(member.id, 0) < COOLDOWN:
            await member.move_to(None, reason="Сова: занадто часте створення кімнат")
            return
        _cool[member.id] = time.monotonic()
        overwrites = dict(trig.category.overwrites) if trig.category else {}
        overwrites[member] = discord.PermissionOverwrite(**OWNER_PERMS)
        ch = await member.guild.create_voice_channel(f"🔊 {member.display_name}"[:90], category=trig.category, overwrites=overwrites,
                                                     reason=f"Сова: приватна кімната {member}")
        await db.run("INSERT OR REPLACE INTO voice_rooms(channel_id, owner, created) VALUES(?,?,?)", str(ch.id), str(member.id), now_ms())
        try:
            await member.move_to(ch, reason="Сова: приватна кімната")
        except discord.HTTPException:  # людина вже пішла з войсу
            await _delete(ch)
            return
        try:
            await ch.send(content=member.mention, embed=panel_embed(member), view=RoomPanel(),
                          allowed_mentions=discord.AllowedMentions(users=[member]))
        except discord.HTTPException as e:
            log.warning("Панель кімнати %s не надіслано: %s", ch.id, e)


async def _left(member: discord.Member, ch: discord.VoiceChannel):
    r = await room(ch.id)
    if not r:
        return
    people = _people(ch)
    if not people:
        await _delete(ch)
        return
    if r["owner"] == str(member.id):  # власник пішов — кімната переходить до наступного
        await _set_owner(ch, member, people[0])
        try:
            await ch.send(f"👑 Власник вийшов — кімнатою тепер керує {people[0].mention}.",
                          allowed_mentions=discord.AllowedMentions(users=[people[0]]))
        except discord.HTTPException:
            pass


async def _set_owner(ch: discord.VoiceChannel, old: discord.abc.Snowflake | None, new: discord.Member):
    await db.run("UPDATE voice_rooms SET owner=? WHERE channel_id=?", str(new.id), str(ch.id))
    if old is not None:
        await ch.set_permissions(old, overwrite=None, reason="Сова: зміна власника кімнати")
    await ch.set_permissions(new, overwrite=discord.PermissionOverwrite(**OWNER_PERMS), reason="Сова: новий власник кімнати")


async def on_voice(member: discord.Member, before: discord.VoiceState, after: discord.VoiceState):
    if member.bot or before.channel == after.channel:
        return
    try:
        if isinstance(before.channel, discord.VoiceChannel):
            await _left(member, before.channel)
        if after.channel and enabled():
            trig = await trigger(member.guild)
            if trig and after.channel.id == trig.id:
                await _create(member, trig)
    except discord.Forbidden:
        log.error("Приватні кімнати: боту бракує прав (Керувати каналами / ролями, Переміщати учасників).")
    except discord.HTTPException as e:
        log.warning("Приватні кімнати: %s", e)


# ---------------------------------------------------------------- панель керування
def panel_embed(owner: discord.Member) -> discord.Embed:
    e = discord.Embed(title="🔊 Приватна кімната", color=COLOR, description=(
        f"Власник: {owner.mention}\n\n"
        "🔒 **Закрити** — зайти зможуть лише запрошені\n"
        "👁 **Сховати** — кімнату не видно в списку каналів\n"
        "➕ **Запросити** / ➖ **Вигнати** — доступ окремим людям\n"
        "✏️ **Назва** · 👥 **Ліміт** · 👑 **Передати** власника\n\n"
        "Порожня кімната видаляється сама."))
    e.set_footer(text="ЄІС «Сова» · кнопками керує лише власник кімнати")
    return e


async def _guard(i: discord.Interaction) -> tuple[discord.VoiceChannel, dict] | None:
    ch = i.channel
    r = await room(ch.id) if isinstance(ch, discord.VoiceChannel) else None
    if not r:
        await i.response.send_message("Ця панель більше не діє: кімнату вже видалено.", ephemeral=True)
        return None
    if r["owner"] != str(i.user.id) and not i.user.guild_permissions.administrator:
        await i.response.send_message("Керувати кімнатою може лише її власник.", ephemeral=True)
        return None
    return ch, r


def _roles(ch: discord.VoiceChannel) -> list[discord.Role]:
    """Ролі, через які люди бачать / заходять у кімнату: @everyone і ролі з налаштувань категорії (крім ролей самого бота)."""
    mine = set(ch.guild.me.roles) - {ch.guild.default_role}
    return [ch.guild.default_role] + [t for t in ch.overwrites if isinstance(t, discord.Role) and t != ch.guild.default_role and t not in mine]


async def _toggle(i: discord.Interaction, perm: str, col: str, on_text: str, off_text: str):
    """Закрити (connect) / сховати (view_channel): заборона всім ролям; запрошені й власник мають особистий дозвіл.
    Відкрити / показати — повернути значення з налаштувань категорії (а не «всім можна»)."""
    g = await _guard(i)
    if not g:
        return
    ch, r = g
    closing = not r.get(col)
    await i.response.defer(ephemeral=True)
    for role in _roles(ch):
        ow = ch.overwrites_for(role)
        base = getattr(ch.category.overwrites_for(role), perm) if ch.category else None
        setattr(ow, perm, False if closing else base)
        await ch.set_permissions(role, overwrite=None if ow.is_empty() else ow, reason="Сова: налаштування приватної кімнати")
    await db.run(f"UPDATE voice_rooms SET {col}=? WHERE channel_id=?", 1 if closing else 0, str(ch.id))
    await i.followup.send(on_text if closing else off_text, ephemeral=True)


async def _report(i: discord.Interaction, error: Exception):
    log.warning("Панель кімнати: %s", error)
    text = "Боту бракує прав для цієї дії." if isinstance(error, discord.Forbidden) else "Не вдалося виконати дію. Спробуйте ще раз."
    try:
        if i.response.is_done():
            await i.followup.send(text, ephemeral=True)
        else:
            await i.response.send_message(text, ephemeral=True)
    except discord.HTTPException:
        pass


class _PickUser(discord.ui.UserSelect):
    def __init__(self, action: str, placeholder: str):
        super().__init__(placeholder=placeholder, min_values=1, max_values=1)
        self.action = action

    async def callback(self, i: discord.Interaction):
        g = await _guard(i)
        if not g:
            return
        ch, r = g
        who = self.values[0]
        if not isinstance(who, discord.Member) or who.bot:
            return await i.response.send_message("Оберіть учасника сервера.", ephemeral=True)
        if str(who.id) == r["owner"]:
            return await i.response.send_message("Це власник кімнати.", ephemeral=True)
        if self.action == "invite":
            ow = ch.overwrites_for(who)
            ow.view_channel, ow.connect = True, True
            await ch.set_permissions(who, overwrite=ow, reason="Сова: запрошення в приватну кімнату")
            msg = f"✅ {who.mention} може заходити в кімнату."
        elif self.action == "kick":
            await ch.set_permissions(who, overwrite=discord.PermissionOverwrite(connect=False), reason="Сова: вигнано з приватної кімнати")
            if who.voice and who.voice.channel == ch:
                await who.move_to(None, reason="Сова: вигнано з приватної кімнати")
            msg = f"🚫 {who.mention} більше не може заходити в кімнату."
        else:  # transfer
            if who not in ch.members:
                return await i.response.send_message("Передати кімнату можна лише тому, хто зараз у ній.", ephemeral=True)
            await _set_owner(ch, i.guild.get_member(int(r["owner"])) or discord.Object(int(r["owner"])), who)
            await ch.send(f"👑 Кімнатою тепер керує {who.mention}.", allowed_mentions=discord.AllowedMentions(users=[who]))
            msg = "Власника змінено."
        await i.response.edit_message(content=msg, view=None)


class _PickView(discord.ui.View):
    def __init__(self, action: str, placeholder: str):
        super().__init__(timeout=120)
        self.add_item(_PickUser(action, placeholder))

    async def on_error(self, i: discord.Interaction, error: Exception, item):
        await _report(i, error)


def _pick(action: str, placeholder: str) -> discord.ui.View:
    return _PickView(action, placeholder)


class _Modal(discord.ui.Modal):
    async def on_error(self, i: discord.Interaction, error: Exception):
        await _report(i, error)


class _Rename(_Modal, title="Назва кімнати"):
    name = discord.ui.TextInput(label="Нова назва", max_length=90, min_length=1)

    async def on_submit(self, i: discord.Interaction):
        g = await _guard(i)
        if not g:
            return
        ch, _ = g
        now = time.monotonic()
        hits = [t for t in _renames.get(ch.id, []) if now - t < RENAME_WINDOW]
        if len(hits) >= 2:
            return await i.response.send_message("Discord дозволяє перейменувати канал лише двічі за 10 хвилин. Спробуйте пізніше.", ephemeral=True)
        _renames[ch.id] = hits + [now]
        await ch.edit(name=str(self.name.value).strip()[:90], reason="Сова: перейменування приватної кімнати")
        await i.response.send_message("Назву змінено.", ephemeral=True)


class _Limit(_Modal, title="Ліміт місць"):
    n = discord.ui.TextInput(label="Скільки людей (0 — без ліміту)", max_length=2, placeholder="напр. 5")

    async def on_submit(self, i: discord.Interaction):
        g = await _guard(i)
        if not g:
            return
        ch, _ = g
        v = str(self.n.value).strip()
        if not v.isdigit() or int(v) > 99:
            return await i.response.send_message("Вкажіть число від 0 до 99.", ephemeral=True)
        await ch.edit(user_limit=int(v), reason="Сова: ліміт приватної кімнати")
        await i.response.send_message("Без ліміту." if v == "0" else f"Ліміт: {int(v)}.", ephemeral=True)


class RoomPanel(discord.ui.View):
    """Постійна панель (працює й після перезапуску): кімнату визначаємо за каналом, де натиснули кнопку."""
    def __init__(self):
        super().__init__(timeout=None)

    @discord.ui.button(label="Закрити / відкрити", emoji="🔒", style=discord.ButtonStyle.secondary, custom_id="sova:vr:lock", row=0)
    async def lock(self, i: discord.Interaction, _):
        await _toggle(i, "connect", "locked", "🔒 Кімнату закрито: заходять лише запрошені.", "🔓 Кімнату відкрито.")

    @discord.ui.button(label="Сховати / показати", emoji="👁", style=discord.ButtonStyle.secondary, custom_id="sova:vr:hide", row=0)
    async def hide(self, i: discord.Interaction, _):
        await _toggle(i, "view_channel", "hidden", "🙈 Кімнату сховано зі списку каналів.", "👁 Кімнату знову видно.")

    @discord.ui.button(label="Запросити", emoji="➕", style=discord.ButtonStyle.success, custom_id="sova:vr:invite", row=1)
    async def invite(self, i: discord.Interaction, _):
        if await _guard(i):
            await i.response.send_message("Кого запросити?", view=_pick("invite", "Оберіть учасника"), ephemeral=True)

    @discord.ui.button(label="Вигнати", emoji="➖", style=discord.ButtonStyle.danger, custom_id="sova:vr:kick", row=1)
    async def kick(self, i: discord.Interaction, _):
        if await _guard(i):
            await i.response.send_message("Кого вигнати?", view=_pick("kick", "Оберіть учасника"), ephemeral=True)

    @discord.ui.button(label="Назва", emoji="✏️", style=discord.ButtonStyle.secondary, custom_id="sova:vr:rename", row=2)
    async def rename(self, i: discord.Interaction, _):
        if await _guard(i):
            await i.response.send_modal(_Rename())

    @discord.ui.button(label="Ліміт", emoji="👥", style=discord.ButtonStyle.secondary, custom_id="sova:vr:limit", row=2)
    async def limit(self, i: discord.Interaction, _):
        if await _guard(i):
            await i.response.send_modal(_Limit())

    @discord.ui.button(label="Передати", emoji="👑", style=discord.ButtonStyle.secondary, custom_id="sova:vr:owner", row=2)
    async def owner(self, i: discord.Interaction, _):
        if await _guard(i):
            await i.response.send_message("Кому передати кімнату?", view=_pick("transfer", "Оберіть учасника кімнати"), ephemeral=True)

    async def on_error(self, i: discord.Interaction, error: Exception, item):
        await _report(i, error)
