"""Бібліотека (лекції, внутрішні документи, пам'ятки) та онлайн-іспити з перевіркою ВКПП."""
import json

import core
import overrides as ov
from core import Fail
from db import db, now_ms
from roles import rank_name

CATS = {"lecture": "Лекції", "internal": "Внутрішні документи СБУ", "memo": "Пам'ятки та інструкції", "material": "Навчальні матеріали"}


def can_edit_lib(u: dict) -> bool:
    return u["rank"] >= ov.P("lib_edit") or u["rank"] == 8 or core.has_dept_role(u, "vkpp")


def is_examiner(u: dict) -> bool:
    return u["rank"] >= ov.P("exam_grade") or core.has_dept_role(u, "vkpp")


# ---------------------------------------------------------------- бібліотека
async def lib_list() -> list[dict]:
    rows = await db.all("SELECT id, cat, title, author, t, updated, fmt, length(body) AS size FROM kb_items WHERE status!='deleted' ORDER BY cat, title")
    return [{**r, "authorName": (await core.user(r["author"]) or {}).get("name")} for r in rows]


async def lib_get(iid: int) -> dict:
    r = await db.one("SELECT * FROM kb_items WHERE id=? AND status!='deleted'", iid)
    if not r:
        raise Fail("Матеріал не знайдено.", 404)
    r["files"] = json.loads(r["files"] or "[]")
    return r


async def lib_save(u: dict, b: dict, iid: int | None = None) -> dict:
    if not can_edit_lib(u):
        raise Fail("Додавати матеріали можуть ВКПП, інструктори й керівництво.", 403)
    cat = b.get("cat") if b.get("cat") in CATS else "lecture"
    fmt = "html" if b.get("fmt") == "html" else "text"  # html — готова презентація, показується в ізольованому вікні
    title, body = str(b.get("title") or "").strip()[:150], str(b.get("body") or "").strip()[:(600000 if fmt == "html" else 60000)]
    files = [str(f)[:40] for f in (b.get("files") or [])][:10]
    if not title or (not body and not files):
        raise Fail("Вкажіть назву й текст (або додайте файл).")
    if iid:
        await lib_get(iid)
        await db.run("UPDATE kb_items SET cat=?, title=?, body=?, files=?, fmt=?, updated=? WHERE id=?", cat, title, body, json.dumps(files), fmt, now_ms(), iid)
    else:
        iid = await db.run("INSERT INTO kb_items(cat,title,body,files,fmt,author,t,updated,status) VALUES(?,?,?,?,?,?,?,?,?)",
                           cat, title, body, json.dumps(files), fmt, u["sid"], now_ms(), now_ms(), "active")
    return await lib_get(iid)


async def lib_delete(u: dict, iid: int):
    r = await lib_get(iid)
    if not (r["author"] == u["sid"] or u["rank"] >= 14 or core.has_dept_role(u, "vkpp")):
        raise Fail("Видалити може автор, ВКПП або керівництво.", 403)
    await db.run("UPDATE kb_items SET status='deleted', updated=? WHERE id=?", now_ms(), iid)


# ---------------------------------------------------------------- іспити
def clean_questions(qs: list) -> list[dict]:
    out = []
    for i, q in enumerate((qs or [])[:60]):
        t = q.get("type") if q.get("type") in ("single", "multi", "text") else "single"
        text = str(q.get("q") or "").strip()[:800]
        if not text:
            continue
        opts = [str(o).strip()[:300] for o in (q.get("options") or []) if str(o).strip()][:8] if t != "text" else []
        correct = sorted({int(c) for c in (q.get("correct") or []) if str(c).isdigit() and int(c) < len(opts)}) if t != "text" else []
        if t != "text" and (len(opts) < 2 or not correct):
            raise Fail(f"Питання {len(out) + 1}: потрібні щонайменше 2 варіанти й правильна відповідь.")
        if t == "single":
            correct = correct[:1]
        out.append({"id": i + 1, "type": t, "q": text, "options": opts, "correct": correct,
                    "points": max(1, min(20, int(q.get("points") or 1))), "hint": str(q.get("hint") or "")[:500]})
    if not out:
        raise Fail("Додайте хоча б одне питання.")
    return out


async def exam_get(eid: int) -> dict:
    e = await db.one("SELECT * FROM exams WHERE id=? AND status!='deleted'", eid)
    if not e:
        raise Fail("Іспит не знайдено.", 404)
    e["questions"] = json.loads(e["questions"] or "[]")
    return e


