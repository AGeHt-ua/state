"""Накази про призначення на посаду, присвоєння звання й переведення (Статут СБУ, р. V; п. 5.2).

Хто готує: заступник начальника й начальник відділу — щодо співробітників свого відділу (нове звання нижче власного),
начальник управління — своїх відділів, ВКПП і керівництво СБУ — будь-кого.
Маршрут проєкту: [віза начальника відділу, куди переводять] → [начальник управління за напрямком] → підпис
Заступника Голови або Голови СБУ (одного підпису досить). Наказ, який складає Голова чи Заступник, може бути підписаний одразу.
Після підпису бот змінює звання, підрозділ, ролі, нікнейм і кадровий аудит. Відхилений проєкт ініціатор може виправити
й подати знову. Скасування наказу повертає попереднє звання й підрозділ, якщо після наказу їх ніхто не змінював."""
import json
import logging

import discord

import core
import docpost
import overrides as ov
import style
from core import Fail
from db import db, now_ms
from roles import DEPTS, OPS_DEPTS, rank_name

log = logging.getLogger("sova.orders")


OTYPES = {"appoint": "Про призначення на посаду", "promo": "Про присвоєння чергового звання", "transfer": "Про переведення"}
STAGE_NAME = {"to": "віза начальника відділу, куди переводять", "mgmt": "погодження начальника управління",
              "sign": "підпис Голови або Заступника Голови"}


def can_sign(u: dict) -> bool:
    """Підписують накази Голова СБУ та Заступник Голови (поріг — в адмін-панелі)."""
    return u["rank"] >= ov.P("order_sign")


def _role_depts(u: dict) -> list[str]:
    import depts  # тут, щоб уникнути циклічного імпорту
    return [d for d in depts.role_depts(u) if d in OPS_DEPTS]


def mgmt_route() -> set[str]:
    """Відділи, накази щодо яких погоджує начальник управління (ОРВ, ДЕБ або як задано в адмін-панелі → «Управління»)."""
    import cases
    return set(cases.MGMT_DEPTS) | {d for v in ov.mgmt.values() for d in v}


def is_mgmt_for(u: dict, dept: str | None) -> bool:
    import depts
    return u["rank"] == 13 and dept in mgmt_route() and dept in depts.mgmt_depts(u)


def is_head_of(u: dict, dept: str | None) -> bool:
    """Заступник начальника або начальник відділу з роллю цього відділу."""
    return u["rank"] in (11, 12) and dept in _role_depts(u)


def scope(u: dict) -> dict | None:
    """Щодо кого людина може готувати накази: усіх (ВКПП, керівництво) або співробітників своїх відділів,
    молодших за неї (нове звання — теж нижче за її власне)."""
    if u.get("curator_ro") or u["dept"] in ("prosecutor", "curator"):
        return None
    if can_sign(u) or core.has_dept_role(u, "vkpp"):
        return {"all": True, "depts": [], "maxRank": 15}
    if u["rank"] == 13:
        import depts
        ds = [d for d in depts.mgmt_depts(u) if d in OPS_DEPTS]
        return {"all": False, "depts": ds, "maxRank": 13} if ds else None
    if u["rank"] in (11, 12):
        ds = _role_depts(u)
        return {"all": False, "depts": ds, "maxRank": u["rank"]} if ds else None
    return None


def can_prepare(u: dict) -> bool:
    return scope(u) is not None


def can_appoint(u: dict) -> bool:
    return can_prepare(u)


def _route(o: dict) -> list[str]:
    return [s for s in str(o.get("route") or "sign").split(",") if s] or ["sign"]


def stage_of(o: dict) -> str:
    return o.get("stage") or "sign"  # проєкти, створені до маршрутів, — одразу на підписі


