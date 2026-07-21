# Spotwhere

Telegram Mini App, который советует, **куда сходить**, по описанию своими словами.
Пишешь ситуацию («тихое место вдвоём, бюджет 1500») → LLM извлекает намерение →
бэкенд ранжирует заведения и учится твоему вкусу по лайкам.

## Стек
- **Бэкенд:** C++ (Drogon), PostgreSQL, GigaChat (LLM)
- **Фронтенд:** Telegram Mini App (HTML/CSS/JS), раздаётся самим бэкендом
- **Прототип:** Python — aiogram-бот + FastAPI (файлы в корне), оставлен для истории

## Структура
```
backend/            C++ бэкенд (Drogon): REST API + отдаёт Mini App
frontend/           Telegram Mini App (статика)
venues.json         база заведений (пока dev-сид)
docker-compose.yml  PostgreSQL
*.py                первый прототип на Python (бот + FastAPI)
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

## Конфигурация
Секреты лежат в `.env` (не в репозитории) — шаблон в `.env.example`.
Dev-креды PostgreSQL заданы в `docker-compose.yml`.

## Roadmap
- [ ] Валидация initData (HMAC) — доверенный user_id
- [ ] Реальные данные заведений (OpenStreetMap)
- [ ] Гео-поиск (PostGIS)
- [ ] Сессии «выбрать вместе»
- [ ] React-фронтенд с продакшн-дизайном
