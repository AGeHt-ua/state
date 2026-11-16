"""Реєстр особистого транспорту співробітників СБУ (База даних → «Особистий транспорт»).

Підстави (законодавство штату NG):
- Заборони при виконанні службових обов'язків СБУ, п. 1.28: патрулювати на особистому автотранспорті без
  офіційного затвердження заборонено. Реєстрація в «Сові» і є таким затвердженням.
- Дорожній кодекс, ст. 20: на приватних авто заборонені стробоскопи, маячки, приховані сирени й символіка служб.
- Внутрішній статут СБУ, р. VII: заборонено зберігати табельне майно в особистому транспорті.
- Закон про Державні документи, ст. 16–17: керувати можна лише з посвідченням водія відповідної категорії.

Подає будь-який співробітник; затверджують Начальник управління, Заступник Голови й Голова СБУ
(поріг — «car_approve» в адмін-панелі → Права). Затверджений запис отримує номер свідоцтва ОТ-0001."""
import asyncio
import functools
import json
import logging

import discord

import core
import overrides as ov
import style
from core import Fail
from db import db, now_ms
from roles import DEPTS, rank_name

log = logging.getLogger("sova.cars")
STATUS = {"wait": "На затвердженні", "ok": "Зареєстровано", "rej": "Відмовлено", "revoked": "Анульовано", "deleted": "Видалено"}
KIND = {"sedan": "Легковий (седан, хетчбек, купе)", "suv": "Позашляховик / кросовер", "sport": "Спортивний",
        "van": "Мінівен / фургон", "pickup": "Пікап", "moto": "Мотоцикл", "truck": "Вантажний", "other": "Інше"}
CATEGORY = {"A": "A — мотоцикли", "B": "B — легкові", "C": "C / D — вантажні й автобуси"}
PURPOSE = {"patrol": "Патрулювання та виїзди на виклики", "ops": "Негласні оперативні заходи (без розпізнавальних знаків)",
           "move": "Пересування до місця служби й між об'єктами"}
PLATE_MAX = 8
MAX_ACTIVE = 5  # на одного співробітника: зареєстрованих і поданих разом
_lock = asyncio.Lock()  # одна черга на реєстр: унікальність номерних знаків


def _locked(fn):
    @functools.wraps(fn)
    async def wrapper(*a, **k):
        async with _lock:
            return await fn(*a, **k)
    return wrapper


def no(c: dict) -> str:
    return f"ОТ-{c['id']:04d}"


def can_submit(u: dict) -> bool:
    return u["rank"] >= 1 and not u.get("curator_ro") and u["dept"] not in ("curator", "prosecutor")


def can_approve(u: dict) -> bool:
    return u["rank"] >= ov.P("car_approve") and not u.get("curator_ro")


def rights(u: dict) -> dict:
    return {"submit": can_submit(u), "approve": can_approve(u)}


def can_view(u: dict, c: dict) -> bool:
    """Зареєстровані бачать усі співробітники (щоб упізнати авто колеги); заявки й відмови — власник і ті, хто затверджує."""
    return c["status"] == "ok" or c["owner"] == u["sid"] or can_approve(u) or bool(u.get("curator"))


def _plate(v) -> str:
    return "".join(ch for ch in str(v or "").upper() if ch.isalnum())[:PLATE_MAX]


def _clean(b: dict) -> dict:
    s = lambda k, n=120: str(b.get(k) or "").strip()[:n]
    return {
        "model": s("model", 60), "kind": b.get("kind") if b.get("kind") in KIND else "sedan",
        "color": s("color", 40), "plate": _plate(b.get("plate")), "year": s("year", 4),
        "category": b.get("category") if b.get("category") in CATEGORY else "B",
        "purpose": [p for p in (b.get("purpose") or []) if p in PURPOSE][:3],
        "tint": bool(b.get("tint")), "mods": s("mods", 300), "note": s("note", 600),
        "photo": s("photo", 40), "photos": [str(f)[:40] for f in (b.get("photos") or []) if f][:4],
        "license": bool(b.get("license")), "noSignals": bool(b.get("noSignals")), "noGear": bool(b.get("noGear")),
    }


