"""База даних → Пам'ятка (статті кодексів таблицею) і Порядок затримання (процесуальні дії крок за кроком).

Пам'ятка будується з законодавчої бази (kb_docs), тож після кожного звіряння з офіційною базою NG сама показує нові
статті, номери й санкції. Керівництво може поправити рядок вручну (коротший опис, покарання, ліцензія, примітка) — правка
пам'ятає, з якого тексту закону її зроблено, і якщо закон потім змінився, рядок позначається «закон змінився — перевірте».

Порядок затримання — кроки, складені за Процесуальним кодексом; керівництво редагує їх на сайті. Кожен крок посилається
на статті, і коли стаття змінюється після останньої редакції кроку, сайт показує попередження.
"""
import hashlib
import html
import re

import overrides as ov
from core import Fail
from db import db, now_ms

# кодекси, з яких будується пам'ятка: slug у законодавчій базі → коротка назва
CODES = {"criminal-code": "КК", "administrative-code": "КУпАП", "road-code": "ДК"}
REF_CODES = {"ПК": "procedural-code", "КК": "criminal-code", "КУпАП": "administrative-code", "АК": "administrative-code",
             "ДК": "road-code", "К": "constitution", "Конституція": "constitution", "ІСБУ": "pravyla-zastosuvannia-syly-sbu"}
POINT_DOCS = {"pravyla-zastosuvannia-syly-sbu"}  # документи з пунктами «1.4.» замість статей (Інструкція СБУ з порядку затримання)
FRESH_MS = 14 * 24 * 3600 * 1000   # «оновлено» — два тижні після зміни статті

ART_RE = re.compile(r"^Стаття\s+(\d+(?:[.-]\d+)*)\.?\s*(.*)$")
PART_RE = re.compile(r"^(?:ч\.\s*)?(\d+)\.\s+(.+)$")
SEC_RE = re.compile(r"^(РОЗДІЛ|Розділ)\s+[IVXLC\d]+")
SANCTION_RE = re.compile(r"\s+[-–—]\s*(?=(?:карає|тягне))|(?=(?-i:Стягнення)\s*:)", re.I)
NOTE_RE = re.compile(r"\s*(?=(?:\(\(\s*)?(?:Примітка|Роз'яснення|Роз’яснення)\s*:)")


def _h(s: str) -> str:
    return hashlib.sha256(s.encode()).hexdigest()[:16]


def can_edit(u: dict) -> bool:
    return u["rank"] >= ov.P("memo_edit") and not u.get("curator_ro")


# ---------------------------------------------------------------- коротке покарання
def _money(s: str) -> str:
    return s.replace("$", "").replace(",", " ").strip()


def _years(n: str) -> str:
    n = int(n)
    return "рік" if n % 10 == 1 and n % 100 != 11 else "роки" if n % 10 in (2, 3, 4) and n % 100 not in (12, 13, 14) else "років"


