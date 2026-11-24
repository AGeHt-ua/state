"""Клопотання СБУ (КЛП-…): до суду, Генерального прокурора, Міністерства юстиції та довільні.
Клопотання до Кабінету Міністрів / Мінфіну — окремий модуль finance.py (своя форма й звіт за 72 години).

Підстави (законодавча база NG):
  • Процесуальний кодекс: ордер — «на підставі мотивованого клопотання слідчого органу або прокурора»; ст. 30 — реквізити ордера;
    ст. 22.1 — арешт і блокування рахунків («ОРД-БЛОКУВАННЯ»).
  • Закон «Про СБУ»: обшуки й вилучення — лише за судовими ордерами («ОРД»).
  • Закон «Про органи прокуратури»: прокурор погоджує клопотання правоохоронних органів до суду; клопотання «ОРД-ІМУНІТЕТ»
    до Апеляційного суду подає Генеральний прокурор.
  • Внутрішній статут СБУ: перевірки працівників інших держорганів — лише за письмовим дорученням Офісу Генпрокурора;
    подання до Мін'юсту про внесення до «Чорного списку».

Подати може будь-який співробітник. Маршрут: начальник управління відділу автора (якщо відділ входить в управління:
ОРВ, ДЕБ або як задано в адмін-панелі → «Управління») → Заступник Голови або Голова СБУ (одного підпису досить).
Після затвердження автор подає документ (PDF / PNG / текст) і позначає результат."""
import json
import logging

import core
import docpost
import orders
import overrides as ov
import style
from core import Fail
from db import db, now_ms
from roles import DEPTS, rank_name

log = logging.getLogger("sova.petitions")

COURT = "Суд першої інстанції штату NG"
PROS = "Генеральний прокурор штату NG (Офіс Генерального прокурора)"
PROS_NOTE = "Перед поданням до суду клопотання погоджує прокурор (Закон «Про органи прокуратури штату NG»)."

# поля форм: ключ → (назва, вид: text | area)
FIELDS = {
    "person": ("Особа (ім'я, паспорт / ID)", "text"),
    "object": ("Об'єкт (адреса, приміщення, транспорт, номерний знак)", "text"),
    "items": ("Предмети, документи чи майно", "area"),
    "account": ("Рахунок / банківська картка (номер, власник)", "text"),
    "amount": ("Сума арешту, $", "text"),
    "official": ("Посадова особа (ім'я, посада, орган)", "text"),
    "witness": ("Особа під охороною (ім'я або псевдонім)", "text"),
    "arts": ("Кваліфікація (статті Кримінального кодексу)", "text"),
    "grounds": ("Обставини й підстави", "area"),
    "evidence": ("Докази (посилання на відео, скріни)", "area"),
    "term": ("Строк дії", "text"),
    "case": ("Кейс-файл (номер, якщо є)", "text"),
    "addressee": ("Адресат", "text"),
    "subject": ("Предмет клопотання (коротко)", "text"),
    "body": ("Текст клопотання", "area"),
}

