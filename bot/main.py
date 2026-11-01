"""Запуск «Сови»: Discord-бот + API для сайту + автоматичні бекапи."""
import asyncio
import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import aiohttp
import discord
from discord.ext import commands, tasks

import api
import backup
import config
import candidates
import core
import slash
import tunnel
from db import db

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("sova")


class Sova(commands.Bot):
    def __init__(self, members: bool):
        intents = discord.Intents.default()
        # Події входу/виходу з сервера потребують Server Members Intent (вмикається в Developer Portal → Bot).
        # Без нього кабінет усе одно закриває доступ тим, кого немає на сервері, — просто не миттєво.
        intents.members = members
        super().__init__(command_prefix="!sova ", intents=intents, help_command=None)
        self.runner = None
        self.members_intent = members

    async def setup_hook(self):
        await db.open()
        core.bot = self
        self.add_dynamic_items(core.ActButton, core.RapButton, core.AccessButton, candidates.CandButton)
        await slash.setup(self)
        self.runner = await api.start()
        asyncio.create_task(tunnel.run())

    async def on_ready(self):
        g = core.guild()
        if not g:
            log.error("Не визначено сервер СБУ (бот на %s серверах, GUILD_ID=%s). Запросіть бота на сервер СБУ або вкажіть GUILD_ID.",
                      len(self.guilds), config.GUILD_ID)
            return
        try:
            await core.ensure_channels(g)
        except discord.Forbidden:
            log.error("Боту бракує права «Керувати каналами» — канали не створено.")
        self.tree.copy_global_to(guild=g)
        await self.tree.sync(guild=g)
        await slash.ensure_panel()
        if not getattr(self, "_panel_loop", None):
            self._panel_loop = asyncio.create_task(slash.panel_loop())
        if not backup_loop.is_running():
            backup_loop.start()
        log.info("Сова на зв'язку як %s · сервер %s", self.user, g.name)
        if not self.members_intent:
            log.warning("Server Members Intent вимкнено: привітання новачків і миттєве закриття доступу при виході не працюють.")

    async def on_member_join(self, member: discord.Member):
        g = core.guild()
        if not g or member.guild.id != g.id or member.bot:
            return
        embed, view = slash.welcome_embed(member), slash.RegisterView()
        ch = await core.channel("welcome")
        try:
            if ch:
                await ch.send(content=member.mention, embed=embed, view=view)
            else:
                await member.send(embed=embed, view=view)
        except discord.Forbidden:
            log.info("Не вдалося привітати %s (закриті особисті або немає доступу до каналу)", member)

    async def on_member_remove(self, member: discord.Member):
        g = core.guild()
        if g and member.guild.id == g.id:
            await core.member_left(member)


async def members_intent_enabled(token: str) -> bool:
    """Чи увімкнено Server Members Intent у застосунку (інакше Discord не пустить бота з цим інтентом)."""
    try:
        async with aiohttp.ClientSession() as s:
            async with s.get("https://discord.com/api/v10/applications/@me", headers={"Authorization": f"Bot {token}"}) as r:
                flags = (await r.json()).get("flags", 0) if r.status == 200 else 0
        return bool(flags & ((1 << 14) | (1 << 15)))
    except aiohttp.ClientError:
        return False


@tasks.loop(hours=config.BACKUP_EVERY_HOURS)
async def backup_loop():
    try:
        await backup.make_backup("автоматично")
    except Exception:
        log.exception("Бекап не вдався")


@backup_loop.before_loop
async def _wait_first_backup():
    await asyncio.sleep(60)


async def api_only():
    """Без токена бота працює лише API (для перевірки хостингу й тунелю)."""
    await db.open()
    await api.start()
    asyncio.create_task(tunnel.run())
    log.warning("DISCORD_TOKEN не задано — працює лише API. Додайте токен у .env і перезапустіть сервер.")
    await asyncio.Event().wait()


async def run_bot():
    members = await members_intent_enabled(config.DISCORD_TOKEN)
    async with Sova(members) as bot:
        await bot.start(config.DISCORD_TOKEN)


if __name__ == "__main__":
    if not config.DISCORD_TOKEN:
        asyncio.run(api_only())
    else:
        asyncio.run(run_bot())
