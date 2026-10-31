"""Слеш-команди «Сови» в Discord."""
import discord
from discord import app_commands

import backup
import config
import core
import style
from core import Fail
from db import db, now_ms
from roles import DEPTS, nickname, rank_name, resolve


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


async def send_credentials(member: discord.Member, sid: int, password: str, name: str | None = None,
                           title: str = "ДОПУСК ДО ЄІС «СОВА» ОФОРМЛЕНО") -> bool:
    try:
        await member.send(embed=core.credentials_embed(sid, password, name or member.display_name, title=title), view=style.site_view())
        return True
    except discord.Forbidden:
        return False


class Access(app_commands.Group):
    def __init__(self):
        super().__init__(name="доступ", description="Облікові записи кабінету «Сова»")

    @app_commands.command(name="видати", description="Оформити допуск до ЄІС «Сова» співробітнику і надіслати код доступу")
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
            await core.set_nick({"sid": static_id, "name": імя[:60], "rank": a["rank"], "discord_id": str(учасник.id)}, учасник)
            dm = await send_credentials(учасник, static_id, pw, імя)
            await interaction.response.send_message(
                f"Допуск для {учасник.mention}: №{static_id}, {rank_name(a['rank'])}, {DEPTS[a['dept']]['s']}.\n"
                + ("Код доступу надіслано в особисті повідомлення." if dm else "Особисті повідомлення закриті — передайте код особисто:"),
                embed=None if dm else core.credentials_embed(static_id, pw, імя), ephemeral=True)
        except Fail as e:
            await reply_error(interaction, e)

    @app_commands.command(name="пароль", description="Видати співробітнику новий код доступу")
    async def reset(self, interaction: discord.Interaction, учасник: discord.Member):
        try:
            head = await head_only(interaction)
            u = await db.one("SELECT * FROM users WHERE discord_id=?", str(учасник.id))
            if not u:
                raise Fail("У цього учасника немає облікового запису. Використайте /доступ видати.")
            pw = core.new_password()
            await db.run("UPDATE users SET pw_hash=?, pw_set=? WHERE sid=?", core.hash_password(pw), now_ms(), u["sid"])
            await db.run("DELETE FROM sessions WHERE sid=?", u["sid"])
            await db.audit(head["sid"], "Новий код доступу", u["sid"], "попередні входи завершено")
            dm = await send_credentials(учасник, u["sid"], pw, u["name"], title="НОВИЙ КОД ДОСТУПУ ДО ЄІС «СОВА»")
            await interaction.response.send_message("Новий код доступу надіслано в особисті." if dm else "Особисті закриті — передайте код особисто:",
                                                    embed=None if dm else core.credentials_embed(u["sid"], pw, u["name"], title="НОВИЙ КОД ДОСТУПУ"),
                                                    ephemeral=True)
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
            dept = DEPTS[u["dept"]]
            lines = [
                style.kv("СПІВРОБІТНИК", u["name"], "white", True),
                style.kv("ЗВАННЯ", rank_name(u["rank"]), "gold", True),
                style.kv("ПІДРОЗДІЛ", f"{dept['s']} · {dept['n']}", "white"),
                style.kv("ЖЕТОН", f"№{u['sid']}", "cyan"),
                style.rule(),
                style.kv("БАЛИ ТИЖНЯ", f"{await core.week_points(u['sid'])}  (минулий: {await core.week_points(u['sid'], 1)})", "gold", True),
            ]
            if pc:
                lines += [style.rule(), style.c(f"До звання «{pc['name']}»:", "white", True)]
                lines += [style.c(("✔ " if i["ok"] else "✖ ") + t, "green" if i["ok"] else ("gold" if i.get("soft") else "red"))
                          for i in pc["items"] for t in style.wrap(i["t"], 42)[:2]]
            e = style.document("ОСОБОВА СПРАВА", dept["color"], desc=style.block(*lines), no=f"№{u['sid']}", footer="ЄІС «Сова»")
            await interaction.response.send_message(embed=e, view=style.site_view(), ephemeral=True)
        except Fail as e:
            await reply_error(interaction, e)

    @app_commands.command(name="панель", description="Розмістити в цьому каналі панель «Отримати допуск» (Голова СБУ)")
    async def panel(self, interaction: discord.Interaction):
        try:
            await head_only(interaction)
            await interaction.channel.send(embed=welcome_embed(), view=RegisterView())
            await interaction.response.send_message("Панель розміщено.", ephemeral=True)
        except Fail as e:
            await reply_error(interaction, e)
        except discord.Forbidden:
            await interaction.response.send_message("Бот не може писати в цей канал.", ephemeral=True)

    @app_commands.command(name="нікнейми", description="Оновити службові нікнейми всім, хто має допуск (Голова СБУ)")
    async def nicks(self, interaction: discord.Interaction):
        try:
            await head_only(interaction)
            await interaction.response.defer(ephemeral=True)
            done = fail = 0
            for u in await db.all("SELECT * FROM users WHERE status!='dismissed' AND discord_id IS NOT NULL"):
                await core.access(u, fresh=True)
                if await core.set_nick(u):
                    done += 1
                else:
                    fail += 1
            await interaction.followup.send(f"Нікнейми оновлено: {done}. Не вдалося: {fail} "
                                            "(бракує права «Керувати нікнеймами», роль вища за роль бота або власник сервера).", ephemeral=True)
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


