"""Ролі Discord-сервера СБУ та правила доступу до кабінету."""

SBU_ROLE = 1553695043947077686      # основна роль, обов'язкова для всіх
PRESS_ROLE = 1564014095836119140    # Прес-секретар
PROSECUTOR_ROLE = 1566246794214641714  # Генеральний прокурор: не співробітник СБУ, бачить лише кейс-файли на погодженні

# Індекс = звання - 1
RANK_ROLES = [
    1553695044169506969,  # 1  Стажер
    1553695044169506970,  # 2  Молодший агент
    1553695044169506975,  # 3  Агент
    1553695044169506976,  # 4  Старший агент
    1553695044169506972,  # 5  Молодший оперуповноважений
    1553695044169506973,  # 6  Оперуповноважений
    1553695044169506974,  # 7  Старший оперуповноважений
    1566139705446109265,  # 8  Інструктор
    1553695044253523988,  # 9  Керівник групи
    1553695044253523989,  # 10 Керівник сектору
    1553695044253523990,  # 11 Заступник начальника відділу
    1553695044253523991,  # 12 Начальник відділу
    1553695044253523992,  # 13 Начальник управління
    1553695044253523995,  # 14 Заступник Голови СБУ
    1553695044253523996,  # 15 Голова СБУ (адміністратор сайту)
]

# (назва, група, мінімальна вислуга в добах для переходу НА це звання; None — наказом Голови)
RANKS = [
    ("Стажер", "jr", None), ("Молодший агент", "jr", 0), ("Агент", "jr", 1),
    ("Старший агент", "op", 2), ("Молодший оперуповноважений", "op", 3), ("Оперуповноважений", "op", 4),
    ("Старший оперуповноважений", "op", 5), ("Інструктор", "mid", None), ("Керівник групи", "mid", None),
    ("Керівник сектору", "mid", None), ("Заступник начальника відділу", "lead", None), ("Начальник відділу", "lead", None),
    ("Начальник управління", "lead", None), ("Заступник Голови СБУ", "lead", None), ("Голова СБУ", "lead", None),
]

DEPTS = {
    "lead":    {"s": "Керівництво", "n": "Керівництво СБУ", "role": None, "color": 0xE2C07F, "channel": "сова-керівництво"},
    "orv":     {"s": "ОРВ", "n": "Оперативно-розшуковий відділ", "role": 1553695044169506967, "color": 0xD9A441, "channel": "сова-орв"},
    "vvb":     {"s": "ВВБ", "n": "Відділ внутрішньої безпеки", "role": 1553695043947077692, "color": 0xD4605A, "channel": "сова-ввб"},
    "atc":     {"s": "АТЦ", "n": "Антитерористичний центр", "role": 1553695043947077690, "color": 0x6F9FD6, "channel": "сова-атц"},
    "alpha":   {"s": "ЦСО «А»", "n": "Центр спеціальних операцій «Альфа»", "role": 1562021631713349632, "color": 0x8FB35F, "channel": "сова-альфа"},
    "deb":     {"s": "ДЕБ", "n": "Департамент економічної безпеки", "role": 1553695044169506968, "color": 0x4FB3A6, "channel": "сова-деб"},
    "vkpp":    {"s": "ВКПП", "n": "Відділ кадрів та підготовки персоналу", "role": 1553695043947077691, "color": 0xE0866B, "channel": "сова-вкпп"},
    "academy": {"s": "Академія", "n": "Академія СБУ · стажування", "role": None, "color": 0xA68AD6, "channel": "сова-академія"},
    "press":   {"s": "Прес-служба", "n": "Прес-служба СБУ", "role": None, "color": 0xC98AB8, "channel": "сова-прес"},
    "prosecutor": {"s": "Прокуратура", "n": "Офіс Генерального прокурора", "role": None, "color": 0x9AA7B8, "channel": None},
}
OPS_DEPTS = ["orv", "vvb", "atc", "alpha", "deb", "vkpp"]


# Скорочення звань для нікнейму (Discord дозволяє не більше 32 символів)
RANK_SHORT = ["Стажер", "Мол. агент", "Агент", "Ст. агент", "Мол. опер", "Опер", "Ст. опер", "Інструктор",
              "Кер. групи", "Кер. сектору", "Заст. нач. від.", "Нач. відділу", "Нач. управл.", "Заст. Голови", "Голова СБУ"]


def nickname(rank: int, name: str, sid: int) -> str:
    """«Звання | Ім'я Прізвище | Static ID», за потреби ім'я скорочується до «І. Прізвище»."""
    short = RANK_SHORT[rank - 1] if 1 <= rank <= len(RANK_SHORT) else "СБУ"
    nick = f"{short} | {name} | {sid}"
    if len(nick) > 32:
        parts = name.split()
        if len(parts) >= 2:
            nick = f"{short} | {parts[0][0]}. {' '.join(parts[1:])} | {sid}"
    return nick[:32]


def rank_name(rank: int) -> str:
    return RANKS[rank - 1][0] if 1 <= rank <= len(RANKS) else "—"


def resolve(role_ids: set[int]) -> dict:
    """Визначає доступ за ролями учасника. Повертає ok, why, rank, dept, multi."""
    if SBU_ROLE not in role_ids:
        if PROSECUTOR_ROLE in role_ids:
            return {"ok": True, "rank": 0, "dept": "prosecutor", "multi": False}
        return {"ok": False, "why": "Немає основної ролі СБУ"}
    rank = 0
    for i, rid in enumerate(RANK_ROLES):
        if rid in role_ids:
            rank = max(rank, i + 1)
    if not rank:
        return {"ok": False, "why": "Немає ролі звання СБУ"}
    depts = [k for k in OPS_DEPTS if DEPTS[k]["role"] in role_ids]
    if rank >= 13:
        return {"ok": True, "rank": rank, "dept": "lead", "multi": False}
    if PRESS_ROLE in role_ids:
        return {"ok": True, "rank": rank, "dept": "press", "multi": False}
    if depts:
        return {"ok": True, "rank": rank, "dept": depts[0], "multi": len(depts) > 1}
    if rank <= 2:
        return {"ok": True, "rank": rank, "dept": "academy", "multi": False}
    return {"ok": False, "why": "Немає ролі відділу (ОРВ, ВВБ, АТЦ, ЦСО «А», ДЕБ або ВКПП)"}


def roles_for(rank: int, dept: str) -> set[int]:
    """Набір ролей СБУ, які мають бути в співробітника за карткою."""
    out = {SBU_ROLE, RANK_ROLES[rank - 1]}
    if DEPTS.get(dept, {}).get("role"):
        out.add(DEPTS[dept]["role"])
    if dept == "press":
        out.add(PRESS_ROLE)
    return out


ALL_SBU_ROLES = {SBU_ROLE, PRESS_ROLE, *RANK_ROLES, *(d["role"] for d in DEPTS.values() if d["role"])}