def can_act(u: dict, o: dict) -> bool:
    """Чи може людина зараз погодити / підписати / відхилити проєкт (свій етап; керівництво — будь-який етап)."""
    if o["status"] != "draft" or o["sid"] == u["sid"]:
        return False
    st = stage_of(o)
    if st == "sign":
        return can_sign(u)
    if o["by_sid"] == u["sid"] and not can_sign(u):
        return False  # ніхто не погоджує власний проєкт
    if can_sign(u):
        return True
    if st == "to":
        return is_head_of(u, o["to_dept"]) or is_mgmt_for(u, o["to_dept"])
    if st == "mgmt":
        return is_mgmt_for(u, o["from_dept"]) or is_mgmt_for(u, o["to_dept"])
    return False


def can_view(u: dict, o: dict) -> bool:
    if can_sign(u) or core.has_dept_role(u, "vkpp") or o["by_sid"] == u["sid"]:
        return True
    ds = {o["from_dept"], o["to_dept"], *extra_list(o.get("extra"))}
    return any(is_head_of(u, d) or is_mgmt_for(u, d) for d in ds)


MGMT_MAX = 3  # скільки відділів може вести один начальник управління


def extra_list(extra) -> list[str]:
    """Відділи з поля extra наказу: «deb» (другий відділ начальника відділу) або «atc,alpha» (відділи начальника управління)."""
    raw = extra if isinstance(extra, (list, tuple)) else str(extra or "").split(",")
    return list(dict.fromkeys(k.strip() for k in raw if str(k).strip() in OPS_DEPTS))


def to_label(o: dict) -> str:
    """«Начальник управління · ЦСО «А», АТЦ» / «Начальник відділу · ОРВ + ДЕБ»."""
    xs = [DEPTS[k]["s"] for k in extra_list(o.get("extra"))]
    if o["to_dept"] == "lead":
        return f"{rank_name(o['to_rank'])} · {DEPTS['lead']['s']}" + (f" ({', '.join(xs)})" if xs else "")
    return f"{rank_name(o['to_rank'])} · {DEPTS[o['to_dept']]['s']}" + "".join(f" + {x}" for x in xs)


