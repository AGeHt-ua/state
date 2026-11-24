"""Кейс-файли: оперативні справи ОРВ, ДЕБ, АТЦ, ЦСО «А», ВВБ.
Маршрут: виконавець → начальник свого відділу → начальник управління (лише для відділів його управління: ОРВ, ДЕБ
або як задано в адмін-панелі → «Управління») → Голова СБУ або заступник → Генеральний прокурор → затверджено.
Начальник управління бачить справу своїх підрозділів лише після погодження начальником відділу.
Зміст справи бачать лише учасники маршруту; у Discord іде тільки журнал руху документа, без змісту."""
import io
import json
import logging

import discord

import config
import core
import docpost
import overrides as ov
import style
from core import Fail
from db import db, now_ms
from roles import DEPTS, rank_name

log = logging.getLogger("sova.cases")

CASE_DEPTS = ("orv", "deb", "atc", "alpha", "vvb")
STAGES = ("draft", "head", "mgmt", "chief", "prosecutor", "approved", "rejected")
STAGE_NAME = {"deleted": "Видалено", "draft": "Чернетка виконавця", "head": "Погодження начальника відділу",
              "mgmt": "Погодження начальника управління", "chief": "Погодження Голови СБУ",
              "prosecutor": "Розгляд Генерального прокурора", "approved": "Затверджено", "rejected": "Відмовлено"}
REACH = {"deleted": 0, "draft": 0, "head": 1, "mgmt": 1, "chief": 2, "prosecutor": 3, "approved": 4, "rejected": 0}
GRIF = {"dsk": "ДЛЯ СЛУЖБОВОГО КОРИСТУВАННЯ", "secret": "ТАЄМНО", "top": "ЦІЛКОМ ТАЄМНО"}
REQUESTS = {"search": "Ордер на обшук", "arrest": "Ордер на арешт (затримання)", "op": "Санкція на проведення спецоперації",
            "surv": "Санкція на негласне стеження та прослуховування", "suspect": "Повідомлення про підозру", "other": "Інше клопотання"}
ROLES = ("підозрюваний", "фігурант", "свідок", "потерпілий", "джерело")
MGMT_DEPTS = {"orv", "deb"}  # відділи управління за замовчуванням (інакше — адмін-панель → «Управління»)
ON_REVIEW = ("head", "mgmt", "chief", "prosecutor")


def depts_of(u: dict) -> set[str]:
    """Відділи, ролі яких має співробітник (з кешу ролей Discord) + основний відділ картки."""
    out = {u["dept"]}
    hit = core._roles_cache.get(str(u.get("discord_id")))
    if hit and hit[1]:
        out |= {k for k in CASE_DEPTS if DEPTS[k]["role"] in hit[1]}
    return out


def is_head_for(u: dict, dept: str) -> bool:
    """Начальник відділу з роллю цього відділу; у ОРВ — ще й заступник начальника з роллю ОРВ."""
    mine = depts_of(u)
    return (u["rank"] == 12 and dept in mine) or (dept == "orv" and u["rank"] == 11 and "orv" in mine)


def mgmt_route() -> set[str]:
    """Відділи, кейс-файли яких проходять етап начальника управління; решта (напр. АТЦ, ЦСО «А») — одразу до Голови."""
    return MGMT_DEPTS | {d for v in ov.mgmt.values() for d in v if d in CASE_DEPTS}


def is_mgmt_for(u: dict, dept: str) -> bool:
    """Начальник управління саме цього відділу (адмін-панель → «Управління», інакше — за ролями відділів у Discord)."""
    import depts  # тут, щоб уникнути циклічного імпорту
    return u["rank"] == 13 and dept in mgmt_route() and dept in depts.mgmt_depts(u)


def _passed_head(c: dict) -> bool:
    """Справа вже пройшла начальника відділу (зараз або колись) — тоді її бачить начальник управління."""
    return c["status"] not in ("draft", "head", "deleted") or c["reached"] >= 2 or any(
        isinstance(h, dict) and h.get("stage") == "mgmt" for h in c.get("history") or [])


def is_chief(u: dict) -> bool:
    return u["rank"] >= ov.P("case_chief")


def is_prosecutor(u: dict) -> bool:
    return u["dept"] == "prosecutor"


def can_create(u: dict) -> list[str]:
    """Відділи, від імені яких співробітник може заводити кейс-файл."""
    if is_prosecutor(u):
        return []
    if is_chief(u):
        return list(CASE_DEPTS)
    return [d for d in CASE_DEPTS if d in depts_of(u)]