# вид → адресат, заголовок, підстава, що просимо (з підстановкою полів {person} …), поля, обов'язкові поля, примітка
KINDS = {
    "ord_search": {"group": "court", "addr": COURT, "title": "про видачу судового ордера «ОРД-ОБШУК»",
                   "basis": "статтею 30 Процесуального кодексу штату NG та Законом «Про Службу безпеки України (СБУ) штату NG»",
                   "ask": "видати судовий ордер «ОРД-ОБШУК» на проведення обшуку: {object}{person_of}",
                   "fields": ["object", "person", "arts", "grounds", "evidence", "term", "case"], "req": ["object", "grounds"], "note": PROS_NOTE},
    "ord_arrest": {"group": "court", "addr": COURT, "title": "про видачу судового ордера «ОРД-АРЕШТ»",
                   "basis": "статтею 30 Процесуального кодексу штату NG",
                   "ask": "видати судовий ордер «ОРД-АРЕШТ» на затримання та взяття під варту: {person}",
                   "fields": ["person", "arts", "grounds", "evidence", "term", "case"], "req": ["person", "arts", "grounds"], "note": PROS_NOTE},
    "ord_seize": {"group": "court", "addr": COURT, "title": "про видачу судового ордера «ОРД-ВИЛУЧЕННЯ»",
                  "basis": "статтею 30 Процесуального кодексу штату NG та Законом «Про Службу безпеки України (СБУ) штату NG»",
                  "ask": "видати судовий ордер «ОРД-ВИЛУЧЕННЯ» на вилучення: {items}{person_of}",
                  "fields": ["items", "person", "object", "arts", "grounds", "evidence", "term", "case"], "req": ["items", "grounds"], "note": PROS_NOTE},
    "ord_block": {"group": "court", "addr": COURT, "title": "про видачу судового ордера «ОРД-БЛОКУВАННЯ»",
                  "basis": "статтями 22.1 та 30 Процесуального кодексу штату NG",
                  "ask": "видати судовий ордер «ОРД-БЛОКУВАННЯ» на арешт і блокування рахунку: {account}{person_of}",
                  "fields": ["account", "person", "amount", "arts", "grounds", "evidence", "term", "case"], "req": ["account", "grounds"], "note": PROS_NOTE},
    "court_protect": {"group": "court", "addr": COURT, "title": "про забезпечення безпеки учасника кримінального судочинства",
                      "basis": "Законом «Про Службу безпеки України (СБУ) штату NG» (захист учасників кримінального судочинства)",
                      "ask": "постановити ухвалу про забезпечення фізичної охорони: {witness}",
                      "fields": ["witness", "grounds", "term", "case"], "req": ["witness", "grounds"]},
    "pros_agree": {"group": "pros", "addr": PROS, "title": "про погодження клопотання до суду",
                   "basis": "Законом «Про органи прокуратури штату NG»",
                   "ask": "погодити клопотання Служби безпеки штату NG до суду: {subject}",
                   "fields": ["subject", "person", "arts", "grounds", "evidence", "case"], "req": ["subject", "grounds"]},
    "pros_immunity": {"group": "pros", "addr": PROS, "title": "щодо звернення про видачу ордера «ОРД-ІМУНІТЕТ»",
                      "basis": "Законом «Про недоторканність штату NG» та Законом «Про органи прокуратури штату NG»",
                      "ask": "звернутися до Апеляційного суду штату NG із клопотанням про видачу ордера «ОРД-ІМУНІТЕТ» щодо: {official}",
                      "fields": ["official", "arts", "grounds", "evidence", "case"], "req": ["official", "grounds"]},
    "pros_mandate": {"group": "pros", "addr": PROS, "title": "про надання письмового доручення на проведення перевірки",
                     "basis": "Внутрішнім статутом СБУ (перевірки працівників інших державних органів — за дорученням Офісу Генерального прокурора)",
                     "ask": "надати письмове доручення на проведення перевірочних заходів щодо: {official}",
                     "fields": ["official", "grounds", "evidence", "term"], "req": ["official", "grounds"]},
    "pros_protect": {"group": "pros", "addr": PROS, "title": "про винесення постанови про охорону учасника судочинства",
                     "basis": "Законом «Про Службу безпеки України (СБУ) штату NG»",
                     "ask": "винести постанову про забезпечення фізичної охорони: {witness}",
                     "fields": ["witness", "grounds", "term", "case"], "req": ["witness", "grounds"]},
    "minjust_black": {"group": "minjust", "addr": "Міністерство юстиції штату NG", "title": "про внесення до «Чорного списку»",
                      "basis": "Внутрішнім статутом Служби безпеки штату NG",
                      "ask": "внести до «Чорного списку» колишнього співробітника: {person}",
                      "fields": ["person", "grounds", "evidence"], "req": ["person", "grounds"]},
    "other": {"group": "other", "addr": "", "title": "", "basis": "", "ask": "", "fields": ["addressee", "subject", "body", "evidence"],
              "req": ["addressee", "subject", "body"]},
}
GROUPS = {"court": "Суд", "pros": "Генеральний прокурор", "minjust": "Міністерство юстиції", "other": "Інше"}
STATUS = {"wait": "На погодженні", "rejected": "Повернуто автору", "approved": "Затверджено", "posted": "Подано адресату",
          "granted": "Задоволено", "denied": "Відмовлено адресатом", "deleted": "Видалено"}
