"""Дисципліна: накази про стягнення, строки дії, оскарження, службові перевірки ВВБ.
За Регламентом «Дисциплінарні стягнення СБУ» та р. VII Внутрішнього статуту СБУ."""
import json
import logging

import discord

import core
import overrides as ov
import style
from core import DAY, Fail
from db import db, now_ms
from roles import DEPTS, OPS_DEPTS, rank_name

log = logging.getLogger("sova.disc")

KINDS = {  # вид: (назва, діє діб, хто накладає: мінімальне звання)
    "remark": ("Усне зауваження", 0, 11),
    "reprimand": ("Письмова догана", 7, 11),
    "severe": ("Сувора догана", 7, 11),
    "fine": ("Дисциплінарний штраф", 0, 14),
    "demote": ("Пониження у званні", 0, 14),
    "dismiss": ("Звільнення зі служби", 0, 14),
    "blacklist": ("Звільнення з поданням до «Чорного списку»", 0, 15),
}
BLOCKING = ("reprimand", "severe")  # п. 1.2: активна догана блокує підвищення й премії

# Р. VII Внутрішнього статуту СБУ (заборони) + Етичний кодекс: (текст, дозволені стягнення, штраф)
S = "Статут СБУ, р. VII"
VIOLATIONS = [
    ("s01", "Перевищення службових повноважень", ["reprimand", "severe"], 0),
    ("s02", "Використання службового становища у власних інтересах", ["severe"], 0),
    ("s03", "Розголошення службової або державної таємниці", ["dismiss", "blacklist"], 0),
    ("s04", "Передача матеріалів розслідувань злочинним угрупованням", ["blacklist"], 0),
    ("s05", "Фальсифікація доказів або процесуальних документів", ["dismiss", "blacklist"], 0),
    ("s06", "Застосування сили або зброї без законних підстав", ["reprimand", "severe"], 0),
    ("s07", "Незаконне затримання громадян", ["reprimand", "severe"], 0),
    ("s08", "Перешкоджання службовим розслідуванням ВВБ або прокуратури", ["severe", "dismiss"], 0),
    ("s09", "Використання службового транспорту, обладнання чи зброї в особистих цілях", ["fine"], 15000),
    ("s10", "Дискредитація Служби безпеки своєю поведінкою", ["dismiss"], 0),
    ("s11", "Співпраця зі злочинними угрупованнями", ["blacklist"], 0),
    ("s12", "Використання баз даних правопорядку в неслужбових цілях", ["fine"], 10000),
    ("s13", "Розголошення даних співробітників під прикриттям", ["severe", "dismiss"], 0),
    ("s14", "Самовільне проведення оперативних заходів без наказу", ["reprimand"], 0),
    ("s15", "Приниження честі й гідності затриманих осіб", ["reprimand", "severe"], 0),
    ("s16", "Прогул: тривала відсутність без погодженої відпустки", ["fine", "dismiss"], 15000),
    ("s17", "Несвоєчасна сплата дисциплінарного штрафу (понад 24 год)", ["reprimand"], 0),
    ("s18", "Порушення правил службової субординації", ["fine", "reprimand"], 20000),
    ("s19", "Ігнорування законного наказу керівника", ["reprimand", "severe"], 0),
    ("s20", "Зміна паспортних даних без повідомлення керівництва", ["fine"], 10000),
    ("s21", "Продаж або передача табельної зброї, набоїв чи спецзасобів", ["blacklist"], 0),
    ("s22", "Вживання алкоголю під час несення служби", ["dismiss"], 0),
    ("s23", "Вживання або зберігання наркотичних засобів", ["dismiss"], 0),
    ("s24", "Неповідомлення ДБР/прокуратури про відомі факти корупції", ["severe"], 0),
    ("s25", "Навмисне безпідставне ігнорування викликів", ["reprimand"], 0),
    ("s26", "Носіння бронежилетів інших відомств або не свого підрозділу", ["reprimand"], 0),
    ("s27", "Залишення пораненого співробітника без медичної допомоги", ["reprimand"], 0),
    ("s28", "Безпідставне накладення штрафів чи евакуація авто", ["reprimand"], 0),
    ("s29", "Зберігання табельного майна вдома, неповернення при звільненні", ["severe"], 0),
    ("s30", "Привласнення штрафних сум або платежів в обхід казни", ["blacklist"], 0),
    ("s31", "Використання мегафона службового авто не за призначенням", ["remark"], 0),
    ("s32", "Розкриття форм і методів негласної діяльності чи деталей спецоперацій", ["dismiss"], 0),
    ("s33", "Порушення конспірації, передача матеріалів справ стороннім", ["severe", "dismiss"], 0),
    ("s34", "Знищення чи фальсифікація службової документації", ["reprimand", "dismiss"], 0),
    ("s35", "Приховування проступків підлеглих", ["reprimand"], 0),
    ("s36", "Використання підлеглих в особистих інтересах", ["fine"], 30000),
    ("s37", "Безпідставне втручання у перевірки ВВБ", ["fine"], 20000),
    ("s38", "Виплата премій без звіту або нарахування собі", ["severe", "dismiss"], 0),
    ("e1", "Етичний кодекс, ст. 34.1: неповага чи образа громадянина", ["fine", "remark", "reprimand"], 15000),
    ("e2", "Етичний кодекс, ст. 34.2: образа державного співробітника", ["fine", "remark", "reprimand"], 10000),
    ("e3", "Етичний кодекс, ст. 34.3: створення конфлікту в організації", ["fine", "reprimand"], 20000),
    ("other", "Інше порушення (вказати в обставинах)", list(KINDS), 0),
]
VMAP = {v[0]: v for v in VIOLATIONS}