def can_view(u: dict, c: dict) -> bool:
    if c["author"] == u["sid"] or is_chief(u) or is_head_for(u, c["dept"]):
        return True
    if is_mgmt_for(u, c["dept"]) and _passed_head(c):
        return True
    return is_prosecutor(u) and c["reached"] >= 3


def can_decide(u: dict, c: dict) -> bool:
    if c["author"] == u["sid"]:
        return False
    # етап начальника управління за його відсутності може пройти й Голова чи заступник
    return {"head": is_head_for(u, c["dept"]), "mgmt": is_mgmt_for(u, c["dept"]) or is_chief(u), "chief": is_chief(u),
            "prosecutor": is_prosecutor(u)}.get(c["status"], False)


def can_transfer(u: dict, c: dict) -> bool:
    """Передати справу іншому виконавцю: заступник і начальник відділу — справи свого відділу, начальник управління — своїх підрозділів,
    керівництво СБУ — будь-яку. Мінімальне звання — адмін-панель → «Доступи» (case_transfer). Затверджені й видалені справи не передаються."""
    if u.get("curator_ro") or is_prosecutor(u) or c["status"] in ("deleted", "approved"):
        return False
    if is_chief(u):
        return True
    if u["rank"] < ov.P("case_transfer"):
        return False
    if u["rank"] == 13:
        return is_mgmt_for(u, c["dept"]) or c["dept"] in depts_of(u)
    return u["rank"] in (11, 12) and c["dept"] in depts_of(u)


async def transfer_targets(u: dict, cid: int) -> list[dict]:
    """Кому можна передати: чинні співробітники відділу справи (основний відділ або роль відділу), крім поточного виконавця."""
    c = await get(cid)
    if not can_transfer(u, c):
        raise Fail("Передавати цю справу ви не можете.", 403)
    rows = await db.all("SELECT * FROM users WHERE status IN ('active','vacation') AND dept NOT IN ('prosecutor','curator') AND sid!=? ORDER BY rank DESC, name",
                        c["author"])
    return [{"sid": r["sid"], "name": r["name"], "rank": r["rank"], "rankName": rank_name(r["rank"]), "vacation": r["status"] == "vacation"}
            for r in rows if c["dept"] in depts_of(r)]


@core.serialized("case")
async def transfer(u: dict, cid: int, sid: int, note: str = "") -> dict:
    c = await get(cid)
    if not can_transfer(u, c):
        raise Fail("Передавати цю справу ви не можете.", 403)
    if sid not in {t["sid"] for t in await transfer_targets(u, cid)}:
        raise Fail(f"Передати можна лише співробітнику відділу {DEPTS[c['dept']]['s']}.")
    old, new = await core.user(c["author"]), await core.user(sid)
    text = f"{old['name'] if old else '№' + str(c['author'])} → {new['name']}" + (f" · {note.strip()}" if note.strip() else "")
    h = await _hist(c, u, "transfer", text)
    await db.run("UPDATE cases SET author=?, history=?, updated=? WHERE id=?", sid, json.dumps(h, ensure_ascii=False), now_ms(), cid)
    c = await get(cid)
    await journal(c, u, f"Передано іншому виконавцю: {new['name']}")
    await db.audit(u["sid"], "Кейс-файл передано іншому виконавцю", sid, f"КФ-{cid:04d} «{c['data'].get('title', '')}»")
    try:  # новому виконавцю — в особисті (без змісту справи)
        m = await core.member_of(new.get("discord_id")) if new.get("discord_id") else None
        if m:
            await m.send(embed=style.document("ВАМ ПЕРЕДАНО КЕЙС-ФАЙЛ", style.GOLD, no=f"КФ-{cid:04d}", desc=style.block(
                style.kv("СПРАВА", f"«{c['data'].get('title', '')}»", bold=True), style.kv("ЕТАП", STAGE_NAME[c["status"]]),
                style.kv("ПЕРЕДАВ", f"{rank_name(u['rank'])} {u['name']}"), *( [style.kv("ПРИМІТКА", note.strip()[:300])] if note.strip() else [] ),
                style.rule(), style.c("Справа тепер у вашому реєстрі кейс-файлів у ЄІС «Сова»."))), view=style.site_view())
    except discord.HTTPException:
        pass
    return c


def rights(u: dict) -> dict:
    return {"create": can_create(u), "view": bool(can_create(u)) or is_chief(u) or is_prosecutor(u)
            or any(is_head_for(u, d) or is_mgmt_for(u, d) for d in CASE_DEPTS)}


