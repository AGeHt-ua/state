"""Новини на головній сторінці «Сови»: стрічка для всього особового складу.

Публікують ті, кому дозволено (адмін-панель → Права, «news_post»; також Прес-служба). Кожна новина одночасно
йде в канал Discord «news» (адмін-панель → Канали) зі згадкою ролі (адмін-панель → «Кого згадувати», ключ «news»)
і з прикріпленою картинкою. Видалення новини на сайті прибирає й повідомлення в Discord.
"""
import io
import logging
import time

import discord

import config
import core
import docpost
import overrides as ov
from core import Fail
from db import db, now_ms
from roles import PRESS_ROLE, rank_name

log = logging.getLogger("sova.news")

IMG_TYPES = ("image/png", "image/jpeg", "image/gif", "image/webp")
COLOR = 0xC9A05A


def can_post(u: dict) -> bool:
    if u.get("curator_ro"):
        return False
    return u["rank"] >= ov.P("news_post") or u.get("dept") == "press" or core.has_role(u, PRESS_ROLE)


def can_delete(u: dict, n: dict) -> bool:
    return not u.get("curator_ro") and (n["author"] == u["sid"] or u["rank"] >= ov.P("news_post"))


async def _out(u: dict, rows: list[dict]) -> list[dict]:
    sids = {r["author"] for r in rows}
    people = {p["sid"]: p for p in (await db.all(f"SELECT sid, name, rank, dept FROM users WHERE sid IN ({','.join('?' * len(sids))})", *sids) if sids else [])}
    out = []
    for r in rows:
        p = people.get(r["author"]) or {}
        out.append({"id": r["id"], "title": r["title"], "body": r["body"], "img": r["img"], "t": r["t"],
                    "author": {"sid": r["author"], "name": p.get("name") or f"№{r['author']}", "rankName": rank_name(p["rank"]) if p.get("rank") else ""},
                    "discord": bool(r["msg"]), "canDelete": can_delete(u, r)})
    return out


async def listing(u: dict, limit: int = 30) -> dict:
    rows = await db.all("SELECT * FROM news WHERE deleted IS NULL ORDER BY t DESC LIMIT ?", max(1, min(100, limit)))
    return {"items": await _out(u, rows), "canPost": can_post(u)}


async def _image(fid: str) -> tuple[bytes, str] | None:
    """Байти картинки зі сховища файлів (повідомлення в каналі «files»), щоб прикріпити її до новини в Discord."""
    row = await db.one("SELECT * FROM files WHERE id=?", fid)
    if not row:
        return None
    ch = core.bot.get_channel(int(row["ch_id"])) or await core.bot.fetch_channel(int(row["ch_id"]))
    msg = await ch.fetch_message(int(row["msg_id"]))
    if not msg.attachments:
        return None
    a = msg.attachments[0]
    ext = (a.filename.rsplit(".", 1)[-1] if "." in a.filename else "png").lower()[:5]
    return await a.read(), f"news.{ext}"


