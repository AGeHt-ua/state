"""Клопотання до Кабінету Міністрів і Мінфіну штату NG про цільове фінансування та звіти про використання коштів
(форми III і IV теми Мінфіну на форумі). Готує начальник або заступник начальника ДЕБ (від свого імені),
погоджує Голова СБУ або Заступник → PDF / PNG / текст для форуму. Звіт — протягом 72 годин після отримання коштів."""
import asyncio
import json
import logging

import discord

import core
import docpost
import overrides as ov
import style
from core import Fail
from db import db, now_ms
from roles import rank_name

log = logging.getLogger("sova.finance")
H72 = 72 * 3600 * 1000
PURPOSES = {
    "arms": "Закупівля матеріалів, державного озброєння, амуніції та спецзасобів",
    "fleet": "Технічне обслуговування, ремонт і заправка службового автопарку та авіації",
    "ops": "Забезпечення спільних спеціальних операцій, навчань, польових зборів, блокпостів чи рейдів",
    "other": "Інші обґрунтовані господарські та оперативно-службові потреби",
}
# draft → wait (погодження) → approved → posted (на форумі) → funded / denied (рішення Мінфіну); звіт: draft → wait → approved → posted
STATUS = {"draft": "Чернетка", "wait": "На погодженні", "approved": "Погоджено", "posted": "Подано на форум",
          "funded": "Кошти отримано", "denied": "Мінфін відмовив", "rejected": "Відмовлено керівництвом", "deleted": "Видалено"}


def no(d: dict) -> str:
    return f"{'КЛ' if d['kind'] == 'petition' else 'ЗВК'}-{d['id']:04d}"


def can_prepare(u: dict) -> bool:
    if u.get("curator_ro"):
        return False
    return (u["rank"] in (11, 12) and core.has_dept_role(u, "deb")) or u["rank"] >= ov.P("rap_override")


def can_approve(u: dict) -> bool:
    return u["rank"] >= ov.P("rap_override") and not u.get("curator_ro")


def can_view(u: dict) -> bool:
    return can_prepare(u) or u["rank"] >= ov.P("rap_override") or bool(u.get("curator"))


def rights(u: dict) -> dict:
    return {"view": can_view(u), "prepare": can_prepare(u), "approve": can_approve(u)}


async def get(did: int) -> dict:
    d = await db.one("SELECT * FROM fin_docs WHERE id=? AND status!='deleted'", did)
    if not d:
        raise Fail("Документ не знайдено.", 404)
    d["data"] = json.loads(d["data"] or "{}")
    d["history"] = json.loads(d["history"] or "[]")
    d["no"] = no(d)
    d["statusName"] = STATUS.get(d["status"], d["status"])
    d["total"] = sum(int(i.get("sum") or 0) for i in d["data"].get("items", [])) if d["kind"] == "petition" else int(d["data"].get("amount") or 0)
    for k in ("author", "approver"):
        p = await core.user(d[k]) if d.get(k) else None
        d[k + "User"] = {"sid": p["sid"], "name": p["name"], "rankName": rank_name(p["rank"])} if p else None
    if d["kind"] == "petition" and d["status"] == "funded":
        d["deadline"] = (d["funded_at"] or 0) + H72
        rep = await db.one("SELECT id, status FROM fin_docs WHERE parent=? AND status!='deleted' ORDER BY id DESC LIMIT 1", d["id"])
        d["report"] = {"id": rep["id"], "status": rep["status"], "no": f"ЗВК-{rep['id']:04d}"} if rep else None
    if d["kind"] == "report" and d["parent"]:
        par = await db.one("SELECT id, data, funded_amount, forum_url FROM fin_docs WHERE id=?", d["parent"])
        d["parentInfo"] = {"no": f"КЛ-{par['id']:04d}", "amount": par["funded_amount"], "url": par["forum_url"]} if par else None
    return d


async def listing(u: dict) -> list[dict]:
    if not can_view(u):
        raise Fail("Розділ доступний керівництву ДЕБ, Голові та Заступнику Голови СБУ.", 403)
    rows = await db.all("SELECT id FROM fin_docs WHERE status!='deleted' ORDER BY id DESC LIMIT 100")
    return [await get(r["id"]) for r in rows]


