"""Дисципліна: накази про стягнення, строки дії, оскарження, службові перевірки ВВБ.
За Регламентом «Дисциплінарні стягнення СБУ» та р. VII Внутрішнього статуту СБУ."""
import json
import logging
from datetime import datetime, timezone

import discord

import core
import docpost
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
    ("s06b", "Сила чи удари щодо особи, яка не чинить опору або в кайданках (п. 1.6)", ["dismiss"], 0),
    ("s07", "Незаконне затримання громадян", ["reprimand", "severe"], 0),
    ("s08", "Перешкоджання службовим розслідуванням ВВБ або прокуратури", ["severe", "dismiss"], 0),
    ("s09", "Використання службового транспорту, обладнання чи зброї в особистих цілях", ["fine"], 20000),
    ("s10", "Дискредитація Служби безпеки своєю поведінкою", ["dismiss"], 0),
    ("s11", "Співпраця зі злочинними угрупованнями", ["blacklist"], 0),
    ("s12", "Використання баз даних правопорядку в неслужбових цілях", ["fine"], 10000),
    ("s13", "Розголошення даних співробітників під прикриттям", ["severe", "dismiss"], 0),
    ("s14", "Самовільне проведення оперативних заходів без наказу", ["reprimand"], 0),
    ("s15", "Приниження честі й гідності затриманих осіб", ["reprimand", "severe"], 0),
    ("s16", "Самовільна відсутність на службі без дозволу керівника (п. 1.16)", ["fine", "reprimand"], 15000),
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
    ("s28", "Безпідставне накладення штрафів чи евакуація авто", ["reprimand", "severe"], 0),
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
    ("s39", "Небезпечні райони без службової підстави або патруль менш ніж удвох (п. 1.27)", ["reprimand"], 0),
    ("s40", "Патрулювання на особистому авто без затвердження (п. 1.28)", ["remark", "reprimand"], 0),
    ("s41", "Чатування біля місць збуту без оперативної мети (п. 1.31)", ["reprimand"], 0),
    ("s42", "Службове прикриття чи документи маскування в особистих інтересах (п. 2.3)", ["severe"], 0),
    ("s43", "Віддання завідомо незаконного або злочинного наказу (п. 3.1)", ["dismiss"], 0),
    ("s44", "Безпідставне звільнення підлеглого з особистих мотивів (п. 3.5)", ["reprimand"], 0),
    ("s45", "Неведення журналу кадрового обліку та підвищень (п. 3.6)", ["reprimand"], 0),
    ("s46", "Присвоєння звання з порушенням встановленого порядку (п. 3.8)", ["reprimand"], 0),
    ("s47", "Порушення форми, прихований жетон або вимкнена боді-камера (Положення про форму, 5.1)", ["reprimand"], 0),
    ("s48", "Умисне знищення чи втрата відеозапису затримання (Положення про форму, 5.2)", ["severe", "dismiss"], 0),
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


VVB_KINDS = ("remark", "reprimand", "severe")
# хто накладає який вид — адмін-панель → «Доступи»; строки доган — адмін-панель → «Налаштування»
KIND_PERM = {"remark": "disc_minor", "reprimand": "disc_minor", "severe": "disc_minor", "fine": "disc_major", "demote": "disc_major",
             "dismiss": "disc_major", "blacklist": "disc_blacklist"}


def kind_rank(kind: str) -> int:
    return ov.P(KIND_PERM[kind])


def kind_days(kind: str) -> int:
    return ov.C("reprimand_days") if kind == "reprimand" else ov.C("severe_days") if kind == "severe" else KINDS[kind][1]  # що може оголосити ВВБ за власними перевірками


def vvb_can(u: dict, target: dict | None = None) -> bool:
    """ВВБ контролює порядок у всій Службі: зауваження й догани будь-якому відділу (звання — адмін-панель → Доступи, «disc_vvb»).
    Не керівництву (13+) і не старшим чи рівним за званням колегам з ВВБ."""
    if u.get("curator_ro") or "vvb" not in depts_of(u) or u["rank"] < ov.P("disc_vvb"):
        return False
    if target is None:
        return True
    return target["rank"] < 13 and not ("vvb" in depts_of(target) and target["rank"] >= u["rank"])


def kinds_for(u: dict) -> list[str]:
    return [k for k in KINDS if u["rank"] >= kind_rank(k) or (k in VVB_KINDS and vvb_can(u))]


