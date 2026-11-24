"""Завдання тижня для відділів.

Ставлять Куратор СБУ, Заступник Голови й Голова (поріг — «task_manage» в адмін-панелі → Права).
Два види завдань:
- auto — прив'язане до звітів: «3 рейди за тиждень». Кожен підтверджений звіт відділу потрібного типу за тиждень
  (Пн–Нд, Київ) додається до прогресу; досягли цілі — завдання закривається саме. Докази — матеріали тих самих звітів.
- manual — те, що звітом не порахуєш: начальник відділу чи заступник позначає «Виконано» з доказами,
  Куратор / Голова / Заступник підтверджує або повертає з причиною.
Щопонеділка — перелік завдань у канали відділів (і повтор щотижневих), у п'ятницю — нагадування про невиконане,
щонеділі — підсумок з посиланнями на докази в канал «tasks_report» (адмін-панель → Канали)."""
import asyncio
import functools
import json
import logging
from collections import Counter, defaultdict
from datetime import datetime, timezone

import discord

import core
import docpost
import overrides as ov
import style
from core import ACTS, DAY, Fail
from db import db, now_ms
from depts import CONTROL_DEPTS
from roles import DEPTS, PRESS_ROLE, rank_name

log = logging.getLogger("sova.tasks")
WEEK = 7 * DAY
DST = 3 * 3600_000  # тижні поруч із переходом на літній / зимовий час коротші або довші на годину
KIND = {"auto": "За звітами (закривається автоматично)", "manual": "Ручне (виконання підтверджує керівництво)"}
STATUS = {"open": "В роботі", "review": "На підтвердженні", "done": "Виконано", "cancel": "Скасовано", "fail": "Не виконано"}
PRIO = {"normal": "Звичайне", "high": "Важливе"}
TARGET_MAX = 200
_lock = asyncio.Lock()


def _locked(fn):
    @functools.wraps(fn)
    async def wrapper(*a, **k):
        async with _lock:
            return await fn(*a, **k)
    return wrapper


# ---------------------------------------------------------------- права
def can_manage(u: dict) -> bool:
    """Ставити, змінювати й підтверджувати завдання: Куратор, Заступник Голови, Голова."""
    return core.is_curator(u) or u["rank"] >= ov.P("task_manage")


def member_of(u: dict, d: str) -> bool:
    if d == "press":
        return u["dept"] == "press" or core.has_role(u, PRESS_ROLE)
    if d == "academy":
        return u["dept"] == "academy" or core.has_dept_role(u, "vkpp")
    return core.has_dept_role(u, d)


def can_lead(u: dict, d: str) -> bool:
    """Позначити ручне завдання виконаним: начальник відділу або його заступник (Академія — керівництво ВКПП)."""
    return core.lead_of(u, d) or (u["rank"] == 13 and member_of(u, d))


def visible_depts(u: dict) -> list[str]:
    if can_manage(u) or u["rank"] >= 13:
        return list(CONTROL_DEPTS)
    return [d for d in CONTROL_DEPTS if member_of(u, d)]


def rights(u: dict) -> dict:
    return {"manage": can_manage(u), "lead": [d for d in CONTROL_DEPTS if can_lead(u, d)], "depts": visible_depts(u)}


# ---------------------------------------------------------------- тиждень
def norm_week(w) -> int:
    """Будь-яка позначка часу → понеділок 00:00 (Київ) того тижня, за сіткою core.week_start."""
    cur = core.week_start(0)
    try:
        w = int(w)
    except (TypeError, ValueError):
        return cur
    k = (cur - w + WEEK - 1) // WEEK if w < cur else -((w - cur) // WEEK)
    return cur - k * WEEK


def fmt_day(ms: int) -> str:
    return datetime.fromtimestamp(ms / 1000, core.TZ or timezone.utc).strftime("%d.%m")


def week_label(w: int) -> str:
    return f"{fmt_day(w)}–{fmt_day(w + 6 * DAY)}"


def act_units(a: dict) -> int:
    """Патрулювання рахуємо блоками по 30 хв (як у звіті), решту — по одному звіту."""
    return max(1, int(a.get("qty") or 1)) if a["type"] == "patrol" else 1


def _msg_link(ch, msg) -> str | None:
    g = core.guild()
    return f"https://discord.com/channels/{g.id}/{ch}/{msg}" if g and ch and msg else None


# ---------------------------------------------------------------- читання
async def _person(sid: int | None) -> dict | None:
    p = await core.user(sid) if sid else None
    if not p:
        return None
    if p["dept"] == "curator":
        return {"sid": p["sid"], "name": "Куратор СБУ", "rankName": "Куратор СБУ"}
    return {"sid": p["sid"], "name": p["name"], "rankName": rank_name(p["rank"])}


