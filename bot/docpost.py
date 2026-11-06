"""Документи в Discord: одне повідомлення на документ — картка (embed) з картинкою аркуша А4 всередині.
Над карткою — теги: хто створив, кого стосується, і роль чи відділ, які автор обрав у формі.
Картку бот оновлює при кожній зміні (підпис, погодження, скасування), картинку — сайт після дії (PNG аркуша).
"""
import asyncio
import io
import json
import logging

import discord

import config
import core
import overrides as ov
from core import Fail
from db import db, now_ms
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


# ---------------------------------------------------------------- кнопка «Відкрити в Сові»: адреса документа на сайті
LINKS = {"act": "act/{}", "rap": "rap/{}", "np": "staff/appoint", "ng": "staff/orders", "ns": "disc/journal",
         "pz": "kb/prot/{}", "fin": "fin/{}", "bn": "bonus/{}", "cases": "cases/{}"}


def link(kind: str, did: int) -> str | None:
    path = LINKS.get(kind)
    return f"{config.SITE_URL.rstrip('/')}/site/#/{path.format(did)}" if path else None


def link_view(kind: str, did: int) -> discord.ui.View | None:
    """Кнопка-посилання під карткою документа: відкриває саме цей документ у ЄІС «Сова»."""
    url = link(kind, did)
    if not url:
        return None
    v = discord.ui.View(timeout=None)
    v.add_item(discord.ui.Button(label="Відкрити в Сові", emoji="🦉", url=url))
    return v


# ---------------------------------------------------------------- повідомлення документа
# doc_msgs: основне повідомлення (ch, msg), копії в інших каналах (extra: [[ch, msg], …]),
# ім'я картинки аркуша (img), обрана в формі роль/відділ (tag), кого стосується (who: Discord ID через кому)
async def _row(kind: str, did: int) -> dict | None:
    return await db.one("SELECT * FROM doc_msgs WHERE kind=? AND id=?", kind, did)


async def _fetch(ch_id, msg_id) -> discord.Message | None:
    try:
        ch = core.bot.get_channel(int(ch_id)) or await core.bot.fetch_channel(int(ch_id))
        return await ch.fetch_message(int(msg_id))
    except (discord.NotFound, discord.Forbidden, discord.HTTPException, TypeError, ValueError):
        return None


async def _messages(row: dict) -> list[discord.Message]:
    """Основне повідомлення документа й копії в інших каналах (наприклад, рапорт у каналах двох відділів)."""
    out = []
    for ch_id, msg_id in [[row["ch"], row["msg"]], *json.loads(row.get("extra") or "[]")]:
        if m := await _fetch(ch_id, msg_id):
            out.append(m)
    return out


def _who(row: dict | None) -> list[str]:
    return [x for x in ((row or {}).get("who") or "").split(",") if x]


async def register(kind: str, did: int, msgs: list[discord.Message], *, users: list[str] | None = None, tag: str | None = None):
    """Документ, який модуль надіслав сам (картки звітів і рапортів з копіями): запам'ятати, щоб далі додати картинку й оновлювати."""
    if not msgs:
        return
    main, *rest = msgs
    await db.run("INSERT OR REPLACE INTO doc_msgs(kind,id,ch,msg,img,tag,who,extra) VALUES(?,?,?,?,?,?,?,?)",
                 kind, did, str(main.channel.id), str(main.id), None, tag, ",".join(dict.fromkeys(users or [])),
                 json.dumps([[str(m.channel.id), str(m.id)] for m in rest]))


async def post(kind: str, did: int, ch: discord.abc.Messageable | None, embed: discord.Embed, *,
               users: list[str] | None = None, tag: str | None = None, roles: list[int] | None = None,
               view: discord.ui.View | None = None) -> discord.Message | None:
    """Перша публікація документа: теги над карткою (автор, кого стосується, ролі виду документа, обрана роль/відділ)."""
    if not ch:
        return None
    concerns_field(embed, users or [], tag)
    view = view or link_view(kind, did)
    try:
        msg = await ch.send(embed=embed, **mentions(users or [], tag, roles), **({"view": view} if view else {}))
    except discord.HTTPException as ex:
        log.warning("Документ %s-%s: %s", kind, did, ex)
        return None
    await register(kind, did, [msg], users=users, tag=tag)
    return msg


async def update(kind: str, did: int, embed: discord.Embed, *, view: discord.ui.View | None = None,
                 ping: str | None = None, users: list[str] | None = None, roles: list[int] | None = None) -> bool:
    """Оновлює картку документа (і копії), зберігаючи картинку аркуша й рядок «Стосується».
    ping — коротка відповідь під повідомленням лише тоді, коли треба покликати нових людей (roles: наступний етап, напр. Мінфін чи виплата премій).
    Рішення («Погоджено», «Відхилено», «Підписано») окремою відповіддю не дублюємо — картка й так оновлюється."""
    row = await _row(kind, did)
    msgs = await _messages(row) if row else []
    if not msgs:
        return False
    concerns_field(embed, _who(row), row["tag"])
    if row["img"]:
        embed.set_image(url=f"attachment://{row['img']}")
    for i, msg in enumerate(msgs):
        try:
            await msg.edit(embed=embed, **({"view": view} if view is not None else {}))
            if ping and roles and i == 0:
                m = mentions([], None, roles)
                await msg.reply(" ".join(filter(None, [ping, m["content"]])), mention_author=False, allowed_mentions=m["allowed_mentions"])
        except discord.HTTPException as ex:
            log.warning("Оновлення документа %s-%s: %s", kind, did, ex)
    return True