def short_pen(s: str) -> str:
    """«карається позбавленням волі на строк від 7 до 12 років із …» → «7-12 років». Не впізнали — повертаємо текст як є."""
    t = re.sub(r"^(?:[-–—]\s*)?(?:карається|караються|тягне за собою|тягнуть за собою|Стягнення\s*:)\s*", "", s.strip(), flags=re.I).rstrip(".;")
    if not t:
        return ""
    # лише головне речення санкції без уточнень у дужках («(у разі … штраф $1,500)», «для продавця …» далі — у повному тексті)
    head = re.split(r";\s*|\.\s+(?=[А-ЯІЇЄҐA-Z])", re.sub(r"\s*\([^()]*\)", "", t), maxsplit=1)[0]
    out = []
    for piece in re.split(r",?\s+або\s+", head):
        p, bits = piece.strip(), []
        for m in re.finditer(r"позбавлення[м]? волі.*?(?:від\s+(\d+)\s+до\s+(\d+)|до\s+(\d+)|на\s+(\d+))\s+(рок\w*|міс\w*)", p, re.I):
            lo, hi, upto, exact, unit = m.groups()
            if unit.lower().startswith("рок"):
                bits.append((m.start(), f"{lo}-{hi} {_years(hi)}" if lo else f"до {upto} {'року' if upto == '1' else 'років'}" if upto else f"{exact} {_years(exact)}"))
            else:
                bits.append((m.start(), f"{lo}-{hi} міс." if lo else f"до {upto} міс." if upto else f"{exact} міс."))
        for m in re.finditer(r"штраф\w*[^$\d]*?\$?\s*(\d[\d,]*(?:\s\d{3})*)(?:\s*(?:до|-|–)\s*\$?\s*(\d[\d,]*(?:\s\d{3})*))?", p, re.I):
            lo, hi = m.groups()
            bits.append((m.start(), f"Штраф {_money(lo)}" + (f" - {_money(hi)}" if hi else "")))
        for m in re.finditer(r"громадськ\w+ робот\w+.*?(?:від\s+(\d+)\s+до\s+(\d+)|до\s+(\d+)|на\s+(\d+))\s+год", p, re.I):
            lo, hi, upto, exact = m.groups()
            bits.append((m.start(), f"ГР {lo}-{hi} год" if lo else f"ГР до {upto} год" if upto else f"ГР {exact} год"))
        for m in re.finditer(r"арешт\w*.*?(?:від\s+(\d+)\s+до\s+(\d+)|до\s+(\d+)|на\s+(\d+))\s+(хв\w*|год\w*|діб|доб\w*)", p, re.I):
            lo, hi, upto, exact, unit = m.groups()
            un = "хв" if unit.lower().startswith("хв") else "год" if unit.lower().startswith("год") else "діб"
            bits.append((m.start(), f"Арешт {lo}-{hi} {un}" if lo else f"Арешт до {upto} {un}" if upto else f"Арешт {exact} {un}"))
        if not bits and re.search(r"попередженн", p, re.I):
            bits.append((0, "Попередження"))
        if bits:
            out.append(" + ".join(dict.fromkeys(b for _, b in sorted(bits))))
    if not out:
        return t[:220]
    extra = []
    ban = re.search(r"(?:позбавленн\w+ права (?!керування)|Чорн\w+ спис\w+|ЧС).*?(?:від\s+(\d+)\s+до\s+(\d+)|на\s+строк\s+до\s+(\d+)|на\s+(?:строк\s+)?(\d+(?:\s*-\s*\d+)?))\s+р(?:ок|ік)", t, re.I)
    if ban:
        lo, hi, upto, exact = ban.groups()
        extra.append(f"ЧС на {lo}-{hi} роки" if lo else f"ЧС до {upto} років" if upto else f"ЧС на {exact.replace(' ', '')} роки")
    drive = re.search(r"(?:позбавленн\w+ (?:права керування|водійськ\w+ прав)|заборон\w+ керування).*?(\d+(?:\s*-\s*\d+)?)\s+р(?:ок|ік)", t, re.I)
    if drive:
        n = drive.group(1).replace(" ", "")
        extra.append(f"заборона керування на {n} {_years(n.split('-')[-1])}")
    if re.search(r"конфіскац|вилученн\w+ (?:використан|транспорт|зброї)", t, re.I):
        extra.append("вилучення")
    return " або ".join(dict.fromkeys(out)) + "".join(f" + {x}" for x in extra)


def _licence(s: str) -> bool:
    return bool(re.search(r"анулюванн\w+ ліцензі|позбавленн\w+ ліцензі|ліцензі\w+ на зброю", s, re.I))


# ---------------------------------------------------------------- розбір кодексу
def _anchors(raw_html: str) -> tuple[dict, set]:
    ids = set(re.findall(r'id="([^"]+)"', raw_html or ""))
    arts = {}
    for aid, inner in re.findall(r'<(?:p|h3)[^>]*id="(st-[^"]+)"[^>]*class="kb-art"[^>]*>(.*?)</(?:p|h3)>', raw_html or "", re.S):
        m = re.search(r"Стаття\s+(\d+(?:[.-]\d+)*)", html.unescape(re.sub(r"<[^>]+>", "", inner)))
        if m:
            arts.setdefault(m.group(1), aid)
    return arts, ids


