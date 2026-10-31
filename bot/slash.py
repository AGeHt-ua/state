"""Слеш-команди «Сови» в Discord."""
import discord
from discord import app_commands

import backup
import config
import core
from core import Fail
from db import db, now_ms
from roles import DEPTS, rank_name, resolve


async def head_only(interaction: discord.Interaction) -> dict:
    """Команди керування доступні лише Голові СБУ (звання 15)."""
    a = resolve({r.id for r in interaction.user.roles})
    if not a["ok"] or a["rank"] != 15:
        raise Fail("Команда доступна лише Голові СБУ.")
    u = await db.one("SELECT * FROM users WHERE discord_id=?", str(interaction.user.id))
    return u or {"sid": 0, "name": interaction.user.display_name, "rank": 15, "dept": "lead"}


async def reply_error(interaction: discord.Interaction, e: Fail):
    if interaction.response.is_done():
        await interaction.followup.send(str(e), ephemeral=True)
    else:
        await interaction.response.send_message(str(e), ephemeral=True)


async def send_credentials(member: discord.Member, sid: int, password: str) -> bool:
    try:
        await member.send(f"**Кабінет СБУ «Сова»**\nСайт: {config.SITE_URL}\nStatic ID: `{sid}`\nПароль: `{password}`\n"
                          "Нікому не передавайте пароль. Вхід можливий лише з ролями СБУ на сервері.")
        return True
    except discord.Forbidden:
        return False


class Access(app_commands.Group):
    def __init__(self):
        super().__init__(name="доступ", description="Облікові записи кабінету «Сова»")

    @app_commands.command(name="видати", description="Створити або оновити обліковий запис співробітника і надіслати пароль")
    @app_commands.describe(учасник="Співробітник на сервері", static_id="Static ID = номер жетона", імя="Ім'я та прізвище (IC)")
    async def issue(self, interaction: discord.Interaction, учасник: discord.Member, static_id: app_commands.Range[int, 1, 9_999_999], імя: str):
        try:
            head = await head_only(interaction)
            a = resolve({r.id for r in учасник.roles})
            if not a["ok"]:
                raise Fail(f"У {учасник.mention} немає доступу за ролями: {a['why']}.")
            other = await db.one("SELECT sid FROM users WHERE discord_id=? AND sid!=?", str(учасник.id), static_id)
            if other:
                raise Fail(f"Цей Discord уже прив'язано до Static ID {other['sid']}.")
            pw = core.new_password()
            exists = await db.one("SELECT sid FROM users WHERE sid=?", static_id)
            if exists:
                await db.run("UPDATE users SET name=?, discord_id=?, pw_hash=?, pw_set=?, rank=?, dept=?, status='active' WHERE sid=?",
                             імя[:60], str(учасник.id), core.hash_password(pw), now_ms(), a["rank"], a["dept"], static_id)
            else:
                await db.run("INSERT INTO users(sid,name,discord_id,pw_hash,pw_set,rank,dept,since,created) VALUES(?,?,?,?,?,?,?,?,?)",
                             static_id, імя[:60], str(учасник.id), core.hash_password(pw), now_ms(), a["rank"], a["dept"], now_ms(), now_ms())
            await db.audit(head["sid"], "Видано доступ" if not exists else "Оновлено доступ", static_id,
                           f"{rank_name(a['rank'])} · {DEPTS[a['dept']]['s']}")
            await db.run("DELETE FROM sessions WHERE sid=?", static_id)
            dm = await send_credentials(учасник, static_id, pw)
            await interaction.response.send_message(
                f"Доступ для {учасник.mention}: №{static_id}, {rank_name(a['rank'])}, {DEPTS[a['dept']]['s']}.\n"
                + ("Пароль надіслано в особисті повідомлення." if dm else f"Особисті повідомлення закриті. Пароль: `{pw}` — передайте особисто."),
                ephemeral=True)
        except Fail as e:
            await reply_error(interaction, e)

    @app_commands.command(name="пароль", description="Згенерувати новий пароль співробітнику")
    async def reset(self, interaction: discord.Interaction, учасник: discord.Member):
        try:
            head = await head_only(interaction)
            u = await db.one("SELECT * FROM users WHERE discord_id=?", str(учасник.id))
            if not u:
                raise Fail("У цього учасника немає облікового запису. Використайте /доступ видати.")
            pw = core.new_password()
            await db.run("UPDATE users SET pw_hash=?, pw_set=? WHERE sid=?", core.hash_password(pw), now_ms(), u["sid"])
            await db.run("DELETE FROM sessions WHERE sid=?", u["sid"])
            await db.audit(head["sid"], "Новий пароль", u["sid"], "попередні входи завершено")
            dm = await send_credentials(учасник, u["sid"], pw)
            await interaction.response.send_message("Новий пароль надіслано в особисті." if dm else f"Пароль: `{pw}` — передайте особисто.", ephemeral=True)
        except Fail as e:
            await reply_error(interaction, e)