async def progress(t: dict) -> dict:
    """Прогрес завдання за звітами: підтверджені (n), на перевірці (wait) і самі звіти-докази."""
    x = t["data"]
    if t["kind"] != "auto":
        return {"n": 1 if t["status"] == "done" else 0, "target": 1, "wait": 1 if t["status"] == "review" else 0, "acts": []}
    types = [k for k in x.get("acts") or []]
    sql = "SELECT id, by_sid, type, qty, t, evidence, files, status, custom, ch_id, msg_id FROM acts WHERE dept=? AND status IN ('ok','wait') AND t>=? AND t<?"
    args = [t["dept"], t["week"], t["week"] + WEEK]
    if types:
        sql += f" AND type IN ({','.join('?' * len(types))})"
        args += types
    rows = await db.all(sql + " ORDER BY t", *args)
    ok = [a for a in rows if a["status"] == "ok"]
    names = {}
    acts = []
    for a in ok:
        if a["by_sid"] not in names:
            p = await core.user(a["by_sid"])
            names[a["by_sid"]] = p["name"] if p else f"№{a['by_sid']}"
        acts.append({"id": a["id"], "no": style.doc_no("ЗВТ", a["id"]), "by": a["by_sid"], "byName": names[a["by_sid"]], "t": a["t"],
                     "type": core.act_name(a), "units": act_units(a), "evidence": a["evidence"] or "",
                     "files": json.loads(a["files"] or "[]"), "link": _msg_link(a["ch_id"], a["msg_id"])})
    return {"n": sum(act_units(a) for a in ok), "target": int(x.get("target") or 1), "wait": sum(act_units(a) for a in rows if a["status"] == "wait"), "acts": acts}


async def _row(tid: int) -> dict:
    t = await db.one("SELECT * FROM tasks WHERE id=? AND status!='deleted'", tid)
    if not t:
        raise Fail("Завдання не знайдено.", 404)
    t["data"] = json.loads(t["data"] or "{}")
    t["proof"] = json.loads(t["proof"] or "{}")
    t["history"] = json.loads(t["history"] or "[]")
    return t


async def present(t: dict, u: dict | None = None, full: bool = False) -> dict:
    """Завдання для сайту / Discord: прогрес, видимий стан (після кінця тижня невиконане — «Не виконано»)."""
    p = await progress(t)
    if t["kind"] == "auto" and t["status"] == "open" and p["n"] >= p["target"]:  # ціль досягнута, а хук не спрацював — закриваємо тихо
        await db.run("UPDATE tasks SET status='done', done_at=?, updated=? WHERE id=? AND status='open'", now_ms(), now_ms(), t["id"])
        t["status"], t["done_at"] = "done", now_ms()
    state = t["status"]
    if state in ("open", "review") and now_ms() >= t["week"] + WEEK:
        state = "fail"
    out = {"id": t["id"], "week": t["week"], "dept": t["dept"], "kind": t["kind"], "status": t["status"], "state": state,
           "stateName": STATUS.get(state, state), "data": t["data"], "repeat": bool(t["repeat"]), "parent": t["parent"],
           "doneAt": t["done_at"], "created": t["created"], "progress": {k: p[k] for k in ("n", "target", "wait")},
           "pct": min(100, round(100 * p["n"] / max(1, p["target"])))}
    if full:
        out["acts"] = p["acts"]
        out["proof"] = t["proof"]
        out["history"] = t["history"]
        out["byUser"] = await _person(t["by_sid"])
        out["doneUser"] = await _person(t["done_by"]) if t["done_by"] else None
    else:
        out["acts"] = [  # для дошки: хто зробив і скільки (без матеріалів)
                       {"by": a["by"], "byName": a["byName"], "units": a["units"]} for a in p["acts"]]
    return out


async def get(tid: int, u: dict) -> dict:
    t = await _row(tid)
    if t["dept"] not in visible_depts(u):
        raise Fail("Завдання цього відділу вам не видно.", 403)
    return await present(t, u, full=True)


def summarize(items: list[dict]) -> dict:
    by = defaultdict(lambda: {"total": 0, "done": 0, "part": 0, "review": 0})
    for x in items:
        if x["status"] == "cancel":
            continue
        s = by[x["dept"]]
        s["total"] += 1
        if x["state"] == "done":
            s["done"] += 1
        elif x["progress"]["n"] > 0:
            s["part"] += 1
        if x["state"] == "review":
            s["review"] += 1
    for s in by.values():
        s["pct"] = round(100 * s["done"] / s["total"]) if s["total"] else 0
    total = sum(s["total"] for s in by.values())
    done = sum(s["done"] for s in by.values())
    return {"depts": dict(by), "total": total, "done": done, "pct": round(100 * done / total) if total else 0}


