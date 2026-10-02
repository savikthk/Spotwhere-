# Spotwhere

**Tell it where you want to go, in plain words, and swipe through real places nearby that fit.**

![CI](https://github.com/savikthk/Spotwhere-/actions/workflows/ci.yml/badge.svg)
![TypeScript](https://img.shields.io/badge/TypeScript-Node%2024-3178C6?logo=typescript&logoColor=white)
![PostGIS](https://img.shields.io/badge/PostgreSQL-16%20%2B%20PostGIS-4169E1?logo=postgresql&logoColor=white)
![Telegram Mini App](https://img.shields.io/badge/Telegram-Mini%20App-26A5E4?logo=telegram&logoColor=white)

Spotwhere is a Telegram Mini App for deciding **where to go** in Moscow. You describe a situation the way you'd say it to a friend, the backend works out what and where you mean, finds real venues around that point among ~12.6k places, and you get a Tinder-style deck of cards. Every like teaches it your taste.

> **Type this…** → **get this**
> - *"бар у метро Тверская"* → bars 60–130 m from the station, nearest first
> - *"кафе на Арбате"* → cafés inside the Arbat district
> - *"боулинг с друзьями у Тверской"* → nothing within 800 m, so the search widens to 2.5 km and says so
> - *"кофейня рядом"* + **Near me** → coffee within 1 km of you

## How a request is answered

The algorithm does the work; the language model only fills gaps and picks from a ready shortlist.

```
free text ─▶ rules ──────────────▶ place ─────────────▶ PostGIS search ─▶ ranking ─▶ GigaChat pick ─▶ cards
             category, cuisine,    metro station or      radius or district   wishes, taste,   best 5 of the top 10
             mood, company,        district from the      polygon, widened     distance         (ids validated,
             budget, place         gazetteer; landmark    step by step when                     algorithm order
             (GigaChat only if     via Nominatim; or      nothing is found                      if it fails)
             rules found nothing)  your location
```

- **Rules first.** A vocabulary of categories, cuisines, moods, company, features and budgets ("до 1500", "5к", "недорого") plus a gazetteer of 240 metro stations and 132 districts from OpenStreetMap. Russian word forms are matched by stems, so "у Чистых прудов" finds «Чистые пруды». A station needs a place cue ("у", "возле", "метро", "в районе") unless its name has several words, so "спортивный бар" stays a sports bar, not the «Спортивная» station.
- **The language model is narrow.** GigaChat is called only when the rules understood nothing or a place stayed unresolved, and its answer is checked against closed lists. It can reorder the top 10 candidates the algorithm found, but never add new ones. If GigaChat is unreachable, it is paused for two minutes and every request is answered by the algorithm alone.
- **Location that means something.** Distances are computed in PostGIS (`geography`, GiST index). Metro and landmarks get 800 m, your own location 1 km, a district its real polygon. When nothing fits, the radius grows to 1.5, 2.5 and 4 km before the category is relaxed, and the response tells why.
- **It learns you.** Likes and dislikes nudge per-tag weights (capped at ±2), so the same query gives better picks the more you use it.

## Example

```bash
curl -X POST localhost:8080/recommend \
  -H 'Content-Type: application/json' \
  -d '{"text": "бар у метро Тверская", "user_id": 1}'
```

```json
{
  "query": { "category": "бар", "cuisines": [], "mood": null, "company": null, "features": [], "budget_max": null, "location": "Тверская" },
  "interpreted_by": "rules",
  "ranked_by": "algorithm",
  "place": { "kind": "metro", "name": "Тверская", "lat": 55.764895, "lon": 37.606313, "radius_m": 800 },
  "notes": [],
  "results": [
    {
      "id": 1212,
      "name": "Молодость",
      "description": "Бар",
      "address": "",
      "tags": ["бар", "коктейли", "шумно", "компания"],
      "avg_bill": 1500,
      "lat": 55.7654, "lon": 37.6059,
      "maps_url": "https://yandex.ru/maps/?text=...",
      "distance_m": 62,
      "matched": []
    }
  ]
}
```

`notes` explain what happened: `place_not_found`, `radius_expanded`, `area_expanded`, `filters_relaxed`, `outside_city`, `location_needed`.

## Project structure

```
backend/            TypeScript backend (Fastify, PostGIS): REST API + serves the Mini App
  src/domain/       rules: vocabulary, query parser and gazetteer, ranking
  src/services/     search, taste, cached geocoding
  src/llm/          GigaChat adapter (interpret, pick, outage pause)
  src/geocoding/    Nominatim fallback geocoder
  migrations/       SQL migrations, applied on start
  scripts/          places:fetch (OSM gazetteer), db:load (venues + places into PostgreSQL)
  data/places.json  metro stations and district polygons from OpenStreetMap
db/Dockerfile       PostgreSQL 16 with PostGIS (native on Apple Silicon)
frontend/           Telegram Mini App (static)
fetch_venues.py     collect venues from OpenStreetMap (Overpass) → venues.json
enrich_venues.py    enrich with vibe tags via GigaChat (optional)
```

## Getting started

Requirements: Node 24, Docker Desktop, optionally a **GigaChat** key (developers.sber.ru) and a bot from **@BotFather**.

```bash
git clone https://github.com/savikthk/Spotwhere-.git
cd Spotwhere-

cp .env.example .env              # GIGACHAT_KEY is optional
docker compose up -d --build      # PostgreSQL + PostGIS on localhost:5433

cd backend
npm ci
npm run db:load                   # venues.json + data/places.json → database
npm start                         # http://localhost:8080
```

Without `GIGACHAT_KEY` the app works on rules alone.

### Data

```bash
pip install -r requirements.txt
python fetch_venues.py            # OpenStreetMap → venues.json
python enrich_venues.py           # vibe tags via GigaChat (optional)
cd backend
npm run places:fetch              # refresh metro stations and districts (optional, committed)
npm run db:load
```

### Tests

```bash
cd backend
npm run lint
npm run typecheck
npm test                          # unit + integration (needs the database from docker compose)
```

## Open as a Telegram Mini App

Telegram serves Mini Apps over HTTPS only, so expose the local server through a tunnel:

```bash
cloudflared tunnel --url http://localhost:8080
```

Copy the `https://…trycloudflare.com` URL → **@BotFather → /mybots → your bot → Bot Settings → Menu Button** → paste it. Open the bot, tap the menu button, and the app loads inside Telegram. **Near me** asks Telegram for your location (Bot API 8.0 LocationManager); in a regular browser it falls back to browser geolocation.

## API

| Method | Path | Body | Description |
|--------|------|------|-------------|
| GET | `/health` | | health check |
| POST | `/recommend` | `{text, user_id?, lat?, lon?}` | recommend venues; `lat`/`lon` only together |
| POST | `/like` | `{user_id, venue_id}` | like (updates taste) |
| POST | `/dislike` | `{user_id, venue_id}` | dislike (updates taste) |

Invalid input gets `400 {"error": "validation_failed"}`, an unknown venue `404 {"error": "venue_not_found"}`.

Secrets live in `.env` (git-ignored); see `.env.example`.

## Roadmap

- [x] Real venue data from OpenStreetMap
- [x] Geo search in PostGIS: metro stations, districts, your location
- [x] Rules first, GigaChat only for gaps and for picking from a shortlist
- [x] Taste personalization from likes/dislikes
- [ ] Landmarks (theatres, parks, squares) in the offline gazetteer
- [ ] Opening hours from OSM and an "open now" filter
- [ ] Real vibe tags, addresses and price levels instead of per-category defaults
- [ ] initData validation (HMAC) for a trusted user_id

Map data © OpenStreetMap contributors, available under the Open Database License.
