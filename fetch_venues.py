"""Fetch real venues from OpenStreetMap (Overpass API) into venues.json.

Usage:  python3 fetch_venues.py
Меняй CITY / LIMIT под нужный город.
"""

import json
import urllib.parse
import urllib.request

CITY = "Москва"
LIMIT = 5000

OVERPASS_URL = "https://overpass-api.de/api/interpreter"

# Базовые теги + примерный чек по категории.
CATEGORY_MAP = {
    "cafe":         (["кафе", "кофе"], 800),
    "restaurant":   (["ресторан", "ужин"], 2000),
    "bar":          (["бар", "коктейли"], 1500),
    "pub":          (["паб", "пиво"], 1600),
    "fast_food":    (["быстро", "недорого", "перекус"], 500),
    "nightclub":    (["клуб", "танцы", "вечер"], 2000),
    "hookah_lounge": (["кальянная", "кальян"], 1500),
    "internet_cafe": (["компьютерный клуб", "игры"], 500),
}

CUISINE_TAGS = {
    "coffee_shop": "кофе", "italian": "итальянская", "sushi": "суши",
    "japanese": "японская", "pizza": "пицца", "burger": "бургеры",
    "asian": "азиатская", "seafood": "морепродукты", "georgian": "грузинская",
    "russian": "русская", "chinese": "китайская", "french": "французская",
    "mexican": "мексиканская", "kebab": "шаурма", "regional": "местная",
    "international": "разная кухня",
}


def build_query() -> str:
    return f"""
    [out:json][timeout:60];
    area["name"="{CITY}"]["admin_level"~"4|6"]->.a;
    (
      node(area.a)["amenity"~"^(cafe|restaurant|bar|pub|fast_food|nightclub|hookah_lounge|internet_cafe)$"]["name"];
    );
    out body {LIMIT};
    """


def fetch():
    data = urllib.parse.urlencode({"data": build_query()}).encode()
    req = urllib.request.Request(
        OVERPASS_URL, data=data,
        headers={"User-Agent": "spotwhere/1.0 (dev)"})
    with urllib.request.urlopen(req, timeout=90) as resp:
        return json.load(resp)


def attribute_tags(osm: dict) -> list:
    """Реальные атрибуты OSM -> теги о конкретном месте."""
    tags = []
    if osm.get("outdoor_seating") == "yes":
        tags.append("веранда")
    if osm.get("internet_access") in ("wlan", "yes", "wifi"):
        tags += ["wifi", "для работы"]
    if osm.get("live_music") == "yes":
        tags.append("живая музыка")
    if osm.get("microbrewery") == "yes" or osm.get("brewery") == "yes":
        tags.append("крафт")
    if osm.get("takeaway") == "yes":
        tags.append("навынос")
    if osm.get("diet:vegan") in ("yes", "only") or osm.get("diet:vegetarian") in ("yes", "only"):
        tags.append("веган")
    if osm.get("opening_hours") == "24/7":
        tags.append("круглосуточно")
    for c in osm.get("cuisine", "").split(";"):
        c = c.strip()
        if c in CUISINE_TAGS:
            tags.append(CUISINE_TAGS[c])
    return tags


def to_venue(vid: int, element: dict):
    osm = element.get("tags", {})
    name = osm.get("name")
    amenity = osm.get("amenity", "")
    if not name or amenity not in CATEGORY_MAP:
        return None

    base_tags, bill = CATEGORY_MAP[amenity]
    tags = list(base_tags) + attribute_tags(osm)
    tags = list(dict.fromkeys(tags))   # убрать дубли, сохранить порядок

    cuisine = osm.get("cuisine", "").split(";")[0].strip()
    category = base_tags[0].capitalize()
    description = f"{category} · {CUISINE_TAGS[cuisine]}" if cuisine in CUISINE_TAGS else category

    address = " ".join(x for x in (osm.get("addr:street", ""),
                                   osm.get("addr:housenumber", "")) if x).strip()

    return {
        "id": vid,
        "name": name,
        "description": description,
        "address": address,
        "tags": tags,
        "avg_bill": bill,
        "maps_url": f"https://yandex.ru/maps/?text={urllib.parse.quote(name + ' ' + CITY)}",
        "lat": element.get("lat"),
        "lon": element.get("lon"),
    }


def main():
    print(f"Запрашиваю OSM: {CITY} (до {LIMIT} мест)…")
    raw = fetch()
    venues, vid = [], 1
    for el in raw.get("elements", []):
        v = to_venue(vid, el)
        if v:
            venues.append(v)
            vid += 1

    with open("venues.json", "w", encoding="utf-8") as f:
        json.dump(venues, f, ensure_ascii=False, indent=2)
    print(f"Готово: {len(venues)} мест -> venues.json")


if __name__ == "__main__":
    main()
