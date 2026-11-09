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
# імена картинок аркуша (img: сторінки А4 через «|»), обрана в формі роль/відділ (tag), кого стосується (who: Discord ID через кому)
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


# ---------------------------------------------------------------- правки карток: черга з повтором
# Discord дозволяє в каналі лише кілька правок повідомлень, старших за годину (429, код 30046), тож коли керівник
# за хвилину розглядає десяток старих рапортів, частина правок відхиляється. Тому правки йдуть через чергу:
#  • картку й картинку аркуша, яку сайт надсилає за секунду-дві після рішення, бот вносить ОДНІЄЮ правкою;
#  • правку, яку Discord відхилив через ліміт, бот повторює пізніше, доки не пройде (картка не «зависає» зі старим статусом).
# Черга живе в пам'яті: після перезапуску бота невнесені правки відновлює «Перебудувати картки» в адмін-панелі.
EDIT_DELAY = 6.0          # с: зачекати картинку від сайту, щоб оновити картку й картинку разом
RETRY_SOON = 60.0         # с: звичайне «You are being rate limited»
RETRY_OLD = 15 * 60.0     # с: 30046 — ліміт правок старих повідомлень у каналі (скидається приблизно за годину)
RETRY_MAX = 12            # спроб на одну правку (для 30046 — близько трьох годин)
_pending: dict[tuple[str, int], dict] = {}   # (вид, номер) → {"embed", "view", "img": [(байти, ім'я), …] | None, "left", "tries"}
MAX_PAGES = 10   # сторінок-картинок у картці: Discord показує до 10 вкладень і 10 вбудувань в одному повідомленні
_tasks: dict[tuple[str, int], asyncio.Task] = {}


def _queue(kind: str, did: int, *, embed: discord.Embed | None = None, view: discord.ui.View | None = None,
           img: list[tuple[bytes, str]] | None = None):
    """Додати зміну картки до черги; зміни, що прийшли до внесення, зливаються в одну правку."""
    key = (kind, did)
    p = _pending.setdefault(key, {"embed": None, "view": None, "img": None, "left": None, "tries": 0})
    if embed is not None:
        p["embed"] = embed
    if view is not None:
        p["view"] = view
    if img is not None:
        p["img"] = img
    p["left"] = None  # нові дані — внести в усі повідомлення документа
    task = _tasks.get(key)
    if not task or task.done():
        _tasks[key] = asyncio.create_task(_worker(key))


def _retry_after(ex: discord.HTTPException) -> float | None:
    """Через скільки секунд повторити правку, яку відхилив Discord; None — повтор не допоможе (видалено, немає прав)."""
    if ex.status == 429:
        return RETRY_OLD if ex.code == 30046 else RETRY_SOON
    if ex.status >= 500:
        return RETRY_SOON
    return None