# ---------------------------------------------------------------- права
def depts_of(u: dict) -> set[str]:
    hit = core._roles_cache.get(str(u.get("discord_id")))
    roles = hit[1] if hit and hit[1] else set()
    out = {u["dept"]} | {d for d in OPS_DEPTS if DEPTS[d]["role"] in roles}
    return out | {"academy"} if "vkpp" in out else out  # Начальник ВКПП — він же начальник академії


def can_punish(u: dict, target: dict, kind: str) -> bool:
    """Р. II: начальники відділів/управлінь і заступники — зауваження й догани своїм; Заступник Голови — до звільнення; Голова — усе."""
    if target["sid"] == u["sid"] or u["dept"] == "prosecutor":
        return False
    if u["rank"] < KINDS[kind][2]:
        return False
    if u["rank"] >= 14:
        return target["rank"] < u["rank"] or u["rank"] == 15
    if u["rank"] == 13:
        return target["rank"] < 13
    return target["rank"] < u["rank"] and target["dept"] in depts_of(u)


def is_vvb(u: dict) -> bool:
    return u["rank"] >= 14 or "vvb" in depts_of(u)


def can_journal(u: dict) -> bool:
    return u["rank"] >= 11 or is_vvb(u)


def active(o: dict, now: int | None = None) -> bool:
    now = now or now_ms()
    return o["status"] == "active" and o["kind"] in BLOCKING and (o["expires"] or 0) > now


async def active_blocking(sid: int) -> list[dict]:
    rows = await db.all("SELECT * FROM discipline WHERE sid=? AND status='active' AND kind IN ('reprimand','severe') AND expires>?", sid, now_ms())
    return rows


# ---------------------------------------------------------------- накази
async def get(oid: int) -> dict:
    o = await db.one("SELECT * FROM discipline WHERE id=?", oid)
    if not o or o["status"] == "deleted":
        raise Fail("Наказ не знайдено.", 404)
    o["history"] = json.loads(o["history"] or "[]")
    o["appeal"] = json.loads(o["appeal"] or "null")
    return o