def problems(x: dict) -> list[str]:
    bad = []
    if len(x["model"]) < 2:
        bad.append("марку й модель")
    if len(x["plate"]) < 3:
        bad.append("номерний знак (від 3 символів)")
    if not x["color"]:
        bad.append("колір")
    if not x["photo"]:
        bad.append("фотографію автомобіля")
    if not x["purpose"]:
        bad.append("мету використання")
    if not x["license"]:
        bad.append("підтвердження посвідчення водія (ст. 16–17 Закону про Державні документи)")
    if not x["noSignals"]:
        bad.append("підтвердження відсутності спецсигналів і символіки (ст. 20 Дорожнього кодексу)")
    if not x["noGear"]:
        bad.append("зобов'язання не зберігати табельне майно в авто (Внутрішній статут СБУ, р. VII)")
    return bad


async def _person(sid: int | None) -> dict | None:
    p = await core.user(sid) if sid else None
    return {"sid": p["sid"], "name": p["name"], "rankName": rank_name(p["rank"]), "dept": p["dept"], "callsign": p.get("callsign"),
            "deptName": DEPTS.get(p["dept"], {}).get("s", "")} if p else None


async def get(cid: int, u: dict | None = None) -> dict:
    c = await db.one("SELECT * FROM cars WHERE id=? AND status!='deleted'", cid)
    if not c:
        raise Fail("Запис не знайдено.", 404)
    c["data"] = json.loads(c["data"] or "{}")
    c["history"] = json.loads(c["history"] or "[]")
    if u and not can_view(u, c):
        raise Fail("Заявку бачать власник і керівництво, яке затверджує реєстрацію.", 403)
    c["no"] = no(c) if c["status"] in ("ok", "revoked") else f"Заявка №{c['id']}"
    c["statusName"] = STATUS.get(c["status"], c["status"])
    c["ownerUser"] = await _person(c["owner"])
    c["approverUser"] = await _person(c["approver"]) if c.get("approver") else None
    return c


async def listing(u: dict) -> list[dict]:
    rows = await db.all("SELECT id FROM cars WHERE status!='deleted' ORDER BY CASE status WHEN 'wait' THEN 0 ELSE 1 END, id DESC LIMIT 500")
    out = []
    for r in rows:
        try:
            out.append(await get(r["id"], u))
        except Fail:
            continue
    return out


async def pending(u: dict) -> int:
    if not can_approve(u):
        return 0
    return (await db.one("SELECT COUNT(*) AS n FROM cars WHERE status='wait'"))["n"]


def _hist(c: dict | None, u: dict, action: str, note: str = "") -> str:
    h = (c or {}).get("history", []) + [{"t": now_ms(), "sid": u["sid"], "name": u["name"], "rank": rank_name(u["rank"]), "action": action, "note": note[:300]}]
    return json.dumps(h, ensure_ascii=False)


async def _check_photo(fid: str, u: dict):
    if not fid:
        return
    f = await db.one("SELECT ctype, uploader FROM files WHERE id=?", fid)
    if not f or not str(f["ctype"] or "").startswith("image/"):
        raise Fail("Фотографія має бути зображенням (JPG, PNG, WEBP).")


async def _plate_taken(plate: str, skip: int | None) -> dict | None:
    for r in await db.all("SELECT id, owner, data FROM cars WHERE status IN ('wait','ok')"):
        if r["id"] != skip and json.loads(r["data"] or "{}").get("plate") == plate:
            return r
    return None