async def week_items(w: int, depts: list[str] | None = None) -> list[dict]:
    rows = await db.all("SELECT * FROM tasks WHERE ABS(week-?)<? AND status!='deleted' ORDER BY id", w, DST)
    out = []
    for t in rows:
        if depts is not None and t["dept"] not in depts:
            continue
        t["data"] = json.loads(t["data"] or "{}")
        t["proof"] = json.loads(t["proof"] or "{}")
        t["history"] = json.loads(t["history"] or "[]")
        out.append(await present(t))
    order = {d: i for i, d in enumerate(CONTROL_DEPTS)}
    out.sort(key=lambda x: (order.get(x["dept"], 99), x["status"] == "cancel", x["data"].get("prio") != "high", x["id"]))
    return out


async def listing(u: dict, w=None) -> dict:
    w = norm_week(w if w is not None else core.week_start(0))
    vis = visible_depts(u)
    items = await week_items(w, vis)
    cur = core.week_start(0)
    return {"week": w, "label": week_label(w), "current": cur, "isCurrent": w == cur, "items": items, "stats": summarize(items),
            "rights": rights(u), "kind": KIND, "prio": PRIO, "depts": CONTROL_DEPTS,
            "carry": len([x for x in await week_items(w - WEEK, vis) if x["state"] == "fail"]) if can_manage(u) and w == cur else 0}


async def pending(u: dict) -> int:
    """Значок у меню: керівництву — ручні завдання на підтвердженні; начальникам відділів — невиконані ручні завдання тижня."""
    if can_manage(u):
        return (await db.one("SELECT COUNT(*) AS n FROM tasks WHERE status='review'"))["n"]
    lead = [d for d in CONTROL_DEPTS if can_lead(u, d)]
    if not lead:
        return 0
    rows = await db.all("SELECT dept FROM tasks WHERE week=? AND kind='manual' AND status='open'", core.week_start(0))
    return len([r for r in rows if r["dept"] in lead])


# ---------------------------------------------------------------- зміни
def _hist(t: dict | None, u: dict | None, action: str, note: str = "") -> str:
    who = {"sid": 0, "name": "ЄІС «Сова»", "rank": ""} if not u else \
        {"sid": u["sid"], "name": "Куратор СБУ" if u["dept"] == "curator" else u["name"], "rank": "" if u["dept"] == "curator" else rank_name(u["rank"])}
    h = (t or {}).get("history", []) + [{"t": now_ms(), **who, "action": action, "note": note[:300]}]
    return json.dumps(h, ensure_ascii=False)


def _clean(b: dict) -> dict:
    title = " ".join(str(b.get("title") or "").split())[:120]
    if len(title) < 3:
        raise Fail("Вкажіть назву завдання (від 3 символів).")
    kind = b.get("kind") if b.get("kind") in KIND else "auto"
    x = {"title": title, "descr": str(b.get("descr") or "").strip()[:1500], "prio": b.get("prio") if b.get("prio") in PRIO else "normal"}
    if kind == "auto":
        x["acts"] = [k for k in dict.fromkeys(b.get("acts") or []) if k in ACTS][:12]
        try:
            x["target"] = int(b.get("target") or 0)
        except (TypeError, ValueError):
            x["target"] = 0
        if not 1 <= x["target"] <= TARGET_MAX:
            raise Fail(f"Ціль завдання за звітами: від 1 до {TARGET_MAX}.")
    return {"kind": kind, "data": x}


@_locked
async def create(u: dict, b: dict) -> dict:
    if not can_manage(u):
        raise Fail("Ставити завдання тижня можуть Куратор, Заступник Голови та Голова СБУ.", 403)
    depts = [d for d in dict.fromkeys(b.get("depts") or []) if d in CONTROL_DEPTS]
    if not depts:
        raise Fail("Оберіть хоча б один відділ.")
    c = _clean(b)
    w = core.week_start(0) + (WEEK if b.get("week") == "next" else 0)
    ids = []
    for d in depts:
        ids.append(await db.run("INSERT INTO tasks(week,dept,kind,status,data,proof,history,by_sid,repeat,created,updated) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                                w, d, c["kind"], "open", json.dumps(c["data"], ensure_ascii=False), "{}", _hist(None, u, "create"),
                                u["sid"], 1 if b.get("repeat") else 0, now_ms(), now_ms()))
    await db.audit(u["sid"], "Поставлено завдання тижня", None, f"{c['data']['title']} · {', '.join(DEPTS[d]['s'] for d in depts)} · {week_label(w)}")
    if w == core.week_start(0):
        for tid in ids:
            await announce(await _row(tid), "new")
    await announce_copy(await _row(ids[0]), depts, u)
    return {"ok": True, "ids": ids, "week": w}


