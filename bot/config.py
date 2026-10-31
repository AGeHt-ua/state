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

BACKUP_EVERY_HOURS = float(env("BACKUP_EVERY_HOURS", "6"))
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
    "audit": 1564895460869677097,       # Кадровий аудит
}
try:
    import json as _json
    CHANNELS.update({k: int(v) for k, v in _json.loads(env("CHANNELS_JSON", "{}")).items()})
except ValueError:
    pass