async def journal(kind: str, did: int, ch: discord.abc.Messageable | None, embed: discord.Embed, *,
                  users: list[str] | None = None, tag: str | None = None, roles: list[int] | None = None,
                  ping: str | None = None, ping_roles: list[int] | None = None):
    """Журнал документа одним повідомленням: перша дія публікує картку з тегами, наступні — оновлюють її з короткою відповіддю."""
    if await _row(kind, did) and await update(kind, did, embed, ping=ping, roles=ping_roles):
        return
    await post(kind, did, ch, embed, users=users, tag=tag, roles=roles)


async def set_image(kind: str, did: int, data: bytes, name: str) -> bool:
    """Картинка аркуша А4 (PNG/JPEG, сформована сайтом) — у картку документа та її копії."""
    if data.startswith(b"\x89PNG"):
        ext = "png"
    elif data.startswith(b"\xff\xd8\xff"):
        ext = "jpg"
    else:
        raise Fail("Картинка документа має бути PNG або JPEG.")
    if len(data) > 9 * 1024 * 1024:
        raise Fail("Картинка документа завелика.")
    row = await _row(kind, did)
    msgs = [m for m in (await _messages(row) if row else []) if m.embeds]
    if not msgs:
        return False
    fname = f"{''.join(ch for ch in name if ch.isalnum() or ch in '-_')[:60] or 'doc'}.{ext}"
    done = False
    for msg in msgs:
        e = msg.embeds[0]
        e.set_image(url=f"attachment://{fname}")
        try:
            await msg.edit(embed=e, attachments=[discord.File(io.BytesIO(data), filename=fname)])
            done = True
        except discord.HTTPException as ex:
            log.warning("Картинка документа %s-%s: %s", kind, did, ex)
    if done:
        await db.run("UPDATE doc_msgs SET img=? WHERE kind=? AND id=?", fname, kind, did)
    return done


async def remove(kind: str, did: int):
    """Документ видалено: прибрати і його повідомлення з Discord (з копіями)."""
    row = await _row(kind, did)
    for msg in (await _messages(row) if row else []):
        try:
            await msg.delete()
        except discord.HTTPException:
            pass
    await db.run("DELETE FROM doc_msgs WHERE kind=? AND id=?", kind, did)


# ---------------------------------------------------------------- нагадування про документи, що довго чекають рішення
REMIND_AFTER = 24 * 3600 * 1000   # перше нагадування — через добу, далі не частіше ніж раз на добу
REMIND_MAX = 3                    # не більше трьох нагадувань на документ


async def remind_waiting():
    """Відповідь під карткою документа з тегами тих, хто має ухвалити рішення: звіти, рапорти, проєкти наказів, документи Мінфіну."""
    now = now_ms()
    old = now - REMIND_AFTER
    todo = []  # (вид, номер, з якого часу чекає, ролі, що робити)
    heads = [RANK_ROLES[10], RANK_ROLES[11]]  # заступник начальника й начальник відділу (у каналі відділу бачать лише свої)
    for a in await db.all("SELECT id, t FROM acts WHERE status='wait' AND t<?", old):
        todo.append(("act", a["id"], a["t"], heads, "Звіт чекає перевірки"))
    for r in await db.all("SELECT id, type, t FROM raps WHERE status='wait' AND t<?", old):
        todo.append(("rap", r["id"], r["t"], key_roles(f"rap:{r['type']}"), "Рапорт чекає розгляду"))
    for o in await db.all("SELECT id, t FROM orders WHERE kind='appoint' AND status='draft' AND t<?", old):
        todo.append(("np", o["id"], o["t"], key_roles("order:draft"), "Проєкт наказу чекає підпису"))
    for d in await db.all("SELECT id, updated FROM fin_docs WHERE status='wait' AND updated<?", old):
        todo.append(("fin", d["id"], d["updated"], key_roles("fin:wait"), "Документ Мінфіну чекає погодження"))
    seen = await db.get_setting("doc_remind", {})
    for kind, did, since, roles, label in todo:
        key = f"{kind}:{did}"
        cnt, last = seen.get(key, [0, 0])
        if cnt >= REMIND_MAX or now - last < REMIND_AFTER:
            continue
        row = await _row(kind, did)
        msgs = await _messages(row) if row else []
        if not msgs:
            continue  # документ, створений до появи карток з картинкою, або повідомлення видалено
        m = mentions([], None, roles)
        try:
            await msgs[0].reply(" ".join(filter(None, [f"⏰ {label} вже {(now - since) // 3_600_000} год.", m["content"]])),
                                mention_author=False, allowed_mentions=m["allowed_mentions"])
            seen[key] = [cnt + 1, now]
        except discord.HTTPException as ex:
            log.warning("Нагадування %s: %s", key, ex)
    live = {f"{k}:{i}" for k, i, *_ in todo}
    await db.set_setting("doc_remind", {k: v for k, v in seen.items() if k in live})  # вирішені — забути


async def reminder_loop():
    await asyncio.sleep(180)  # дати боту під'єднатися після запуску
    while True:
        try:
            await remind_waiting()
        except Exception as ex:
            log.warning("Нагадування про документи: %s", ex)
        await asyncio.sleep(3600)