@_locked
async def save(u: dict, b: dict) -> dict:
    """Нова заявка або виправлення власної заявки (на затвердженні чи після відмови — тоді подається знову)."""
    if not can_submit(u):
        raise Fail("Реєструвати особистий транспорт можуть співробітники СБУ.", 403)
    old = await get(int(b["id"]), u) if b.get("id") else None
    if old and (old["owner"] != u["sid"] or old["status"] not in ("wait", "rej")):
        raise Fail("Виправити можна лише власну заявку на затвердженні або після відмови.", 403)
    x = _clean(b.get("data") or {})
    bad = problems(x)
    if bad:
        raise Fail("Не заповнено: " + ", ".join(bad) + ".")
    await _check_photo(x["photo"], u)
    for f in x["photos"]:
        await _check_photo(f, u)
    taken = await _plate_taken(x["plate"], old["id"] if old else None)
    if taken:
        raise Fail(f"Номерний знак {x['plate']} уже зареєстровано або подано на реєстрацію (запис №{taken['id']}).", 409)
    if not old:
        n = (await db.one("SELECT COUNT(*) AS n FROM cars WHERE owner=? AND status IN ('wait','ok')", u["sid"]))["n"]
        if n >= MAX_ACTIVE:
            raise Fail(f"На одного співробітника — не більше {MAX_ACTIVE} зареєстрованих або поданих автомобілів.")
    data = json.dumps(x, ensure_ascii=False)
    if old:
        await db.run("UPDATE cars SET data=?, status='wait', history=?, updated=? WHERE id=?",
                     data, _hist(old, u, "resubmit" if old["status"] == "rej" else "edit"), now_ms(), old["id"])
        c = await get(old["id"], u)
    else:
        cid = await db.run("INSERT INTO cars(owner,status,data,history,created,updated) VALUES(?,?,?,?,?,?)",
                           u["sid"], "wait", data, _hist(None, u, "create"), now_ms(), now_ms())
        c = await get(cid, u)
    await db.audit(u["sid"], "Подано заявку на реєстрацію особистого транспорту", None, f"№{c['id']} · {x['model']} · {x['plate']}")
    if not old or old["status"] == "rej":
        await journal(c, ping=True)
    return c


@_locked
async def act(u: dict, cid: int, action: str, b: dict) -> dict:
    c = await get(cid, u)
    note = str(b.get("note") or "").strip()[:300]
    mine = c["owner"] == u["sid"]
    x = c["data"]
    if action in ("approve", "reject"):
        if not can_approve(u):
            raise Fail("Затверджують реєстрацію Начальник управління, Заступник Голови та Голова СБУ.", 403)
        if c["status"] != "wait":
            raise Fail("Заявку вже розглянуто.")
        if action == "reject" and not note:
            raise Fail("Вкажіть причину відмови.")
        if action == "approve" and await _plate_taken(x["plate"], c["id"]):
            raise Fail("Цей номерний знак уже зареєстровано за іншим записом.", 409)
        st = "ok" if action == "approve" else "rej"
        await db.run("UPDATE cars SET status=?, approver=?, decided=?, history=?, updated=? WHERE id=?",
                     st, u["sid"], now_ms(), _hist(c, u, action, note), now_ms(), c["id"])
        c = await get(c["id"], u)
        await db.audit(u["sid"], "Зареєстровано особистий транспорт" if st == "ok" else "Відмовлено в реєстрації транспорту",
                       c["owner"], f"{c['no']} · {x['model']} · {x['plate']}" + (f" · {note}" if note else ""))
        await journal(c)
        await tell_owner(c, u, note)
    elif action == "revoke":
        if not (mine or can_approve(u)) or c["status"] != "ok":
            raise Fail("Анулювати реєстрацію може власник або керівництво, яке її затверджує.", 403)
        if not mine and not note:
            raise Fail("Вкажіть причину анулювання.")
        await db.run("UPDATE cars SET status='revoked', history=?, updated=? WHERE id=?", _hist(c, u, "revoke", note), now_ms(), c["id"])
        c = await get(c["id"], u)
        await db.audit(u["sid"], "Анульовано реєстрацію особистого транспорту", c["owner"], f"{c['no']} · {x['plate']}" + (f" · {note}" if note else ""))
        await journal(c)
        if not mine:
            await tell_owner(c, u, note)
    elif action == "delete":
        if not ((mine and c["status"] in ("wait", "rej", "revoked")) or can_approve(u)):
            raise Fail("Видалити можна власну заявку, відмову чи анульований запис; зареєстрований — лише керівництво.", 403)
        await db.run("UPDATE cars SET status='deleted', history=?, updated=? WHERE id=?", _hist(c, u, "delete", note), now_ms(), c["id"])
        await db.audit(u["sid"], "Видалено запис реєстру транспорту", c["owner"], f"№{c['id']} · {x['plate']}")
        return {"ok": True}
    else:
        raise Fail("Невідома дія.")
    return c