def _clean(kind: str, b: dict) -> dict:
    if kind == "petition":
        items = [{"name": str(i.get("name") or "").strip()[:120], "sum": max(0, int(float(i.get("sum") or 0)))}
                 for i in (b.get("items") or []) if str(i.get("name") or "").strip()][:20]
        return {"purpose": b.get("purpose") if b.get("purpose") in PURPOSES else "other", "why": str(b.get("why") or "")[:3000],
                "items": items, "account": str(b.get("account") or "Казна Служби безпеки штату NG")[:120]}
    return {"amount": max(0, int(float(b.get("amount") or 0))), "done": str(b.get("done") or "")[:3000],
            "rest": max(0, int(float(b.get("rest") or 0))), "restFate": "returned" if b.get("restFate") == "returned" else "kept",
            "evidence": [str(x).strip()[:400] for x in (b.get("evidence") or []) if str(x).strip().startswith(("http://", "https://"))][:10],
            "files": [str(f)[:40] for f in (b.get("files") or []) if f][:10]}


async def _hist(d: dict | None, u: dict, action: str, note: str = "") -> str:
    h = (d or {}).get("history", []) + [{"t": now_ms(), "sid": u["sid"], "name": u["name"], "rank": rank_name(u["rank"]), "action": action, "note": note[:300]}]
    return json.dumps(h, ensure_ascii=False)


async def save(u: dict, b: dict) -> dict:
    if not can_prepare(u):
        raise Fail("Клопотання готують начальник або заступник начальника ДЕБ.", 403)
    if b.get("id"):
        d = await get(int(b["id"]))
        if d["status"] != "draft":
            raise Fail("Редагувати можна лише чернетку. Відкличте документ з погодження.")
        await db.run("UPDATE fin_docs SET data=?, updated=? WHERE id=?", json.dumps(_clean(d["kind"], b.get("data") or {}), ensure_ascii=False), now_ms(), d["id"])
        return await get(d["id"])
    kind = "report" if b.get("kind") == "report" else "petition"
    parent = None
    if kind == "report":
        par = await get(int(b.get("parent") or 0))
        if par["kind"] != "petition" or par["status"] != "funded":
            raise Fail("Звіт складається до клопотання, за яким кошти вже отримано.")
        if await db.one("SELECT id FROM fin_docs WHERE parent=? AND status NOT IN ('deleted','rejected')", par["id"]):
            raise Fail("Звіт до цього клопотання вже є.")
        parent = par["id"]
    did = await db.run("INSERT INTO fin_docs(kind,parent,author,status,data,history,created,updated) VALUES(?,?,?,?,?,?,?,?)",
                       kind, parent, u["sid"], "draft", json.dumps(_clean(kind, b.get("data") or {}), ensure_ascii=False),
                       await _hist(None, u, "create"), now_ms(), now_ms())
    return await get(did)


async def _set(d: dict, u: dict, status: str, action: str, note: str = "", **extra):
    cols = ", ".join(f"{k}=?" for k in extra)
    await db.run(f"UPDATE fin_docs SET status=?, history=?, updated=?{', ' + cols if cols else ''} WHERE id=?",
                 status, await _hist(d, u, action, note), now_ms(), *extra.values(), d["id"])
    return await get(d["id"])