STAGE_NAME = {"mgmt": "погодження начальника управління", "chief": "затвердження Заступника Голови або Голови СБУ"}
DONE = ("approved", "posted", "granted", "denied")


def no(p: dict) -> str:
    return f"КЛП-{p['id']:04d}"


# ---------------------------------------------------------------- права
def can_prepare(u: dict) -> bool:
    return not u.get("curator_ro") and u["dept"] not in ("prosecutor", "curator")


def is_approver(u: dict) -> bool:
    return u["rank"] >= ov.P("pet_approve") and not u.get("curator_ro")


def can_act(u: dict, p: dict) -> bool:
    if p["status"] != "wait" or p["by_sid"] == u["sid"]:
        return False
    if is_approver(u):
        return True
    return p["stage"] == "mgmt" and orders.is_mgmt_for(u, p["dept"])


def can_view(u: dict, p: dict) -> bool:
    if p["by_sid"] == u["sid"] or is_approver(u) or u.get("curator"):
        return True
    return orders.is_mgmt_for(u, p["dept"]) or orders.is_head_of(u, p["dept"])


def _route(u: dict, dept: str) -> list[str]:
    route = []
    if dept in orders.mgmt_route() and not (u["rank"] >= 13):
        route.append("mgmt")
    route.append("chief")
    return route


# ---------------------------------------------------------------- дані
def _clean(kind: str, b: dict) -> dict:
    k = KINDS[kind]
    data = {}
    for f in k["fields"]:
        v = str(b.get(f) or "").strip()
        data[f] = v[:2500] if FIELDS[f][1] == "area" else v[:300]
    missing = [FIELDS[f][0] for f in k["req"] if not data.get(f)]
    if missing:
        raise Fail("Заповніть: " + "; ".join(missing) + ".")
    return data


async def _row(pid: int) -> dict:
    p = await db.one("SELECT * FROM petitions WHERE id=? AND status!='deleted'", pid)
    if not p:
        raise Fail("Клопотання не знайдено.", 404)
    for k, d in (("data", "{}"), ("visas", "[]"), ("history", "[]")):
        try:
            p[k] = json.loads(p.get(k) or d)
        except ValueError:
            p[k] = json.loads(d)
    return p


def _hist(p: dict | None, u: dict, action: str, note: str = "") -> str:
    h = (p["history"] if p else []) + [{"t": now_ms(), "sid": u["sid"], "name": u["name"], "action": action, "note": note[:500]}]
    return json.dumps(h, ensure_ascii=False)


async def out(u: dict, p: dict) -> dict:
    a = await core.user(p["by_sid"])
    k = KINDS.get(p["kind"], KINDS["other"])
    return {**{x: p[x] for x in ("id", "kind", "dept", "status", "stage", "t", "updated", "approved", "note", "result_url", "by_sid", "data", "visas", "history")},
            "no": no(p), "statusName": STATUS.get(p["status"], p["status"]), "stageName": STAGE_NAME.get(p["stage"], "") if p["status"] == "wait" else "",
            "group": k["group"], "author": {"sid": a["sid"], "name": a["name"], "rank": a["rank"], "rankName": rank_name(a["rank"]),
                                             "dept": a["dept"]} if a else None,
            "canAct": can_act(u, p), "mine": p["by_sid"] == u["sid"],
            "canEdit": p["by_sid"] == u["sid"] and p["status"] in ("wait", "rejected") and not p["visas"],
            "canDelete": (p["by_sid"] == u["sid"] and p["status"] in ("wait", "rejected")) or is_approver(u),
            "canResult": p["status"] in DONE and (p["by_sid"] == u["sid"] or is_approver(u))}