async def appoint(u: dict, b: dict) -> dict:
    """Проєкт наказу (призначення, присвоєння звання, переведення). Якщо готує Голова чи Заступник і просить
    підписати одразу — наказ одразу набирає чинності; інакше йде маршрутом погодження."""
    sc = scope(u)
    if not sc:
        raise Fail("Накази готують заступники начальників і начальники відділів, начальники управлінь, ВКПП та керівництво СБУ.", 403)
    otype = b.get("otype") if b.get("otype") in OTYPES else "appoint"
    try:
        p = await core.user(int(b.get("sid") or 0))
    except (TypeError, ValueError):
        p = None
    if not p or p["status"] == "dismissed" or p["dept"] in ("prosecutor", "curator"):
        raise Fail("Співробітника не знайдено.")
    if p["sid"] == u["sid"]:
        raise Fail("Призначити самого себе не можна.")
    if p["rank"] == 15:
        raise Fail("Звання Голови СБУ наказом про призначення не змінюється.", 403)
    if not sc["all"]:
        if p["dept"] not in sc["depts"]:
            raise Fail("Накази ви готуєте лише щодо співробітників своїх відділів.", 403)
        if p["rank"] >= sc["maxRank"]:
            raise Fail("Наказ щодо рівного чи старшого за званням готує вище керівництво.", 403)
    if otype == "promo":
        to_rank, to_dept = p["rank"] + 1, p["dept"]
        if to_rank >= 13:
            raise Fail("Керівні звання (від начальника управління) — через «Призначення на посаду».")
    elif otype == "transfer":
        to_rank, to_dept = p["rank"], b.get("dept")
        if p["rank"] >= 13:
            raise Fail("Керівництво СБУ не переводиться між відділами — оберіть «Призначення на посаду».")
        if to_dept not in OPS_DEPTS or to_dept == p["dept"]:
            raise Fail("Оберіть відділ, куди переводиться співробітник (інший, ніж зараз).")
    else:
        try:
            to_rank = int(b.get("rank") or 0)
        except (TypeError, ValueError):
            to_rank = 0
        to_dept = b.get("dept") or p["dept"]
    if not 1 <= to_rank <= 14:
        raise Fail("Оберіть звання від 1 до 14 (звання Голови наказом не присвоюється).")
    if not sc["all"] and to_rank >= sc["maxRank"]:
        raise Fail("Нове звання має бути нижчим за ваше власне — такий наказ готує вище керівництво.", 403)
    if to_rank >= 13:
        to_dept = "lead"
    elif to_rank <= 4 and to_dept not in OPS_DEPTS:
        to_dept = "academy"
    elif to_dept not in OPS_DEPTS:
        raise Fail("Оберіть підрозділ.")
    if to_rank == 13:
        # Начальник управління веде свої відділи (напр. ЦСО «А» + АТЦ або ОРВ + ДЕБ): бот видасть ролі саме цих відділів
        extra = ",".join(extra_list(b.get("extra"))[:MGMT_MAX]) or None
        if not extra:
            raise Fail("Оберіть відділи, якими керуватиме начальник управління.")
    else:
        extra = b.get("extra") if to_rank == 12 and b.get("extra") in OPS_DEPTS and b.get("extra") != to_dept else None
    if to_rank == p["rank"] and to_dept == p["dept"] and not extra:
        raise Fail("Звання й підрозділ не змінюються.")
    if not sc["all"] and otype == "appoint" and to_dept not in (*sc["depts"], "academy"):
        raise Fail("Призначити в інший відділ — це «Переведення» (з візою начальника того відділу).", 403)
    route = []
    if to_dept in OPS_DEPTS and to_dept != p["dept"] and not (can_sign(u) or is_head_of(u, to_dept) or is_mgmt_for(u, to_dept)):
        route.append("to")
    if {p["dept"], to_dept} & mgmt_route() and u["rank"] < 13:
        route.append("mgmt")
    route.append("sign")
    if await db.one("SELECT id FROM orders WHERE sid=? AND status='draft'", p["sid"]):
        raise Fail("На цього співробітника вже є проєкт наказу на підписі.")
    reason = str(b.get("reason") or "").strip()[:800]
    oid = await db.run("INSERT INTO orders(sid,kind,from_rank,to_rank,from_dept,to_dept,extra,reason,by_sid,t,status,otype,stage,route,visas) "
                       "VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", p["sid"], "appoint", p["rank"], to_rank, p["dept"], to_dept, extra, reason,
                       u["sid"], now_ms(), "draft", otype, route[0], ",".join(route), "[]")
    if b.get("sign") and can_sign(u):
        await db.run("UPDATE orders SET stage='sign' WHERE id=?", oid)
        return await sign(u, oid, tag=b.get("tag"))
    o = await get(oid)
    await journal(o, u, f"Проєкт наказу підготовлено · далі: {STAGE_NAME[route[0]]}", tag=b.get("tag"))
    return o


def _visas(o: dict) -> list[dict]:
    try:
        v = json.loads(o.get("visas") or "[]")
        return v if isinstance(v, list) else []
    except ValueError:
        return []


@core.serialized("np")
async def approve(u: dict, oid: int) -> dict:
    """Віза на проміжному етапі (начальник відділу, куди переводять; начальник управління) — проєкт іде далі маршрутом."""
    o = await get(oid)
    st = stage_of(o)
    if st == "sign":
        raise Fail("Проєкт уже на підписі Голови або Заступника Голови.")
    if not can_act(u, o):
        raise Fail("Цей проєкт зараз не на вашому погодженні.", 403)
    route = _route(o)
    nxt = route[route.index(st) + 1] if st in route and route.index(st) + 1 < len(route) else "sign"
    visas = _visas(o) + [{"stage": st, "sid": u["sid"], "name": u["name"], "rank": u["rank"], "t": now_ms()}]
    await db.run("UPDATE orders SET stage=?, visas=? WHERE id=? AND status='draft'", nxt, json.dumps(visas, ensure_ascii=False), oid)
    o = await get(oid)
    await journal(o, u, f"Погоджено ({STAGE_NAME[st]}) · далі: {STAGE_NAME[nxt]}")
    return o


