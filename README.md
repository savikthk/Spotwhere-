# Spotwhere

A Telegram Mini App that tells you **where to go**, described in your own words.

Type a situation — *"a quiet place for two, budget 1500"* or *"bowling with friends near Tverskaya"* — an LLM turns it into structured intent, the backend filters and ranks real Moscow venues, and you swipe through the results. It learns your taste from every like.

## How it works

```
free text ──▶ GigaChat parse ──▶ filter + rank ──▶ GigaChat rerank ──▶ swipe cards
             (mood, company,     (category, geo,     (best 5 of the
              category, geo,      budget, taste)      shortlist)
              budget, features)
```

1. **Parse** — GigaChat extracts `mood`, `company`, `category`, `location`, `budget` and `features` from the query.
2. **Geocode** — the location (metro station / district / landmark) is resolved via OpenStreetMap Nominatim; results are cached for speed and determinism.
3. **Rank** — venues are filtered by category, distance (tight radius for a precise point, wider for a district) and budget, then scored on vibe match and the user's learned taste.
4. **Rerank** — GigaChat picks the best 5 from the shortlist; if it fails, the algorithm's top 5 are used as a fallback.
5. **Learn** — likes and dislikes adjust per-tag weights, so recommendations personalize over time.

## Stack

- **Backend:** C++17 (Drogon), PostgreSQL, GigaChat (LLM), libcurl
- **Frontend:** Telegram Mini App (HTML/CSS/JS) with Yandex Maps JS API, served by the backend
- **Data pipeline:** Python — collect venues from OpenStreetMap → enrich with vibe tags via LLM → load into PostgreSQL
- **CI:** GitHub Actions — backend build, script and frontend syntax checks

The dataset is ~12.6k real venues inside the MKAD: cafes, restaurants, bars, pubs, clubs, hookah lounges, plus entertainment (bowling, banya/spa, water parks, trampoline parks, quests, cinemas, dance).

## Project structure

```
backend/            C++ backend (Drogon): REST API + serves the Mini App
frontend/           Telegram Mini App (static)
fetch_venues.py     collect venues from OpenStreetMap (Overpass) → venues.json
enrich_venues.py    enrich with vibe tags via GigaChat
load_to_db.py       load venues.json into PostgreSQL
docker-compose.yml  PostgreSQL
.github/workflows/  CI
```

## Getting started

Requirements (macOS / Homebrew):

```bash
brew install cmake drogon libpq curl cloudflared
```

Also needed: Docker Desktop (for PostgreSQL), a **GigaChat** key (developers.sber.ru), and a bot from **@BotFather** to open the Mini App.

```bash
git clone https://github.com/savikthk/Spotwhere-.git
cd Spotwhere-

cp .env.example .env      # put your GIGACHAT_KEY here
docker compose up -d      # PostgreSQL on localhost:5433

cd backend
cmake -B build
cmake --build build
```

Run:

```bash
set -a; source ../.env; set +a
./build/spotwhere_backend
```

Open **http://localhost:8080**.

## Populate the venue database

```bash
pip install -r requirements.txt
python fetch_venues.py     # OpenStreetMap → venues.json
python enrich_venues.py    # add vibe tags via LLM (optional)
python load_to_db.py       # load into PostgreSQL
```

## Open as a Telegram Mini App

Telegram only serves Mini Apps over HTTPS, so expose the local server through a tunnel:

```bash
cloudflared tunnel --url http://localhost:8080
```

Copy the `https://…trycloudflare.com` URL → **@BotFather → /mybots → your bot → Bot Settings → Menu Button** → paste it. Open the bot, tap the menu button, and the app loads inside Telegram.

> The free tunnel changes its URL on every restart — update it in BotFather each time.

## API

| Method | Path | Body | Description |
|--------|------|------|-------------|
| GET | `/health` | — | health check |
| GET | `/venues` | — | list all venues |
| POST | `/recommend` | `{text, user_id}` | recommend venues for a query |
| POST | `/like` | `{user_id, venue_id}` | like (updates taste) |
| POST | `/dislike` | `{user_id, venue_id}` | dislike (updates taste) |

## Configuration

Secrets live in `.env` (git-ignored) — see `.env.example` for the template. Dev PostgreSQL credentials are set in `docker-compose.yml`.

## Roadmap

- [x] Real venue data from OpenStreetMap
- [x] Geo search (radius from a metro station / district)
- [x] LLM rerank of the shortlist
- [x] Entertainment categories (bowling, banya, quests, …)
- [ ] initData validation (HMAC) for a trusted user_id
- [ ] "Choose together" shared sessions
- [ ] Wider data coverage (all of Moscow + region)