def clean(b: dict) -> dict:
    s = lambda v, n: str(v or "").strip()[:n]
    persons = [{"name": s(p.get("name"), 60), "sid": s(p.get("sid"), 10), "role": p.get("role") if p.get("role") in ROLES else "фігурант",
                "org": s(p.get("org"), 80), "note": s(p.get("note"), 300)} for p in (b.get("persons") or [])[:30] if s(p.get("name"), 60)]
    web = lambda v: s(v, 400) if s(v, 400).lower().startswith(("http://", "https://")) else ""  # лише веб-посилання
    evidence = [{"desc": s(e.get("desc"), 300), "url": web(e.get("url")), "files": [str(f)[:40] for f in (e.get("files") or [])[:5]]}
                for e in (b.get("evidence") or [])[:40] if s(e.get("desc"), 300) or e.get("files") or web(e.get("url"))]
    # хід розслідування: хронологія (коли й що встановлено, які докази здобуто)
    timeline = [{"when": s(x.get("when"), 30), "text": s(x.get("text"), 600)} for x in (b.get("timeline") or [])[:60] if s(x.get("text"), 600)]
    return {
        "title": s(b.get("title"), 80), "org": s(b.get("org"), 120), "grif": b.get("grif") if b.get("grif") in GRIF else "secret",
        "summary": s(b.get("summary"), 6000), "measures": s(b.get("measures"), 4000), "timeline": timeline,
        "arts": [s(a, 12) for a in (b.get("arts") or [])[:20] if s(a, 12)],
        "persons": persons, "evidence": evidence,
        "request": {"type": (b.get("request") or {}).get("type") if (b.get("request") or {}).get("type") in REQUESTS else "search",
                    "text": s((b.get("request") or {}).get("text"), 3000)},
    }


async def get(cid: int) -> dict:
    c = await db.one("SELECT * FROM cases WHERE id=?", cid)
    if not c:
        raise Fail("Кейс-файл не знайдено.", 404)
    c["data"] = json.loads(c["data"] or "{}")
    c["history"] = json.loads(c["history"] or "[]")
    return c


def out(c: dict, u: dict) -> dict:
    return {**c, "canEdit": c["author"] == u["sid"] and c["status"] == "draft", "canDecide": can_decide(u, c),
            "canWithdraw": c["author"] == u["sid"] and c["status"] in ON_REVIEW,
            "canDelete": (c["author"] == u["sid"] and c["status"] == "draft") or is_chief(u),
            "canArchive": c["status"] == "approved" and is_chief(u), "archived": bool(c.get("arch_msg")), "canTransfer": can_transfer(u, c),
            "stageName": STAGE_NAME[c["status"]], "noMgmt": c["dept"] not in mgmt_route()}


async def _hist(c: dict, u: dict, action: str, note: str = "") -> list:
    h = c["history"] + [{"t": now_ms(), "sid": u["sid"], "name": u["name"], "rank": u["rank"], "dept": u["dept"],
                         "stage": c["status"], "action": action, "note": note[:500]}]
    return h


async def create(u: dict, b: dict) -> dict:
    allowed = can_create(u)
    dept = b.get("dept") if b.get("dept") in allowed else (allowed[0] if allowed else None)
    if not dept:
        raise Fail("Кейс-файли ведуть ОРВ, ДЕБ, АТЦ, ЦСО «А» та ВВБ.", 403)
    data = clean(b)
    if not data["title"]:
        raise Fail("Вкажіть кодову назву операції.")
    t = now_ms()
    h = [{"t": t, "sid": u["sid"], "name": u["name"], "rank": u["rank"], "dept": u["dept"], "stage": "draft", "action": "create", "note": ""}]
    cid = await db.run("INSERT INTO cases(dept,author,status,reached,data,history,created,updated) VALUES(?,?,?,?,?,?,?,?)",
                       dept, u["sid"], "draft", 0, json.dumps(data, ensure_ascii=False), json.dumps(h, ensure_ascii=False), t, t)
    return await get(cid)


@core.serialized("case")
async def update(u: dict, cid: int, b: dict) -> dict:
    c = await get(cid)
    if c["author"] != u["sid"] or c["status"] != "draft":
        raise Fail("Редагувати можна лише власну чернетку.", 403)
    data = clean(b)
    if not data["title"]:
        raise Fail("Вкажіть кодову назву операції.")
    dept = b.get("dept") if b.get("dept") in can_create(u) else c["dept"]
    await db.run("UPDATE cases SET data=?, dept=?, updated=? WHERE id=?", json.dumps(data, ensure_ascii=False), dept, now_ms(), cid)
    return await get(cid)