# ---------------------------------------------------------------- кнопка «Отримати допуск»
def credentials_card(u: dict, pw: str, a: dict) -> discord.Embed:
    warn = None if a.get("ok") else (f"Система поки не пустить: {a.get('why', 'немає ролей СБУ')}. "
                                     "Щойно вас зарахують до складу СБУ — вхід відкриється сам.")
    return core.credentials_embed(u["sid"], pw, u["name"], title="НОВИЙ КОД ДОСТУПУ ДО ЄІС «СОВА»", warn=warn)


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
        await interaction.response.send_message(embed=credentials_card(u, pw, resolve({r.id for r in member.roles})),
                                                view=style.site_view(), ephemeral=True)
    except Fail as e:
        await interaction.response.send_message(str(e), ephemeral=True)


class RegisterModal(discord.ui.Modal, title="Оформлення допуску до ЄІС «Сова»"):
    sid = discord.ui.TextInput(label="Номер жетона (Static ID)", placeholder="напр. 3481", min_length=1, max_length=8)
    name = discord.ui.TextInput(label="Ім'я та прізвище персонажа (IC)", placeholder="Name Surname", min_length=3, max_length=60)

    def __init__(self, member: discord.Member):
        super().__init__()
        self.member = member

    async def on_submit(self, interaction: discord.Interaction):
        try:
            raw = str(self.sid.value).strip()
            if not raw.isdigit():
                raise Fail("Static ID — лише цифри.")
            name = str(self.name.value).strip()
            rid = await core.request_access(self.member, int(raw), name)
            lines = [style.kv("ЗАЯВНИК", name, "white", True), style.kv("НОМЕР ЖЕТОНА", f"№{raw}", "cyan", True),
                     style.kv("СТАТУС", "ПЕРЕДАНО НА ПЕРЕВІРКУ ВКПП", "gold", True), style.rule(),
                     style.c("Після підтвердження код доступу надійде", "gray"), style.c("вам в особисті повідомлення. Тримайте", "gray"),
                     style.c("особисті від учасників сервера відкритими.", "gray")]
            await interaction.response.send_message(
                embed=style.document("ЗАЯВКУ НА ДОПУСК ЗАРЕЄСТРОВАНО", 0xD9A23D, desc=style.block(*lines), no=style.doc_no("ЗД", rid)),
                ephemeral=True)
        except Fail as e:
            await interaction.response.send_message(str(e), ephemeral=True, view=ResetView())


class ResetView(discord.ui.View):
    def __init__(self):
        super().__init__(timeout=300)

    @discord.ui.button(label="Відновити код доступу", style=discord.ButtonStyle.secondary)
    async def reset(self, interaction: discord.Interaction, button: discord.ui.Button):
        await do_reset(interaction)