def _unglue(text: str) -> str:
    """«…штату NG.Стаття 16.1 Застосування…» — заголовок статті, приклеєний до попереднього рядка, переносимо на новий рядок."""
    return re.sub(r"(?<=[.!?»)])[ \t]*(?=Стаття\s+\d+(?:[.-]\d+)*\.?\s+[А-ЯІЇЄҐ])", "\n", text or "")


def parse_code(text: str, raw_html: str = "") -> list[dict]:
    """Текст кодексу → розділи зі статтями й частинами, у яких є санкція (карається / тягне / Стягнення)."""
    arts_id, ids = _anchors(raw_html)
    text = _unglue(text)
    sections, sec, art = [], None, None
    parts_buf: list[dict] = []

    def flush():
        nonlocal art
        if art and parts_buf:
            rows = []
            for p in parts_buf:
                body = " ".join(p["lines"]).strip()
                m = SANCTION_RE.search(body)
                if not m:
                    continue
                desc, pen = body[:m.start()].strip(" -–—"), body[m.start():].strip(" -–—")
                note = ""
                if (n := NOTE_RE.search(pen)) and n.start() > 0:
                    pen, note = pen[:n.start()].strip(), pen[n.start():].strip(" ()")
                desc = re.sub(r"^Суть правопорушення\s*:\s*", "", desc) or art["title"]
                # у таблиці — без уточнень у дужках (повний текст — у розгорнутому рядку)
                desc = re.sub(r"\s+([,.;:])", r"\1", re.sub(r"\s*\((?!\()[^()]*\)", "", desc)).strip(" ,;") or desc
                aid = arts_id.get(art["no"])
                anchor = f"{aid}-ch{p['part']}" if aid and p["part"] and f"{aid}-ch{p['part']}" in ids else aid
                rows.append({"key": f"{art['no']}.{p['part'] or 0}", "art": art["no"], "part": p["part"], "title": art["title"],
                             "desc": desc, "pen": short_pen(pen), "penFull": pen, "lawNote": note, "lic": _licence(pen), "anchor": anchor,
                             "find": f"Стаття {art['no']}", "full": body, "hash": _h(body)})
            if rows:
                if sec is None:
                    sections.append({"title": "", "rows": []})
                sections[-1]["rows"].extend(rows)
        art = None
        parts_buf.clear()

    for line in (text or "").split("\n"):
        line = line.strip()
        if not line:
            continue
        if SEC_RE.match(line):
            flush()
            sec = line
            sections.append({"title": line, "rows": []})
            continue
        m = ART_RE.match(line)
        if m and len(line) < 200:
            if art and art["no"] == m.group(1):
                continue  # заголовок статті, повторений у тексті
            flush()
            art = {"no": m.group(1), "title": m.group(2).strip()}
            continue
        if not art or line.startswith("((") or re.match(r"^(Примітка|Роз'яснення|Роз’яснення)", line):
            continue
        pm = PART_RE.match(line)
        if pm and not line.lower().startswith(("1 рік", "2 роки")):
            parts_buf.append({"part": pm.group(1), "lines": [pm.group(2)]})
        elif line.lower().startswith("стягнення") and parts_buf:
            parts_buf[-1]["lines"].append(line)
        elif parts_buf:
            if not SANCTION_RE.search(" ".join(parts_buf[-1]["lines"])):
                parts_buf[-1]["lines"].append(line)
        else:
            parts_buf.append({"part": "", "lines": [line]})
    flush()
    return [s for s in sections if s["rows"]]