async def issue(u: dict, b: dict) -> dict:
    target = await core.user(int(b.get("sid") or 0))
    if not target or target["status"] == "dismissed":
        raise Fail("Співробітника не знайдено.")
    kind = b.get("kind")
    if kind not in KINDS:
        raise Fail("Оберіть вид стягнення.")
    if not can_punish(u, target, kind):
        raise Fail("Ви не маєте права накладати це стягнення на цього співробітника (р. II Регламенту).", 403)
    if kind == "demote" and target["rank"] <= 1:
        raise Fail("Нижче звання немає.")
    v = VMAP.get(b.get("violation")) or VMAP["other"]
    reason = str(b.get("reason") or "").strip()[:1500]
    if not reason:
        raise Fail("Опишіть обставини порушення.")
    fine = max(0, int(float(b.get("fine") or 0))) if kind == "fine" else 0
    if kind == "fine" and not fine:
        raise Fail("Вкажіть суму штрафу.")
    t = now_ms()
    expires = t + KINDS[kind][1] * DAY if KINDS[kind][1] else None
    h = [{"t": t, "sid": u["sid"], "name": u["name"], "action": "issue"}]
    oid = await db.run("INSERT INTO discipline(sid,dept,kind,violation,reason,fine,status,issued_by,issued,expires,history,inspection) "
                       "VALUES(?,?,?,?,?,?,?,?,?,?,?,?)", target["sid"], target["dept"], kind, v[0], reason, fine, "active", u["sid"], t, expires,
                       json.dumps(h, ensure_ascii=False), b.get("inspection"))
    o = await get(oid)
    await apply(u, o, target)
    if b.get("inspection"):
        await db.run("UPDATE inspections SET status='closed', order_id=?, updated=? WHERE id=?", oid, t, int(b["inspection"]))
    await db.audit(u["sid"], f"Стягнення: {KINDS[kind][0]}", target["sid"], f"НС-{oid:04d} · {v[1][:80]}")
    await journal(o, target, u, "Оголошено наказ")
    reps = [x for x in await active_blocking(target["sid"]) if x["kind"] == "reprimand"]
    if len(reps) >= 3:  # п. 3.4
        await alert_three(target, reps)
    return o


async def apply(u: dict, o: dict, target: dict):
    """Пониження й звільнення виконуються одразу: ролі в Discord, нікнейм, кадровий аудит."""
    if o["kind"] == "demote":
        if target["rank"] <= 1:
            raise Fail("Нижче звання немає.")
        await db.run("UPDATE users SET rank=?, since=? WHERE sid=?", target["rank"] - 1, now_ms(), target["sid"])
        await db.audit(u["sid"], "Пониження", target["sid"], f"{rank_name(target['rank'])} → {rank_name(target['rank'] - 1)} · НС-{o['id']:04d}")
    elif o["kind"] in ("dismiss", "blacklist"):
        await db.run("UPDATE users SET status='dismissed' WHERE sid=?", target["sid"])
        await db.run("DELETE FROM sessions WHERE sid=?", target["sid"])
        await db.audit(u["sid"], "Звільнення (дисциплінарне)" + (" · Чорний список" if o["kind"] == "blacklist" else ""), target["sid"], f"НС-{o['id']:04d}")
    else:
        return
    t2 = await core.user(target["sid"])
    await core.sync_roles(t2, f"Сова: наказ НС-{o['id']:04d}")
    if o["kind"] == "demote":
        await core.set_nick(t2)
    await core.send_audit(t2, u)


async def appeal(u: dict, oid: int, text: str) -> dict:
    o = await get(oid)
    if o["sid"] != u["sid"]:
        raise Fail("Оскаржити можна лише власне стягнення.", 403)
    if o["appeal"]:
        raise Fail("Скаргу вже подано.")
    if now_ms() - o["issued"] > DAY:
        raise Fail("Строк оскарження (24 години, п. 4.1) минув. Залишається позов до Суду першої інстанції (п. 4.2).")
    text = (text or "").strip()[:1500]
    if len(text) < 10:
        raise Fail("Поясніть, чому стягнення незаконне.")
    ap = {"t": now_ms(), "text": text, "decision": None}
    h = o["history"] + [{"t": now_ms(), "sid": u["sid"], "name": u["name"], "action": "appeal"}]
    await db.run("UPDATE discipline SET appeal=?, history=? WHERE id=?", json.dumps(ap, ensure_ascii=False), json.dumps(h, ensure_ascii=False), oid)
    o = await get(oid)
    await journal(o, u, u, "Подано скаргу Голові СБУ")
    return o


