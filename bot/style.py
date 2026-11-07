"""Оформлення повідомлень «Сови» в Discord.

Документи (звіти, рапорти, накази, стягнення, протоколи, фінанси, премії, кейс-файли) — єдиний зразок картки: style.card().
Решта повідомлень — embed зі звичайним текстом (kv / block). ANSI-блоків більше немає: функції c/kv/rule/block
лишились з тими самими назвами, але повертають звичайну розмітку Discord.
"""
from datetime import datetime, timezone

import discord

import config

try:
    from zoneinfo import ZoneInfo
    TZ = ZoneInfo("Europe/Kyiv")
except Exception:
    TZ = timezone.utc

LOGO = config.SITE_URL.rstrip("/") + "/site/sbu-logo.webp"
AUTHOR = "Служба безпеки штату NG · ЄІС «Сова»"

# Статуси документів: (напис, колір (історично для ANSI, не використовується), колір embed)
STATUS = {
    "wait": ("НА РОЗГЛЯДІ", "gold", 0xD9A23D),
    "ok": ("ПОГОДЖЕНО", "green", 0x5FB37A),
    "rej": ("ВІДМОВЛЕНО", "red", 0xD4605A),
    "cancel": ("ВІДКЛИКАНО", "gray", 0x5F6A7A),
    "deleted": ("ВИДАЛЕНО", "gray", 0x3A4250),
}

# Кольори карток документів за станом
GOLD, GREEN, RED, GRAY, BLUE, DARK = 0xD9A23D, 0x5FB37A, 0xD4605A, 0x5F6A7A, 0x6F9FD6, 0x3A4250

# Скорочення, які в підписах полів лишаються великими літерами
_ABBR = {"СБУ", "ЄІС", "ВВБ", "ВКПП", "ОРВ", "АТЦ", "ДЕБ", "ЦСО", "КК", "ПК", "NG", "ID", "PDF", "ПСЖ", "НГ", "НП", "НС", "ЗВТ", "РАП", "АНК", "ЗД", "КФ"}


def esc(text) -> str:
    """Текст користувача без розмітки Discord (зірочки, підкреслення тощо не ламають картку)."""
    return discord.utils.escape_markdown(str(text if text is not None else ""))


def _label(label: str) -> str:
    """«НОМЕР ЖЕТОНА» → «Номер жетона» (скорочення на кшталт ВКПП лишаються як є)."""
    words = str(label).split(" ")
    out = []
    for i, w in enumerate(words):
        core_w = w.strip("·:,()«»")
        if core_w.upper() in _ABBR or any(ch.isdigit() for ch in w):
            out.append(w)
        else:
            out.append(w[:1].upper() + w[1:].lower() if i == 0 else w.lower())
    return " ".join(out)


def c(text, color: str = "white", bold: bool = False) -> str:
    """Рядок тексту (колір більше не застосовується; bold — жирний)."""
    t = esc(str(text).strip())
    return f"**{t}**" if bold and t else t


def kv(label: str, value, color: str = "white", bold: bool = False, width: int = 16) -> str:
    """«Підпис: значення». Без підпису — продовження попереднього рядка."""
    v = esc(value)
    v = f"**{v}**" if bold and v.strip() else v
    return f"**{_label(label)}:** {v}" if str(label).strip() else v


def rule(n: int = 44) -> str:
    return ""  # роздільник — порожній рядок


def block(*lines: str) -> str:
    """Рядки в опис embed (порожні рядки-роздільники не дублюються)."""
    out: list[str] = []
    for ln in lines:
        ln = (ln or "").rstrip()
        if not ln and (not out or not out[-1]):
            continue
        out.append(ln)
    while out and not out[-1]:
        out.pop()
    return "\n".join(out)


def when(ms: int | None = None) -> str:
    dt = datetime.fromtimestamp(ms / 1000, TZ) if ms else datetime.now(TZ)
    return dt.strftime("%d.%m.%Y %H:%M")


def doc_no(prefix: str, n: int) -> str:
    return f"{prefix}-{n:04d}"


def wrap(text: str, width: int = 44) -> list[str]:
    """Раніше — перенос для ANSI-блоку; Discord переносить звичайний текст сам, тож один рядок."""
    return [" ".join(str(text).split())] if str(text).strip() else [""]


def document(title: str, color: int, *, no: str | None = None, desc: str | None = None, footer: str | None = None) -> discord.Embed:
    """Службове повідомлення (не документ): допуск, аудит, журнал рішень, нагадування."""
    e = discord.Embed(title=title, description=desc or None, color=color)
    e.set_author(name=AUTHOR, icon_url=LOGO, url=config.SITE_URL)
    e.set_thumbnail(url=LOGO)
    parts = [p for p in (no, footer) if p]
    if parts:
        e.set_footer(text=" · ".join(parts), icon_url=LOGO)
    return e


# ---------------------------------------------------------------- єдина картка документа
def person(u: dict | None, with_rank: bool = True) -> str:
    """«Звання Ім'я · №жетон» для полів картки."""
    if not u:
        return "—"
    from roles import rank_name  # тут, щоб style не тягнув roles під час імпорту
    rank = f"{rank_name(u['rank'])} " if with_rank and u.get("rank") else ""
    return f"{rank}{esc(u.get('name') or '—')} · №{u.get('sid', '—')}"


def card(no: str, title: str, state: str, color: int, *, fields: list | None = None, note: str | None = None,
         t: int | None = None) -> discord.Embed:
    """Картка документа — однакова для всіх видів:
    заголовок «НОМЕР · Вид документа», рядок стану, поля (2–3 в ряд), далі docpost додає «Стосується» й картинку аркуша А4.
    fields: [(назва, значення) або (назва, значення, inline)]; порожні значення пропускаються.
    note — короткий рядок під станом (напр. причина відмови)."""
    desc = f"**{state}**" + (f"\n{note}" if note else "")
    e = discord.Embed(title=f"{no} · {title}"[:256], description=desc[:4000], color=color, url=None)
    e.set_author(name=AUTHOR, icon_url=LOGO, url=config.SITE_URL)
    for f in fields or []:
        name, value = f[0], f[1]
        inline = f[2] if len(f) > 2 else True
        if value in (None, "", []):
            continue
        e.add_field(name=name[:256], value=str(value)[:1024], inline=inline)
    e.set_footer(text=f"ЄІС «Сова» · {when(t)}", icon_url=LOGO)
    return e


def site_button(label: str = "Відкрити ЄІС «Сова»") -> discord.ui.Button:
    return discord.ui.Button(label=label, url=config.SITE_URL, emoji="🦉")


def site_view(label: str = "Відкрити ЄІС «Сова»") -> discord.ui.View:
    v = discord.ui.View()
    v.add_item(site_button(label))
    return v