# ---------------------------------------------------------------- пам'ятка
async def memo(code: str, u: dict) -> dict:
    if code not in CODES:
        raise Fail("Невідомий кодекс.", 404)
    d = await db.one("SELECT slug, title, text, html, hash, updated FROM kb_docs WHERE slug=?", code)
    if not d:
        raise Fail("Цього кодексу ще немає в законодавчій базі. Оновіть базу на вкладці «Зміни законодавства».", 404)
    sections = parse_code(d["text"], d["html"])
    over = (await db.get_setting("memo_over", {})).get(code, {})
    hist = await db.get_setting("memo_hist", {})
    seen = hist.get(code)
    t = now_ms()
    new_seen, changed_hist = {}, False
    for s in sections:
        for r in s["rows"]:
            prev = (seen or {}).get(r["key"])
            if seen is None:
                since = 0  # перший показ — усе «як було»
            elif not prev:
                since = t
            elif prev[0] != r["hash"]:
                since = t
            else:
                since = prev[1]
            new_seen[r["key"]] = [r["hash"], since]
            if not prev or prev[0] != r["hash"]:
                changed_hist = True
            r["fresh"] = since if since and t - since < FRESH_MS else 0
            o = over.get(r["key"])
            if o:
                r["auto"] = {"desc": r["desc"], "pen": r["pen"], "lic": r["lic"]}
                for k in ("desc", "pen", "note"):
                    if o.get(k):
                        r[k] = o[k]
                if "lic" in o:
                    r["lic"] = bool(o["lic"])
                r["hide"] = bool(o.get("hide"))
                r["edited"] = {"by": o.get("by_name"), "t": o.get("t")}
                r["stale"] = o.get("src") != r["hash"]
    if changed_hist or seen is None:
        hist[code] = new_seen
        await db.set_setting("memo_hist", hist)
    keys = {r["key"] for s in sections for r in s["rows"]}
    gone = [{"key": k, "desc": o.get("desc") or "", "t": o.get("t")} for k, o in over.items() if k not in keys]
    codes = [{"slug": r["slug"], "abbr": CODES[r["slug"]], "title": r["title"]}
             for r in await db.all("SELECT slug, title FROM kb_docs WHERE slug IN (%s)" % ",".join("?" * len(CODES)), *CODES)]
    codes.sort(key=lambda c: list(CODES).index(c["slug"]))
    return {"code": code, "abbr": CODES[code], "title": d["title"], "updated": d["updated"], "checked": await db.get_setting("kb_checked", None),
            "sections": sections, "gone": gone, "codes": codes, "canEdit": can_edit(u)}


async def save_row(u: dict, data: dict) -> dict:
    if not can_edit(u):
        raise Fail("Редагувати пам'ятку може керівництво (адмін-панель → Права).", 403)
    code, key = data.get("code"), str(data.get("key") or "")
    if code not in CODES or not re.match(r"^\d+(?:[.-]\d+)*\.\d+$", key):
        raise Fail("Невідомий рядок пам'ятки.")
    all_over = await db.get_setting("memo_over", {})
    over = all_over.setdefault(code, {})
    if data.get("reset"):
        over.pop(key, None)
        await db.set_setting("memo_over", all_over)
        await db.audit(u["sid"], "Пам'ятка: повернуто текст закону", 0, f"{CODES[code]} ст. {key}")
        return {"ok": True}
    d = await db.one("SELECT text, html FROM kb_docs WHERE slug=?", code)
    row = next((r for s in parse_code(d["text"], d["html"]) for r in s["rows"] if r["key"] == key), None) if d else None
    if not row and not data.get("drop"):
        raise Fail("Такого рядка вже немає в кодексі (статтю змінили або вилучили).", 409)
    if data.get("drop"):  # прибрати ручну правку рядка, якого вже немає в законі
        over.pop(key, None)
        await db.set_setting("memo_over", all_over)
        return {"ok": True}
    clip = lambda k, n: str(data.get(k) or "").strip()[:n]
    o = {"desc": clip("desc", 600), "pen": clip("pen", 240), "note": clip("note", 400), "hide": bool(data.get("hide")),
         "src": row["hash"], "by": u["sid"], "by_name": u["name"], "t": now_ms()}
    if data.get("lic") is not None:
        o["lic"] = bool(data.get("lic"))
    # те, що збігається з автоматичним текстом, не зберігаємо — тоді рядок оновлюватиметься разом із законом
    if o["desc"] == row["desc"]:
        o["desc"] = ""
    if o["pen"] == row["pen"]:
        o["pen"] = ""
    if o.get("lic") == row["lic"]:
        o.pop("lic", None)
    if not (o["desc"] or o["pen"] or o["note"] or o["hide"] or "lic" in o):
        over.pop(key, None)
    else:
        over[key] = o
    await db.set_setting("memo_over", all_over)
    await db.audit(u["sid"], "Пам'ятка: змінено рядок", 0, f"{CODES[code]} ст. {key}")
    return {"ok": True}