# ---------------------------------------------------------------- дії
async def create(u: dict, b: dict) -> dict:
    if not can_prepare(u):
        raise Fail("Клопотання подають співробітники СБУ.", 403)
    kind = b.get("kind")
    if kind not in KINDS:
        raise Fail("Оберіть вид клопотання.")
    data = _clean(kind, b)
    dept = u["dept"]
    route = _route(u, dept)
    t = now_ms()
    status, stage = ("approved", "chief") if is_approver(u) else ("wait", route[0])  # Голова / Заступник затверджують своє одразу
    pid = await db.run("INSERT INTO petitions(by_sid,dept,kind,data,status,stage,route,visas,history,t,updated,approved) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
                       u["sid"], dept, kind, json.dumps(data, ensure_ascii=False), status, stage, ",".join(route), "[]",
                       _hist(None, u, "create"), t, t, t if status == "approved" else None)
    p = await _row(pid)
    await journal(p, u, "Клопотання подано" if status == "wait" else "Клопотання складено й затверджено", tag=b.get("tag"))
    return p


async def edit(u: dict, pid: int, b: dict) -> dict:
    """Автор виправляє своє клопотання (поки ніхто не погодив) або повернуте — і подає знову, маршрут спочатку."""
    async with core.doc_lock("pet", pid):
        p = await _row(pid)
        if p["by_sid"] != u["sid"] or p["status"] not in ("wait", "rejected") or (p["status"] == "wait" and p["visas"]):
            raise Fail("Змінити можна власне клопотання, доки його ніхто не погодив, або повернуте вам.", 403)
        data = _clean(p["kind"], b)
        route = p["route"].split(",")
        await db.run("UPDATE petitions SET data=?, status='wait', stage=?, visas='[]', note=NULL, history=?, updated=? WHERE id=?",
                     json.dumps(data, ensure_ascii=False), route[0], _hist(p, u, "edit"), now_ms(), pid)
        p = await _row(pid)
    await journal(p, u, "Клопотання виправлено й подано знову")
    return p


async def decide(u: dict, pid: int, decision: str, note: str = "") -> dict:
    async with core.doc_lock("pet", pid):
        p = await _row(pid)
        if not can_act(u, p):
            raise Fail("Це клопотання зараз не на вашому погодженні.", 403)
        t = now_ms()
        if decision == "reject":
            if not note.strip():
                raise Fail("Вкажіть причину — її побачить автор.")
            await db.run("UPDATE petitions SET status='rejected', note=?, history=?, updated=? WHERE id=?", note.strip()[:500],
                         _hist(p, u, "reject", note), t, pid)
            label = "Повернуто автору: " + note.strip()[:200]
        elif decision == "ok":
            visas = p["visas"] + [{"stage": p["stage"], "sid": u["sid"], "name": u["name"], "rank": u["rank"], "rankName": rank_name(u["rank"]), "t": t}]
            if p["stage"] == "chief" or is_approver(u):  # затвердження ЗГС/ГС (вони можуть і замість начальника управління)
                await db.run("UPDATE petitions SET status='approved', stage='chief', visas=?, approved=?, history=?, updated=? WHERE id=?",
                             json.dumps(visas, ensure_ascii=False), t, _hist(p, u, "approve"), t, pid)
                label = "Клопотання затверджено"
            else:
                await db.run("UPDATE petitions SET stage='chief', visas=?, history=?, updated=? WHERE id=?",
                             json.dumps(visas, ensure_ascii=False), _hist(p, u, "visa"), t, pid)
                label = "Погоджено начальником управління · на затвердженні ЗГС / ГС"
        else:
            raise Fail("Невідоме рішення.")
        p = await _row(pid)
    await journal(p, u, label)
    return p


