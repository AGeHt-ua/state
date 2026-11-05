"""Документи в Discord: одне повідомлення на документ — картка (embed) з картинкою аркуша А4 всередині.
Над карткою — теги: хто створив, кого стосується, і роль чи відділ, які автор обрав у формі.
Картку бот оновлює при кожній зміні (підпис, погодження, скасування), картинку — сайт після дії (PNG аркуша).
"""
import io
import logging

import discord

import config
import core
import overrides as ov
from core import Fail
from db import db
from roles import DEPTS, RANK_ROLES, RANKS, SBU_ROLE

log = logging.getLogger("sova.docpost")

# ---------------------------------------------------------------- кого можна тегнути (вибір у формі документа)
def tag_options() -> dict:
    depts = [{"id": f"dept:{k}", "n": v["n"]} for k, v in DEPTS.items() if v.get("role")]
    roles = [{"id": f"role:{SBU_ROLE}", "n": "Увесь особовий склад СБУ"}] + \
            [{"id": f"role:{r}", "n": RANKS[i][0]} for i, r in enumerate(RANK_ROLES)]
    return {"depts": depts, "roles": roles}


def key_roles(key: str | None) -> list[int]:
    """Ролі, які за налаштуваннями (адмін-панель → «Кого згадувати») згадуються для цього виду документа."""
    if not key:
        return []
    return [int(r) for r in (ov.mentions[key] if key in ov.mentions else config.MENTIONS.get(key) or [])]


def tag_role(tag: str | None) -> int | None:
    """«dept:orv» або «role:<id>» → ID ролі Discord (лише з дозволеного списку)."""
    if not tag:
        return None
    kind, _, val = str(tag).partition(":")
    if kind == "dept" and val in DEPTS and DEPTS[val].get("role"):
        return int(DEPTS[val]["role"])
    if kind == "role" and val.isdigit() and int(val) in (SBU_ROLE, *RANK_ROLES):
        return int(val)
    return None


def tag_label(tag: str | None) -> str | None:
    rid = tag_role(tag)
    return f"<@&{rid}>" if rid else None


async def people(*sids) -> list[str]:
    """Discord ID співробітників за жетонами (без дублів і порожніх)."""
    out = []
    for sid in sids:
        if not sid:
            continue
        p = await core.user(int(sid))
        if p and p.get("discord_id") and p["discord_id"] not in out:
            out.append(p["discord_id"])
    return out


def mentions(users: list[str], tag: str | None = None, roles: list[int] | None = None) -> dict:
    """Текст над карткою + дозвіл пінгувати саме цих людей і ролі."""
    rids = [r for r in [*(roles or []), tag_role(tag)] if r]
    rids = list(dict.fromkeys(rids))
    uids = [int(x) for x in dict.fromkeys(users or []) if x]
    if not rids and not uids:
        return {"content": None, "allowed_mentions": discord.AllowedMentions.none()}
    return {"content": " ".join([f"<@{x}>" for x in uids] + [f"<@&{r}>" for r in rids]),
            "allowed_mentions": discord.AllowedMentions(everyone=False, users=[discord.Object(x) for x in uids],
                                                        roles=[discord.Object(r) for r in rids])}


def concerns_field(e: discord.Embed, users: list[str], tag: str | None = None):
    """Рядок «Стосується» в картці (у самій картці згадки не пінгують — лише показують)."""
    parts = [f"<@{x}>" for x in dict.fromkeys(users or []) if x]
    if tag_label(tag):
        parts.append(tag_label(tag))
    if parts:
        e.add_field(name="Стосується", value=" ".join(parts)[:1024], inline=False)


# ---------------------------------------------------------------- повідомлення документа
async def _row(kind: str, did: int) -> dict | None:
    return await db.one("SELECT * FROM doc_msgs WHERE kind=? AND id=?", kind, did)


