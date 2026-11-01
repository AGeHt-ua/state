"""Оформлення повідомлень «Сови» в Discord: службові документи (embed + кольоровий ANSI-блок)."""
from datetime import datetime, timezone

import discord

import config

try:
    from zoneinfo import ZoneInfo
    TZ = ZoneInfo("Europe/Kyiv")
except Exception:
    TZ = timezone.utc

ESC = "\u001b["
COLORS = {"gray": "30", "red": "31", "green": "32", "gold": "33", "blue": "34", "pink": "35", "cyan": "36", "white": "37"}
LOGO = config.SITE_URL.rstrip("/") + "/site/sbu-logo.webp"
AUTHOR = "Служба безпеки штату NG · ЄІС «Сова»"

# Статуси документів: (напис, колір ANSI, колір embed)
STATUS = {
    "wait": ("НА РОЗГЛЯДІ", "gold", 0xD9A23D),
    "ok": ("ПОГОДЖЕНО", "green", 0x5FB37A),
    "rej": ("ВІДМОВЛЕНО", "red", 0xD4605A),
    "cancel": ("ВІДКЛИКАНО", "gray", 0x5F6A7A),
    "deleted": ("ВИДАЛЕНО", "gray", 0x3A4250),
}


def c(text, color: str = "white", bold: bool = False) -> str:
    return f"{ESC}{'1' if bold else '0'};{COLORS[color]}m{text}{ESC}0m"


def block(*lines: str) -> str:
    """Кольоровий ANSI-блок. Кожен рядок — окремий аргумент."""
    return "```ansi\n" + "\n".join(lines) + "\n```"


def kv(label: str, value, color: str = "white", bold: bool = False, width: int = 16) -> str:
    return c(f"{label:<{width}}", "gray") + c(value, color, bold)


def rule(n: int = 44) -> str:
    return c("─" * n, "gray")


def when(ms: int | None = None) -> str:
    dt = datetime.fromtimestamp(ms / 1000, TZ) if ms else datetime.now(TZ)
    return dt.strftime("%d.%m.%Y %H:%M")


def doc_no(prefix: str, n: int) -> str:
    return f"{prefix}-{n:04d}"


def wrap(text: str, width: int = 44) -> list[str]:
    """Перенос тексту для ANSI-блоку (Discord не переносить слова в коді гарно)."""
    out, line = [], ""
    for word in str(text).split():
        if len(line) + len(word) + 1 > width and line:
            out.append(line)
            line = word
        else:
            line = f"{line} {word}".strip()
    if line:
        out.append(line)
    return out or [""]


def document(title: str, color: int, *, no: str | None = None, desc: str | None = None, footer: str | None = None) -> discord.Embed:
    e = discord.Embed(title=title, description=desc, color=color)
    e.set_author(name=AUTHOR, icon_url=LOGO, url=config.SITE_URL)
    e.set_thumbnail(url=LOGO)
    parts = [p for p in (no, footer) if p]
    if parts:
        e.set_footer(text=" · ".join(parts), icon_url=LOGO)
    return e


def site_button(label: str = "Відкрити ЄІС «Сова»") -> discord.ui.Button:
    return discord.ui.Button(label=label, url=config.SITE_URL, emoji="🦉")


def site_view(label: str = "Відкрити ЄІС «Сова»") -> discord.ui.View:
    v = discord.ui.View()
    v.add_item(site_button(label))
    return v