async def decide(u: dict, oid: int, action: str, note: str = "") -> dict:
    """Голова СБУ: розгляд скарги (uphold/cancel) або дострокове зняття догани (lift)."""
    if u["rank"] < 15:
        raise Fail("Це рішення ухвалює Голова СБУ.", 403)
    o = await get(oid)
    target = await core.user(o["sid"])
    h = o["history"] + [{"t": now_ms(), "sid": u["sid"], "name": u["name"], "action": action, "note": note[:300]}]
    if action in ("uphold", "cancel"):
        if not o["appeal"] or o["appeal"].get("decision"):
            raise Fail("Немає скарги на розгляді.")
        o["appeal"].update(decision=action, by=u["name"], dt=now_ms(), note=note[:300])
        status = "cancelled" if action == "cancel" else o["status"]
        await db.run("UPDATE discipline SET appeal=?, status=?, history=? WHERE id=?",
                     json.dumps(o["appeal"], ensure_ascii=False), status, json.dumps(h, ensure_ascii=False), oid)
        label = "Скаргу задоволено — стягнення скасовано" if action == "cancel" else "Скаргу відхилено — стягнення залишено"
    elif action == "lift":
        if not active(o):
            raise Fail("Знімати можна лише чинну догану.")
        await db.run("UPDATE discipline SET status='lifted', history=? WHERE id=?", json.dumps(h, ensure_ascii=False), oid)
        label = "Догану знято достроково"
    else:
        raise Fail("Невідома дія.")
    o = await get(oid)
    await db.audit(u["sid"], label, o["sid"], f"НС-{oid:04d}")
    await journal(o, target, u, label)
    return o


async def delete(u: dict, oid: int):
    """Скасування й видалення наказу: хто наклав або Голова/заступник. Пониження/звільнення ролей назад не повертає."""
    o = await get(oid)
    if not (o["issued_by"] == u["sid"] or u["rank"] >= ov.P("disc_chief")):
        raise Fail("Видалити наказ може той, хто його видав, або керівництво СБУ.", 403)
    h = o["history"] + [{"t": now_ms(), "sid": u["sid"], "name": u["name"], "action": "delete"}]
    await db.run("UPDATE discipline SET status='deleted', history=? WHERE id=?", json.dumps(h, ensure_ascii=False), oid)
    await db.audit(u["sid"], "Наказ про стягнення видалено", o["sid"], f"НС-{oid:04d}")
    await journal(o, await core.user(o["sid"]), u, "Наказ скасовано й видалено")


async def journal(o: dict, target: dict | None, u: dict, label: str):
    ch = await core.channel("disc")
    if not ch:
        return
    kind = KINDS[o["kind"]][0]
    col = 0xD4605A if o["kind"] in ("dismiss", "blacklist", "severe") else 0xD9A23D
    lines = [style.kv("НАКАЗ", f"НС-{o['id']:04d} · {kind}", "white", True),
             style.kv("СПІВРОБІТНИК", f"{target['name']} · №{target['sid']}" if target else f"№{o['sid']}", "white", True),
             style.kv("ПОРУШЕННЯ", VMAP.get(o["violation"], VMAP["other"])[1][:40], "white")]
    if o["fine"]:
        lines.append(style.kv("ШТРАФ", f"${o['fine']:,}".replace(",", " "), "gold", True))
    if o["expires"]:
        lines.append(style.kv("ДІЄ ДО", style.when(o["expires"]), "gray"))
    lines += [style.rule(), style.kv("ДІЯ", label, "red" if "Оголошено" in label else "cyan", True),
              style.kv("ХТО", f"{u['name']} · №{u['sid']}", "white"), style.kv("ДАТА", style.when(), "gray")]
    e = style.document("НАКАЗ ПРО ДИСЦИПЛІНАРНЕ СТЯГНЕННЯ", col, desc=style.block(*lines),
                       footer="Регламент «Дисциплінарні стягнення СБУ» · п. 4.3: реєстрація в журналі кадрового обліку")
    try:
        # наказ, оголошений Головою чи Заступником, — згадка ролі СБУ
        await ch.send(embed=e, **(core.mention("order") if label == "Оголошено наказ" and u["rank"] >= 14
                                  else {"allowed_mentions": discord.AllowedMentions.none()}))
    except discord.HTTPException as ex:
        log.warning("Журнал дисципліни: %s", ex)


