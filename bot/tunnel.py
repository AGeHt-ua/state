"""HTTPS для сайту. SparkedHost дає лише http://IP:порт, а GitHub Pages працює через HTTPS,
тому бот відкриває безкоштовний тунель Cloudflare (адреса *.trycloudflare.com) і повідомляє її
ретранслятору (Cloudflare Worker з постійною адресою), до якого звертається сайт.

Вмикається змінними в .env:
  TUNNEL=1
  RELAY_URL=https://<worker>.workers.dev      — постійна адреса для сайту
  RELAY_SECRET=<спільний секрет із Worker>
"""
import asyncio
import logging
import os
import platform
import re
import stat
import urllib.request

import aiohttp

import config

log = logging.getLogger("sova.tunnel")
BIN = config.DATA_DIR / "bin" / "cloudflared"
URL = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-{arch}"
current_url: str | None = None


def ensure_binary():
    if BIN.exists():
        return
    arch = "arm64" if platform.machine() in ("aarch64", "arm64") else "amd64"
    BIN.parent.mkdir(parents=True, exist_ok=True)
    log.info("Завантажую cloudflared (%s) з GitHub Cloudflare…", arch)
    urllib.request.urlretrieve(URL.format(arch=arch), BIN)
    BIN.chmod(BIN.stat().st_mode | stat.S_IEXEC)


async def announce(url: str):
    relay, secret = config.env("RELAY_URL"), config.env("RELAY_SECRET")
    if not relay or not secret:
        log.warning("RELAY_URL/RELAY_SECRET не задано — адреса тунелю: %s", url)
        return
    for attempt in range(10):
        try:
            async with aiohttp.ClientSession() as s:
                async with s.post(relay.rstrip("/") + "/__sova/upstream", json={"url": url},
                                  headers={"Authorization": f"Bearer {secret}"}, timeout=aiohttp.ClientTimeout(total=15)) as r:
                    if r.status == 200:
                        log.info("Ретранслятор оновлено: %s → %s", relay, url)
                        return
                    log.warning("Ретранслятор відповів %s", r.status)
        except aiohttp.ClientError as e:
            log.warning("Ретранслятор недоступний: %s", e)
        await asyncio.sleep(min(60, 5 * (attempt + 1)))


async def run():
    global current_url
    if config.env("TUNNEL") != "1":
        return
    while True:
        try:
            await asyncio.to_thread(ensure_binary)
            proc = await asyncio.create_subprocess_exec(
                str(BIN), "tunnel", "--no-autoupdate", "--url", f"http://127.0.0.1:{config.API_PORT}",
                stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.PIPE)
            async for line in proc.stderr:
                text = line.decode(errors="ignore")
                m = re.search(r"https://[a-z0-9-]+\.trycloudflare\.com", text)
                if m and m.group(0) != current_url:
                    current_url = m.group(0)
                    log.info("Тунель: %s", current_url)
                    asyncio.create_task(announce(current_url))
            await proc.wait()
            log.warning("cloudflared завершився (код %s), перезапуск за 10 с", proc.returncode)
        except Exception:
            log.exception("Тунель не запустився")
        current_url = None
        await asyncio.sleep(10)