def _color(c: dict) -> int:
    return {"ok": style.GREEN, "rej": style.RED, "revoked": style.GRAY}.get(c["status"], style.GOLD)


async def embed(c: dict) -> discord.Embed:
    x, o = c["data"], c.get("ownerUser") or {}
    state = {"wait": "🕓 На затвердженні", "ok": "✅ Зареєстровано", "rej": "⛔ Відмовлено", "revoked": "⛔ Анульовано"}.get(c["status"], c["statusName"])
    last = (c["history"] or [{}])[-1]
    e = style.card(c["no"], "Реєстрація особистого транспорту", state, _color(c),
                   note=f"Причина: {style.esc(last.get('note'))}" if c["status"] in ("rej", "revoked") and last.get("note") else None, fields=[
        ("Автомобіль", f"**{style.esc(x.get('model'))}**" + (f" · {style.esc(x['year'])}" if x.get("year") else "")),
        ("Номерний знак", f"`{style.esc(x.get('plate'))}`"),
        ("Колір", style.esc(x.get("color") or "—")),
        ("Власник", f"{style.esc(o.get('rankName', ''))} {style.esc(o.get('name', '—'))} · №{c['owner']}"),
        ("Тип", KIND.get(x.get("kind"), "—")),
        ("Мета", ", ".join(PURPOSE[p] for p in x.get("purpose", []) if p in PURPOSE) or "—", False),
        ("Затвердив", f"{style.esc(c['approverUser']['rankName'])} {style.esc(c['approverUser']['name'])}" if c.get("approverUser") and c["status"] != "wait" else None),
    ])
    if x.get("photo"):
        try:
            e.set_image(url=await core.file_url(x["photo"]))
        except Exception:
            pass
    return e


async def journal(c: dict, ping: bool = False):
    """Одне повідомлення на запис: заявка → рішення оновлюють ту саму картку. Збій Discord не скасовує рішення на сайті."""
    try:
        ch = await core.channel("cars") or await core.channel("log")
        if not ch:
            return
        e = await embed(c)
        if c.get("msg"):
            try:
                m = await ch.fetch_message(int(c["msg"]))
                await m.edit(embed=e)
                return
            except (discord.HTTPException, ValueError):
                pass
        m = await ch.send(embed=e, view=style.site_view(), **(core.mention("car") if ping else {"allowed_mentions": discord.AllowedMentions.none()}))
        await db.run("UPDATE cars SET msg=? WHERE id=?", str(m.id), c["id"])
    except Exception as err:
        log.warning("Реєстр транспорту: картка №%s не надіслана: %s", c["id"], err)


async def tell_owner(c: dict, actor: dict, note: str):
    try:
        await _tell_owner(c, actor, note)
    except Exception as err:
        log.warning("Реєстр транспорту: повідомлення власнику №%s не надіслано: %s", c["id"], err)


async def _tell_owner(c: dict, actor: dict, note: str):
    o = await core.user(c["owner"])
    if not o or not o.get("discord_id"):
        return
    m = await core.member_of(o["discord_id"])
    if not m:
        return
    x = c["data"]
    title = {"ok": "ТРАНСПОРТ ЗАРЕЄСТРОВАНО", "rej": "У РЕЄСТРАЦІЇ ВІДМОВЛЕНО", "revoked": "РЕЄСТРАЦІЮ АНУЛЬОВАНО"}.get(c["status"], "РЕЄСТР ТРАНСПОРТУ")
    lines = [style.kv("АВТОМОБІЛЬ", f"{x.get('model')} · {x.get('plate')}", bold=True),
             style.kv("РОЗГЛЯНУВ", f"{rank_name(actor['rank'])} {actor['name']}")]
    if note:
        lines.append(style.kv("ПРИЧИНА", note, bold=True))
    lines += [style.rule(), style.c("Свідоцтво доступне в ЄІС «Сова» → База даних → Особистий транспорт." if c["status"] == "ok"
                                   else "Виправте зауваження й подайте заявку повторно в ЄІС «Сова».")]
    try:
        await m.send(embed=style.document(title, _color(c), no=c["no"], desc=style.block(*lines)), view=style.site_view())
    except discord.HTTPException:
        pass
