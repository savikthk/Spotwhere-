# Spotwhere

**Tell it where you want to go — in plain words — and swipe through real places that fit.**

![CI](https://github.com/savikthk/Spotwhere-/actions/workflows/ci.yml/badge.svg)
![C++17](https://img.shields.io/badge/C%2B%2B-17-00599C?logo=cplusplus&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white)
![Telegram Mini App](https://img.shields.io/badge/Telegram-Mini%20App-26A5E4?logo=telegram&logoColor=white)

Spotwhere is a Telegram Mini App for deciding **where to go** in Moscow. You describe a situation the way you'd say it to a friend; an LLM turns that into structured intent, a C++ backend filters and ranks ~12.6k real venues, and you get a Tinder-style deck of cards. Every like teaches it your taste.

> **Type this…** → **get this**
> - *"quiet place for two, budget 1500"* → cosy cafés and wine bars within budget
> - *"bar near metro Tverskaya"* → Hidden, Beermarket, Let's Rock — all within 800 m of the station
> - *"bowling with friends"* → Kosmik, Planeta Bowling, Globus
> - *"banya for a company on the weekend"* → real bathhouses, not restaurants

## Why it's more than a keyword search

- **Two-stage LLM.** GigaChat first *parses* the query into `mood / company / category / location / budget / features`, then *reranks* the algorithm's shortlist to pick the 5 that actually fit — with a deterministic algorithmic fallback if the model misbehaves.
- **Location that means something.** A named metro or address gets a tight walking radius; a district gets a wider one. Geocoding is cached and retried, so results are fast and repeatable instead of drifting across the city.
- **It learns you.** Likes and dislikes nudge per-tag weights, so the same query gives better picks the more you use it.
- **Real data, real coverage.** ~12.6k venues inside the MKAD — cafés, restaurants, bars, pubs, clubs, hookah, plus entertainment: bowling, banya/spa, water parks, trampoline parks, quests, cinemas, dance.

## How a request flows

```
free text ──▶ GigaChat parse ──▶ geocode ──▶ filter + rank ──▶ GigaChat rerank ──▶ swipe cards
             mood, company,      Nominatim    category, radius,   best 5 of the
             category, budget,   (cached)      budget, vibe,       shortlist
             location, features                learned taste       (algo fallback)
```

## Example

```bash
curl -X POST localhost:8080/recommend \
  -H 'Content-Type: application/json' \
  -d '{"text": "bar near metro Tverskaya", "user_id": 1}'
```

```json
{
  "query": { "category": "бар", "location": "тверская", "precise": true },
  "results": [
    {
      "id": 1212,
      "name": "Hidden",
      "description": "Бар",
      "tags": ["бар", "коктейли", "веранда", "компания"],
      "avg_bill": 1500,
      "lat": 55.7600, "lon": 37.6140,
      "maps_url": "https://yandex.ru/maps/?text=Hidden%20Москва"
    }
  ]
}
```

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

The backend loads all venues into memory on startup and serves both the REST API and the Mini App itself — no separate web server.

## Getting started

Requirements (macOS / Homebrew) — plus Docker Desktop, a **GigaChat** key (developers.sber.ru) and a bot from **@BotFather**:

```bash
brew install cmake drogon libpq curl cloudflared
```

Build and run:

```bash
git clone https://github.com/savikthk/Spotwhere-.git
cd Spotwhere-

cp .env.example .env      # put your GIGACHAT_KEY here
docker compose up -d      # PostgreSQL on localhost:5433

cd backend
cmake -B build
cmake --build build

set -a; source ../.env; set +a
./build/spotwhere_backend  # http://localhost:8080
```

Populate the database:

```bash
pip install -r requirements.txt
python fetch_venues.py     # OpenStreetMap → venues.json
python enrich_venues.py    # add vibe tags via LLM (optional)
python load_to_db.py       # load into PostgreSQL
```

## Open as a Telegram Mini App

Telegram serves Mini Apps over HTTPS only, so expose the local server through a tunnel:

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

Secrets live in `.env` (git-ignored); see `.env.example`. Dev PostgreSQL credentials are in `docker-compose.yml`.

## Roadmap

- [x] Real venue data from OpenStreetMap
- [x] Geo search with a radius from a metro station / district
- [x] Two-stage LLM: parse + shortlist rerank
- [x] Taste personalization from likes/dislikes
- [x] Entertainment categories (bowling, banya, quests, …)
- [ ] initData validation (HMAC) for a trusted user_id
- [ ] "Choose together" shared sessions
- [ ] Wider data coverage (all of Moscow + region)