# ---------------------------------------------------------------- порядок затримання
DEFAULT_GUIDE = [
    {"title": "Підстава для затримання",
     "text": "Затримати можна лише за наявності підстави:\n• під час правопорушення або одразу після нього;\n• є достатні докази причетності;\n"
             "• є чинний ордер;\n• особа в офіційному розшуку;\n• інші випадки, прямо передбачені законом.\nЗатримання — не покарання, а тимчасове обмеження свободи.",
     "refs": ["ПК 13", "ПК 14", "ІСБУ 1.1"]},
    {"title": "Перевірка перед плановим затриманням",
     "text": "Якщо затримання не на місці злочину — спершу перевірте особу за базою даних правопорядку.\n"
             "Авто, схоже на викрадене чи в орієнтуванні, зупиняйте лише після спостереження, перевірки номерів за базою розшуку й збігу марки та кольору.",
     "refs": ["ІСБУ 1.2", "ІСБУ 1.3"]},
    {"title": "Увімкнути фіксацію",
     "text": "До початку дій увімкніть боді-камеру / запис. Без відеофіксації докази можуть визнати недопустимими, а дії — незаконними. "
             "Кожне застосування спецзасобів чи зброї перевіряє ВВБ.",
     "refs": ["ПК 12", "ПК 48", "ІСБУ 5.1"]},
    {"title": "Припинити правопорушення й знерухомити",
     "text": "Припиніть правопорушення, знерухомте особу й обмежте рухливість кайданками. Силу застосовуйте за стадіями:\n"
             "1) усна законна вимога й попередження;\n2) фізична сила (заломи, захват);\n3) нелетальні спецзасоби (кийок, Taser, газ);\n"
             "4) вогнепальна зброя — винятково: захист життя, збройний чи груповий напад, озброєна небезпечна особа, заручники, теракт.\n"
             "Наступна стадія — лише якщо попередня не дала результату або є пряма загроза життю.",
     "refs": ["ПК 15", "ПК 35", "ПК 36", "ПК 37", "ІСБУ 3.1", "ІСБУ 3.2", "ІСБУ 3.3"]},
    {"title": "Після кайданків — лише утримання",
     "text": "З моменту повного контролю й кайданків будь-яка сила припиняється: лише утримання й конвоювання. Бити знерухомлену особу категорично заборонено.\n"
             "Не примушуйте викидати речі чи зброю — вилучення лише через особистий обшук. Тон — твердий командний, без образ, лайки й залякування.",
     "refs": ["ІСБУ 4.1", "ІСБУ 4.3", "ІСБУ 4.4", "ІСБУ 2.3"]},
    {"title": "Медичний пріоритет",
     "text": "Якщо особа в тяжкому чи критичному стані (поранення, непритомність) — спершу медична допомога. Не заважайте медикам, не застосовуйте кайданки під час реанімації. "
             "Процесуальні дії — лише після стабілізації й дозволу медика.",
     "refs": ["ПК 15", "ІСБУ 1.5"]},
    {"title": "Представитися",
     "text": "Назвіть ім'я (або позивний), відомство, посаду, звання й пред'явіть жетон або службове посвідчення.",
     "refs": ["ПК 15", "ПК 8"]},
    {"title": "Оголосити підстави й статті",
     "text": "Чітко оголосіть, за що затримано, і назвіть статті, які інкримінуються (пам'ятка статей — на сусідній вкладці).",
     "refs": ["ПК 15", "ПК 7"]},
    {"title": "Роз'яснити права (правило Міранди)",
     "text": "Невідкладно після знерухомлення:\n«Ви затримані. Відповідно до статті 63 Конституції штату NG ви маєте право зберігати мовчання і не свідчити проти себе та своїх близьких. "
             "Усе, що ви скажете, може бути використано проти вас у суді. Ви маєте право на захисника (адвоката) з моменту затримання, право на один телефонний дзвінок "
             "тривалістю до трьох хвилин, а також право на медичну допомогу. Чи зрозумілі вам ваші права?»\n"
             "Не зрозумів — повторіть (до двох разів). Без роз'яснення прав будь-які показання — недопустимі докази.",
     "refs": ["ПК 15", "ПК 7", "ПК 11", "ІСБУ 1.4"]},
    {"title": "Поверхневий огляд",
     "text": "Огляньте особу на приховану зброю чи засоби нападу. Повний особистий обшук, обшук авто чи приміщення — за правилами відповідних статей (за потреби — ордер).",
     "refs": ["ПК 17", "ПК 18", "ПК 19", "ПК 20"]},
    {"title": "Особливі категорії",
     "text": "• Співробітник держоргану, силовик: обов'язковий виклик чергового прокурора / ДБР / керівництва.\n"
             "• Особа з недоторканністю: затримання лише на місці злочину проти життя; у КПЗ не поміщати, негайно повідомити Генпрокурора.\n"
             "• Агент під прикриттям (жетон спецпідрозділу): припинити відкриті дії, перевірити через керівника підрозділу.\n"
             "• Державна зрада, диверсія, тероризм: обов'язковий виклик прокурора або ДБР.",
     "refs": ["ПК 16.2", "ПК 15"]},
    {"title": "Доставити до службового приміщення",
     "text": "Безпечно доставте затриманого до приміщення СБУ, поліції, ДБР або ізолятора.",
     "refs": ["ПК 15"]},
    {"title": "Забезпечити права затриманого",
     "text": "Дзвінок до 3 хвилин; виклик державного адвоката (і за потреби прокурора) через загальну хвилю департаменту. "
             "Очікування адвоката чи прокурора (до 5 хв відповідь + до 10 хв прибуття), бесіда з захисником (до 5 хв) і протокольний допит (до 30 хв) зупиняють строк затримання.",
     "refs": ["ПК 15", "ПК 7", "ПК 23", "ПК 24"]},
    {"title": "Вилучення речей",
     "text": "Вилучене опишіть у протоколі й здайте до кімнати зберігання речових доказів (строки — ст. 22 ПК). Банківські картки й рахунки — за окремою процедурою.",
     "refs": ["ПК 21", "ПК 22", "ПК 22.1"]},
    {"title": "Рішення в межах 60 хвилин",
     "text": "Загальний строк затримання — 60 хвилин (без зупинок). За цей час: скорочене провадження (якщо санкція / сукупність ≤ 15 років), "
             "погодження прокурором поміщення під варту або ордер на арешт. Інакше — негайно звільнити.\n"
             "Застава заборонена за зброю, насильницькі й корисливо-насильницькі злочини, злочини проти держбезпеки та представників влади (перелік — ст. 16.1 ПК).",
     "refs": ["ПК 15", "ПК 16.1"]},
    {"title": "Скласти протокол",
     "text": "Складіть протокол затримання й внесіть відомості до бази правопорядку (у «Сові» — База даних → Протоколи затримання). "
             "Обов'язкові відомості — ст. 41 ПК; фальсифікація документів — злочин. Матеріали фіксації зберігайте.",
     "refs": ["ПК 40", "ПК 41", "ПК 42", "ПК 49"]},
]