def can_punish(u: dict, target: dict, kind: str) -> bool:
    """Р. II: начальники відділів/управлінь і заступники — зауваження й догани своїм; Заступник Голови — до звільнення; Голова — усе.
    ВВБ — зауваження й догани будь-якому відділу (див. vvb_can)."""
    if target["sid"] == u["sid"] or u["dept"] == "prosecutor":
        return False
    if kind in VVB_KINDS and vvb_can(u, target):
        return True
    if u["rank"] < kind_rank(kind):
        return False
    if u["rank"] >= 14:
        return target["rank"] < u["rank"] or u["rank"] == 15
    if u["rank"] == 13:
        return target["rank"] < 13
    return target["rank"] < u["rank"] and target["dept"] in depts_of(u)


def is_vvb(u: dict) -> bool:
    return u["rank"] >= 14 or "vvb" in depts_of(u)


def can_journal(u: dict) -> bool:
    return u["rank"] >= ov.P("disc_journal") or is_vvb(u)


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
    expires = t + kind_days(kind) * DAY if kind_days(kind) else None
    h = [{"t": t, "sid": u["sid"], "name": u["name"], "action": "issue"}]
    oid = await db.run("INSERT INTO discipline(sid,dept,kind,violation,reason,fine,status,issued_by,issued,expires,history,inspection) "
                       "VALUES(?,?,?,?,?,?,?,?,?,?,?,?)", target["sid"], target["dept"], kind, v[0], reason, fine, "active", u["sid"], t, expires,
                       json.dumps(h, ensure_ascii=False), b.get("inspection"))
    o = await get(oid)
    await apply(u, o, target)
    if b.get("inspection"):
        await db.run("UPDATE inspections SET status='closed', order_id=?, updated=? WHERE id=?", oid, t, int(b["inspection"]))
    await db.audit(u["sid"], f"Стягнення: {KINDS[kind][0]}", target["sid"], f"НС-{oid:04d} · {v[1][:80]}")
    await journal(o, target, u, "Оголошено наказ", tag=b.get("tag"))
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


@core.serialized("ns")
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


NS_STATE = {"active": "⚖️ Чинне", "lifted": "🕊️ Знято достроково", "cancelled": "↩ Скасовано за скаргою", "deleted": "🗑 Скасовано й видалено"}


async def ns_embed(o: dict, target: dict | None) -> discord.Embed:
    """Картка наказу НС — єдиний зразок документа."""
    issuer = await core.user(o["issued_by"])
    expired = o["status"] == "active" and o["expires"] and o["expires"] < now_ms()
    head = "⌛ Строк дії минув" if expired else NS_STATE.get(o["status"], "⚖️ Чинне")
    ap = json.loads(o["appeal"]) if isinstance(o.get("appeal"), str) else o.get("appeal")
    color = style.GRAY if o["status"] in ("deleted", "cancelled", "lifted") or expired else style.RED if o["kind"] in ("dismiss", "blacklist", "severe") else style.GOLD
    insp = await db.one("SELECT id, files FROM inspections WHERE id=?", o["inspection"]) if o.get("inspection") else None
    e = style.card(f"НС-{o['id']:04d}", "Наказ про дисциплінарне стягнення", head, color, t=o["issued"], fields=[
        ("Співробітник", style.person(target) if target else f"№{o['sid']}"),
        ("Стягнення", KINDS[o["kind"]][0]),
        ("Наклав", style.person(issuer)),
        ("Порушення", style.esc(VMAP.get(o["violation"], VMAP["other"])[1]), False),
        ("Штраф", f"**${o['fine']:,}**".replace(",", " ") if o["fine"] else None),
        ("Діє до", style.when(o["expires"]) if o["expires"] else None),
        ("Скарга", ({"cancel": "задоволено", "uphold": "відхилено"}.get(ap.get("decision")) or "на розгляді Голови СБУ") if ap else None),
        ("Підстава", f"Службова перевірка СП-{insp['id']:04d}" if insp else None),
        ("Матеріали", await core.materials(None, json.loads(insp["files"] or "[]")) if insp else None, False),
    ])
    return e


async def journal(o: dict, target: dict | None, u: dict, label: str, tag: str | None = None):
    """Наказ про стягнення — одне повідомлення в каналі дисципліни: картка з аркушем А4, теги (хто наклав, на кого,
    обрана роль/відділ, роль СБУ — якщо оголосив Голова чи заступник); скарга й рішення оновлюють картку з відповіддю."""
    o = await db.one("SELECT * FROM discipline WHERE id=?", o["id"]) or o
    e = await ns_embed(o, target)
    first = label == "Оголошено наказ"
    await docpost.journal("ns", o["id"], await core.channel("disc"), e, users=await docpost.people(o["issued_by"], o["sid"]), tag=tag,
                          roles=docpost.key_roles("order") if first and u["rank"] >= 14 else None,
                          ping=None if first else f"🔔 {label}.")


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
INSP_KINDS = {"invest": "Службове розслідування", "check": "Службова перевірка"}
INSP_STATUS = {"open": "У провадженні", "paused": "Зупинено", "head": "На погодженні начальника ВВБ", "sent": "Направлено Голові СБУ",
               "closed": "Висновок затверджено", "deleted": "Видалено"}