async def act(u: dict, did: int, action: str, b: dict) -> dict:
    d = await get(did)
    note = str(b.get("note") or "").strip()
    if action == "submit":
        if not can_prepare(u) or d["status"] != "draft":
            raise Fail("Подати на погодження можна чернетку.", 403)
        x = d["data"]
        if d["kind"] == "petition" and (not x.get("items") or d["total"] <= 0 or len(x.get("why", "")) < 20):
            raise Fail("Заповніть обґрунтування (від 20 символів) і кошторис хоча б з одним пунктом із сумою.")
        if d["kind"] == "report" and (len(x.get("done", "")) < 10 or not (x.get("evidence") or x.get("files"))):
            raise Fail("Опишіть, що закуплено, і додайте докази цільового використання.")
        d = await _set(d, u, "wait", "submit")
        await journal(d, u, "Подано на погодження Голові СБУ", mention=True, tag=b.get("tag"))
    elif action == "withdraw":
        if not can_prepare(u) or d["status"] != "wait":
            raise Fail("Відкликати можна документ на погодженні.", 403)
        d = await _set(d, u, "draft", "withdraw")
    elif action in ("ok", "return", "rej"):
        if not can_approve(u) or d["status"] != "wait":
            raise Fail("Цей документ зараз не на вашому погодженні.", 403)
        if d["author"] == u["sid"]:
            raise Fail("Погоджує інша посадова особа (Голова або Заступник), не автор документа.", 403)
        if action != "ok" and not note:
            raise Fail("Вкажіть причину.")
        st = {"ok": "approved", "return": "draft", "rej": "rejected"}[action]
        d = await _set(d, u, st, action, note, **({"approver": u["sid"], "approved": now_ms()} if action == "ok" else {}))
        await journal(d, u, {"ok": "ПОГОДЖЕНО — можна подавати на форум", "return": f"Повернуто: {note}", "rej": f"Відмовлено: {note}"}[action])
        if action == "ok":
            await db.audit(u["sid"], "Погоджено клопотання Мінфіну" if d["kind"] == "petition" else "Погоджено звіт про використання коштів",
                           d["author"], f"{d['no']} · ${d['total']:,}".replace(",", " "))
    elif action == "posted":
        url = str(b.get("url") or "").strip()
        if not can_prepare(u) or d["status"] != "approved":
            raise Fail("Позначити поданим можна погоджений документ.", 403)
        if not url.startswith(("http://", "https://")):
            raise Fail("Вставте посилання на вашу відповідь у темі Мінфіну.")
        d = await _set(d, u, "posted", "posted", url, forum_url=url[:400])
        await journal(d, u, "Подано на форум Мінфіну")
    elif action in ("funded", "denied"):
        if not (can_prepare(u) or can_approve(u)) or d["kind"] != "petition" or d["status"] != "posted":
            raise Fail("Рішення Мінфіну позначається для поданого клопотання.", 403)
        if action == "funded":
            amount = max(0, int(float(b.get("amount") or 0)))
            if amount <= 0:
                raise Fail("Вкажіть отриману суму.")
            d = await _set(d, u, "funded", "funded", f"${amount:,}".replace(",", " "), funded_amount=amount, funded_at=now_ms())
            await journal(d, u, f"Мінфін схвалив: ${amount:,} — звіт протягом 72 годин".replace(",", " "))
            await db.audit(u["sid"], "Отримано цільове фінансування", d["author"], f"{d['no']} · ${amount:,}".replace(",", " "))
        else:
            d = await _set(d, u, "denied", "denied", note)
            await journal(d, u, f"Мінфін відмовив{': ' + note if note else ''}")
    elif action == "delete":
        if not (can_approve(u) or (d["author"] == u["sid"] and d["status"] in ("draft", "rejected"))):
            raise Fail("Видалити може автор (чернетку) або Голова чи Заступник.", 403)
        await db.run("UPDATE fin_docs SET status='deleted', updated=? WHERE id=?", now_ms(), d["id"])
        await docpost.remove("fin", d["id"])  # видалено — прибрати і з Discord
        return {"ok": True}
    else:
        raise Fail("Невідома дія.")
    return d


async def pending(u: dict) -> int:
    n = 0
    if can_approve(u):
        n += (await db.one("SELECT COUNT(*) AS c FROM fin_docs WHERE status='wait' AND author!=?", u["sid"]))["c"]
    if can_prepare(u):  # отримані кошти без звіту
        rows = await db.all("SELECT id FROM fin_docs f WHERE kind='petition' AND status='funded' AND NOT EXISTS "
                            "(SELECT 1 FROM fin_docs r WHERE r.parent=f.id AND r.status IN ('approved','posted'))")
        n += len(rows)
    return n