async def result(u: dict, pid: int, b: dict) -> dict:
    """Після затвердження: подано адресату (з посиланням) → задоволено / відмовлено."""
    async with core.doc_lock("pet", pid):
        p = await _row(pid)
        if p["status"] not in DONE or not (p["by_sid"] == u["sid"] or is_approver(u)):
            raise Fail("Результат позначає автор або керівництво після затвердження.", 403)
        st = b.get("status")
        if st not in ("posted", "granted", "denied"):
            raise Fail("Невідомий результат.")
        url = str(b.get("url") or p.get("result_url") or "").strip()[:300]
        if url and not url.startswith(("http://", "https://")):
            raise Fail("Посилання має починатися з http:// або https://")
        await db.run("UPDATE petitions SET status=?, result_url=?, history=?, updated=? WHERE id=?", st, url or None,
                     _hist(p, u, st, url), now_ms(), pid)
        p = await _row(pid)
    await journal(p, u, STATUS[st])
    return p


async def delete(u: dict, pid: int):
    async with core.doc_lock("pet", pid):
        p = await _row(pid)
        if not ((p["by_sid"] == u["sid"] and p["status"] in ("wait", "rejected")) or is_approver(u)):
            raise Fail("Видалити можна власне незатверджене клопотання.", 403)
        await db.run("UPDATE petitions SET status='deleted', history=?, updated=? WHERE id=?", _hist(p, u, "delete"), now_ms(), pid)
    await docpost.remove("pet", pid)


async def listing(u: dict) -> list[dict]:
    rows = await db.all("SELECT * FROM petitions WHERE status!='deleted' ORDER BY updated DESC LIMIT 400")
    res = []
    for r in rows:
        for k, d in (("data", "{}"), ("visas", "[]"), ("history", "[]")):
            try:
                r[k] = json.loads(r.get(k) or d)
            except ValueError:
                r[k] = json.loads(d)
        if can_view(u, r):
            res.append(await out(u, r))
    return res[:200]


async def pending(u: dict) -> int:
    n = 0
    for r in await db.all("SELECT id, by_sid, dept, status, stage FROM petitions WHERE status='wait'"):
        n += can_act(u, r)
    return n


def meta() -> dict:
    return {"kinds": {k: {x: v[x] for x in ("group", "addr", "title", "basis", "ask", "fields", "req")} | {"note": v.get("note", "")}
                      for k, v in KINDS.items()},
            "fields": {k: {"n": v[0], "t": v[1]} for k, v in FIELDS.items()}, "groups": GROUPS, "status": STATUS}


# ---------------------------------------------------------------- Discord: журнал руху в каналі відділу автора
COLORS = {"wait": style.GOLD, "rejected": style.RED, "approved": style.GREEN, "posted": style.BLUE, "granted": style.GREEN,
          "denied": style.RED, "deleted": style.GRAY}


async def journal(p: dict, u: dict, label: str, tag: str | None = None):
    try:
        k = KINDS[p["kind"]]
        a = await core.user(p["by_sid"])
        title = f"Клопотання {k['title']}" if k["title"] else f"Клопотання: {p['data'].get('subject', '')}"
        e = style.card(no(p), title[:200], label, COLORS.get(p["status"], style.BLUE), t=p["updated"], fields=[
            ("Адресат", k["addr"] or p["data"].get("addressee")),
            ("Автор", style.person(a)),
            ("Стан", STATUS.get(p["status"]) + (f" · {STAGE_NAME.get(p['stage'], '')}" if p["status"] == "wait" else "")),
            ("Візи", " · ".join(f"{style.esc(v['name'])}" for v in p["visas"]) or None),
        ])
        ch = await core.channel(p["dept"]) or await core.channel("log")
        await docpost.journal("pet", p["id"], ch, e, users=await docpost.people(p["by_sid"]), tag=tag,
                              ping={"rejected": "↩ Клопотання повернуто автору.", "approved": "✅ Клопотання затверджено."}.get(p["status"]))
    except Exception:  # клопотання вже збережено — збій Discord не повинен повертати помилку автору
        log.exception("Журнал клопотання %s", p.get("id"))