class Admin(app_commands.Group):
    def __init__(self):
        super().__init__(name="сова", description="Кабінет СБУ «Сова»")

    @app_commands.command(name="профіль", description="Ваш профіль і бали за тиждень")
    async def profile(self, interaction: discord.Interaction):
        try:
            u = await core.actor_from_discord(interaction.user)
            pc = await core.promo_check(u)
            e = discord.Embed(title=f"{u['name']} · №{u['sid']}", color=DEPTS[u["dept"]]["color"])
            e.add_field(name="Звання", value=rank_name(u["rank"]))
            e.add_field(name="Відділ", value=DEPTS[u["dept"]]["n"])
            e.add_field(name="Бали: цей / минулий тиждень", value=f"{await core.week_points(u['sid'])} / {await core.week_points(u['sid'], 1)}")
            if pc:
                e.add_field(name=f"До звання «{pc['name']}»", value="\n".join(("✅ " if i["ok"] else "❌ ") + i["t"] for i in pc["items"]), inline=False)
            e.add_field(name="Кабінет", value=config.SITE_URL, inline=False)
            await interaction.response.send_message(embed=e, ephemeral=True)
        except Fail as e:
            await reply_error(interaction, e)

    @app_commands.command(name="панель", description="Розмістити в цьому каналі панель «Створити акаунт» (Голова СБУ)")
    async def panel(self, interaction: discord.Interaction):
        try:
            await head_only(interaction)
            await interaction.channel.send(embed=welcome_embed(), view=RegisterView())
            await interaction.response.send_message("Панель розміщено.", ephemeral=True)
        except Fail as e:
            await reply_error(interaction, e)
        except discord.Forbidden:
            await interaction.response.send_message("Бот не може писати в цей канал.", ephemeral=True)

    @app_commands.command(name="бекап", description="Зробити бекап бази зараз (Голова СБУ)")
    async def backup_now(self, interaction: discord.Interaction):
        try:
            await head_only(interaction)
            await interaction.response.defer(ephemeral=True)
            name, size = await backup.make_backup(f"вручну, {interaction.user.display_name}")
            await interaction.followup.send(f"Бекап {name} ({size / 1024:.0f} КБ) збережено.", ephemeral=True)
        except Fail as e:
            await reply_error(interaction, e)

    @app_commands.command(name="відновити", description="Відновити базу з файлу бекапу (Голова СБУ)")
    async def restore(self, interaction: discord.Interaction, файл: discord.Attachment):
        try:
            await head_only(interaction)
            await interaction.response.defer(ephemeral=True)
            before = await backup.restore(await файл.read(), файл.filename)
            await interaction.followup.send(f"Базу відновлено з {файл.filename}. Попередній стан збережено як {before}.", ephemeral=True)
        except Fail as e:
            await reply_error(interaction, e)


# ---------------------------------------------------------------- кнопка «Створити акаунт»
def credentials_text(sid: int, pw: str, a: dict) -> str:
    text = (f"**Ваш акаунт у кабінеті «Сова»**\nСайт: {config.SITE_URL}\nStatic ID: `{sid}`\nПароль: `{pw}`\n"
            "Збережіть пароль — це повідомлення бачите лише ви.")
    if not a.get("ok"):
        text += f"\n\n⚠️ Увійти поки не вийде: {a.get('why', 'немає ролей СБУ')}. Щойно отримаєте ролі — вхід відкриється сам."
    return text