@core.serialized("np")
async def resubmit(u: dict, oid: int) -> dict:
    """Відхилений проєкт ініціатор подає знову — маршрут починається спочатку."""
    o = await get(oid)
    if o["by_sid"] != u["sid"] or o["status"] != "rejected":
        raise Fail("Подати знову можна лише власний відхилений проєкт.", 403)
    if await db.one("SELECT id FROM orders WHERE sid=? AND status='draft' AND id!=?", o["sid"], oid):
        raise Fail("На цього співробітника вже є інший проєкт наказу.")
    await db.run("UPDATE orders SET status='draft', stage=?, visas='[]', note=NULL, signed_by=NULL, signed=NULL WHERE id=?", _route(o)[0], oid)
    o = await get(oid)
    await journal(o, u, f"Проєкт подано знову · далі: {STAGE_NAME[stage_of(o)]}")
    return o


@core.serialized("np")
async def sign(u: dict, oid: int, tag: str | None = None) -> dict:
    """Підпис наказу Головою або заступником: звання, підрозділ, ролі й нікнейм змінюються одразу."""
    if not can_sign(u):
        raise Fail("Підписують накази Голова СБУ та Заступник Голови.", 403)
    o = await get(oid)
    if o["status"] != "draft":
        raise Fail("Цей проєкт уже розглянуто.")
    if stage_of(o) != "sign" and u["rank"] != 15:
        raise Fail(f"Проєкт ще на етапі: {STAGE_NAME[stage_of(o)]}. Погодьте цей етап або дочекайтеся його.")
    p = await core.user(o["sid"])
    if not p or p["status"] == "dismissed":
        raise Fail("Співробітника вже немає у складі.")
    if p["sid"] == u["sid"]:
        raise Fail("Підписати наказ щодо себе не можна.")
    if u["rank"] != 15 and (p["rank"] >= u["rank"] or o["to_rank"] >= u["rank"]):
        # Заступник Голови не змінює звання рівних і старших і не призначає на звання, рівне своєму
        raise Fail("Цей наказ (щодо рівного чи старшого за званням або на звання не нижче вашого) підписує Голова СБУ.", 403)
    t = now_ms()
    # «Було» фіксуємо на момент підпису — з проєкту звання могло змінитися
    await db.run("UPDATE orders SET status='active', stage='sign', from_rank=?, from_dept=?, signed_by=?, signed=? WHERE id=?", p["rank"], p["dept"], u["sid"], t, oid)
    await db.run("UPDATE users SET rank=?, dept=?, since=? WHERE sid=?", o["to_rank"], o["to_dept"], t if o["to_rank"] != p["rank"] else p["since"], p["sid"])
    keep = {o["to_dept"], *extra_list(o["extra"])}
    if o["to_rank"] == 13 and o["extra"]:
        drop = [k for k in OPS_DEPTS if k not in keep]  # начальник управління — ролі лише своїх відділів, інші знімаємо
    else:
        drop = [p["dept"]] if p["dept"] in OPS_DEPTS and p["dept"] not in keep else []
    roles_res = await apply_roles(p["sid"], o["extra"], f"Сова: наказ НП-{oid:04d}", drop_extra=drop)
    await db.audit(u["sid"], "Призначення на посаду", p["sid"],
                   f"{rank_name(p['rank'])} / {DEPTS[p['dept']]['s']} → {to_label(o).replace(' · ', ' / ', 1)} · НП-{oid:04d}")
    o = await get(oid)
    await journal(o, u, "Наказ підписано й оголошено", tag=tag)
    await core.send_audit(await core.user(p["sid"]), u)
    if warn := core.roles_problem(roles_res):
        await db.audit(u["sid"], "⚠ Ролі не збігаються з наказом", p["sid"], f"НП-{oid:04d}: {warn}"[:500])
    return {**o, "rolesWarning": warn}