@_locked
async def act(u: dict, tid: int, action: str, b: dict) -> dict:
    t = await _row(tid)
    if t["dept"] not in visible_depts(u):
        raise Fail("Завдання цього відділу вам не видно.", 403)
    note = " ".join(str(b.get("note") or "").split())[:300]
    manage, past = can_manage(u), now_ms() >= t["week"] + WEEK
    title = t["data"].get("title", "")
    if action == "edit":
        if not manage or t["status"] not in ("open", "review"):
            raise Fail("Змінити можна завдання в роботі (Куратор, Заступник Голови, Голова).", 403)
        c = _clean(b)
        if c["kind"] != t["kind"]:
            raise Fail("Вид завдання (за звітами чи ручне) змінити не можна — створіть нове.")
        await db.run("UPDATE tasks SET data=?, repeat=?, history=?, updated=? WHERE id=?", json.dumps(c["data"], ensure_ascii=False),
                     1 if b.get("repeat") else 0, _hist(t, u, "edit"), now_ms(), tid)
    elif action == "submit":
        if t["kind"] != "manual" or not (can_lead(u, t["dept"]) or manage):
            raise Fail("Позначити виконаним може начальник відділу або його заступник.", 403)
        if t["status"] != "open":
            raise Fail("Завдання вже виконано або очікує підтвердження.")
        if now_ms() >= t["week"] + WEEK + DAY:
            raise Fail("Тиждень цього завдання вже закрито.")
        links = [str(x).strip()[:400] for x in (b.get("links") or []) if str(x).strip()][:5]
        if any(not x.startswith(("http://", "https://")) for x in links):
            raise Fail("Посилання на докази мають починатися з http:// або https://")
        files = [str(f)[:40] for f in (b.get("files") or []) if f][:10]
        if not links and not files:
            raise Fail("Додайте докази виконання: посилання або файли.")
        proof = {"links": links, "files": files, "note": str(b.get("note") or "").strip()[:1000], "by": u["sid"], "t": now_ms()}
        if manage:  # керівництво само позначає — одразу «виконано»
            await db.run("UPDATE tasks SET status='done', proof=?, done_by=?, done_at=?, history=?, updated=? WHERE id=?",
                         json.dumps(proof, ensure_ascii=False), u["sid"], now_ms(), _hist(t, u, "done"), now_ms(), tid)
        else:
            await db.run("UPDATE tasks SET status='review', proof=?, done_by=?, history=?, updated=? WHERE id=?",
                         json.dumps(proof, ensure_ascii=False), u["sid"], _hist(t, u, "submit"), now_ms(), tid)
        await db.audit(u["sid"], "Завдання тижня позначено виконаним", None, f"{DEPTS[t['dept']]['s']} · {title}")
        if manage:
            await announce(await _row(tid), "done")
    elif action in ("confirm", "reject"):
        if not manage:
            raise Fail("Підтверджують виконання Куратор, Заступник Голови та Голова СБУ.", 403)
        if t["status"] != "review":
            raise Fail("Завдання не очікує підтвердження.")
        if action == "reject":
            if len(note) < 3:
                raise Fail("Вкажіть, чому виконання не зараховано — це побачить відділ.")
            await db.run("UPDATE tasks SET status='open', history=?, updated=? WHERE id=?", _hist(t, u, "reject", note), now_ms(), tid)
            await announce(await _row(tid), "reject", note)
        else:
            await db.run("UPDATE tasks SET status='done', done_at=?, history=?, updated=? WHERE id=?", now_ms(), _hist(t, u, "confirm", note), now_ms(), tid)
            await announce(await _row(tid), "done")
        await db.audit(u["sid"], "Виконання завдання тижня " + ("підтверджено" if action == "confirm" else "не зараховано"), None,
                       f"{DEPTS[t['dept']]['s']} · {title}" + (f" · {note}" if note else ""))
    elif action == "cancel":
        if not manage or t["status"] not in ("open", "review"):
            raise Fail("Скасувати можна завдання в роботі.", 403)
        await db.run("UPDATE tasks SET status='cancel', history=?, updated=? WHERE id=?", _hist(t, u, "cancel", note), now_ms(), tid)
        await db.audit(u["sid"], "Скасовано завдання тижня", None, f"{DEPTS[t['dept']]['s']} · {title}")
    elif action == "delete":
        if not manage:
            raise Fail("Видаляти завдання може керівництво, яке їх ставить.", 403)
        await db.run("UPDATE tasks SET status='deleted', history=?, updated=? WHERE id=?", _hist(t, u, "delete", note), now_ms(), tid)
        await db.audit(u["sid"], "Видалено завдання тижня", None, f"{DEPTS[t['dept']]['s']} · {title}")
        return {"ok": True}
    elif action == "carry":
        if not manage or not past or t["status"] not in ("open", "review"):
            raise Fail("Перенести можна невиконане завдання минулого тижня.", 403)
        cur = core.week_start(0)
        if await db.one("SELECT id FROM tasks WHERE parent=? AND week=? AND status!='deleted'", tid, cur):
            raise Fail("Це завдання вже перенесено на поточний тиждень.")
        nid = await db.run("INSERT INTO tasks(week,dept,kind,status,data,proof,history,by_sid,repeat,parent,created,updated) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
                           cur, t["dept"], t["kind"], "open", json.dumps(t["data"], ensure_ascii=False), "{}",
                           _hist(None, u, "carried", f"з тижня {week_label(t['week'])}"), u["sid"], t["repeat"], tid, now_ms(), now_ms())
        await db.run("UPDATE tasks SET history=?, updated=? WHERE id=?", _hist(t, u, "carry", f"на тиждень {week_label(cur)}"), now_ms(), tid)
        await db.audit(u["sid"], "Завдання тижня перенесено", None, f"{DEPTS[t['dept']]['s']} · {title}")
        await announce(await _row(nid), "new")
        await announce_copy(await _row(nid), [t["dept"]], u, carried=True)
        return await get(nid, u)
    elif action == "repeat":
        if not manage:
            raise Fail("Повтор налаштовує керівництво, яке ставить завдання.", 403)
        await db.run("UPDATE tasks SET repeat=?, history=?, updated=? WHERE id=?", 0 if t["repeat"] else 1,
                     _hist(t, u, "repeat_off" if t["repeat"] else "repeat_on"), now_ms(), tid)
    else:
        raise Fail("Невідома дія.")
    return await get(tid, u)