def _next_after_draft(u: dict, dept: str) -> str:
    """Ніхто не погоджує сам собі: справа начальника відділу йде до начальника управління, його справа — до Голови,
    справа Голови/заступника — до прокурора."""
    if is_chief(u):
        return "prosecutor"
    if is_mgmt_for(u, dept):
        return "chief"
    if is_head_for(u, dept):
        return "mgmt" if dept in mgmt_route() else "chief"
    return "head"


@core.serialized("case")
async def submit(u: dict, cid: int) -> dict:
    c = await get(cid)
    if c["author"] != u["sid"] or c["status"] != "draft":
        raise Fail("Подати можна лише власну чернетку.", 403)
    d = c["data"]
    missing = [n for n, ok in (("фабула", d.get("summary")), ("фігуранти", d.get("persons")), ("докази", d.get("evidence")),
                               ("кваліфікація (статті)", d.get("arts")), ("клопотання", d.get("request", {}).get("text"))) if not ok]
    if missing:
        raise Fail("Не заповнено: " + ", ".join(missing) + ".")
    nxt = _next_after_draft(u, c["dept"])
    h = await _hist(c, u, "submit")
    await db.run("UPDATE cases SET status=?, reached=MAX(reached, ?), history=?, updated=? WHERE id=?",
                 nxt, REACH[nxt], json.dumps(h, ensure_ascii=False), now_ms(), cid)
    c = await get(cid)
    await journal(c, u, "Передано на погодження")
    return c


@core.serialized("case")
async def withdraw(u: dict, cid: int) -> dict:
    """Виконавець відкликає справу з погодження назад у свою чернетку (поки її не затвердили чи не відмовили)."""
    c = await get(cid)
    if c["author"] != u["sid"]:
        raise Fail("Відкликати може лише виконавець справи.", 403)
    if c["status"] not in ON_REVIEW:
        raise Fail("Справа зараз не на погодженні.")
    h = await _hist(c, u, "withdraw")
    await db.run("UPDATE cases SET status='draft', reached=0, history=?, updated=? WHERE id=?", json.dumps(h, ensure_ascii=False), now_ms(), cid)
    c = await get(cid)
    await journal(c, u, "Відкликано виконавцем з погодження")
    return c


@core.serialized("case")
async def delete(u: dict, cid: int):
    """Видалення справи: виконавець — свою чернетку (з погодження спершу відкликати); Голова й заступник — будь-яку."""
    c = await get(cid)
    if c["status"] == "deleted":
        raise Fail("Справу вже видалено.", 404)
    if not ((c["author"] == u["sid"] and c["status"] == "draft") or is_chief(u)):
        raise Fail("Видалити можна власну чернетку. Якщо справа на погодженні — спершу відкличте її.", 403)
    h = await _hist(c, u, "delete")
    await db.run("UPDATE cases SET status='deleted', history=?, updated=? WHERE id=?", json.dumps(h, ensure_ascii=False), now_ms(), cid)
    await _drop_archive(c)
    c = await get(cid)
    await journal(c, u, "Справу видалено")


@core.serialized("case")
async def decide(u: dict, cid: int, decision: str, note: str = "") -> dict:
    c = await get(cid)
    if not can_decide(u, c):
        raise Fail("Цей кейс-файл зараз не на вашому погодженні.", 403)
    if decision in ("return", "rej") and not note.strip():
        raise Fail("Вкажіть причину.")
    if decision == "ok":
        nxt = {"head": "mgmt" if c["dept"] in mgmt_route() else "chief", "mgmt": "chief", "chief": "prosecutor", "prosecutor": "approved"}[c["status"]]
        if c["status"] == "mgmt" and not is_mgmt_for(u, c["dept"]):
            nxt = "prosecutor"  # Голова чи заступник погодив замість начальника управління — це й віза керівництва
        action, label = "ok", ("Затверджено Генеральним прокурором" if nxt == "approved" else "Погоджено")
    elif decision == "return":
        nxt, action, label = "draft", "return", "Повернуто на доопрацювання"
    else:
        nxt, action, label = "rejected", "rej", "Відмовлено"
    h = await _hist(c, u, action, note)
    await db.run("UPDATE cases SET status=?, reached=MAX(reached, ?), history=?, updated=?, approved=? WHERE id=?",
                 nxt, REACH[nxt], json.dumps(h, ensure_ascii=False), now_ms(), now_ms() if nxt == "approved" else None, cid)
    c = await get(cid)
    await journal(c, u, label)
    return c


