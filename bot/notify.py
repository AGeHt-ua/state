"""Особисті повідомлення в Discord і «Чекає мене».

• Наступному погоджувачу — щойно документ дійшов до його етапу (клопотання, повістки, накази, кейс-файли, справи ВВБ).
• Автору — коли документ затверджено, повернуто чи відмовлено.
• Нагадування: документ чекає понад 24 год — повідомлення тим, хто має вирішити; понад 48 год — ще одне.
• inbox(u) — усі документи з усіх розділів, що чекають рішення саме цієї людини (головна сторінка, «Чекає мене»).

Усе тут — «найкраще, що можемо»: збій Discord чи закриті особисті повідомлення ніколи не ламають саму дію."""
import asyncio
import json
import logging

import discord

import core
import docpost
import style
from db import db, now_ms
from roles import rank_name

log = logging.getLogger("sova.notify")
MAX_DM = 6                     # не більше стількох погоджувачів на один етап (щоб не розсилати всім керівникам)
REMIND = (24, 48)              # год: перше й друге нагадування
HOUR = 3_600_000


# ---------------------------------------------------------------- надсилання
async def dm(u: dict | None, title: str, lines: list[str], kind: str, did: int, color: int = style.BLUE) -> bool:
    if not u or not u.get("discord_id") or u.get("status") in ("dismissed", "removed"):
        return False
    try:
        m = await asyncio.wait_for(core.member_of(u["discord_id"]), 8)
        if not m:
            return False
        e = style.document(title, color, desc=style.block(*lines))
        view = docpost.link_view(kind, did)
        await m.send(embed=e, **({"view": view} if view else {}))
        return True
    except Exception as ex:  # закриті особисті, Discord недоступний тощо
        log.info("Особисте повідомлення №%s не надіслано: %s", u.get("sid"), ex)
        return False


def later(coro):
    """Сповіщення — у фоні, щоб дія на сайті не чекала Discord."""
    async def run():
        try:
            await coro
        except Exception as ex:
            log.warning("Сповіщення: %s", ex)
    asyncio.get_running_loop().create_task(run())


async def _active_leads() -> list[dict]:
    return await db.all("SELECT * FROM users WHERE status NOT IN ('dismissed','removed') AND discord_id IS NOT NULL AND rank>=11")


# ---------------------------------------------------------------- хто вирішує зараз
async def _doc(kind: str, did: int) -> dict | None:
    import cases
    import discipline
    import orders
    import petitions
    try:
        if kind == "pet":
            return await petitions._row(did)
        if kind == "np":
            return await orders.get(did)
        if kind == "cases":
            return await cases.get(did)
        if kind == "insp":
            return await discipline.insp_get(did)
    except Exception:
        return None
    return None


def _can(kind: str, u: dict, d: dict) -> bool:
    import cases
    import discipline
    import orders
    import petitions
    if kind == "pet":
        return petitions.can_act(u, d)
    if kind == "np":
        return orders.can_act(u, d)
    if kind == "cases":
        return cases.can_decide(u, d)
    if kind == "insp":
        if d["status"] == "head":
            return discipline.is_vvb_head(u) and d["author"] != u["sid"] and d["sid"] != u["sid"]
        if d["status"] == "sent":
            return discipline.can_resolve(u) and d["sid"] != u["sid"]
    return False


def _primary(kind: str, u: dict, d: dict) -> bool:
    """Хто відповідає саме за поточний етап (керівництво, яке може «перескочити» етап, пишемо лише коли таких немає)."""
    import cases
    import orders
    import petitions
    if kind == "pet":
        return {"mgmt": orders.is_mgmt_for(u, d["dept"]), "head": orders.is_head_of(u, d["dept"]),
                "chief": petitions.is_approver(u)}.get(d["stage"], True)
    if kind == "np":
        st = orders.stage_of(d)
        return {"to": orders.is_head_of(u, d["to_dept"]) or orders.is_mgmt_for(u, d["to_dept"]),
                "mgmt": orders.is_mgmt_for(u, d["from_dept"]) or orders.is_mgmt_for(u, d["to_dept"]), "sign": orders.can_sign(u)}.get(st, True)
    if kind == "cases":
        return {"head": cases.is_head_for(u, d["dept"]), "mgmt": cases.is_mgmt_for(u, d["dept"])}.get(d["status"], True)
    return True


async def approvers(kind: str, d: dict, exclude: int | None = None) -> list[dict]:
    out = [u for u in await _active_leads() if u["sid"] != exclude and _can(kind, u, d)]
    prim = [u for u in out if _primary(kind, u, d)]
    # спершу ті, кому рішення найближче за званням (начальник відділу раніше за Голову)
    return sorted(prim or out, key=lambda u: u["rank"])[:MAX_DM]