class RegisterView(discord.ui.View):
    """Постійна кнопка (працює і після перезапуску бота)."""
    def __init__(self):
        super().__init__(timeout=None)

    @discord.ui.button(label="Отримати допуск", style=discord.ButtonStyle.success, emoji="🦉", custom_id="sova:register")
    async def create(self, interaction: discord.Interaction, button: discord.ui.Button):
        member = await guild_member(interaction)
        if not member:
            return await interaction.response.send_message("Спершу приєднайтеся до сервера «Служба Безпеки NG».", ephemeral=True)
        if await db.one("SELECT sid FROM users WHERE discord_id=?", str(member.id)):
            return await interaction.response.send_message("Допуск уже оформлено. Загубили код доступу?", ephemeral=True, view=ResetView())
        await interaction.response.send_modal(RegisterModal(member))

    @discord.ui.button(label="Відновити код доступу", style=discord.ButtonStyle.secondary, emoji="🔑", custom_id="sova:resetpw")
    async def reset(self, interaction: discord.Interaction, button: discord.ui.Button):
        await do_reset(interaction)

    @discord.ui.button(label="Змінити дані", style=discord.ButtonStyle.secondary, emoji="✏️", custom_id="sova:rename")
    async def rename(self, interaction: discord.Interaction, button: discord.ui.Button):
        member = await guild_member(interaction)
        u = await db.one("SELECT * FROM users WHERE discord_id=?", str(member.id)) if member else None
        if not u:
            return await interaction.response.send_message("Допуск ще не оформлено. Натисніть «Отримати допуск».", ephemeral=True)
        await interaction.response.send_modal(NameModal(member, u["name"]))


class NameModal(discord.ui.Modal, title="Зміна персональних даних"):
    name = discord.ui.TextInput(label="Ім'я та прізвище персонажа (IC)", min_length=3, max_length=60)

    def __init__(self, member: discord.Member, current: str):
        super().__init__()
        self.member = member
        self.name.default = current

    async def on_submit(self, interaction: discord.Interaction):
        try:
            u = await core.change_name(self.member, str(self.name.value).strip())
            await interaction.response.send_message(
                f"Дані оновлено: **{u['name']}**. Нікнейм: `{nickname(u['rank'], u['name'], u['sid'])}`.\n"
                "Зміну зафіксовано в кадровому аудиті — керівництво повідомлено.", ephemeral=True)
        except Fail as e:
            await interaction.response.send_message(str(e), ephemeral=True)


def welcome_embed(member: discord.abc.User | None = None) -> discord.Embed:
    e = discord.Embed(title="🦉  ЄІС «Сова» · оформлення допуску", color=0xC9A05A, url=config.SITE_URL,
                      description=(f"Вітаємо, {member.mention}. Ви прибули до Служби безпеки штату NG.\n\n" if member else "")
                      + "Єдина інформаційна система «Сова» — службовий кабінет співробітника СБУ: звіти про діяльність, "
                      "рапорти, кейс-файли, бали й премії.")
    e.add_field(name="📋  Як оформити допуск", inline=False, value=(
        "**1.** Натисніть **«Отримати допуск»** під цим повідомленням.\n"
        "**2.** Вкажіть **номер жетона** (ваш Static ID) та **ім'я й прізвище** персонажа.\n"
        "**3.** Заявку розгляне **ВКПП**. Після підтвердження бот надішле вам **код доступу** в особисті повідомлення.\n"
        f"**4.** Увійдіть до кабінету: {config.SITE_URL}"))
    e.add_field(name="⚠️  Важливо", inline=False, value=(
        "• Відкрийте особисті повідомлення від учасників сервера, інакше код не надійде.\n"
        "• Звання й підрозділ підтягуються з ваших ролей автоматично, нікнейм бот поставить сам.\n"
        "• Допуск діє, доки ви у складі СБУ: при звільненні чи виході із сервера його анулюють."))
    e.add_field(name="🔑  Вже маєте допуск?", inline=False, value=(
        "**«Відновити код доступу»** — новий код, якщо загубили старий.\n"
        "**«Змінити дані»** — нове ім'я персонажа (зміна фіксується в кадровому аудиті)."))
    e.set_image(url=config.SITE_URL.rstrip("/") + "/site/access-panel.png")
    e.set_footer(text="Код доступу є службовою таємницею · Положення про захист службової інформації СБУ")
    return e


async def ensure_panel():
    """Панель «Отримати допуск» у каналі панелі: бот розміщує її сам і не дублює після перезапусків."""
    ch = await core.channel("welcome")
    if not ch:
        return
    mid = await db.get_setting("panel_msg")
    if mid:
        try:
            msg = await ch.fetch_message(int(mid))
            await msg.edit(embed=welcome_embed(), view=RegisterView())
            return
        except (discord.NotFound, discord.Forbidden):
            pass
    try:
        msg = await ch.send(embed=welcome_embed(), view=RegisterView())
        await db.set_setting("panel_msg", str(msg.id))
    except discord.Forbidden:
        core.log.warning("Бот не може писати в канал панелі %s", ch.id)


async def setup(bot: discord.Client):
    bot.tree.add_command(Access())
    bot.tree.add_command(Admin())
    bot.add_view(RegisterView())