async def exam_save(u: dict, b: dict, eid: int | None = None) -> dict:
    if not is_examiner(u):
        raise Fail("Іспити створює ВКПП.", 403)
    title = str(b.get("title") or "").strip()[:150]
    if not title:
        raise Fail("Вкажіть назву іспиту.")
    qs = clean_questions(b.get("questions"))
    vals = (title, str(b.get("descr") or "")[:2000], json.dumps(qs, ensure_ascii=False), max(1, min(100, int(b.get("pass_pct") or 70))),
            max(0, min(240, int(b.get("minutes") or 0))), "published" if b.get("publish") else "draft")
    if eid:
        await exam_get(eid)
        await db.run("UPDATE exams SET title=?, descr=?, questions=?, pass_pct=?, minutes=?, status=?, updated=? WHERE id=?", *vals, now_ms(), eid)
    else:
        eid = await db.run("INSERT INTO exams(title,descr,questions,pass_pct,minutes,status,author,t,updated) VALUES(?,?,?,?,?,?,?,?,?)",
                           *vals, u["sid"], now_ms(), now_ms())
    return await exam_get(eid)


async def exam_delete(u: dict, eid: int):
    if not is_examiner(u):
        raise Fail("Видаляти іспити може ВКПП.", 403)
    await exam_get(eid)
    await db.run("UPDATE exams SET status='deleted', updated=? WHERE id=?", now_ms(), eid)


def public_exam(e: dict) -> dict:
    """Іспит для складання — без правильних відповідей."""
    return {**{k: e[k] for k in ("id", "title", "descr", "pass_pct", "minutes")},
            "questions": [{k: q[k] for k in ("id", "type", "q", "options", "points")} | {"multi": q["type"] == "multi"} for q in e["questions"]]}


RETRY_MS = 24 * 3600 * 1000  # пауза між спробами іспиту після нескладеної


async def start(u: dict, eid: int) -> dict:
    e = await exam_get(eid)
    if e["status"] != "published":
        raise Fail("Іспит ще не опубліковано.")
    a = await db.one("SELECT * FROM attempts WHERE exam_id=? AND sid=? AND status='progress'", eid, u["sid"])
    if not a:
        last = await db.one("SELECT * FROM attempts WHERE exam_id=? AND sid=? AND status IN ('submitted','graded') ORDER BY finished DESC LIMIT 1",
                            eid, u["sid"])
        if last and last["status"] == "submitted":
            raise Fail("Попередня спроба ще на перевірці ВКПП.")
        if last and now_ms() - (last["finished"] or 0) < RETRY_MS:
            ok = last["total"] and last["score"] is not None and 100 * last["score"] / last["total"] >= e["pass_pct"] and not last["late"]
            if not ok:
                left = RETRY_MS - (now_ms() - (last["finished"] or 0))
                raise Fail(f"Нову спробу можна почати через {left // 3_600_000} год {left % 3_600_000 // 60_000} хв (між спробами — 24 години).")
        aid = await db.run("INSERT INTO attempts(exam_id,sid,status,started) VALUES(?,?,?,?)", eid, u["sid"], "progress", now_ms())
        a = await db.one("SELECT * FROM attempts WHERE id=?", aid)
    return {"attempt": a["id"], "started": a["started"], "exam": public_exam(e)}


async def submit(u: dict, eid: int, answers: dict) -> dict:
    e = await exam_get(eid)
    a = await db.one("SELECT * FROM attempts WHERE exam_id=? AND sid=? AND status='progress'", eid, u["sid"])
    if not a:
        raise Fail("Спершу розпочніть іспит.")
    late = e["minutes"] and now_ms() - a["started"] > (e["minutes"] * 60 + 60) * 1000
    auto, total, per, manual = 0.0, 0.0, {}, False
    for q in e["questions"]:
        total += q["points"]
        ans = (answers or {}).get(str(q["id"]))
        if q["type"] == "text":
            manual = True
            per[str(q["id"])] = {"answer": str(ans or "")[:3000], "points": None}
            continue
        got = sorted({int(x) for x in (ans if isinstance(ans, list) else [ans]) if str(x).isdigit()})
        ok = got == q["correct"]
        pts = q["points"] if ok else 0
        auto += pts
        per[str(q["id"])] = {"answer": got, "points": pts, "ok": ok}
    status = "submitted" if manual else "graded"
    score = None if manual else auto
    await db.run("UPDATE attempts SET answers=?, auto=?, total=?, score=?, status=?, finished=?, late=? WHERE id=?",
                 json.dumps(per, ensure_ascii=False), auto, total, score, status, now_ms(), int(bool(late)), a["id"])
    return await attempt_out(await db.one("SELECT * FROM attempts WHERE id=?", a["id"]), e, reveal=not manual)