@core.serialized("np")
async def reject(u: dict, oid: int, note: str) -> dict:
    o = await get(oid)
    if o["status"] != "draft":
        raise Fail("Цей проєкт уже розглянуто.")
    if not can_act(u, o):
        raise Fail("Відхилити може той, на чиєму погодженні зараз проєкт.", 403)
    if not (note or "").strip():
        raise Fail("Вкажіть причину — її побачить той, хто готував проєкт.")
    await db.run("UPDATE orders SET status='rejected', signed_by=?, signed=?, note=? WHERE id=?", u["sid"], now_ms(), (note or "")[:300], oid)
    o = await get(oid)
    await journal(o, u, "Проєкт наказу відхилено" + (f": {note}" if note else ""))
    return o


@core.serialized("np")
async def delete_draft(u: dict, oid: int):
    o = await get(oid)
    if o["status"] not in ("draft", "rejected"):
        raise Fail("Підписаний наказ не видаляється — його можна лише скасувати.")
    if not (o["by_sid"] == u["sid"] or can_sign(u)):
        raise Fail("Видалити проєкт може той, хто його підготував, або Голова й заступник.", 403)
    await db.run("UPDATE orders SET status='deleted', cancelled_by=?, cancelled=? WHERE id=?", u["sid"], now_ms(), oid)
    await docpost.remove("np", oid)  # проєкт видалено — і його повідомлення в Discord


async def apply_roles(sid: int, extra, reason: str, drop_extra=None) -> dict:
    """Ролі за наказом: звання й відділ з картки + додаткові відділи (extra: другий відділ начальника відділу
    або відділи начальника управління) / зняти колишні (drop_extra). Ролі, потрібні за карткою, не знімаються ніколи.
    Одна сувора синхронізація з перевіркою після змін (core.sync_roles)."""
    p = await core.user(sid)
    role = lambda ks: {DEPTS[k]["role"] for k in extra_list(ks) if DEPTS[k].get("role")}
    add = role(extra)
    drop = role(drop_extra) - add - core.roles_for(p["rank"], p["dept"])
    return await core.sync_roles(p, reason, extra_add=add, extra_remove=drop)


async def get(oid: int) -> dict:
    o = await db.one("SELECT * FROM orders WHERE id=?", oid)
    if not o or o["status"] == "deleted":
        raise Fail("Наказ не знайдено.", 404)
    return o


@core.serialized("np")
async def cancel(u: dict, oid: int) -> dict:
    """Скасування наказу: повертає попереднє звання/підрозділ, якщо поточні ще такі, як призначив наказ."""
    if not can_sign(u):
        raise Fail("Скасувати наказ може Голова СБУ або Заступник Голови.", 403)
    o = await get(oid)
    if o["status"] != "active":
        raise Fail("Наказ уже скасовано.")
    p = await core.user(o["sid"])
    if u["rank"] != 15 and p and (p["rank"] >= u["rank"] or (o["from_rank"] or 0) >= u["rank"]):
        raise Fail("Скасувати наказ щодо рівного чи старшого за званням може лише Голова СБУ.", 403)
    reverted = bool(p and p["rank"] == o["to_rank"] and p["dept"] == o["to_dept"] and p["status"] != "dismissed")
    warn = None
    if reverted:
        await db.run("UPDATE users SET rank=?, dept=?, since=? WHERE sid=?", o["from_rank"], o["from_dept"], now_ms(), o["sid"])
        warn = core.roles_problem(await apply_roles(o["sid"], None, f"Сова: скасування наказу НП-{oid:04d}", drop_extra=o["extra"]))
    await db.run("UPDATE orders SET status='deleted', cancelled_by=?, cancelled=? WHERE id=?", u["sid"], now_ms(), oid)
    await db.audit(u["sid"], "Скасовано наказ про призначення", o["sid"],
                   f"НП-{oid:04d}" + (" · звання й підрозділ повернуто" if reverted else " · звання вже змінювалось, повернення не виконано"))
    await journal(o, u, "Наказ скасовано" + (" · попереднє звання повернуто" if reverted else ""))
    return {"reverted": reverted, "rolesWarning": warn}