MAT_TYPES = ["Відеозапис з боді-камери", "Пояснення фігуранта", "Пояснення свідків / потерпілих", "Протокол допиту",
             "Відеозапис допиту", "Рапорт", "Розпорядження / інший документ", "Інше"]
GRIFS = {"top": "Цілком таємно", "secret": "Таємно", "dsk": "Для службового користування"}
# текстові поля справи: ключ → максимальна довжина
INSP_TEXT = {"basis": 300, "qual": 300, "when": 120, "place": 200, "fabula": 6000, "statute": 2000, "regs": 2000, "crim": 1000,
             "mitig": 1000, "aggr": 1000, "callsign": 40}


def can_resolve(u: dict) -> bool:
    """Затвердити висновок службового розслідування або повернути його на доопрацювання (резолюція Голови)."""
    return u["rank"] >= ov.P("insp_approve") and not u.get("curator_ro")


def is_vvb_head(u: dict) -> bool:
    """Начальник ВВБ або заступник (з роллю ВВБ) — погоджує висновок перед направленням Голові."""
    return u["rank"] in (11, 12) and "vvb" in depts_of(u)


def _j(v, d):
    try:
        x = json.loads(v or d)
        return x if isinstance(x, type(json.loads(d))) else json.loads(d)
    except ValueError:
        return json.loads(d)


async def insp_get(iid: int) -> dict:
    i = await db.one("SELECT * FROM inspections WHERE id=?", iid)
    if not i or i["status"] == "deleted":
        raise Fail("Перевірку не знайдено.", 404)
    i["files"] = _j(i["files"], "[]")
    i["data"] = _j(i.get("data"), "{}")
    i["visas"] = _j(i.get("visas"), "[]")
    i["history"] = _j(i.get("history"), "[]")
    return i


def _ihist(i: dict | None, u: dict, action: str, note: str = "") -> str:
    h = (i["history"] if i else []) + [{"t": now_ms(), "sid": u["sid"], "name": u["name"], "rank": u["rank"], "rankName": rank_name(u["rank"]),
                                        "action": action, "note": note[:1000]}]
    return json.dumps(h, ensure_ascii=False)


async def _regno() -> str:
    """Реєстраційний номер справи: ВВБ-РІК-NNN (наскрізна нумерація в межах року)."""
    year = datetime.now(core.TZ).year if getattr(core, "TZ", None) else datetime.now(timezone.utc).year
    n = (await db.one("SELECT COUNT(*) AS n FROM inspections WHERE regno LIKE ?", f"ВВБ-{year}-%"))["n"]
    return f"ВВБ-{year}-{n + 1:03d}"


async def insp_save(u: dict, b: dict, iid: int | None = None) -> dict:
    if not is_vvb(u):
        raise Fail("Службові перевірки й розслідування проводить ВВБ.", 403)
    try:
        target = await core.user(int(b.get("sid") or 0))
    except (TypeError, ValueError):
        target = None
    if not target:
        raise Fail("Оберіть співробітника (фігуранта).")
    s = lambda k, n: str(b.get(k) or "").strip()[:n]
    rec = b.get("recommend") if b.get("recommend") in KINDS else None
    kind = b.get("kind") if b.get("kind") in INSP_KINDS else "invest"
    data = {k: s(k, n) for k, n in INSP_TEXT.items()}
    data["grif"] = b.get("grif") if b.get("grif") in GRIFS else "top"
    data["opened"] = s("opened", 20)
    mats = []
    for m in (b.get("mats") or [])[:30]:
        if not isinstance(m, dict):
            continue
        row = {"type": m.get("type") if m.get("type") in MAT_TYPES else "Інше", "desc": str(m.get("desc") or "").strip()[:500],
               "ref": str(m.get("ref") or "").strip()[:500]}
        if row["desc"] or row["ref"]:
            mats.append(row)
    data["mats"] = mats
    title = s("title", 120)
    if not title:
        raise Fail("Вкажіть предмет розслідування (коротко).")
    vals = (target["sid"], title, s("materials", 5000), s("conclusion", 4000), rec,
            json.dumps([str(f)[:40] for f in (b.get("files") or [])[:10]]), kind, json.dumps(data, ensure_ascii=False))
    if iid:
        async with core.doc_lock("insp", iid):
            i = await insp_get(iid)
            if i["status"] not in ("open", "paused"):
                raise Fail("Справу вже передано на погодження — редагувати не можна.")
            await db.run("UPDATE inspections SET sid=?, title=?, materials=?, conclusion=?, recommend=?, files=?, kind=?, data=?, history=?, updated=? WHERE id=?",
                         *vals, _ihist(i, u, "edit"), now_ms(), iid)
    else:
        iid = await db.run("INSERT INTO inspections(sid,title,materials,conclusion,recommend,files,kind,data,status,author,created,updated,regno,visas,history) "
                           "VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", *vals, "open", u["sid"], now_ms(), now_ms(), await _regno(), "[]",
                           _ihist(None, u, "create"))
    return await insp_get(iid)


