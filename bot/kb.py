"""База даних: законодавча база штату NG (з офіційного API NG), журнал змін, бібліотека лекцій, онлайн-іспити.
Законодавство тягнемо з api.ng-gta5.com/api/kb (index + docs/{slug}); Голова СБУ кнопкою звіряє зміни."""
import asyncio
import difflib
import hashlib
import html
import json
import logging
import re
from html.parser import HTMLParser

import aiohttp
import discord

import config
import core
import overrides as ov
import style
from core import Fail
from db import db, now_ms

log = logging.getLogger("sova.kb")
NG_API = "https://api.ng-gta5.com/api/kb"
SBU_SLUGS_HINT = ("sbu", "sluzhbu-bezpeky")
AI_MODEL = "claude-sonnet-5-5"


# ---------------------------------------------------------------- безпечний HTML (документи приходять із зовнішнього сайту)
class _Clean(HTMLParser):
    TAGS = {"p", "h1", "h2", "h3", "h4", "strong", "b", "em", "i", "u", "ul", "ol", "li", "br", "table", "thead", "tbody",
            "tr", "td", "th", "span", "div", "blockquote", "hr", "a", "code", "pre", "sub", "sup"}
    ATTRS = {"id", "class", "colspan", "rowspan"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.out, self.skip = [], 0

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style", "iframe", "object"):
            self.skip += 1
            return
        if tag not in self.TAGS:
            return
        keep = []
        for k, v in attrs:
            if k in self.ATTRS and v:
                keep.append(f'{k}="{html.escape(v, quote=True)}"')
            elif tag == "a" and k == "href" and v and re.match(r"^(https?:|#)", v):
                keep.append(f'href="{html.escape(v, quote=True)}" target="_blank" rel="noopener"')
        self.out.append(f"<{tag}{' ' + ' '.join(keep) if keep else ''}>")

    def handle_endtag(self, tag):
        if tag in ("script", "style", "iframe", "object"):
            self.skip = max(0, self.skip - 1)
            return
        if tag in self.TAGS and tag not in ("br", "hr"):
            self.out.append(f"</{tag}>")

    def handle_data(self, data):
        if not self.skip:
            self.out.append(html.escape(data))


def clean_html(raw: str) -> str:
    p = _Clean()
    p.feed(raw or "")
    return "".join(p.out)


def to_text(raw: str) -> str:
    t = re.sub(r"<br\s*/?>|</(p|h\d|li|tr|div)>", "\n", raw or "", flags=re.I)
    t = html.unescape(re.sub(r"<[^>]+>", "", t))
    return "\n".join(line.strip() for line in t.splitlines() if line.strip())


def is_sbu(doc: dict) -> bool:
    return doc.get("faction") == "sbu" or any(h in doc["slug"] for h in SBU_SLUGS_HINT) or "СБУ" in (doc.get("title") or "")


# ---------------------------------------------------------------- синхронізація з NG
_sync_lock = asyncio.Lock()


async def _get(s: aiohttp.ClientSession, url: str):
    async with s.get(url, timeout=aiohttp.ClientTimeout(total=30), headers={"Accept": "application/json"}) as r:
        if r.status != 200:
            raise Fail(f"NG API повернув {r.status} для {url.rsplit('/', 1)[-1]}", 502)
        return await r.json(content_type=None)


async def sync(u: dict | None, initial: bool = False) -> dict:
    """Звірка з офіційною базою NG: нові, змінені, вилучені документи → журнал змін (+ ШІ-підсумок, якщо є ключ)."""
    if u is not None and u["rank"] < ov.P("kb_sync"):
        raise Fail("Оновлювати законодавчу базу може лише Голова СБУ.", 403)
    if _sync_lock.locked():
        raise Fail("Оновлення вже триває. Зачекайте хвилину.", 409)
    async with _sync_lock:
        async with aiohttp.ClientSession() as s:
            idx = await _get(s, f"{NG_API}/index")
            docs = idx.get("docs") or []
            groups = {g["id"]: g["title"] for sec in (idx.get("groups") or {}).values() for g in sec}
            factions = {f["id"]: f.get("abbr") or f.get("name") for f in idx.get("factions") or []}
            sem = asyncio.Semaphore(6)

            async def one(d):
                async with sem:
                    try:
                        return d, await _get(s, f"{NG_API}/docs/{d['slug']}")
                    except Exception as e:
                        log.warning("KB %s: %s", d["slug"], e)
                        return d, None
            fetched = await asyncio.gather(*(one(d) for d in docs))
        old = {r["slug"]: r for r in await db.all("SELECT slug, title, text, hash FROM kb_docs")}
        first = not old
        t = now_ms()
        changes, seen = [], set()
        for d, full in fetched:
            if not full:
                continue
            seen.add(d["slug"])
            raw = full.get("html") or ""
            text = to_text(raw)
            h = hashlib.sha256(text.encode()).hexdigest()
            meta = (d["title"], d.get("section"), d.get("group"), groups.get(d.get("group"), ""), d.get("faction"),
                    factions.get(d.get("faction"), "") if d.get("faction") else "", clean_html(raw), text, h,
                    json.dumps(full.get("toc") or [], ensure_ascii=False), int(is_sbu(d)), d.get("short") or "")
            prev = old.get(d["slug"])
            if prev and prev["hash"] == h:
                await db.run("UPDATE kb_docs SET checked=? WHERE slug=?", t, d["slug"])
                continue
            await db.run("INSERT INTO kb_docs(slug,title,section,grp,grp_title,faction,faction_abbr,html,text,hash,toc,sbu,short,updated,checked) "
                         "VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(slug) DO UPDATE SET title=excluded.title, section=excluded.section, "
                         "grp=excluded.grp, grp_title=excluded.grp_title, faction=excluded.faction, faction_abbr=excluded.faction_abbr, html=excluded.html, "
                         "text=excluded.text, hash=excluded.hash, toc=excluded.toc, sbu=excluded.sbu, short=excluded.short, updated=excluded.updated, checked=excluded.checked",
                         d["slug"], *meta, t, t)
            if first:
                continue
            if prev:
                diff = list(difflib.unified_diff(prev["text"].splitlines(), text.splitlines(), lineterm="", n=1))
                add = sum(1 for x in diff if x.startswith("+") and not x.startswith("+++"))
                rem = sum(1 for x in diff if x.startswith("-") and not x.startswith("---"))
                changes.append(("changed", d["slug"], d["title"], add, rem, "\n".join(diff[2:])[:20000]))
            else:
                changes.append(("new", d["slug"], d["title"], len(text.splitlines()), 0, ""))
        if not first:
            for slug, prev in old.items():
                if slug not in seen and all(x is not None for _, x in fetched):
                    await db.run("DELETE FROM kb_docs WHERE slug=?", slug)
                    changes.append(("removed", slug, prev["title"], 0, len(prev["text"].splitlines()), ""))
        for kind, slug, title, add, rem, diff in changes:
            summary = await ai_summary(title, diff) if kind == "changed" else ""
            await db.run("INSERT INTO kb_changes(t,slug,title,kind,added,removed,diff,summary,by_sid) VALUES(?,?,?,?,?,?,?,?,?)",
                         t, slug, title, kind, add, rem, diff, summary, u["sid"] if u else 0)
        await db.set_setting("kb_checked", t)
        res = {"docs": len(seen), "changes": len(changes), "first": first,
               "new": sum(1 for c in changes if c[0] == "new"), "changed": sum(1 for c in changes if c[0] == "changed"),
               "removed": sum(1 for c in changes if c[0] == "removed")}
        if changes:
            await notify(changes, u)
        return res


async def ai_summary(title: str, diff: str) -> str:
    """Короткий підсумок змін від ШІ (Claude). Потрібен ANTHROPIC_API_KEY у .env на хостингу; без ключа — порожньо."""
    if not config.AI_KEY or not diff:
        return ""
    prompt = (f"Ти юрист Служби безпеки штату NG (рольовий сервер GTA 5). Нижче — зміни (unified diff) у документі «{title}». "
              "Коротко українською (до 6 пунктів) опиши, що саме змінилося по суті, і окремим пунктом — що це означає для співробітників СБУ. "
              "Без вступу.\n\n" + diff[:12000])
    try:
        async with aiohttp.ClientSession() as s:
            async with s.post("https://api.anthropic.com/v1/messages", timeout=aiohttp.ClientTimeout(total=60),
                              headers={"x-api-key": config.AI_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json"},
                              json={"model": AI_MODEL, "max_tokens": 700, "messages": [{"role": "user", "content": prompt}]}) as r:
                j = await r.json()
                return "".join(b.get("text", "") for b in j.get("content", []) if b.get("type") == "text").strip()[:3000]
    except Exception as e:
        log.warning("ШІ-підсумок: %s", e)
        return ""


async def notify(changes: list, u: dict | None):
    ch = await core.channel("log")
    if not ch:
        return
    word = {"new": "новий", "changed": "змінено", "removed": "вилучено"}
    lines = [style.kv("ЗМІН", str(len(changes)), "gold", True), style.rule()]
    for kind, _, title, add, rem, _ in changes[:15]:
        lines.append(style.c(f"• {word[kind]}: ", "red" if kind == "removed" else "green" if kind == "new" else "gold", True)
                     + style.c(title[:48] + (f"  +{add}/−{rem}" if kind == "changed" else ""), "white"))
    if len(changes) > 15:
        lines.append(style.c(f"… і ще {len(changes) - 15}", "gray"))
    lines += [style.rule(), style.kv("ОНОВИВ", u["name"] if u else "автоматично", "white"), style.kv("ДАТА", style.when(), "gray")]
    e = style.document("ЗМІНИ ЗАКОНОДАВЧОЇ БАЗИ ШТАТУ NG", 0x6F9FD6, desc=style.block(*lines), footer="Деталі — ЄІС «Сова» → База даних → Зміни законодавства")
    try:
        await ch.send(embed=e)
    except discord.HTTPException:
        pass


async def ensure_seeded():
    """Перше завантаження бази при старті, якщо вона порожня."""
    await asyncio.sleep(30)
    if not await db.one("SELECT slug FROM kb_docs LIMIT 1"):
        try:
            r = await sync(None)
            log.info("Законодавчу базу завантажено: %s документів", r["docs"])
        except Exception as e:
            log.warning("Первинне завантаження законодавчої бази: %s", e)


# ---------------------------------------------------------------- пошук
def snippet(text: str, q: str, width: int = 90) -> str:
    i = text.lower().find(q.lower())
    if i < 0:
        return text[:width * 2]
    a, b = max(0, i - width), min(len(text), i + len(q) + width)
    return ("…" if a else "") + text[a:b] + ("…" if b < len(text) else "")


async def search(q: str, sbu: bool = False) -> list[dict]:
    q = q.strip()
    if len(q) < 2:
        return []
    rows = await db.all("SELECT slug, title, grp_title, faction_abbr, text, sbu FROM kb_docs" + (" WHERE sbu=1" if sbu else ""))
    out = []
    for r in rows:
        lines = [ln for ln in r["text"].split("\n") if q.lower() in ln.lower()]
        if lines or q.lower() in r["title"].lower():
            out.append({"slug": r["slug"], "title": r["title"], "grp": r["grp_title"], "faction": r["faction_abbr"], "hits": len(lines),
                        "snippets": [snippet(ln, q) for ln in lines[:4]]})
    out.sort(key=lambda x: (-int(q.lower() in x["title"].lower()), -x["hits"]))
    return out[:40]