async def journal(c: dict, u: dict, label: str):
    """Журнал руху в Discord-каналі відділу: лише номер, кодова назва, етап і хто — без змісту справи."""
    ch = await core.channel(c["dept"])
    if not ch:
        return
    st = c["status"]
    color = {"approved": style.GREEN, "rejected": style.RED, "draft": style.GOLD}.get(st, style.BLUE)
    who_ = f"{style.esc(u['name'])} · №{u['sid']}" if u["dept"] != "prosecutor" else f"{style.esc(u['name'])} · Генеральний прокурор"
    e = style.card(f"КФ-{c['id']:04d}", "Кейс-файл · журнал руху", label, color, fields=[
        ("Справа", f"«{style.esc(c['data'].get('title', ''))}»"),
        ("Гриф", GRIF[c["data"].get("grif", "secret")]),
        ("Етап", STAGE_NAME[st]),
        ("Хто", who_),
    ], note="Зміст справи доступний лише в ЄІС «Сова»")
    try:
        await ch.send(embed=e, allowed_mentions=discord.AllowedMentions.none())
    except discord.HTTPException as ex:
        log.warning("Журнал кейс-файлу: %s", ex)


# ---------------------------------------------------------------- архів у Discord: PDF + текстовий файл з посиланнями
async def _drop_archive(c: dict):
    """Прибирає попереднє повідомлення справи з архівного каналу (перевідправка або видалення справи)."""
    if not c.get("arch_ch") or not c.get("arch_msg"):
        return
    try:
        ch = core.bot.get_channel(int(c["arch_ch"])) or await core.bot.fetch_channel(int(c["arch_ch"]))
        await (await ch.fetch_message(int(c["arch_msg"]))).delete()
    except (discord.NotFound, discord.Forbidden, discord.HTTPException):
        pass
    await db.run("UPDATE cases SET arch_ch=NULL, arch_msg=NULL WHERE id=?", c["id"])


def _md(s: str) -> str:
    """Текст користувача без розмітки Discord (щоб не ламав посилання й жирний шрифт)."""
    return discord.utils.escape_markdown(str(s or "")).replace("[", "(").replace("]", ")")


async def _evidence_links(e: dict) -> str:
    """Клікабельні посилання доказу: матеріал (відкат) і додатки зі сховища «Сови»."""
    out = []
    url = (e.get("url") or "").strip()
    if url.startswith(("http://", "https://")):
        host = url.split("/")[2].removeprefix("www.")[:40]
        out.append(f"[▶ Матеріал · {host}]({url})")
    elif url:
        out.append(_md(url)[:200])
    g = core.guild()
    for j, fid in enumerate(e.get("files") or [], 1):
        row = await db.one("SELECT * FROM files WHERE id=?", fid)
        if row and g:
            out.append(f"[📎 Додаток {j}](https://discord.com/channels/{g.id}/{row['ch_id']}/{row['msg_id']})")
    return " · ".join(out) or "*посилань немає*"