async def carry_all(u: dict) -> dict:
    """Перенести всі невиконані завдання минулого тижня (видимих відділів) на поточний."""
    if not can_manage(u):
        raise Fail("Переносити завдання може керівництво, яке їх ставить.", 403)
    n = 0
    for x in await week_items(core.week_start(1)):
        if x["state"] == "fail":
            try:
                await act(u, x["id"], "carry", {})
                n += 1
            except Fail:
                pass
    return {"ok": True, "n": n}


async def on_act(a: dict):
    """Звіт підтверджено → завдання відділу за звітами могло виконатися: закриваємо й повідомляємо відділ."""
    try:
        if a.get("status") != "ok" or not a.get("dept"):
            return
        w = norm_week(a["t"])
        for r in await db.all("SELECT id FROM tasks WHERE ABS(week-?)<? AND dept=? AND kind='auto' AND status='open'", w, DST, a["dept"]):
            t = await _row(r["id"])
            types = t["data"].get("acts") or []
            if types and a["type"] not in types:
                continue
            p = await progress(t)
            if p["n"] >= p["target"]:
                await db.run("UPDATE tasks SET status='done', done_at=?, history=?, updated=? WHERE id=? AND status='open'",
                             now_ms(), _hist(t, None, "auto_done", f"{p['n']}/{p['target']}"), now_ms(), t["id"])
                await announce(await _row(t["id"]), "done")
    except Exception:
        log.exception("Завдання тижня: перевірка після звіту №%s", a.get("id"))


# ---------------------------------------------------------------- Discord
def bar(pct: int, n: int = 10) -> str:
    k = max(0, min(n, round(pct / 100 * n)))
    return "▰" * k + "▱" * (n - k)


def _ping(d: str) -> dict:
    """Нове завдання й нагадування — з пінгом ролі відділу (адмін-панель → Згадки → «Завдання тижня» має пріоритет)."""
    if "task" in ov.mentions:
        return core.mention("task")
    role = PRESS_ROLE if d == "press" else DEPTS[d].get("role")
    if not role:
        return {"allowed_mentions": discord.AllowedMentions.none()}
    return {"content": f"<@&{role}>", "allowed_mentions": discord.AllowedMentions(everyone=False, users=False, roles=[discord.Object(role)])}