async def grade(u: dict, aid: int, points: dict, note: str) -> dict:
    if not is_examiner(u):
        raise Fail("Перевіряє ВКПП.", 403)
    a = await db.one("SELECT * FROM attempts WHERE id=?", aid)
    if not a or a["status"] not in ("submitted", "graded"):
        raise Fail("Спробу не знайдено.", 404)
    if a["sid"] == u["sid"]:
        raise Fail("Перевіряти власний іспит не можна.", 403)
    e = await exam_get(a["exam_id"])
    per = json.loads(a["answers"] or "{}")
    score = 0.0
    for q in e["questions"]:
        p = per.get(str(q["id"]), {})
        if q["type"] == "text":
            p["points"] = max(0.0, min(float(q["points"]), float((points or {}).get(str(q["id"])) or 0)))
            per[str(q["id"])] = p
        score += p.get("points") or 0
    await db.run("UPDATE attempts SET answers=?, score=?, status='graded', grader=?, graded=?, note=? WHERE id=?",
                 json.dumps(per, ensure_ascii=False), score, u["sid"], now_ms(), (note or "")[:1000], aid)
    return await attempt_out(await db.one("SELECT * FROM attempts WHERE id=?", aid), e, reveal=True, keys=True)


async def attempt_delete(u: dict, aid: int):
    if not is_examiner(u):
        raise Fail("Видаляти спроби може ВКПП.", 403)
    await db.run("UPDATE attempts SET status='deleted' WHERE id=?", aid)


async def attempt_out(a: dict, e: dict | None = None, reveal: bool = False, keys: bool = False) -> dict:
    """reveal — показати питання й відповіді людини; keys — ще й правильні варіанти (лише ВКПП, щоб іспит не складали перебором)."""
    e = e or await exam_get(a["exam_id"])
    p = await core.user(a["sid"])
    g = await core.user(a["grader"]) if a.get("grader") else None
    pct = round(100 * (a["score"] or 0) / a["total"]) if a.get("total") and a.get("score") is not None else None
    out = {**{k: a[k] for k in ("id", "exam_id", "sid", "status", "started", "finished", "score", "total", "auto", "note", "late")},
           "examTitle": e["title"], "pass_pct": e["pass_pct"], "pct": pct, "passed": pct is not None and pct >= e["pass_pct"],
           "name": p["name"] if p else f"№{a['sid']}", "rankName": rank_name(p["rank"]) if p else "", "graderName": g["name"] if g else None,
           "answers": json.loads(a["answers"] or "{}")}
    if reveal:
        out["questions"] = e["questions"] if keys else [{k: v for k, v in q.items() if k != "correct"} for q in e["questions"]]
    out["counts"] = out["passed"] and not a.get("late")  # прострочена спроба не зараховується для підвищення
    return out


async def overview(u: dict) -> dict:
    ex = is_examiner(u)
    exams = await db.all("SELECT id, title, descr, pass_pct, minutes, status, questions, t FROM exams WHERE status!='deleted'"
                         + ("" if ex else " AND status='published'") + " ORDER BY id")
    mine = await db.all("SELECT * FROM attempts WHERE sid=? AND status!='deleted' ORDER BY id DESC LIMIT 50", u["sid"])
    review = await db.all("SELECT * FROM attempts WHERE status IN ('submitted','graded') ORDER BY (status='submitted') DESC, finished DESC LIMIT 100") if ex else []
    return {
        "examiner": ex,
        "exams": [{**{k: e[k] for k in ("id", "title", "descr", "pass_pct", "minutes", "status", "t")}, "count": len(json.loads(e["questions"] or "[]"))} for e in exams],
        "mine": [await attempt_out(a, reveal=a["status"] == "graded") for a in mine if a["status"] != "progress"],
        "review": [await attempt_out(a, reveal=True, keys=True) for a in review],
    }
