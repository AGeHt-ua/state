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
    "disc_chief":     ("Дисципліна: рішення керівництва (зняття, перевірки ВВБ)", 14, ""),
    "news_post":      ("Новини: публікація на головній і в Discord", 14, "також Прес-служба"),
}

_perms: dict[str, int] = {}
channels: dict[str, int] = {}
mentions: dict[str, list[int]] = {}
nick: dict = {}  # шаблони нікнеймів, скорочення звань, відділи з позивними


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


async def save_perms(db, data: dict) -> dict:
    clean = {k: max(1, min(15, int(v))) for k, v in data.items() if k in PERMS and str(v).strip().isdigit()}
    clean = {k: v for k, v in clean.items() if v != PERMS[k][1]}  # зберігаємо лише відмінне від стандарту
    await db.set_setting("admin_perms", clean)
    _perms.clear(); _perms.update(clean)
    return clean