async def _post_discord(n: dict, u: dict) -> tuple[str, str] | None:
    ch = await core.channel("news")
    if not ch:
        return None
    root = config.SITE_URL.rstrip('/')
    site, logo = f"{root}/site/#/", f"{root}/site/sbu-logo.webp"
    # Картка «Інформаційний бюлетень СБУ»: шапка з емблемою, заголовок-посилання на сайт, текст між лініями,
    # реквізити випуску (номер, автор, дата), картинка на всю ширину; під карткою — кнопка «Читати в Сові»
    line = "━" * 24
    body = n["body"][:3600].strip()
    e = discord.Embed(title=f"📰 {n['title']}"[:256], url=site, color=COLOR, timestamp=discord.utils.utcnow(),
                      description=f"{line}\n{body}\n{line}" if body else line)
    e.set_author(name="СЛУЖБА БЕЗПЕКИ УКРАЇНИ · ПРЕС-ЦЕНТР", url=site, icon_url=logo)
    e.set_thumbnail(url=logo)
    e.add_field(name="📋 Випуск", value=f"`НВ-{n['id']:04d}`", inline=True)
    e.add_field(name="👤 Автор", value=(f"{rank_name(u['rank'])}\n**{u['name']}**" if u.get("dept") != "curator" else "**Керівництво СБУ**")[:1024], inline=True)
    e.add_field(name="🗓 Дата", value=f"<t:{int(time.time())}:f>", inline=True)
    e.set_footer(text="ЄІС «Сова» · Інформаційний бюлетень СБУ · Для службового користування", icon_url=logo)
    kw = {}
    if n["img"]:
        try:
            img = await _image(n["img"])
        except (discord.HTTPException, ValueError) as ex:
            log.warning("Новина %s: картинку не взято (%s)", n["id"], ex)
            img = None
        if img:
            e.set_image(url=f"attachment://{img[1]}")
            kw["file"] = discord.File(io.BytesIO(img[0]), filename=img[1])
    m = docpost.mentions([], None, docpost.key_roles("news"))
    view = discord.ui.View(timeout=None)
    view.add_item(discord.ui.Button(label="Читати в «Сові»", emoji="🦉", url=site))
    head = "📢 **Інформаційний бюлетень СБУ**"
    msg = await ch.send(content=" · ".join(filter(None, [head, m["content"]])), embed=e, allowed_mentions=m["allowed_mentions"], view=view, **kw)
    return str(ch.id), str(msg.id)


async def create(u: dict, b: dict) -> dict:
    if not ov.module_on("news"):
        raise Fail("Новини вимкнено в адмін-панелі.", 403)
    if not can_post(u):
        raise Fail("Публікувати новини може керівництво й Прес-служба (адмін-панель → Права).", 403)
    title = " ".join(str(b.get("title") or "").split())[:200]
    body = str(b.get("body") or "").strip()[:3500]
    img = str(b.get("img") or "").strip() or None
    if len(title) < 3:
        raise Fail("Додайте заголовок новини (від 3 символів).")
    if img:
        f = await db.one("SELECT ctype, filename FROM files WHERE id=?", img)
        if not f:
            raise Fail("Картинку не знайдено — прикріпіть її ще раз.")
        if not (str(f["ctype"]).startswith("image/") or str(f["filename"]).lower().endswith((".png", ".jpg", ".jpeg", ".gif", ".webp"))):
            raise Fail("До новини можна прикріпити лише картинку (PNG, JPG, GIF, WEBP).")
    nid = await db.run("INSERT INTO news(author,title,body,img,t) VALUES(?,?,?,?,?)", u["sid"], title, body, img, now_ms())
    n = {"id": nid, "title": title, "body": body, "img": img}
    warn = None
    try:
        where = await _post_discord(n, u)
        if where:
            await db.run("UPDATE news SET ch=?, msg=? WHERE id=?", where[0], where[1], nid)
        else:
            warn = "Канал новин у Discord не налаштовано (адмін-панель → Канали → «Новини») — новина лише на сайті."
    except Exception as ex:  # будь-яка біда з Discord не скасовує публікацію на сайті
        log.warning("Новина %s: Discord відхилив (%r)", nid, ex)
        warn = "Новину опубліковано на сайті, але Discord її не прийняв. Перевірте права бота в каналі новин."
    await db.audit(u["sid"], "Опубліковано новину", None, title[:120])
    return {"ok": True, "id": nid, "warn": warn}


async def delete(u: dict, nid: int) -> dict:
    n = await db.one("SELECT * FROM news WHERE id=? AND deleted IS NULL", nid)
    if not n:
        raise Fail("Новину не знайдено.", 404)
    if not can_delete(u, n):
        raise Fail("Видалити новину може автор або керівництво.", 403)
    await db.run("UPDATE news SET deleted=? WHERE id=?", now_ms(), nid)
    if n["msg"]:
        try:
            ch = core.bot.get_channel(int(n["ch"])) or await core.bot.fetch_channel(int(n["ch"]))
            await (await ch.fetch_message(int(n["msg"]))).delete()
        except (discord.HTTPException, ValueError):
            pass
    await db.audit(u["sid"], "Видалено новину", None, n["title"][:120])
    return {"ok": True}