async def guild_member(interaction: discord.Interaction) -> discord.Member | None:
    """Учасник сервера СБУ (кнопку могли натиснути в особистих повідомленнях)."""
    if isinstance(interaction.user, discord.Member) and core.guild() and interaction.user.guild.id == core.guild().id:
        return interaction.user
    return await core.member_of(interaction.user.id)


async def do_reset(interaction: discord.Interaction):
    try:
        member = await guild_member(interaction)
        if not member:
            raise Fail("Спершу приєднайтеся до сервера «Служба Безпеки NG».")
        u, pw = await core.reset_own_password(member)
        await interaction.response.send_message(credentials_text(u["sid"], pw, resolve({r.id for r in member.roles})), ephemeral=True)
    except Fail as e:
        await interaction.response.send_message(str(e), ephemeral=True)


class RegisterModal(discord.ui.Modal, title="Акаунт у кабінеті «Сова»"):
    sid = discord.ui.TextInput(label="Static ID (номер жетона)", placeholder="напр. 3481", min_length=1, max_length=8)
    name = discord.ui.TextInput(label="Ім'я та прізвище персонажа (IC)", placeholder="Name Surname", min_length=3, max_length=60)

    def __init__(self, member: discord.Member):
        super().__init__()
        self.member = member

    async def on_submit(self, interaction: discord.Interaction):
        try:
            raw = str(self.sid.value).strip()
            if not raw.isdigit():
                raise Fail("Static ID — лише цифри.")
            a, pw = await core.register(self.member, int(raw), str(self.name.value).strip())
            await interaction.response.send_message(credentials_text(int(raw), pw, a), ephemeral=True)
        except Fail as e:
            await interaction.response.send_message(str(e), ephemeral=True, view=ResetView())


class ResetView(discord.ui.View):
    def __init__(self):
        super().__init__(timeout=300)

    @discord.ui.button(label="Новий пароль", style=discord.ButtonStyle.secondary)
    async def reset(self, interaction: discord.Interaction, button: discord.ui.Button):
        await do_reset(interaction)


class RegisterView(discord.ui.View):
    """Постійна кнопка (працює і після перезапуску бота)."""
    def __init__(self):
        super().__init__(timeout=None)

    @discord.ui.button(label="Створити акаунт", style=discord.ButtonStyle.success, emoji="🦉", custom_id="sova:register")
    async def create(self, interaction: discord.Interaction, button: discord.ui.Button):
        member = await guild_member(interaction)
        if not member:
            return await interaction.response.send_message("Спершу приєднайтеся до сервера «Служба Безпеки NG».", ephemeral=True)
        if await db.one("SELECT sid FROM users WHERE discord_id=?", str(member.id)):
            return await interaction.response.send_message("У вас уже є акаунт. Забули пароль?", ephemeral=True, view=ResetView())
        await interaction.response.send_modal(RegisterModal(member))

    @discord.ui.button(label="Новий пароль", style=discord.ButtonStyle.secondary, custom_id="sova:resetpw")
    async def reset(self, interaction: discord.Interaction, button: discord.ui.Button):
        await do_reset(interaction)


def welcome_embed(member: discord.abc.User | None = None) -> discord.Embed:
    e = discord.Embed(title="Служба безпеки штату NG · кабінет «Сова»", color=0xC9A05A,
                      description=(f"Ласкаво просимо, {member.mention}!\n\n" if member else "")
                      + "Натисніть **«Створити акаунт»**, вкажіть Static ID та ім'я персонажа — бот одразу видасть пароль до кабінету.\n"
                      "Звання й відділ кабінет бере з ваших ролей на сервері. Без ролей СБУ акаунт створюється, але вхід відкриється, "
                      "щойно ролі з'являться. Якщо вийдете із сервера — доступ закриється автоматично.")
    e.add_field(name="Кабінет", value=config.SITE_URL)
    return e


async def setup(bot: discord.Client):
    bot.tree.add_command(Access())
    bot.tree.add_command(Admin())
    bot.add_view(RegisterView())
