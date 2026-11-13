"""Налаштування з адмін-панелі, що діють без перезапуску: мінімальні звання для дій, канали, згадки.
Тримаються в пам'яті (перевірки прав синхронні) і зберігаються в settings бази."""

# ключ: (назва дії, звання за замовчуванням, пояснення — хто ще має доступ незалежно від звання)
PERMS = {
    "act_any":        ("Перевірка звітів будь-якого відділу", 13, ""),
    "act_dept":       ("Перевірка звітів свого відділу", 9, "лише з роллю відділу; Академія — інструктори й ВКПП"),
    "rap_hr":         ("Погодження кадрових рапортів (підвищення, звільнення)", 13, "також ВКПП"),
    "rap_override":   ("Віза за начальника відділу (переведення, відпустка)", 14, ""),
    "case_chief":     ("Кейс-файли: погодження керівництвом СБУ", 14, ""),
    "bonus_manage":   ("Премії: формування відомостей", 14, ""),
    "bonus_finalize": ("Премії: схвалення й виплата", 15, "також Куратор (схвалення)"),
    "order_sign":     ("Підпис наказів про призначення й довільних наказів", 14, ""),
    "lib_edit":       ("Бібліотека: додавання й редагування матеріалів", 12, "також Інструктор (8) і ВКПП"),
    "exam_grade":     ("Іспити: перевірка й створення", 14, "також ВКПП"),
    "kb_sync":        ("Оновлення законодавчої бази", 15, ""),
    "memo_edit":      ("Пам'ятка статей і порядок затримання: редагування", 14, ""),
    "audit_view":     ("Перегляд кадрового аудиту", 12, "також ВКПП"),
    "dept_all":       ("Статистика відділів: усі підрозділи", 14, ""),
    "dept_own":       ("Статистика відділів: свої підрозділи", 12, "за ролями відділів; начальник управління — підрозділи з вкладки «Управління»"),
    "disc_chief":     ("Дисципліна: рішення керівництва (зняття, перевірки ВВБ)", 14, ""),
    "disc_minor":     ("Дисципліна: усне зауваження, письмова й сувора догана", 11, "своєму відділу; керівництво — усім"),
    "disc_major":     ("Дисципліна: штраф, пониження у званні, звільнення", 14, ""),
    "disc_blacklist": ("Дисципліна: звільнення з поданням до «Чорного списку»", 15, ""),
    "disc_journal":   ("Дисципліна: журнал стягнень свого відділу", 11, "також ВВБ"),
    "disc_journal_all": ("Дисципліна: журнал стягнень усієї СБУ", 13, "також ВВБ"),
    "cand_vvb":       ("Кадри: перевірка кандидатів і заявок (етап ВВБ)", 13, "також роль ВВБ"),
    "cand_vkpp":      ("Кадри: рішення про зарахування (етап ВКПП)", 14, "також роль ВКПП"),
    "rap_view_all":   ("Перегляд будь-якого рапорту", 13, "автор, той, хто розглядає, і начальники відділів бачать свої завжди"),
    "docs_view_all":  ("Картки документів у Discord: рапорти, накази, протоколи будь-кого", 14, ""),
    "docs_manage":    ("Анулювання погоджених документів і видалення чужих файлів", 14, ""),
    "fin_deb":        ("Мінфін: підготовка клопотань (з роллю ДЕБ)", 11, "лише з роллю ДЕБ"),
    "fin_any":        ("Мінфін: підготовка клопотань без ролі ДЕБ", 14, ""),
    "fin_approve":    ("Мінфін: погодження клопотань", 14, ""),
    "disc_vvb":       ("Дисципліна: накази ВВБ (зауваження, догани) будь-якому відділу", 4, "лише з роллю ВВБ; кому — співробітникам до 12-го звання, крім старших колег з ВВБ"),
    "news_post":      ("Новини: публікація на головній і в Discord", 14, "також Прес-служба"),
    "castro_broadcast": ("CASTRO CONTROL: оголошення на екрани всіх СБУ (текст, картинка)", 14, "розділ «Оголошення» в програмі"),
}

_perms: dict[str, int] = {}
channels: dict[str, int] = {}
mentions: dict[str, list[int]] = {}
nick: dict = {}  # шаблони нікнеймів, скорочення звань, відділи з позивними
mgmt: dict[str, list[str]] = {}
cfg: dict = {}  # налаштування роботи сайту (адмін-панель → «Налаштування»)
MODULES = {"news": "Новини на головній", "game": "Тренажери", "game_assault": "Тренажер «Штурм» (ЦСО «Альфа»)", "game_tail": "Тренажер «Хвіст» (ОРВ)",
           "game_audit": "Тренажер «Перевірка» (ВВБ)", "cases": "Кейс-файли", "fin": "Клопотання Мінфіну", "bonus": "Премії", "dept": "Статистика відділів"}