FIN_STATE = {"draft": ("📝 ПОВЕРНУТО НА ДООПРАЦЮВАННЯ", 0xD9A23D), "wait": ("🕓 НА ПОГОДЖЕННІ ГОЛОВИ СБУ", 0xD9A23D),
             "approved": ("✅ ПОГОДЖЕНО · МОЖНА ПОДАВАТИ НА ФОРУМ", 0x5FB37A), "rejected": ("⛔ ВІДМОВЛЕНО", 0xD4605A),
             "posted": ("📨 ПОДАНО НА ФОРУМ МІНФІНУ", 0x6F9FD6), "funded": ("💰 МІНФІН СХВАЛИВ", 0x5FB37A), "denied": ("⛔ МІНФІН ВІДМОВИВ", 0xD4605A)}


async def journal(d: dict, u: dict, label: str, mention: bool = False, tag: str | None = None):
    """Клопотання чи звіт Мінфіну — одне повідомлення: при поданні — картка з аркушем А4 і тегами (автор, Голова й заступник,
    обрана роль/відділ), далі кожне рішення оновлює картку з короткою відповіддю."""
    money = lambda v: f"${v:,}".replace(",", " ")
    state, color = FIN_STATE.get(d["status"], ("📄 " + label.upper()[:60], 0xC9A05A))
    desc = [f"### {state}",
            f"📄 {'Клопотання про виділення цільових коштів' if d['kind'] == 'petition' else 'Звіт про цільове використання коштів'}",
            f"💵 Сума: **{money(d['total'])}**" + (f" · отримано {money(d['funded_amount'])}" if d.get("funded_amount") else ""),
            f"✍️ Підготував: {(d.get('authorUser') or {}).get('name', '—')}"]
    if d.get("forum_url"):
        desc.append(f"🔗 [Тема на форумі Мінфіну]({d['forum_url']})")
    e = style.document(f"ФІНАНСУВАННЯ {d['no']} · МІНФІН ШТАТУ NG", color, desc="\n".join(desc),
                       footer=f"Остання дія: {label[:80]} · {u['name']} · {style.when()}")
    await docpost.journal("fin", d["id"], await core.channel("fin") or await core.channel("deb"), e,
                          users=await docpost.people(d["author"]), tag=tag, roles=docpost.key_roles("fin:wait" if mention else None),
                          ping=None if mention else f"🔔 {d['no']}: {label[:150]}", ping_roles=docpost.key_roles("fin:wait") if mention else None)


async def reminder_loop():
    """Нагадування в канал: до кінця 72 годин на звіт лишилося менше 12 годин."""
    await asyncio.sleep(60)
    while True:
        try:
            rows = await db.all("SELECT * FROM fin_docs f WHERE kind='petition' AND status='funded' AND funded_at IS NOT NULL AND NOT EXISTS "
                                "(SELECT 1 FROM fin_docs r WHERE r.parent=f.id AND r.status IN ('approved','posted'))")
            for r in rows:
                data = json.loads(r["data"] or "{}")
                left = r["funded_at"] + H72 - now_ms()
                if 0 < left < 12 * 3600 * 1000 and not data.get("reminded"):
                    data["reminded"] = now_ms()
                    await db.run("UPDATE fin_docs SET data=? WHERE id=?", json.dumps(data, ensure_ascii=False), r["id"])
                    ch = await core.channel("fin") or await core.channel("deb")
                    if ch:
                        await ch.send(embed=style.document("НАГАДУВАННЯ · ЗВІТ МІНФІНУ", 0xD9A23D, desc=style.block(
                            style.kv("КЛОПОТАННЯ", f"КЛ-{r['id']:04d}", "white", True),
                            style.kv("ЛИШИЛОСЬ", f"{left // 3600000} год", "red", True),
                            style.c("Подайте звіт про використання коштів (форма IV) у темі Мінфіну.", "white")), footer="72 години після отримання коштів"),
                            allowed_mentions=discord.AllowedMentions.none())
        except Exception:
            log.exception("Нагадування про звіти Мінфіну")
        await asyncio.sleep(1800)
