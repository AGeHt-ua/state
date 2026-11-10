"""Налаштування бота «Сова». Усе секретне — лише у файлі .env на хостингу (у git не потрапляє)."""
import os
from pathlib import Path

try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).resolve().parent.parent / ".env")
except ImportError:
    pass


def env(key: str, default: str | None = None) -> str | None:
    value = os.getenv(key)
    return value if value not in (None, "") else default


DISCORD_TOKEN = env("DISCORD_TOKEN")
GUILD_ID = int(env("GUILD_ID", "1553695043947077684"))  # сервер «Служба Безпеки NG»

# Pterodactyl (SparkedHost) сам передає порт основної алокації в SERVER_PORT
API_PORT = int(env("API_PORT", env("SERVER_PORT", "8080")))
API_HOST = env("API_HOST", "0.0.0.0")

# Адреси сайту, яким дозволено звертатися до API (через кому)
SITE_ORIGINS = [o.strip() for o in env("SITE_ORIGINS", "https://ageht-ua.github.io,http://localhost:8765").split(",") if o.strip()]
SITE_URL = env("SITE_URL", "https://ageht-ua.github.io/state/")

DATA_DIR = Path(env("DATA_DIR", str(Path(__file__).resolve().parent.parent / "data")))
DATA_DIR.mkdir(parents=True, exist_ok=True)
DB_PATH = DATA_DIR / "sova.db"
BACKUP_DIR = DATA_DIR / "backups"
BACKUP_DIR.mkdir(parents=True, exist_ok=True)

# Тунель Cloudflare + ретранслятор (Cloudflare Worker) — постійна HTTPS-адреса для сайту
TUNNEL = env("SOVA_TUNNEL", "1")
RELAY_URL = env("RELAY_URL", "https://sova.d-f-12339.workers.dev")
AI_KEY = env("ANTHROPIC_API_KEY", "")  # необов'язково: ШІ-підсумок змін законодавства (вписує власник у .env)

BACKUP_EVERY_HOURS =float(env("BACKUP_EVERY_HOURS", "6"))
BACKUP_KEEP_DAYS = int(env("BACKUP_KEEP_DAYS", "30"))
SESSION_DAYS = int(env("SESSION_DAYS", "7"))
MAX_UPLOAD_MB = float(env("MAX_UPLOAD_MB", "10"))

# Назва категорії, у якій бот створює свої канали
CATEGORY_NAME = env("CATEGORY_NAME", "СОВА · кабінет")

# Наявні канали сервера СБУ. Для решти ключів бот створює власні канали в категорії вище.
# Ключі: lead, orv, vvb, atc, alpha, deb, vkpp, academy, press (звіти й рапорти відділу),
# rap:promo, rap:vac, rap:dismiss, rap:transfer (окремі канали для типів рапортів), audit, files, backups.
CHANNELS = {
    "rap:promo": 1563888686800568361,   # Рапорт на підвищення
    "rap:dismiss": 1563867645193887744, # Рапорт на звільнення
    "audit": 1564895460869677097,       # Кадровий аудит
    "welcome": 1553695048070336616,     # Панель із кнопкою «Отримати допуск»
    "access": 1566208970530492416,      # Заявки на допуск (підтверджує ВКПП)
    "rap:vac": 1566407528164892823,     # Рапорт на відпустку
    "rap:assign": 1566410120534163487,  # Рапорт про розподіл випускника Академії до підрозділу
    "rap:refund": 1567339374348210236,  # Рапорт на відшкодування коштів
    "cand:vvb": 1553695051857657910,    # Анкети кандидатів — перевірка ВВБ
    "cand:vkpp": 1564307526458023956,   # Анкети кандидатів — рішення ВКПП
    "bonus": 1566408775072616518,       # Відомості премій
    "disc": 1566408410172493854,        # Дисциплінарні накази
    "orders": 1566408610831933593,      # Накази про призначення на посаду
    "news": 1561702276173799544,         # Новини СБУ (стрічка на головній сторінці «Сови»)
    "cases:archive": 1567532887077691512,  # Затверджені Генпрокурором кейс-файли: PDF + текстовий файл з посиланнями
    # Канали рапортів начальників відділів: сюди приходять копії рапортів на переведення й розподіл (звідки та куди)
    "rapdept:vvb": 1565261032442564719,
    "rapdept:vkpp": 1565261439621406900,
    "rapdept:orv": 1565259414619947062,
    "rapdept:deb": 1565262996375080990,
    "rapdept:atc": 1565261697206190140,
    "rapdept:alpha": 1565261948201992243,
    # звіти — у каналах відділів категорії «СОВА · кабінет»; журнал рішень — #сова-журнал там само
}

# Згадки ролей у Discord: хто отримує сповіщення про документ
MENTIONS = {
    "order": [1553695043947077686],       # накази Голови / Заступника → роль СБУ
    "rap:promo": [1553695043947077691],   # рапорт на підвищення → ВКПП
    "cand:vvb": [1553695043947077692],    # анкета на перевірці ВВБ → ВВБ
    "cand:vkpp": [1553695043947077691],   # анкета на рішенні ВКПП → ВКПП
    "rap:refund": [1553695044253523996, 1553695044253523995],
    "fin:wait": [1553695044253523996, 1553695044253523995],     # клопотання / звіт Мінфіну на погодженні → Голова, Заступник  # відшкодування коштів → Голова, Заступник
    "rap:dismiss": [1553695043947077691],                       # рапорт на звільнення → ВКПП
    "rap:transfer": [1553695044253523991],                      # переведення → начальник відділу (бачать лише ті, хто має доступ до каналу)
    "rap:assign": [1553695043947077691, 1553695044253523991],   # розподіл з Академії → ВКПП, начальник відділу
    "access": [1553695043947077691],                            # заявка на допуск → ВКПП
    "bonus:paid": [1553695043947077686],                        # премії виплачено → СБУ
    "alert3": [1553695044253523996],                            # 3 догани → Голова
    "order:draft": [1553695044253523996, 1553695044253523995],  # проєкт наказу на підпис → Голова, Заступник
    "insp": [1553695044253523996],                              # службова перевірка ВВБ направлена Голові
    "news": [1553695043947077686],                              # новини з головної сторінки → роль СБУ
}

# Хто підтверджує заявки на допуск
ACCESS_APPROVER_ROLES = [
    1553695043947077691,  # ВКПП
]

# Ролі, які бот видає людині, щойно вона оформила допуск («Отримати допуск»)
JOIN_ROLES = [
    1553695043947077686,  # СБУ (основна)
    1553695043947077689,
]
try:
    import json as _json
    CHANNELS.update({k: int(v) for k, v in _json.loads(env("CHANNELS_JSON", "{}")).items()})
except ValueError:
    pass