async def insp_move(u: dict, iid: int, to: str, note: str = "") -> dict:
    """Рух справи: open ⇄ paused → head (начальник ВВБ) → sent (Голова) → closed; повернення на доопрацювання — до open."""
    async with core.doc_lock("insp", iid):
        i = await insp_get(iid)
        st, chief = i["status"], u["rank"] >= ov.P("disc_chief")
        resolve = can_resolve(u)  # резолюція по висновку (Голова; поріг — адмін-панель → Доступи «insp_approve»)
        note = (note or "").strip()
        if to == "paused" and st == "open" and is_vvb(u):
            await db.run("UPDATE inspections SET status='paused', history=?, updated=? WHERE id=?", _ihist(i, u, "pause", note), now_ms(), iid)
        elif to == "open" and st == "paused" and is_vvb(u):
            await db.run("UPDATE inspections SET status='open', history=?, updated=? WHERE id=?", _ihist(i, u, "resume", note), now_ms(), iid)
        elif to in ("head", "sent") and st == "open" and is_vvb(u) and (to == "head" or not i["visas"]):
            if not i["conclusion"]:
                raise Fail("Додайте висновок розслідування.")
            # начальник / заступник ВВБ (або керівництво) направляє одразу Голові — це і є погодження відділу
            direct = is_vvb_head(u) or chief
            nxt = "sent" if direct else "head"
            visas = i["visas"] + ([{"stage": "head", "sid": u["sid"], "name": u["name"], "rankName": rank_name(u["rank"]), "t": now_ms()}] if direct else [])
            await db.run("UPDATE inspections SET status=?, visas=?, completed=?, history=?, updated=? WHERE id=?", nxt,
                         json.dumps(visas, ensure_ascii=False), now_ms(), _ihist(i, u, "submit"), now_ms(), iid)
            await insp_notice(await insp_get(iid), u, "head" if nxt == "head" else "sent")
        elif to == "sent" and st == "head" and (is_vvb_head(u) or chief):
            if i["author"] == u["sid"] and not chief:
                raise Fail("Власну справу погоджує інший керівник ВВБ.", 403)
            visas = i["visas"] + [{"stage": "head", "sid": u["sid"], "name": u["name"], "rankName": rank_name(u["rank"]), "t": now_ms()}]
            await db.run("UPDATE inspections SET status='sent', visas=?, history=?, updated=? WHERE id=?",
                         json.dumps(visas, ensure_ascii=False), _ihist(i, u, "visa", note), now_ms(), iid)
            await insp_notice(await insp_get(iid), u, "sent")
        elif to == "closed" and st == "sent" and resolve:
            res = {"decision": "approve", "comment": note[:1000], "sid": u["sid"], "name": u["name"], "rankName": rank_name(u["rank"]), "t": now_ms()}
            await db.run("UPDATE inspections SET status='closed', resolution=?, history=?, updated=? WHERE id=?",
                         json.dumps(res, ensure_ascii=False), _ihist(i, u, "approve", note), now_ms(), iid)
        elif to == "return" and ((st == "head" and (is_vvb_head(u) or chief)) or (st == "sent" and resolve)):
            if not note:
                raise Fail("Вкажіть, що доопрацювати.")
            res = {"decision": "return", "comment": note[:1000], "sid": u["sid"], "name": u["name"], "rankName": rank_name(u["rank"]), "t": now_ms()} \
                if st == "sent" else None
            await db.run("UPDATE inspections SET status='open', visas='[]', resolution=?, history=?, updated=? WHERE id=?",
                         json.dumps(res, ensure_ascii=False) if res else None, _ihist(i, u, "return", note), now_ms(), iid)
        elif to == "deleted" and (chief or (i["author"] == u["sid"] and st in ("open", "paused"))):
            await db.run("UPDATE inspections SET status='deleted', history=?, updated=? WHERE id=?", _ihist(i, u, "delete"), now_ms(), iid)
            return i
        else:
            raise Fail("Такий перехід неможливий.", 403)
    return await insp_get(iid)


