"""HTTPS для сайту. SparkedHost дає лише http://IP:порт, а GitHub Pages працює через HTTPS,
тому бот відкриває безкоштовний тунель Cloudflare (адреса *.trycloudflare.com змінюється після перезапуску)
і повідомляє її ретранслятору — Cloudflare Worker з постійною адресою, до якого звертається сайт.

Повідомлення підписується ключем Ed25519, який бот створює сам (data/relay.key).
Worker знає лише відкритий ключ (GET /api/relay-key), тож жодних спільних секретів немає.
"""
import asyncio
import base64
import logging
import platform
import re
import stat
import time
import urllib.request

import aiohttp
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

import config

log = logging.getLogger("sova.tunnel")
BIN = config.DATA_DIR / "bin" / "cloudflared"
KEY = config.DATA_DIR / "relay.key"
URL = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-{arch}"
current_url: str | None = None
_key: Ed25519PrivateKey | None = None


def signing_key() -> Ed25519PrivateKey:
    global _key
    if _key:
        return _key
    if KEY.exists():
        _key = Ed25519PrivateKey.from_private_bytes(KEY.read_bytes())
    else:
        _key = Ed25519PrivateKey.generate()
        KEY.write_bytes(_key.private_bytes(serialization.Encoding.Raw, serialization.PrivateFormat.Raw,
                                           serialization.NoEncryption()))
    return _key


def public_key_b64() -> str:
    raw = signing_key().public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
    return base64.b64encode(raw).decode()


def ensure_binary():
    if BIN.exists():
        return
    arch = "arm64" if platform.machine() in ("aarch64", "arm64") else "amd64"
    BIN.parent.mkdir(parents=True, exist_ok=True)
    log.info("Завантажую cloudflared (%s) з GitHub Cloudflare…", arch)
    urllib.request.urlretrieve(URL.format(arch=arch), BIN)
    BIN.chmod(BIN.stat().st_mode | stat.S_IEXEC)


async def announce(url: str):
    relay = config.RELAY_URL
    if not relay:
        log.warning("RELAY_URL не задано — адреса тунелю: %s", url)
        return
    for attempt in range(20):
        ts = int(time.time())
        sig = base64.b64encode(signing_key().sign(f"{url}|{ts}".encode())).decode()
        try:
            async with aiohttp.ClientSession() as s:
                async with s.post(relay.rstrip("/") + "/__sova/upstream", json={"url": url, "ts": ts, "sig": sig},
                                  timeout=aiohttp.ClientTimeout(total=15)) as r:
                    if r.status == 200:
                        log.info("Ретранслятор %s → %s", relay, url)
                        return
                    log.warning("Ретранслятор відповів %s: %s", r.status, (await r.text())[:200])
        except aiohttp.ClientError as e:
            log.warning("Ретранслятор недоступний: %s", e)
        await asyncio.sleep(min(60, 5 * (attempt + 1)))


async def run():
    global current_url
    if config.TUNNEL != "1":
        return
    log.info("Відкритий ключ ретранслятора: %s", public_key_b64())
    while True:
        try:
            await asyncio.to_thread(ensure_binary)
            proc = await asyncio.create_subprocess_exec(
                str(BIN), "tunnel", "--no-autoupdate", "--url", f"http://127.0.0.1:{config.API_PORT}",
                stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.PIPE)
            async for line in proc.stderr:
                m = re.search(r"https://[a-z0-9-]+\.trycloudflare\.com", line.decode(errors="ignore"))
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