async def _message(row: dict) -> discord.Message | None:
    try:
        ch = core.bot.get_channel(int(row["ch"])) or await core.bot.fetch_channel(int(row["ch"]))
        return await ch.fetch_message(int(row["msg"]))
    except (discord.NotFound, discord.Forbidden, discord.HTTPException, TypeError, ValueError):
        return None


async def post(kind: str, did: int, ch: discord.abc.Messageable | None, embed: discord.Embed, *,
               users: list[str] | None = None, tag: str | None = None, roles: list[int] | None = None,
               view: discord.ui.View | None = None) -> discord.Message | None:
    """Перша публікація документа: теги над карткою. Якщо повідомлення вже є — лише оновлює картку."""
    row = await _row(kind, did)
    if row and row["msg"]:
        return await update(kind, did, embed, view=view)
    if not ch:
        return None
    try:
        msg = await ch.send(embed=embed, **mentions(users or [], tag, roles), **({"view": view} if view else {}))
    except discord.HTTPException as ex:
        log.warning("Документ %s-%s: %s", kind, did, ex)
        return None
    await db.run("INSERT OR REPLACE INTO doc_msgs(kind,id,ch,msg,img,tag) VALUES(?,?,?,?,?,?)",
                 kind, did, str(ch.id), str(msg.id), None, tag)
    return msg


async def update(kind: str, did: int, embed: discord.Embed, *, view: discord.ui.View | None = None,
                 ping: str | None = None, users: list[str] | None = None, roles: list[int] | None = None) -> discord.Message | None:
    """Оновлює картку документа, зберігаючи картинку аркуша. ping — коротка відповідь під повідомленням,
    щоб важлива зміна (підпис, рішення) дійшла сповіщенням: редагування в Discord не пінгує."""
    row = await _row(kind, did)
    msg = await _message(row) if row else None
    if not msg:
        return None
    if row["img"]:
        embed.set_image(url=f"attachment://{row['img']}")
    try:
        await msg.edit(embed=embed, **({"view": view} if view is not None else {}))
        if ping:
            m = mentions(users or [], row["tag"], roles)
            await msg.reply(" ".join(filter(None, [ping, m["content"]])), mention_author=False, allowed_mentions=m["allowed_mentions"])
    except discord.HTTPException as ex:
        log.warning("Оновлення документа %s-%s: %s", kind, did, ex)
    return msg


async def set_image(kind: str, did: int, data: bytes, name: str) -> bool:
    """Картинка аркуша А4 (PNG/JPEG, сформована сайтом) — у картку документа."""
    if data.startswith(b"\x89PNG"):
        ext = "png"
    elif data.startswith(b"\xff\xd8\xff"):
        ext = "jpg"
    else:
        raise Fail("Картинка документа має бути PNG або JPEG.")
    if len(data) > 9 * 1024 * 1024:
        raise Fail("Картинка документа завелика.")
    row = await _row(kind, did)
    msg = await _message(row) if row else None
    if not msg or not msg.embeds:
        return False
    fname = f"{''.join(ch for ch in name if ch.isalnum() or ch in '-_')[:60] or 'doc'}.{ext}"
    e = msg.embeds[0]
    e.set_image(url=f"attachment://{fname}")
    try:
        await msg.edit(embed=e, attachments=[discord.File(io.BytesIO(data), filename=fname)])
    except discord.HTTPException as ex:
        log.warning("Картинка документа %s-%s: %s", kind, did, ex)
        return False
    await db.run("UPDATE doc_msgs SET img=? WHERE kind=? AND id=?", fname, kind, did)
    return True


async def remove(kind: str, did: int):
    """Документ видалено: прибрати і його повідомлення з Discord."""
    row = await _row(kind, did)
    msg = await _message(row) if row else None
    if msg:
        try:
            await msg.delete()
        except discord.HTTPException:
            pass
    await db.run("DELETE FROM doc_msgs WHERE kind=? AND id=?", kind, did)