async def insp_notice(i: dict, u: dict, stage: str = "sent"):
    """Сповіщення без змісту матеріалів: на погодження начальнику ВВБ (канал ВВБ) або Голові (канал дисципліни)."""
    ch = await core.channel("vvb" if stage == "head" else "disc")
    if not ch:
        return
    t = await core.user(i["sid"])
    lines = [style.kv("СПРАВА", f"{i.get('regno') or 'СП-%04d' % i['id']} · {i['title'][:40]}", "white", True),
             style.kv("ЩОДО", f"{t['name']} · №{t['sid']}" if t else f"№{i['sid']}", "white"),
             style.kv("РЕКОМЕНДАЦІЯ", KINDS[i["recommend"]][0] if i.get("recommend") else "без стягнення", "gold", True),
             style.rule(), style.kv("НАПРАВИВ", f"{u['name']} · ВВБ", "white"), style.kv("ДАТА", style.when(), "gray")]
    head = INSP_KINDS.get(i.get("kind") or "check", "Службова перевірка").upper()
    title = f"{head} · " + ("НА ПОГОДЖЕННЯ НАЧАЛЬНИКА ВВБ" if stage == "head" else "НА РІШЕННЯ ГОЛОВИ")
    e = style.document(title, 0x6F9FD6, desc=style.block(*lines), footer="Матеріали — в ЄІС «Сова» → Дисципліна → Службові перевірки")
    try:
        await ch.send(embed=e, **(core.mention("insp") if stage == "sent" else {"allowed_mentions": discord.AllowedMentions.none()}))
    except discord.HTTPException as ex:
        log.warning("Сповіщення про перевірку: %s", ex)


async def background(sid: int) -> dict:
    """Дисциплінарне минуле фігуранта: активні догани (блокують підвищення) і попередні стягнення."""
    rows = await db.all("SELECT kind, status, expires, issued FROM discipline WHERE sid=? AND status!='deleted' ORDER BY issued DESC", sid)
    now = now_ms()
    act = [r for r in rows if r["status"] == "active" and r["kind"] in BLOCKING and (r["expires"] or 0) > now]
    past = [KINDS[r["kind"]][0] for r in rows if r not in act and r["kind"] in KINDS]
    return {"active": len(act), "past": past[:10]}


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
    if u["rank"] >= ov.P("disc_journal_all") or is_vvb(u):
        journal_rows = rows
    elif u["rank"] >= ov.P("disc_journal"):
        ds = depts_of(u)
        journal_rows = [o for o in rows if o["dept"] in ds]
    else:
        journal_rows = []
    insp = await db.all("SELECT * FROM inspections WHERE status!='deleted' ORDER BY updated DESC LIMIT 100") if (is_vvb(u) or u["rank"] >= 14 or can_resolve(u)) else []
    for i in insp:
        i["files"], i["data"], i["visas"], i["history"] = _j(i["files"], "[]"), _j(i.get("data"), "{}"), _j(i.get("visas"), "[]"), _j(i.get("history"), "[]")
        i["resolution"] = _j(i.get("resolution"), "{}") or None
        i["background"] = await background(i["sid"])
    sids = {o["sid"] for o in rows} | {o["issued_by"] for o in rows} | {i["sid"] for i in insp} | {i["author"] for i in insp}
    people = {}
    for sid in sids:
        p = await core.user(sid)
        if p:
            people[sid] = {"sid": sid, "name": p["name"], "rank": p["rank"], "rankName": rank_name(p["rank"]), "dept": p["dept"],
                           "callsign": p.get("callsign")}
    return {
        "mine": [out(o, people) for o in mine],
        "journal": [out(o, people) for o in journal_rows],
        "inspections": [{**i, "target": people.get(i["sid"]), "author": people.get(i["author"])} for i in insp],
        "insp": {"kinds": INSP_KINDS, "status": INSP_STATUS, "mats": MAT_TYPES, "grifs": GRIFS},
        "rights": {"journal": can_journal(u), "vvb": is_vvb(u), "vvbHead": is_vvb_head(u), "resolve": can_resolve(u), "chief": u["rank"] >= ov.P("disc_chief"), "head": u["rank"] == 15,
                   "kinds": kinds_for(u)},
        "kinds": {k: v[0] for k, v in KINDS.items()},
        "violations": [{"id": v[0], "t": v[1], "kinds": v[2], "fine": v[3]} for v in VIOLATIONS],
    }
