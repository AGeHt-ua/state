"""Бали за перевірку документів для Заступника начальника відділу і вище (звання від 11).

За кожне своє рішення (погодив, відхилив, повернув) керівник отримує бали:
  • звіт, рапорт (кожна віза рапорту на переведення / розподіл), анкета кандидата (ВВБ і ВКПП), запит на допуск — 1 бал;
  • рішення по кейс-файлу — 2 бали.
Рахуються лише рішення після запуску системи (налаштування «review_pts_since»), щоб накопичені бали й підвищення
не змінились заднім числом. Бали додаються до тижневих (премії, рейтинг, статистика відділів) і до балів на підвищення.
Звання береться поточне: хто опустився нижче 11, бали за перевірку перестає отримувати."""
import json

from db import db, now_ms

DOC_PTS, CASE_PTS, MIN_RANK = 1, 2, 11
CASE_ACTIONS = ("ok", "return", "rej")
FAR = 1 << 62
STAGED_RAPS = ("transfer", "assign")   # рапорти з кількома візами: бал за кожну візу


async def since() -> int:
    """Момент запуску нарахування; ставиться один раз при першому старті."""
    t = await db.get_setting("review_pts_since", None)
    if not t:
        t = now_ms()
        await db.set_setting("review_pts_since", t)
    return int(t)


async def _events(t0: int, t1: int) -> list[tuple[int, int]]:
    """(sid, бали) за кожне рішення в проміжку [t0, t1)."""
    t0 = max(t0, await since())
    if t0 >= t1:
        return []
    out: list[tuple[int, int]] = []
    for r in await db.all("SELECT reviewer FROM acts WHERE reviewer IS NOT NULL AND status IN ('ok','rej') AND reviewed>=? AND reviewed<?", t0, t1):
        out.append((r["reviewer"], DOC_PTS))
    q = ",".join("?" * len(STAGED_RAPS))
    for r in await db.all(f"SELECT reviewer FROM raps WHERE reviewer IS NOT NULL AND status IN ('ok','rej') AND type NOT IN ({q}) "
                          "AND reviewed>=? AND reviewed<?", *STAGED_RAPS, t0, t1):
        out.append((r["reviewer"], DOC_PTS))
    for r in await db.all(f"SELECT data FROM raps WHERE type IN ({q}) AND status!='deleted' AND COALESCE(reviewed, ?)>=?", *STAGED_RAPS, FAR, t0):
        for v in json.loads(r["data"] or "{}").get("visas", []):
            if v.get("sid") and t0 <= int(v.get("t") or 0) < t1:
                out.append((v["sid"], DOC_PTS))
    for r in await db.all("SELECT history FROM cases WHERE updated>=?", t0):
        for h in json.loads(r["history"] or "[]"):
            if h.get("action") in CASE_ACTIONS and h.get("sid") and t0 <= int(h.get("t") or 0) < t1:
                out.append((h["sid"], CASE_PTS))
    # анкети й запити на допуск зберігають Discord ID того, хто вирішив
    sid_of = {str(u["discord_id"]): u["sid"] for u in await db.all("SELECT sid, discord_id FROM users WHERE discord_id IS NOT NULL")}
    for who, t in [(r["vvb_by"], r["vvb_t"]) for r in await db.all("SELECT vvb_by, vvb_t FROM candidates WHERE vvb_by IS NOT NULL AND vvb_t>=? AND vvb_t<?", t0, t1)] \
            + [(r["vkpp_by"], r["vkpp_t"]) for r in await db.all("SELECT vkpp_by, vkpp_t FROM candidates WHERE vkpp_by IS NOT NULL AND vkpp_t>=? AND vkpp_t<?", t0, t1)] \
            + [(r["reviewer"], r["reviewed"]) for r in await db.all("SELECT reviewer, reviewed FROM access_requests WHERE reviewer IS NOT NULL "
                                                                     "AND status IN ('ok','rej') AND reviewed>=? AND reviewed<?", t0, t1)]:
        if str(who) in sid_of:
            out.append((sid_of[str(who)], DOC_PTS))
    return out


async def points_all(t0: int = 0, t1: int = FAR) -> dict[int, int]:
    """Бали за перевірку всіх керівників (звання від 11) за проміжок."""
    events = await _events(t0, t1)
    if not events:
        return {}
    leads = {r["sid"] for r in await db.all("SELECT sid FROM users WHERE rank>=? AND status NOT IN ('dismissed','removed')", MIN_RANK)}
    out: dict[int, int] = {}
    for sid, p in events:
        if sid in leads:
            out[sid] = out.get(sid, 0) + p
    return out


async def points(sid: int, t0: int = 0, t1: int = FAR) -> int:
    return (await points_all(t0, t1)).get(sid, 0)