def _describe(kind: str, d: dict) -> tuple[str, str, str]:
    """(номер, назва, етап) документа для повідомлення."""
    import cases
    import discipline
    import orders
    import petitions
    if kind == "pet":
        k = petitions.KINDS.get(d["kind"], {})
        title = (k.get("doc") or "Клопотання").capitalize() + " " + (k.get("title") or d["data"].get("subject", ""))
        return petitions.no(d), title, petitions.STAGE_NAME.get(d["stage"], "")
    if kind == "np":
        return f"НП-{d['id']:04d}", orders.OTYPES.get(d.get("otype") or "appoint", "Наказ"), orders.STAGE_NAME.get(orders.stage_of(d), "")
    if kind == "cases":
        return f"КФ-{d['id']:04d}", f"Кейс-файл «{d['data'].get('title', '')}»", cases.STAGE_NAME.get(d["status"], "")
    if kind == "insp":
        return d.get("regno") or f"СП-{d['id']:04d}", discipline.INSP_KINDS.get(d.get("kind") or "check", "Справа ВВБ") + f" · {d['title']}", \
            discipline.INSP_STATUS.get(d["status"], "")
    return "", "", ""


LINK = {"pet": "pet", "np": "np", "cases": "cases", "insp": "insp"}


async def next_step(kind: str, did: int, actor: dict | None = None):
    """Документ дійшов до нового етапу — особисте повідомлення тим, хто має вирішити."""
    d = await _doc(kind, did)
    if not d:
        return
    no, title, stage = _describe(kind, d)
    who = f"{rank_name(actor['rank'])} {actor['name']}" if actor and actor.get("dept") != "curator" else "Куратор СБУ" if actor else "—"
    for u in await approvers(kind, d, exclude=actor["sid"] if actor else None):
        await dm(u, "ЧЕКАЄ ВАШОГО РІШЕННЯ", [style.kv("ДОКУМЕНТ", no, "white", True), style.kv("ЩО", title[:120], "white"),
                                             style.kv("ЕТАП", stage, "gold"), style.kv("НАПРАВИВ", who, "white"),
                                             style.rule(), style.c("Відкрийте документ у ЄІС «Сова» кнопкою нижче.")], LINK[kind], did, style.GOLD)


async def outcome(kind: str, did: int, author_sid: int, verdict: str, actor: dict | None = None, note: str = ""):
    """Автору — рішення по його документу (затверджено / повернуто / відмовлено)."""
    d = await _doc(kind, did)
    if not d or not author_sid or (actor and actor["sid"] == author_sid):
        return
    no, title, _ = _describe(kind, d)
    color = style.GREEN if verdict.startswith(("Затвердж", "Погодж", "Підпис")) else style.RED if verdict.startswith("Відмов") else style.GOLD
    lines = [style.kv("ДОКУМЕНТ", no, "white", True), style.kv("ЩО", title[:120], "white"), style.kv("РІШЕННЯ", verdict, "gold", True)]
    if actor:
        lines.append(style.kv("ХТО", "Куратор СБУ" if actor.get("dept") == "curator" else f"{rank_name(actor['rank'])} {actor['name']}", "white"))
    if note:
        lines += [style.kv("ПРИЧИНА" if i == 0 else "", p, "white") for i, p in enumerate(style.wrap(note, 28)[:6])]
    await dm(await core.user(author_sid), "РІШЕННЯ ЩОДО ВАШОГО ДОКУМЕНТА", lines, LINK[kind], did, color)


# ---------------------------------------------------------------- нагадування
async def _waiting() -> list[tuple[str, int, int]]:
    """(вид, номер, з якого часу чекає на поточному етапі)."""
    out = []
    for p in await db.all("SELECT id, updated FROM petitions WHERE status='wait'"):
        out.append(("pet", p["id"], p["updated"]))
    for o in await db.all("SELECT id, t, visas FROM orders WHERE kind='appoint' AND status='draft'"):
        vs = [v.get("t") or 0 for v in json.loads(o["visas"] or "[]") if isinstance(v, dict)]
        out.append(("np", o["id"], max([o["t"] or 0, *vs])))
    for c in await db.all("SELECT id, updated FROM cases WHERE status IN ('head','mgmt','chief','prosecutor')"):
        out.append(("cases", c["id"], c["updated"]))
    for i in await db.all("SELECT id, updated FROM inspections WHERE status IN ('head','sent')"):
        out.append(("insp", i["id"], i["updated"]))
    return out