async def alert_three(target: dict, reps: list[dict]):
    ch = await core.channel("disc")
    if not ch:
        return
    lines = [style.kv("СПІВРОБІТНИК", f"{target['name']} · №{target['sid']}", "white", True),
             style.kv("АКТИВНИХ ДОГАН", str(len(reps)), "red", True),
             style.c("П. 3.4: накопичення трьох активних письмових доган тягне", "gray"),
             style.c("безумовне звільнення зі складу СБУ. Рішення — Голова СБУ.", "gray")]
    e = style.document("⚠ ПІДСТАВА ДЛЯ ЗВІЛЬНЕННЯ", 0xD4605A, desc=style.block(*lines))
    try:
        await ch.send(embed=e, **core.mention("alert3"))
    except discord.HTTPException:
        pass


# ---------------------------------------------------------------- службові перевірки ВВБ
async def insp_get(iid: int) -> dict:
    i = await db.one("SELECT * FROM inspections WHERE id=?", iid)
    if not i or i["status"] == "deleted":
        raise Fail("Перевірку не знайдено.", 404)
    i["files"] = json.loads(i["files"] or "[]")
    return i


async def insp_save(u: dict, b: dict, iid: int | None = None) -> dict:
    if not is_vvb(u):
        raise Fail("Службові перевірки проводить ВВБ.", 403)
    target = await core.user(int(b.get("sid") or 0))
    if not target:
        raise Fail("Співробітника не знайдено.")
    s = lambda k, n: str(b.get(k) or "").strip()[:n]
    rec = b.get("recommend") if b.get("recommend") in KINDS else None
    vals = (target["sid"], s("title", 120), s("materials", 5000), s("conclusion", 3000), rec, json.dumps([str(f)[:40] for f in (b.get("files") or [])[:10]]))
    if not vals[1]:
        raise Fail("Вкажіть предмет перевірки.")
    if iid:
        i = await insp_get(iid)
        if i["status"] != "open":
            raise Fail("Перевірку вже направлено Голові.")
        await db.run("UPDATE inspections SET sid=?, title=?, materials=?, conclusion=?, recommend=?, files=?, updated=? WHERE id=?", *vals, now_ms(), iid)
    else:
        iid = await db.run("INSERT INTO inspections(sid,title,materials,conclusion,recommend,files,status,author,created,updated) VALUES(?,?,?,?,?,?,?,?,?,?)",
                           *vals, "open", u["sid"], now_ms(), now_ms())
    return await insp_get(iid)


async def insp_move(u: dict, iid: int, to: str) -> dict:
    i = await insp_get(iid)
    if to == "sent" and i["status"] == "open" and is_vvb(u):
        if not i["conclusion"]:
            raise Fail("Додайте висновок перевірки.")
        await db.run("UPDATE inspections SET status='sent', updated=? WHERE id=?", now_ms(), iid)
        await insp_notice(i, u)
    elif to == "closed" and i["status"] == "sent" and u["rank"] >= ov.P("disc_chief"):
        await db.run("UPDATE inspections SET status='closed', updated=? WHERE id=?", now_ms(), iid)
    elif to == "deleted" and (i["author"] == u["sid"] or u["rank"] >= ov.P("disc_chief")):
        await db.run("UPDATE inspections SET status='deleted', updated=? WHERE id=?", now_ms(), iid)
        return i
    else:
        raise Fail("Такий перехід неможливий.", 403)
    return await insp_get(iid)


