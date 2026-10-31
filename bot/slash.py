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


async def setup(bot: discord.Client):
    bot.tree.add_command(Access())
    bot.tree.add_command(Admin())