def _goal(x: dict) -> str:
    if x["kind"] != "auto":
        return "ручне · підтверджує керівництво"
    types = x["data"].get("acts") or []
    what = ", ".join(ACTS[k][0] for k in types if k in ACTS) if types else "будь-які звіти"
    return f"{what} — {x['progress']['target']}"


def _icon(x: dict) -> str:
    if x["state"] == "done":
        return "✅"
    if x["status"] == "cancel":
        return "▫️"
    if x["state"] == "review":
        return "🕓"
    if x["progress"]["n"] > 0:
        return "🟡"
    return "❌" if x["state"] == "fail" else "⬜"


async def announce(t: dict, what: str, note: str = ""):
    """Повідомлення відділу в його канал: нове завдання / виконано / виконання не зараховано. Збій Discord не скасовує дію."""
    try:
        ch = await core.channel(t["dept"])
        if not ch:
            return
        x = await present(t)
        d = DEPTS[t["dept"]]
        title = {"new": "НОВЕ ЗАВДАННЯ ТИЖНЯ", "done": "ЗАВДАННЯ ВИКОНАНО", "reject": "ВИКОНАННЯ НЕ ЗАРАХОВАНО"}[what]
        color = {"new": d["color"], "done": style.GREEN, "reject": style.RED}[what]
        lines = [f"**{style.esc(x['data']['title'])}**" + (" · ❗ важливе" if x["data"].get("prio") == "high" else "")]
        if x["data"].get("descr") and what == "new":
            lines.append(style.esc(x["data"]["descr"])[:1500])
        lines += ["", style.kv("ПІДРОЗДІЛ", d["n"]), style.kv("ЦІЛЬ", _goal(x))]
        if x["kind"] == "auto":
            lines.append(style.kv("ПРОГРЕС", f"{x['progress']['n']}/{x['progress']['target']} {bar(x['pct'])}"))
        if note:
            lines.append(style.kv("ПРИЧИНА", note, bold=True))
        if what == "new":
            lines += ["", "Завдання за звітами закривається саме, щойно підтверджено достатньо звітів." if x["kind"] == "auto"
                      else "Начальник відділу або заступник позначає виконання з доказами в ЄІС «Сова» → «Завдання тижня»."]
        e = style.document(title, color, no=f"Тиждень {week_label(t['week'])}", desc=style.block(*lines))
        await ch.send(embed=e, view=style.site_view("Завдання тижня у «Сові»"), **(_ping(t["dept"]) if what == "new" else {"allowed_mentions": discord.AllowedMentions.none()}))
    except Exception as err:
        log.warning("Завдання тижня №%s: повідомлення відділу не надіслано: %s", t.get("id"), err)


async def announce_copy(t: dict, depts: list[str], u: dict | None, carried: bool = False):
    """Копія нового завдання в загальний канал (адмін-панель → Канали «tasks_copy») з пінгом ролі (Згадки «tasks_copy»):
    одне повідомлення на завдання, навіть якщо його поставлено кільком відділам. Збій Discord не скасовує дію."""
    try:
        ch = await core.channel("tasks_copy")
        if not ch:
            return
        x = await present(t)
        lines = [f"**{style.esc(x['data']['title'])}**" + (" · ❗ важливе" if x["data"].get("prio") == "high" else "")]
        if x["data"].get("descr"):
            lines.append(style.esc(x["data"]["descr"])[:1500])
        lines += ["", style.kv("ВІДДІЛИ", ", ".join(DEPTS[d]["s"] for d in depts)), style.kv("ЦІЛЬ", _goal(x))]
        if u:
            who = "Куратор СБУ" if u.get("dept") == "curator" else f"{rank_name(u['rank'])} {u['name']}"
            lines.append(style.kv("ПОСТАВИВ", who))
        title = "ЗАВДАННЯ ТИЖНЯ ПЕРЕНЕСЕНО" if carried else "НОВЕ ЗАВДАННЯ ТИЖНЯ"
        e = style.document(title, style.GOLD, no=f"Тиждень {week_label(t['week'])}", desc=style.block(*lines))
        await ch.send(embed=e, view=style.site_view("Завдання тижня у «Сові»"), **docpost.mentions([], roles=docpost.key_roles("tasks_copy")))
    except Exception as err:
        log.warning("Завдання тижня №%s: копію в загальний канал не надіслано: %s", t.get("id"), err)


