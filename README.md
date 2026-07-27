# Spotwhere

Telegram Mini App, который советует, **куда сходить**, по описанию своими словами.
Пишешь ситуацию («тихое место вдвоём, бюджет 1500») → LLM извлекает намерение →
бэкенд ранжирует заведения и учится твоему вкусу по лайкам.

## Стек
- **Бэкенд:** C++ (Drogon), PostgreSQL, GigaChat (LLM)
- **Фронтенд:** Telegram Mini App (HTML/CSS/JS + Yandex Maps JS API), раздаётся самим бэкендом
- **Пайплайн данных:** Python-скрипты — сбор заведений из OpenStreetMap → обогащение вайб-тегами через LLM → загрузка в PostgreSQL

## Структура
```
backend/            C++ бэкенд (Drogon): REST API + отдаёт Mini App
frontend/           Telegram Mini App (статика)
fetch_venues.py     сбор заведений из OpenStreetMap (Overpass) → venues.json
enrich_venues.py    обогащение вайб-тегами через GigaChat
load_to_db.py       загрузка venues.json в PostgreSQL
venues.json         собранная база заведений
docker-compose.yml  PostgreSQL
```

## Требования (macOS / Homebrew)
```bash
brew install cmake drogon libpq curl cloudflared
```
- Docker Desktop — для PostgreSQL
- Ключ **GigaChat** (developers.sber.ru)
- Телеграм-бот от **@BotFather** — чтобы открыть Mini App

## Установка
```bash
git clone https://github.com/savikthk/Spotwhere-.git
cd Spotwhere-

cp .env.example .env      # впиши свой GIGACHAT_KEY
docker compose up -d      # PostgreSQL на localhost:5433

cd backend
cmake -B build
cmake --build build
```

## Запуск
Из папки `backend/` — подгрузить окружение и стартовать:
```bash
set -a; source ../.env; set +a
./build/spotwhere_backend
```
Открой в браузере **http://localhost:8080**.

## Наполнить базу заведений
Пайплайн на Python (нужны зависимости из `requirements.txt`):
```bash
pip install -r requirements.txt
python fetch_venues.py     # OpenStreetMap → venues.json
python enrich_venues.py    # добавить вайб-теги через LLM
python load_to_db.py       # залить в PostgreSQL
```

## Открыть как Telegram Mini App
Телеграм пускает Mini App только по HTTPS, поэтому нужен туннель:
```bash
cloudflared tunnel --url http://localhost:8080
```
Скопируй выданный `https://…trycloudflare.com` →
**@BotFather → /mybots → свой бот → Bot Settings → Menu Button** → вставь адрес.
Открой бота → кнопка меню → приложение загрузится в Телеграме.

> Бесплатный туннель меняет адрес при каждом перезапуске — обновляй его в BotFather.

## API
| Метод | Путь | Тело | Что делает |
|-------|------|------|-----------|
| GET | `/health` | — | проверка |
| GET | `/venues` | — | список заведений |
| POST | `/recommend` | `{text, user_id}` | подбор мест по запросу |
| POST | `/like` | `{user_id, venue_id}` | лайк (учёт вкуса) |
| POST | `/dislike` | `{user_id, venue_id}` | дизлайк (учёт вкуса) |

## Конфигурация
Секреты лежат в `.env` (не в репозитории) — шаблон в `.env.example`.
Dev-креды PostgreSQL заданы в `docker-compose.yml`.

## Roadmap
- [x] Реальные данные заведений (OpenStreetMap)
- [x] Гео-поиск (радиус от метро/района)
- [x] LLM-переранжирование шортлиста с объяснением подбора
- [ ] Валидация initData (HMAC) — доверенный user_id
- [ ] Сессии «выбрать вместе»
- [ ] Расширить покрытие данных (вся Москва + область)