NP_STATE = {"draft": ("🕓 Проєкт · на підписі", style.GOLD), "active": ("✅ Підписано · чинний", style.GREEN),
            "rejected": ("⛔ Проєкт відхилено", style.RED), "deleted": ("↩ Наказ скасовано", style.GRAY)}


async def np_embed(o: dict, label: str) -> discord.Embed:
    """Картка наказу про призначення — єдиний зразок документа (style.card)."""
    p, by = await core.user(o["sid"]), await core.user(o["by_sid"])
    sg = await core.user(o["signed_by"]) if o.get("signed_by") else None
    state, color = NP_STATE.get(o["status"], NP_STATE["draft"])
    if o["status"] == "draft":
        state = f"🕓 Проєкт · {STAGE_NAME[stage_of(o)]}"
    if sg:
        state += f" · {style.esc(sg['name'])} · {style.when(o.get('signed'))}"
    to = to_label(o)
    return style.card(f"НП-{o['id']:04d}", "Наказ · " + OTYPES.get(o.get("otype") or "appoint", OTYPES["appoint"]).lower(), state, color, t=o.get("signed") or o["t"],
                      note=f"Причина: {style.esc(o['note'])}" if o["status"] == "rejected" and o.get("note") else None, fields=[
        ("Співробітник", style.person(p) if p else f"№{o['sid']}"),
        ("Було", f"{rank_name(o['from_rank'])} · {DEPTS[o['from_dept']]['s']}"),
        ("Призначено", f"**{to}**"),
        ("Підготував", style.person(by)),
        ("Візи", " · ".join(f"{style.esc(v.get('name', ''))} ({STAGE_NAME.get(v.get('stage'), '')})" for v in _visas(o)) or None, False),
        ("Підстава", style.esc(o["reason"][:300]) if o.get("reason") else None, False),
    ])


async def journal(o: dict, u: dict, label: str, tag: str | None = None):
    """Одне повідомлення на наказ: створюється з тегами (автор, співробітник, обрана роль/відділ), далі лише оновлюється.
    Підпис, відхилення й скасування — ще й коротка відповідь зі сповіщенням."""
    o = await db.one("SELECT * FROM orders WHERE id=?", o["id"]) or o
    st = o["status"]
    await docpost.journal("np", o["id"], await core.channel("orders"), await np_embed(o, label),
                          users=await docpost.people(o["by_sid"], o["sid"]), tag=tag,
                          roles=docpost.key_roles("order" if st == "active" else "order:draft" if st == "draft" else None),
                          ping={"active": "✅ Наказ підписано.", "rejected": "⛔ Проєкт наказу відхилено.", "deleted": "↩ Наказ скасовано."}.get(st),
                          ping_roles=docpost.key_roles("order") if st == "active" else None)


async def pending(u: dict) -> int:
    return len([o for o in await db.all("SELECT * FROM orders WHERE kind='appoint' AND status='draft'") if can_act(u, o)])


async def listing(u: dict) -> list[dict]:
    rows = [o for o in await db.all("SELECT * FROM orders WHERE kind='appoint' AND status!='deleted' ORDER BY t DESC LIMIT 300") if can_view(u, o)][:100]
    out = []
    for o in rows:
        p, by = await core.user(o["sid"]), await core.user(o["by_sid"])
        sg = await core.user(o["signed_by"]) if o.get("signed_by") else None
        out.append({**o, "name": p["name"] if p else f"№{o['sid']}", "byName": by["name"] if by else "—", "signedName": sg["name"] if sg else None,
                    "curRank": rank_name(p["rank"]) if p else "",
                    "fromRank": rank_name(o["from_rank"]), "toRank": rank_name(o["to_rank"]), "extras": extra_list(o.get("extra")),
                    "otype": o.get("otype") or "appoint", "otypeName": OTYPES.get(o.get("otype") or "appoint"),
                    "stage": stage_of(o), "stageName": STAGE_NAME[stage_of(o)], "route": [STAGE_NAME[s] for s in _route(o)], "visas": _visas(o),
                    "canAct": can_act(u, o), "canSign": can_act(u, o) and (stage_of(o) == "sign" or u["rank"] == 15)})
    return out