def _task_line(x: dict) -> str:
    p = x["progress"]
    if x["kind"] == "auto":
        return f"{p['n']}/{p['target']} {bar(x['pct'], 8)}"
    return {"done": "виконано", "review": "на підтвердженні", "fail": "не виконано"}.get(x["state"], "в роботі")


async def digest(d: str, w: int, kind: str) -> discord.Embed | None:
    """Перелік завдань відділу на тиждень (понеділок) або нагадування про невиконане (п'ятниця)."""
    items = [x for x in await week_items(w, [d]) if x["status"] != "cancel"]
    if kind == "remind":
        items = [x for x in items if x["state"] not in ("done",)]
    if not items:
        return None
    dp = DEPTS[d]
    title = "ЗАВДАННЯ НА ТИЖДЕНЬ" if kind == "week" else "НАГАДУВАННЯ: ЗАВДАННЯ ТИЖНЯ"
    head = "Завдання від керівництва СБУ на цей тиждень:" if kind == "week" else "До кінця тижня лишилось виконати:"
    e = style.document(f"{title} · {dp['s']}", dp["color"], no=f"Тиждень {week_label(w)}", desc=head)
    for i, x in enumerate(items[:20], 1):
        e.add_field(name=f"{_icon(x)} {i}. {x['data']['title']}"[:256] + (" ❗" if x["data"].get("prio") == "high" else ""),
                    value=f"{style.esc(_goal(x))}\n{_task_line(x)}"[:1024], inline=False)
    return e


async def post_digests(w: int, kind: str) -> int:
    sent = 0
    for d in CONTROL_DEPTS:
        try:
            e = await digest(d, w, kind)
            ch = await core.channel(d) if e else None
            if ch:
                await ch.send(embed=e, view=style.site_view("Завдання тижня у «Сові»"), **_ping(d))
                sent += 1
                await asyncio.sleep(1.5)
        except Exception as err:
            log.warning("Завдання тижня: %s для %s: %s", kind, d, err)
    return sent


def _proof_links(x: dict, room: int = 700) -> str:
    """Посилання на докази: відкат зі звіту (або картка звіту в Discord), для ручних — посилання з виконання."""
    out = []
    if x["kind"] == "auto":
        for a in x.get("acts") or []:
            url = a["evidence"] if a["evidence"].startswith(("http://", "https://")) else a.get("link")
            out.append(f"[{a['no']}]({url})" if url else a["no"])
    else:
        pr = x.get("proof") or {}
        out += [f"[доказ {i}]({u})" for i, u in enumerate(pr.get("links") or [], 1)]
        if pr.get("files"):
            out.append(f"📎 файлів: {len(pr['files'])}")
    text, shown = "", 0
    for s in out:
        if len(text) + len(s) + 3 > room:
            break
        text += (" · " if text else "") + s
        shown += 1
    if shown < len(out):
        text += f" · … ще {len(out) - shown} у «Сові»"
    return text


async def summary_embeds(w: int) -> list[discord.Embed]:
    items = [x for x in await week_items(w) if x["status"] != "cancel"]
    if not items:
        return []
    full = {x["id"]: await get_full(x["id"]) for x in items}
    st = summarize(items)
    ranking = sorted(st["depts"].items(), key=lambda kv: (-kv[1]["pct"], -kv[1]["done"], CONTROL_DEPTS.index(kv[0])))
    medal = ["🥇", "🥈", "🥉"]
    rows = []
    for i, (d, s) in enumerate(ranking):
        m = medal[i] if i < 3 and s["done"] else "▫️"
        rows.append(f"{m} **{DEPTS[d]['s']}** {bar(s['pct'])} {s['done']}/{s['total']} · {s['pct']}%")
    contrib = Counter()
    names = {}
    for f in full.values():
        for a in f.get("acts") or []:
            contrib[a["by"]] += a["units"]
            names[a["by"]] = a["byName"]
    color = style.GREEN if st["pct"] >= 80 else style.GOLD if st["pct"] >= 50 else style.RED
    over = style.document("ПІДСУМКИ ЗАВДАНЬ ТИЖНЯ", color, no=f"Тиждень {week_label(w)}", footer="автоматично щонеділі",
                          desc=style.block(style.kv("ВИКОНАНО", f"{st['done']} з {st['total']} · {st['pct']}%", bold=True), bar(st["pct"], 16), "",
                                           style.kv("ВІДДІЛІВ ІЗ ЗАВДАННЯМИ", len(st["depts"])),
                                           style.kv("ЧАСТКОВО", sum(s["part"] for s in st["depts"].values())),
                                           style.kv("НЕ ВИКОНАНО", st["total"] - st["done"] - sum(s["part"] for s in st["depts"].values()))))
    over.add_field(name="🏆 Рейтинг відділів", value="\n".join(rows)[:1024], inline=False)
    if contrib:
        over.add_field(name="👤 Найбільший внесок", value="\n".join(f"{medal[i] if i < 3 else '•'} {style.esc(names[s])} — {n}"
                                                                  for i, (s, n) in enumerate(contrib.most_common(5)))[:1024], inline=False)
    out = [over]
    for d, s in ranking:
        dp = DEPTS[d]
        e = style.document(f"{dp['s']} · {s['done']}/{s['total']} · {s['pct']}%", dp["color"], no=dp["n"],
                           desc=bar(s["pct"], 16))
        for x in [i for i in items if i["dept"] == d][:20]:
            f = full[x["id"]]
            val = [style.esc(_goal(x)), _task_line(x)]
            if x["state"] == "done" and x.get("doneAt"):
                val[-1] += f" · закрито {fmt_day(x['doneAt'])}"
            links = _proof_links(f)
            if links:
                val.append("📎 " + links)
            e.add_field(name=f"{_icon(x)} {x['data']['title']}"[:256], value="\n".join(val)[:1024], inline=False)
        dc = Counter()
        for x in [i for i in items if i["dept"] == d]:
            for a in full[x["id"]].get("acts") or []:
                dc[a["byName"]] += a["units"]
        if dc:
            e.add_field(name="👤 Внесок", value=", ".join(f"{style.esc(n)} ({k})" for n, k in dc.most_common(5))[:1024], inline=False)
        out.append(e)
    return out


