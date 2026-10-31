"""Запуск «Сови»: Discord-бот + API для сайту + автоматичні бекапи."""
import asyncio
import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import discord
from discord.ext import commands, tasks

import api
import backup
import config
import core
import slash
import tunnel
from db import db

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("sova")


class Sova(commands.Bot):
    def __init__(self):
        intents = discord.Intents.default()  # привілейовані інтенти не потрібні: ролі читаються через fetch_member
        super().__init__(command_prefix="!sova ", intents=intents, help_command=None)
        self.runner = None

    async def setup_hook(self):
        await db.open()
        core.bot = self
        self.add_dynamic_items(core.ActButton, core.RapButton)
        await slash.setup(self)
        self.runner = await api.start()
        asyncio.create_task(tunnel.run())

    async def on_ready(self):
        g = self.get_guild(config.GUILD_ID)
        if not g:
            log.error("Бот не бачить сервер GUILD_ID=%s. Запросіть бота на сервер СБУ.", config.GUILD_ID)
            return
        try:
            await core.ensure_channels(g)
        except discord.Forbidden:
            log.error("Боту бракує права «Керувати каналами» — канали не створено.")
        self.tree.copy_global_to(guild=g)
        await self.tree.sync(guild=g)
        if not backup_loop.is_running():
            backup_loop.start()
        log.info("Сова на зв'язку як %s · сервер %s", self.user, g.name)


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


if __name__ == "__main__":
    if not config.DISCORD_TOKEN:
        asyncio.run(api_only())
    else:
        Sova().run(config.DISCORD_TOKEN, log_handler=None)