async def insp_notice(i: dict, u: dict):
    """Матеріали службової перевірки направлено Голові: сповіщення в канал дисципліни (без змісту матеріалів)."""
    ch = await core.channel("disc")
    if not ch:
        return
    t = await core.user(i["sid"])
    lines = [style.kv("ПЕРЕВІРКА", f"СП-{i['id']:04d} · {i['title'][:40]}", "white", True),
             style.kv("ЩОДО", f"{t['name']} · №{t['sid']}" if t else f"№{i['sid']}", "white"),
             style.kv("РЕКОМЕНДАЦІЯ", KINDS[i["recommend"]][0] if i.get("recommend") else "без стягнення", "gold", True),
             style.rule(), style.kv("НАПРАВИВ", f"{u['name']} · ВВБ", "white"), style.kv("ДАТА", style.when(), "gray")]
    e = style.document("СЛУЖБОВА ПЕРЕВІРКА · НА РІШЕННЯ ГОЛОВИ", 0x6F9FD6, desc=style.block(*lines), footer="Матеріали — в ЄІС «Сова» → Дисципліна → Службові перевірки")
    try:
        await ch.send(embed=e, **core.mention("insp"))
    except discord.HTTPException as ex:
        log.warning("Сповіщення про перевірку: %s", ex)


# ---------------------------------------------------------------- вибірки для сайту
def out(o: dict, people: dict) -> dict:
    v = VMAP.get(o["violation"], VMAP["other"])
    return {**{k: o[k] for k in ("id", "sid", "dept", "kind", "violation", "reason", "fine", "status", "issued", "expires", "appeal", "history")},
            "violationText": v[1], "kindName": KINDS[o["kind"]][0], "active": active(o), "target": people.get(o["sid"]), "issuer": people.get(o["issued_by"])}


async def listing(u: dict) -> dict:
    rows = await db.all("SELECT * FROM discipline WHERE status!='deleted' ORDER BY issued DESC LIMIT 400")
    for o in rows:
        o["history"] = json.loads(o["history"] or "[]")
        o["appeal"] = json.loads(o["appeal"] or "null")
    mine = [o for o in rows if o["sid"] == u["sid"]]
    if u["rank"] >= 13 or is_vvb(u):
        journal_rows = rows
    elif u["rank"] >= 11:
        ds = depts_of(u)
        journal_rows = [o for o in rows if o["dept"] in ds]
    else:
        journal_rows = []
    insp = await db.all("SELECT * FROM inspections WHERE status!='deleted' ORDER BY updated DESC LIMIT 100") if (is_vvb(u) or u["rank"] >= 14) else []
    sids = {o["sid"] for o in rows} | {o["issued_by"] for o in rows} | {i["sid"] for i in insp} | {i["author"] for i in insp}
    people = {}
    for sid in sids:
        p = await core.user(sid)
        if p:
            people[sid] = {"sid": sid, "name": p["name"], "rank": p["rank"], "rankName": rank_name(p["rank"]), "dept": p["dept"]}
    return {
        "mine": [out(o, people) for o in mine],
        "journal": [out(o, people) for o in journal_rows],
        "inspections": [{**i, "files": json.loads(i["files"] or "[]"), "target": people.get(i["sid"]), "author": people.get(i["author"])} for i in insp],
        "rights": {"journal": can_journal(u), "vvb": is_vvb(u), "chief": u["rank"] >= ov.P("disc_chief"), "head": u["rank"] == 15,
                   "kinds": [k for k in KINDS if u["rank"] >= KINDS[k][2]]},
        "kinds": {k: v[0] for k, v in KINDS.items()},
        "violations": [{"id": v[0], "t": v[1], "kinds": v[2], "fine": v[3]} for v in VIOLATIONS],
    }