async def _archive_embed(c: dict, u: dict, approver: dict | None) -> discord.Embed:
    d, dp = c["data"], DEPTS[c["dept"]]
    author = await db.one("SELECT name FROM users WHERE sid=?", c["author"])
    arts = ", ".join(f"ст. {_md(a)}" for a in d.get("arts") or []) or "—"
    desc = [f"### Операція «{_md(d.get('title', ''))}»"]
    if d.get("org"):
        desc.append(f"Об'єкт розробки: **{_md(d['org'])}**")
    desc += ["",
             f"🔒 **{GRIF[d.get('grif', 'secret')]}**",
             f"🏢 **Підрозділ:** {dp['n']}",
             f"🕵️ **Виконавець:** {_md(author['name']) if author else '—'} · №{c['author']}",
             f"⚖️ **Кваліфікація:** {arts} КК штату NG",
             f"📨 **Клопотання:** {REQUESTS.get((d.get('request') or {}).get('type'), '—')}",
             "",
             f"✅ **ЗАТВЕРДЖЕНО** Генеральним прокурором" + (f" **{_md(approver['name'])}** · {style.when(approver['t'])}" if approver else "")]
    e = discord.Embed(title=f"📁 КЕЙС-ФАЙЛ КФ-{c['id']:04d}", url=config.SITE_URL, description="\n".join(desc), color=dp["color"])
    e.set_author(name=style.AUTHOR, icon_url=style.LOGO, url=config.SITE_URL)
    e.set_thumbnail(url=style.LOGO)
    persons = d.get("persons") or []
    if persons:
        e.add_field(name=f"👥 Фігуранти · {len(persons)}", inline=False, value="\n".join(
            f"`{i}` **{_md(p['name'])}**" + (f" · {_md(p['sid'])}" if p.get("sid") else "") + f" — {p.get('role', '')}"
            for i, p in enumerate(persons[:12], 1))[:990] + (f"\n…ще {len(persons) - 12}" if len(persons) > 12 else ""))
    tl = d.get("timeline") or []
    if tl:
        rows = [f"`{_md(x['when']) or '—'}` {_md(x['text'])}" for x in tl]
        val = ""
        for i, r in enumerate(rows):
            r = r if len(r) <= 200 else r[:197] + "…"
            if len(val) + len(r) > 900:
                val += f"\n…ще записів: {len(rows) - i} (повністю — у PDF)"
                break
            val += ("\n" if val else "") + r
        e.add_field(name=f"🕒 Хід розслідування · {len(tl)}", value=val, inline=False)
    ev = d.get("evidence") or []
    size = len(e.description) + sum(len(f.name) + len(f.value) for f in e.fields)
    for i, x in enumerate(ev, 1):
        name = f"🧾 Доказ {i} · {_md(x.get('desc') or 'без опису')}"[:250]
        value = (await _evidence_links(x))[:1024]
        if len(e.fields) >= 23 or size + len(name) + len(value) > 5600:
            e.add_field(name="…", value=f"Ще доказів: {len(ev) - i + 1}. Повний перелік — у PDF та в ЄІС «Сова».", inline=False)
            break
        e.add_field(name=name, value=value, inline=False)
        size += len(name) + len(value)
    if not ev:
        e.add_field(name="🧾 Докази", value="*не додано*", inline=False)
    e.set_footer(text=f"Відправив {u['name']} · №{u['sid']} · бланк справи — у PDF нижче", icon_url=style.LOGO)
    e.timestamp = discord.utils.utcnow()
    return e


@core.serialized("case")
async def archive(u: dict, cid: int, pdf: bytes) -> dict:
    """Затверджений кейс-файл → архівний канал Discord: embed з клікабельними посиланнями на докази + PDF бланка (формує сайт).
    Генпрокурор надсилає автоматично одразу після затвердження; Голова чи заступник — кнопкою (зокрема повторно)."""
    c = await get(cid)
    if c["status"] != "approved":
        raise Fail("У Discord відправляється лише затверджений кейс-файл.")
    if not is_chief(u) and not (is_prosecutor(u) and not c.get("arch_msg")):
        raise Fail("Відправити кейс-файл у Discord може Голова СБУ або заступник.", 403)
    if not pdf.startswith(b"%PDF"):
        raise Fail("Пошкоджений PDF. Спробуйте ще раз.")
    ch = await core.channel("cases:archive")
    if not ch:
        raise Fail("Архівний канал кейс-файлів недоступний боту.", 503)
    approver = next((h for h in reversed(c["history"]) if h["stage"] == "prosecutor" and h["action"] == "ok"), None)
    name = f"КФ-{c['id']:04d}_" + "".join(ch_ if ch_.isalnum() else "_" for ch_ in c["data"].get("title", ""))[:60]
    e = await _archive_embed(c, u, approver)
    await _drop_archive(c)
    msg = await ch.send(embed=e, file=discord.File(io.BytesIO(pdf), filename=name + ".pdf"), view=docpost.link_view("cases", c["id"]),
                        allowed_mentions=discord.AllowedMentions.none())
    h = await _hist(c, u, "archive")
    await db.run("UPDATE cases SET arch_ch=?, arch_msg=?, history=? WHERE id=?", str(ch.id), str(msg.id), json.dumps(h, ensure_ascii=False), cid)
    return await get(cid)


async def visible(u: dict) -> list[dict]:
    rows = await db.all("SELECT * FROM cases WHERE status!='deleted' ORDER BY updated DESC LIMIT 300")
    res = []
    for c in rows:
        c["data"] = json.loads(c["data"] or "{}")
        c["history"] = json.loads(c["history"] or "[]")
        if can_view(u, c):
            res.append(c)
    return res


async def pending(u: dict) -> int:
    return len([c for c in await visible(u) if can_decide(u, c)])