async def get_full(tid: int) -> dict:
    return await present(await _row(tid), full=True)


async def post_summary(w: int | None = None, by: dict | None = None) -> int:
    w = norm_week(w if w is not None else core.week_start(0))
    ch = await core.channel("tasks_report")
    if not ch:
        raise Fail("Канал підсумків завдань не налаштовано (адмін-панель → Канали → «Підсумки завдань тижня»).")
    embeds = await summary_embeds(w)
    if not embeds:
        return 0
    view = style.site_view("Завдання тижня у «Сові»")
    await ch.send(embed=embeds[0], view=view, allowed_mentions=discord.AllowedMentions.none())
    for e in embeds[1:]:
        await asyncio.sleep(1.5)
        await ch.send(embed=e, allowed_mentions=discord.AllowedMentions.none())
    if by:
        await db.audit(by["sid"], "Підсумок завдань тижня в Discord", None, week_label(w))
    return len(embeds)


async def rollover(cur: int) -> int:
    """Новий тиждень: копії щотижневих завдань з минулого тижня (один раз)."""
    n = 0
    for t in await db.all("SELECT * FROM tasks WHERE ABS(week-?)<? AND repeat=1 AND status NOT IN ('deleted','cancel')", cur - WEEK, DST):
        root = t["id"]
        if await db.one("SELECT id FROM tasks WHERE parent=? AND week=?", root, cur):
            continue
        await db.run("INSERT INTO tasks(week,dept,kind,status,data,proof,history,by_sid,repeat,parent,created,updated) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
                     cur, t["dept"], t["kind"], "open", t["data"], "{}", _hist(None, None, "repeat", f"повтор з тижня {week_label(t['week'])}"),
                     t["by_sid"], 1, root, now_ms(), now_ms())
        n += 1
    return n


async def weekly_loop():
    """Раз на 10 хв: понеділок — повтори й перелік завдань у канали відділів; п'ятниця — нагадування; неділя — підсумок."""
    await asyncio.sleep(120)
    while True:
        try:
            if ov.module_on("tasks"):
                now = datetime.now(core.TZ or timezone.utc)
                cur = core.week_start(0)
                if await db.get_setting("tasks_rolled") != cur:
                    await db.set_setting("tasks_rolled", cur)
                    await rollover(cur)
                    if now.weekday() == 0:  # перелік — лише якщо бот працює в понеділок (а не наздоганяє посеред тижня)
                        await post_digests(cur, "week")
                if now.weekday() == ov.C("task_remind_day") and now.hour >= ov.C("task_remind_hour") and await db.get_setting("tasks_reminded") != cur:
                    await db.set_setting("tasks_reminded", cur)
                    await post_digests(cur, "remind")
                if now.weekday() == ov.C("task_report_day") and now.hour >= ov.C("task_report_hour") and await db.get_setting("tasks_reported") != cur:
                    await db.set_setting("tasks_reported", cur)
                    await post_summary(cur)
        except Exception:
            log.exception("Завдання тижня: щотижневий цикл")
        await asyncio.sleep(600)
