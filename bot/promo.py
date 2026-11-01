"""Єдина система підвищення за балами.
Бали — це підтверджені звіти. На кожне звання задано поріг (адмін-панель → «Підвищення»); надлишок переходить на наступне
звання: баланс = усі підтверджені бали − бали, «витрачені» на попередні підвищення. Для звань Академії — обов'язковий іспит.
Активна догана блокує подання рапорту. Погоджує ВКПП; після погодження поріг списується з балансу."""
import json

import discord

import core
import style
from db import db, now_ms
from roles import RANKS, rank_name

DEFAULT_PTS = {2: 15, 3: 25, 4: 35, 5: 50, 6: 70, 7: 90, 8: 120, 9: 150, 10: 180, 11: 220, 12: 260, 13: 300, 14: 350, 15: 400}
ORDER_ONLY = (13, 14, 15)  # посади в одному екземплярі — за замовчуванням лише наказом


async def cfg() -> dict[int, dict]:
    saved = {int(k): v for k, v in (await db.get_setting("promo_cfg", {}) or {}).items()}
    exams = [r["id"] for r in await db.all("SELECT id FROM exams WHERE status='published' ORDER BY id LIMIT 3")]
    out = {}
    for r in range(2, 16):
        d = {"pts": DEFAULT_PTS[r], "mode": "order" if r in ORDER_ONLY else "rap",
             "exam": exams[r - 2] if r <= 4 and len(exams) > r - 2 else None}
        d.update({k: v for k, v in saved.get(r, {}).items() if k in d})
        out[r] = d
    return out


async def save(u: dict, data: dict) -> dict:
    clean = {}
    for k, v in (data or {}).items():
        r = int(k)
        if 2 <= r <= 15:
            ex = v.get("exam")
            clean[r] = {"pts": max(0, min(100000, int(float(v.get("pts") or 0)))), "mode": "order" if v.get("mode") == "order" else "rap",
                        "exam": int(ex) if str(ex or "").isdigit() else None}
    await db.set_setting("promo_cfg", {str(k): v for k, v in clean.items()})
    await db.audit(u["sid"], "⚙ Змінено систему підвищення", 0, ", ".join(f"{rank_name(r)}: {c['pts']} б." for r, c in clean.items()))
    return await cfg()


async def _points(sid: int, before: int | None = None) -> int:
    c = await core.coef()
    q = "SELECT type, qty FROM acts WHERE by_sid=? AND status='ok'" + (" AND t<?" if before else "")
    rows = await db.all(q, sid, *([before] if before else []))
    return sum(c.get(r["type"], 0) * (r["qty"] or 1) for r in rows)


async def spent(u: dict) -> int:
    """Скільки балів уже «витрачено» на підвищення. Перший раз — усе, що набрано до отримання поточного звання (старт системи)."""
    row = await db.one("SELECT promo_spent, since FROM users WHERE sid=?", u["sid"])
    if row and row["promo_spent"] is not None:
        return row["promo_spent"]
    base = await _points(u["sid"], (row or {}).get("since") or now_ms())
    await db.run("UPDATE users SET promo_spent=? WHERE sid=?", base, u["sid"])
    return base


async def balance(u: dict) -> int:
    return await _points(u["sid"]) - await spent(u)


async def exam_passed(sid: int, eid: int) -> bool:
    e = await db.one("SELECT pass_pct FROM exams WHERE id=?", eid)
    if not e:
        return True  # іспит видалено — вимога не діє
    for a in await db.all("SELECT score, total FROM attempts WHERE sid=? AND exam_id=? AND score IS NOT NULL AND status!='deleted'", sid, eid):
        if a["total"] and 100 * a["score"] / a["total"] >= e["pass_pct"]:
            return True
    return False


async def check(u: dict) -> dict | None:
    if u["dept"] in ("prosecutor", "curator") or u["rank"] >= 15 or u["rank"] < 1:
        return None
    nxt = u["rank"] + 1
    c = (await cfg())[nxt]
    bal = await balance(u)
    items = []
    if c["mode"] == "order":
        items.append({"ok": False, "soft": True, "t": f"Звання «{rank_name(nxt)}» присвоюється наказом Голови СБУ (рапорт не подається)"})
    items.append({"ok": bal >= c["pts"], "t": f"Бали: {bal} з {c['pts']}" + (f" (надлишок {bal - c['pts']} перейде на наступне звання)" if bal > c["pts"] else ""),
                  "pct": min(1, bal / c["pts"]) if c["pts"] else 1})
    if c["exam"]:
        e = await db.one("SELECT title FROM exams WHERE id=?", c["exam"])
        if e:
            items.append({"ok": await exam_passed(u["sid"], c["exam"]), "t": f"Іспит «{e['title']}» складено"})
    blocked = await db.one("SELECT id FROM discipline WHERE sid=? AND status='active' AND kind IN ('reprimand','severe') AND expires>? ORDER BY expires DESC",
                           u["sid"], now_ms())
    if blocked:
        items.append({"ok": False, "t": f"Активна догана НС-{blocked['id']:04d}: підвищення заблоковано (п. 1.2 Регламенту стягнень)"})
    pending = await db.one("SELECT id FROM raps WHERE by_sid=? AND type='promo' AND status='wait'", u["sid"])
    if pending:
        items.append({"ok": False, "t": f"Рапорт №{pending['id']} уже на розгляді"})
    return {"next": nxt, "name": RANKS[nxt - 1][0], "items": items, "eligible": all(i["ok"] for i in items),
            "points": bal, "need": c["pts"], "mode": c["mode"]}


async def promoted(sid: int, to_rank: int):
    """Після погодженого рапорту: поріг звання списується з балансу (надлишок лишається)."""
    u = await core.user(sid)
    if not u:
        return
    s = await spent(u)
    need = (await cfg())[to_rank]["pts"]
    await db.run("UPDATE users SET promo_spent=? WHERE sid=?", s + need, sid)


async def notify_if_ready(sid: int):
    """Після підтвердження звіту: якщо умови для підвищення щойно виконано — повідомлення в особисті (один раз на звання)."""
    u = await core.user(sid)
    if not u or not u.get("discord_id"):
        return
    pc = await check(u)
    if not pc or not pc["eligible"] or pc["mode"] != "rap":
        return
    key = f"promo_dm:{sid}"
    if await db.get_setting(key) == pc["next"]:
        return
    await db.set_setting(key, pc["next"])
    m = await core.member_of(u["discord_id"])
    if not m:
        return
    try:
        await m.send(embed=style.document("УМОВИ ДЛЯ ПІДВИЩЕННЯ ВИКОНАНО", 0x5FB37A, desc=style.block(
            style.kv("СПІВРОБІТНИК", u["name"], "white", True), style.kv("НАСТУПНЕ ЗВАННЯ", pc["name"], "gold", True),
            style.kv("БАЛИ", f"{pc['points']} з {pc['need']}", "green"), style.rule(),
            style.c("Подайте рапорт на підвищення в ЄІС «Сова»:", "white"), style.c("Рапорти → Подати рапорт → Рапорт на підвищення.", "gray"))),
            view=style.site_view())
    except discord.Forbidden:
        pass