CFG = {  # ключ: (стандарт, мінімум, максимум, назва, пояснення)
    "inactive_days": (3, 1, 30, "Неактивний, якщо без звітів понад, діб", "«Статистика відділів» і тижневі звіти"),
    "reprimand_days": (7, 1, 90, "Строк дії письмової догани, діб", "для нових наказів"),
    "severe_days": (7, 1, 90, "Строк дії суворої догани, діб", "для нових наказів"),
    "exam_retry_h": (24, 0, 168, "Пауза між спробами іспиту, годин", "після нескладеної спроби"),
    "upload_mb": (0, 0, 100, "Ліміт розміру файлу, МБ", "0 — максимум сервера"),
    "dept_report_day": (6, 0, 6, "День тижневих звітів відділів", "0 — понеділок … 6 — неділя"),
    "dept_report_hour": (20, 0, 23, "Година тижневих звітів відділів (Київ)", ""),
}


def C(key: str):
    """Налаштування з адмін-панелі або стандартне."""
    if key in CFG:
        return int(cfg.get(key, CFG[key][0]))
    if key == "modules":
        return {k: bool((cfg.get("modules") or {}).get(k, True)) for k in MODULES}
    if key == "dept_report_on":
        return bool(cfg.get("dept_report_on", True))
    if key == "banner":
        return {"text": "", "tone": "info", "until": 0, **(cfg.get("banner") or {})}
    raise KeyError(key)


def module_on(key: str) -> bool:
    return C("modules").get(key, True)


def upload_limit_mb(server_max: float) -> float:
    v = C("upload_mb")
    return min(server_max, v) if v > 0 else server_max


def cfg_view() -> dict:
    return {"values": {k: C(k) for k in CFG}, "fields": [{"key": k, "default": v[0], "min": v[1], "max": v[2], "label": v[3], "note": v[4]} for k, v in CFG.items()],
            "modules": C("modules"), "moduleNames": MODULES, "dept_report_on": C("dept_report_on"), "banner": C("banner")}


async def save_cfg(db, data: dict) -> dict:
    clean = dict(cfg)
    for k, (d, lo, hi, *_x) in CFG.items():
        if k in data and str(data[k]).strip().lstrip("-").isdigit():
            clean[k] = max(lo, min(hi, int(data[k])))
    if isinstance(data.get("modules"), dict):
        clean["modules"] = {k: bool(data["modules"].get(k, True)) for k in MODULES}
    if "dept_report_on" in data:
        clean["dept_report_on"] = bool(data["dept_report_on"])
    if isinstance(data.get("banner"), dict):
        b = data["banner"]
        clean["banner"] = {"text": str(b.get("text") or "").strip()[:400], "tone": b.get("tone") if b.get("tone") in ("info", "warn", "bad", "ok") else "info",
                           "until": max(0, int(b.get("until") or 0))}
    await db.set_setting("admin_cfg", clean)
    cfg.clear(); cfg.update(clean)
    return cfg_view()  # начальники управлінь: sid → відділи, статистику яких бачить (вручну; інакше — за ролями Discord)


def P(key: str) -> int:
    """Мінімальне звання для дії (з адмін-панелі або стандартне)."""
    return _perms.get(key, PERMS[key][1])


def perms_view() -> list[dict]:
    return [{"key": k, "label": v[0], "default": v[1], "note": v[2], "value": P(k)} for k, v in PERMS.items()]


async def load(db):
    _perms.clear(); _perms.update({k: int(v) for k, v in (await db.get_setting("admin_perms", {})).items() if k in PERMS})
    channels.clear(); channels.update({k: int(v) for k, v in (await db.get_setting("admin_channels", {})).items() if v})
    mentions.clear(); mentions.update({k: [int(x) for x in v] for k, v in (await db.get_setting("admin_mentions", {})).items()})
    nick.clear(); nick.update(await db.get_setting("admin_nick", {}))
    cfg.clear(); cfg.update(await db.get_setting("admin_cfg", {}) or {})
    mgmt.clear(); mgmt.update({str(k): list(v) for k, v in (await db.get_setting("admin_mgmt", {})).items() if isinstance(v, list)})


async def save_perms(db, data: dict) -> dict:
    clean = {k: max(1, min(15, int(v))) for k, v in data.items() if k in PERMS and str(v).strip().isdigit()}
    clean = {k: v for k, v in clean.items() if v != PERMS[k][1]}  # зберігаємо лише відмінне від стандарту
    await db.set_setting("admin_perms", clean)
    _perms.clear(); _perms.update(clean)
    return clean