async def remind_once():
    now = now_ms()
    seen = await db.get_setting("dm_remind", {})
    live = set()
    for kind, did, since in await _waiting():
        key = f"{kind}:{did}:{since}"  # новий етап — новий відлік
        live.add(key)
        cnt = seen.get(key, 0)
        if cnt >= len(REMIND) or now - since < REMIND[cnt] * HOUR:
            continue
        d = await _doc(kind, did)
        if not d:
            continue
        no, title, stage = _describe(kind, d)
        hours = (now - since) // HOUR
        for u in await approvers(kind, d):
            await dm(u, "⏰ НАГАДУВАННЯ: ДОКУМЕНТ ЧЕКАЄ", [style.kv("ДОКУМЕНТ", no, "white", True), style.kv("ЩО", title[:120], "white"),
                                                        style.kv("ЕТАП", stage, "gold"), style.kv("ЧЕКАЄ", f"{hours} год", "red", True)],
                     LINK[kind], did, style.RED)
        seen[key] = cnt + 1
    await db.set_setting("dm_remind", {k: v for k, v in seen.items() if k in live})


async def remind_loop():
    await asyncio.sleep(240)
    while True:
        try:
            await remind_once()
        except Exception as ex:
            log.warning("Нагадування в особисті: %s", ex)
        await asyncio.sleep(1800)


# ---------------------------------------------------------------- «Чекає мене»
async def inbox(u: dict) -> list[dict]:
    """Усе, що чекає рішення саме цієї людини, — з номером, назвою, автором і часом очікування (найстаріші спершу)."""
    import candidates
    import cases
    import discipline
    import orders
    import petitions
    items = []

    async def who(sid):
        p = await core.user(sid) if sid else None
        return p["name"] if p else ""

    for a in await db.all("SELECT * FROM acts WHERE status='wait' ORDER BY t LIMIT 200"):
        if core.can_approve_act(u, a):
            items.append({"kind": "Звіт", "no": style.doc_no("ЗВТ", a["id"]), "title": core.act_name(a), "by": await who(a["by_sid"]),
                          "since": a["t"], "path": f"act/{a['id']}"})
    for r in await db.all("SELECT * FROM raps WHERE status='wait' ORDER BY t LIMIT 200"):
        if core.can_approve_rap(u, r):
            items.append({"kind": "Рапорт", "no": style.doc_no("РАП", r["id"]), "title": core.RAP_TYPES.get(r["type"], ""), "by": await who(r["by_sid"]),
                          "since": r["t"], "path": f"rap/{r['id']}"})
    for o in await db.all("SELECT * FROM orders WHERE kind='appoint' AND status='draft'"):
        if orders.can_act(u, o):
            vs = [v.get("t") or 0 for v in json.loads(o.get("visas") or "[]") if isinstance(v, dict)]
            items.append({"kind": "Наказ", "no": f"НП-{o['id']:04d}", "title": orders.OTYPES.get(o.get("otype") or "appoint", ""),
                          "by": await who(o["by_sid"]), "since": max([o["t"] or 0, *vs]), "path": "staff/appoint"})
    for c in await db.all("SELECT id, dept, author, status, data, updated FROM cases WHERE status IN ('head','mgmt','chief','prosecutor')"):
        if cases.can_decide(u, c):
            title = (json.loads(c["data"] or "{}") or {}).get("title", "")
            items.append({"kind": "Кейс-файл", "no": f"КФ-{c['id']:04d}", "title": f"«{title}»", "by": await who(c["author"]),
                          "since": c["updated"], "path": f"cases/{c['id']}"})
    for p in await db.all("SELECT * FROM petitions WHERE status='wait'"):
        if petitions.can_act(u, p):
            k = petitions.KINDS.get(p["kind"], {})
            data = json.loads(p["data"] or "{}")
            items.append({"kind": "Повістка" if k.get("group") == "summons" else "Клопотання", "no": petitions.no(p),
                          "title": k.get("title") or data.get("subject", ""), "by": await who(p["by_sid"]), "since": p["updated"],
                          "path": f"pet/{p['id']}"})
    for i in await db.all("SELECT id, sid, author, status, title, regno, kind, updated FROM inspections WHERE status IN ('head','sent')"):
        if _can("insp", u, i):
            items.append({"kind": "Справа ВВБ", "no": i["regno"] or f"СП-{i['id']:04d}", "title": i["title"], "by": await who(i["author"]),
                          "since": i["updated"], "path": f"disc/insp/{i['id']}"})
    r = None
    try:
        import api
        r = api.hr_rights(u)
    except Exception:
        r = None
    if r and (r["vvb"] or r["vkpp"]):
        stages = [s for s, ok in (("vvb", r["vvb"]), ("vkpp", r["vkpp"])) if ok]
        for c in await db.all(f"SELECT * FROM candidates WHERE status IN ({','.join('?' * len(stages))}) ORDER BY t", *stages):
            if candidates.claim_active(c) and c["claim_by"] != str(u.get("discord_id")):
                continue  # анкету вже опрацьовує інший
            items.append({"kind": "Анкета", "no": style.doc_no("АНК", c["id"]), "title": f"{c['name']} · {'ВВБ' if c['status'] == 'vvb' else 'ВКПП'}",
                          "by": "", "since": c["t"], "path": "hr/cand"})
    items.sort(key=lambda x: x["since"] or 0)
    return items[:60]