# ---------------------------------------------------------------- довільні накази Голови / Заступника (НГ-…)
async def create_free(u: dict, b: dict) -> dict:
    if not can_sign(u):
        raise Fail("Накази видають Голова СБУ та Заступник Голови.", 403)
    title = str(b.get("title") or "").strip()[:150]
    text = str(b.get("body") or "").strip()[:3500]
    if not title or len(text) < 10:
        raise Fail("Вкажіть назву наказу й текст.")
    oid = await db.run("INSERT INTO orders(sid,kind,title,body,by_sid,t,status) VALUES(?,?,?,?,?,?,?)",
                       u["sid"], "free", title, text, u["sid"], now_ms(), "active")
    o = await get(oid)
    await free_post(o, u, tag=b.get("tag"))
    await db.audit(u["sid"], "Наказ Голови СБУ", 0, f"НГ-{oid:04d} · {title[:80]}")
    return o


def ng_embed(o: dict, by: dict | None, cancelled_by: dict | None = None) -> discord.Embed:
    """Картка наказу Голови — єдиний зразок документа; повний текст — на аркуші А4 у картці."""
    state, color = ("↩ Наказ скасовано", style.GRAY) if cancelled_by else ("✅ Підписано · обов'язковий до виконання", style.GREEN)
    if cancelled_by:
        state += f" · {style.esc(cancelled_by['name'])} · {style.when()}"
    return style.card(f"НГ-{o['id']:04d}", "Наказ Голови СБУ", state, color, t=o["t"], fields=[
        ("Назва", f"**«{style.esc(o['title'])}»**", False),
        ("Підписав", style.person(by)),
        ("Дата", style.when(o["t"])),
    ])


async def free_post(o: dict, u: dict, cancelled: bool = False, tag: str | None = None):
    """Одне повідомлення на наказ Голови: при оголошенні — теги (автор, «order» з панелі, обрана роль/відділ), скасування — оновлення картки."""
    by = await core.user(o["by_sid"])
    await docpost.journal("ng", o["id"], await core.channel("orders"), ng_embed(o, by, u if cancelled else None),
                          users=await docpost.people(o["by_sid"]), tag=tag, roles=docpost.key_roles(None if cancelled else "order"),
                          ping="↩ Наказ скасовано." if cancelled else None)


async def delete_free(u: dict, oid: int):
    o = await get(oid)
    if o["kind"] != "free":
        raise Fail("Це не наказ Голови.", 400)
    if not (o["by_sid"] == u["sid"] or u["rank"] == 15):
        raise Fail("Скасувати наказ може той, хто його видав, або Голова СБУ.", 403)
    await db.run("UPDATE orders SET status='deleted', cancelled_by=?, cancelled=? WHERE id=?", u["sid"], now_ms(), oid)
    await db.audit(u["sid"], "Наказ Голови скасовано", 0, f"НГ-{oid:04d}")
    await free_post(o, u, cancelled=True)


async def listing_free() -> list[dict]:
    rows = await db.all("SELECT * FROM orders WHERE kind='free' AND status!='deleted' ORDER BY t DESC LIMIT 100")
    out = []
    for o in rows:
        by = await core.user(o["by_sid"])
        out.append({k: o[k] for k in ("id", "title", "body", "t", "by_sid")} | {"byName": by["name"] if by else "—", "byRank": rank_name(by["rank"]) if by else ""})
    return out