def _article_texts(text: str, points: bool = False) -> dict[str, str]:
    """Номер статті (або пункту «1.4.» в інструкціях) → її текст до наступної статті / пункту."""
    out, cur, buf = {}, None, []
    head = re.compile(r"^(\d+\.\d+)\.\s") if points else ART_RE
    for line in _unglue(text).split("\n"):
        m = head.match(line.strip())
        if m and (points or len(line) < 220):  # заголовок статті — короткий рядок; пункт інструкції може бути довгим
            no = m.group(1)
            if cur and no != cur:
                out.setdefault(cur, "\n".join(buf))
                buf = []
            cur = no
        if cur:
            buf.append(line)
    if cur:
        out.setdefault(cur, "\n".join(buf))
    return out


def parse_ref(ref: str) -> tuple[str, str] | None:
    m = re.match(r"^\s*(ПК|КК|КУпАП|АК|ДК|ІСБУ|К|Конституція)\s*(?:ст\.?\s*)?(\d+(?:[.-]\d+)*)\s*$", ref or "")
    return (REF_CODES[m.group(1)], m.group(2)) if m else None


async def _ref_info(refs: list[str]) -> dict[str, dict]:
    slugs = {p[0] for r in refs if (p := parse_ref(r))}
    if not slugs:
        return {}
    docs = {d["slug"]: d for d in await db.all("SELECT slug, title, text, html FROM kb_docs WHERE slug IN (%s)" % ",".join("?" * len(slugs)), *slugs)}
    cache = {}
    out = {}
    for r in refs:
        p = parse_ref(r)
        if not p or p[0] not in docs:
            out[r] = {"ok": False}
            continue
        slug, no = p
        if slug not in cache:
            cache[slug] = (_article_texts(docs[slug]["text"], slug in POINT_DOCS), _anchors(docs[slug]["html"])[0])
        texts, anchors = cache[slug]
        t = texts.get(no)
        out[r] = {"ok": bool(t), "slug": slug, "anchor": anchors.get(no), "find": f"{no}." if slug in POINT_DOCS else f"Стаття {no}", "hash": _h(t) if t else None,
                  "title": (t or "").split("\n", 1)[0][:160], "doc": docs[slug]["title"]}
    return out