async def _apply(key: tuple[str, int], p: dict) -> float | None:
    """Внести зміну в усі повідомлення документа. Повертає, через скільки секунд повторити те, що не пройшло (None — усе)."""
    kind, did = key
    row = await _row(*key)
    msgs = await _messages(row) if row else []
    if p["left"] is not None:
        msgs = [m for m in msgs if m.id in p["left"]]
    wait, left, img_done = None, set(), False
    for msg in msgs:
        if p["embed"] is not None:
            e = p["embed"].copy()
        elif msg.embeds:
            e = msg.embeds[0]
        else:
            continue
        extra = {"view": p["view"]} if p["view"] is not None else {}
        # сторінки аркуша: перша — у самій картці, решта — окремими вбудуваннями під нею (кожна сторінка на всю ширину)
        names = [f for _, f in p["img"]] if p["img"] else [n for n in (row["img"] or "").split("|") if n]
        embeds = [e]
        if names:
            e.set_image(url=f"attachment://{names[0]}")
            embeds += [discord.Embed(color=e.color).set_image(url=f"attachment://{n}") for n in names[1:MAX_PAGES]]
        if p["img"]:
            extra["attachments"] = [discord.File(io.BytesIO(data), filename=fname) for data, fname in p["img"]]
        try:
            await msg.edit(embeds=embeds, **extra)
            img_done = img_done or bool(p["img"])
        except discord.HTTPException as ex:
            after = _retry_after(ex)
            what = "Картинка документа" if p["img"] and p["embed"] is None else "Оновлення документа"
            if after is None:
                log.warning("%s %s-%s: %s", what, kind, did, ex)
                continue
            log.info("%s %s-%s: Discord відхилив правку (%s), повтор через %d хв", what, kind, did, ex.code or ex.status, max(1, after // 60))
            left.add(msg.id)
            wait = max(wait or 0, after)
    if img_done:
        await db.run("UPDATE doc_msgs SET img=? WHERE kind=? AND id=?", "|".join(f for _, f in p["img"]), kind, did)
    p["left"] = left
    return wait


async def _worker(key: tuple[str, int]):
    delay = EDIT_DELAY
    try:
        while True:
            await asyncio.sleep(delay)
            p = _pending.pop(key, None)
            if not p:
                return
            try:
                wait = await _apply(key, p)
            except Exception:
                log.exception("Правка картки документа %s-%s", *key)
                wait = RETRY_SOON
            if wait is None:
                if key not in _pending:
                    return
                delay = 1.0  # поки вносили, прийшла нова зміна
                continue
            p["tries"] += 1
            if p["tries"] >= RETRY_MAX:
                log.warning("Картка документа %s-%s не оновилась після %d спроб (ліміти Discord) — «Перебудувати картки» в адмін-панелі",
                            *key, p["tries"])
                if key not in _pending:
                    return
                delay = 1.0
                continue
            newer = _pending.get(key)
            if newer:  # новіші дані важливіші; з невнесеної спроби лишаємо те, чого в них немає
                for k in ("embed", "view", "img"):
                    if newer[k] is None:
                        newer[k] = p[k]
                newer["tries"] = p["tries"]
            else:
                _pending[key] = p
            delay = wait
    finally:
        if _tasks.get(key) is asyncio.current_task():
            del _tasks[key]


async def update(kind: str, did: int, embed: discord.Embed, *, view: discord.ui.View | None = None,
                 ping: str | None = None, users: list[str] | None = None, roles: list[int] | None = None) -> bool:
    """Оновлює картку документа (і копії), зберігаючи картинку аркуша й рядок «Стосується».
    ping — коротка відповідь під повідомленням лише тоді, коли треба покликати нових людей (roles: наступний етап, напр. Мінфін чи виплата премій).
    Рішення («Погоджено», «Відхилено», «Підписано») окремою відповіддю не дублюємо — картка й так оновлюється.
    Сама правка картки йде через чергу (_queue): за кілька секунд, разом із картинкою від сайту, з повтором після лімітів."""
    row = await _row(kind, did)
    msgs = await _messages(row) if row else []
    if not msgs:
        return False
    concerns_field(embed, _who(row), row["tag"])
    _queue(kind, did, embed=embed, view=view)
    if ping and roles:
        m = mentions([], None, roles)
        try:
            await msgs[0].reply(" ".join(filter(None, [ping, m["content"]])), mention_author=False, allowed_mentions=m["allowed_mentions"])
        except discord.HTTPException as ex:
            log.warning("Відповідь під документом %s-%s: %s", kind, did, ex)
    return True


async def journal(kind: str, did: int, ch: discord.abc.Messageable | None, embed: discord.Embed, *,
                  users: list[str] | None = None, tag: str | None = None, roles: list[int] | None = None,
                  ping: str | None = None, ping_roles: list[int] | None = None):
    """Журнал документа одним повідомленням: перша дія публікує картку з тегами, наступні — оновлюють її з короткою відповіддю."""
    if await _row(kind, did) and await update(kind, did, embed, ping=ping, roles=ping_roles):
        return
    await post(kind, did, ch, embed, users=users, tag=tag, roles=roles)


async def set_image(kind: str, did: int, pages: list[bytes], name: str) -> bool:
    """Картинки аркуша А4 (PNG/JPEG, сформовані сайтом; довгий документ — по картинці на сторінку, як у PDF) —
    у картку документа та її копії (через чергу правок, разом зі зміною картки)."""
    if isinstance(pages, (bytes, bytearray)):
        pages = [pages]
    if not pages:
        raise Fail("Немає картинки документа.")
    if len(pages) > MAX_PAGES:
        raise Fail(f"Картинок документа більше {MAX_PAGES}.")
    if sum(map(len, pages)) > 9 * 1024 * 1024:
        raise Fail("Картинки документа завеликі.")
    base = ''.join(ch for ch in name if ch.isalnum() or ch in '-_')[:60] or 'doc'
    files = []
    for i, data in enumerate(pages, 1):
        if data.startswith(b"\x89PNG"):
            ext = "png"
        elif data.startswith(b"\xff\xd8\xff"):
            ext = "jpg"
        else:
            raise Fail("Картинка документа має бути PNG або JPEG.")
        files.append((bytes(data), f"{base}-{i}.{ext}" if len(pages) > 1 else f"{base}.{ext}"))
    row = await _row(kind, did)
    msgs = [m for m in (await _messages(row) if row else []) if m.embeds]
    if not msgs:
        return False
    _queue(kind, did, img=files)
    return True


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