def _clean_steps(steps) -> list[dict]:
    if not isinstance(steps, list) or not steps:
        raise Fail("Додайте хоча б один крок.")
    out = []
    for s in steps[:40]:
        title = str((s or {}).get("title") or "").strip()[:160]
        text = str((s or {}).get("text") or "").strip()[:3000]
        refs = [str(x).strip()[:30] for x in ((s or {}).get("refs") or []) if str(x).strip()][:12]
        if not title:
            raise Fail("У кожного кроку має бути назва.")
        bad = [r for r in refs if not parse_ref(r)]
        if bad:
            raise Fail(f"Не розпізнано посилання: {', '.join(bad)}. Формат: «ПК 15», «КК 342», «ПК 16.2», «ІСБУ 1.4».")
        out.append({"title": title, "text": text, "refs": refs})
    return out


async def guide(u: dict) -> dict:
    g = await db.get_setting("detain_guide", None)
    steps = (g or {}).get("steps") or [dict(s, refHash={}) for s in DEFAULT_GUIDE]
    info = await _ref_info([r for s in steps for r in s.get("refs", [])])
    for s in steps:
        s["links"] = []
        for r in s.get("refs", []):
            i = info.get(r, {"ok": False})
            saved = (s.get("refHash") or {}).get(r)
            s["links"].append({"ref": r, "ok": i["ok"], "slug": i.get("slug"), "anchor": i.get("anchor"), "find": i.get("find"), "title": i.get("title"),
                               "changed": bool(g and saved and i.get("hash") and saved != i["hash"])})
    return {"steps": steps, "custom": bool(g), "updated": (g or {}).get("t"), "by": (g or {}).get("by_name"), "canEdit": can_edit(u),
            "checked": await db.get_setting("kb_checked", None)}


async def save_guide(u: dict, data: dict) -> dict:
    if not can_edit(u):
        raise Fail("Редагувати порядок затримання може керівництво (адмін-панель → Права).", 403)
    if data.get("reset"):
        await db.set_setting("detain_guide", None)
        await db.audit(u["sid"], "Порядок затримання: повернуто стандартний", 0, "")
        return {"ok": True}
    steps = _clean_steps(data.get("steps"))
    info = await _ref_info([r for s in steps for r in s["refs"]])
    missing = [r for r, i in info.items() if not i["ok"]]
    if missing:
        raise Fail(f"Таких статей немає в законодавчій базі: {', '.join(missing)}.")
    for s in steps:
        s["refHash"] = {r: info[r]["hash"] for r in s["refs"]}  # з якою редакцією статей звірено крок
    await db.set_setting("detain_guide", {"steps": steps, "t": now_ms(), "by": u["sid"], "by_name": u["name"]})
    await db.audit(u["sid"], "Порядок затримання: змінено", 0, f"кроків: {len(steps)}")
    return {"ok": True}
