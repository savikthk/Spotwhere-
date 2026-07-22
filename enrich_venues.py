"""Обогащение вайб-тегами через GigaChat (одноразовый батч-скрипт).

Читает venues.json, каждому месту добавляет вайб-теги и перезаписывает файл.
Запуск:  venv/bin/python enrich_venues.py   (нужен GIGACHAT_KEY в .env)
"""

import json
import os

from dotenv import load_dotenv
from gigachat import GigaChat

load_dotenv()
KEY = os.getenv("GIGACHAT_KEY")
BATCH = 8

VOCAB = ("тихо, шумно, романтика, вдвоём, компания, друзья, один, "
         "уютно, весело, стильно, спокойно, для работы, посидеть, бюджетно")

PROMPT = (
    "Ты размечаешь заведения вайб-тегами. Для каждого места подбери 3-5 тегов "
    "ТОЛЬКО из набора:\n" + VOCAB + "\n"
    "Обязательно ровно одно настроение из: тихо, шумно, романтика. "
    "И подходящую компанию: вдвоём, компания, друзья или один.\n"
    "Ответь СТРОГО JSON-массивом без пояснений: "
    '[{"id": число, "vibe": [теги]}]\n\n'
    "Заведения:\n"
)


def enrich_batch(client, batch):
    listing = "\n".join(
        f'{v["id"]}. {v["name"]} — {v["description"]} ({", ".join(v["tags"])})'
        for v in batch
    )
    resp = client.chat({
        "messages": [{"role": "user", "content": PROMPT + listing}],
        "temperature": 0.1,
    })
    content = resp.choices[0].message.content
    s, e = content.find("["), content.rfind("]")
    return json.loads(content[s:e + 1])


# Гарантируем базовый вайб по категории (там, где LLM не проставил).
BASELINE = {
    "бар": ("шумно", "компания"), "паб": ("шумно", "друзья"),
    "ресторан": ("романтика", "вдвоём"), "кафе": ("тихо", "вдвоём"),
    "быстро": ("шумно", "один"),
}
MOODS = {"тихо", "шумно", "романтика"}
COMPANIES = {"вдвоём", "компания", "друзья", "один"}


def ensure_baseline(venues):
    for v in venues:
        cat = next((c for c in BASELINE if c in v["tags"]), "кафе")
        mood, company = BASELINE[cat]
        if not (MOODS & set(v["tags"])):
            v["tags"].append(mood)
        if not (COMPANIES & set(v["tags"])):
            v["tags"].append(company)


def main():
    venues = json.load(open("venues.json", encoding="utf-8"))
    by_id = {v["id"]: v for v in venues}

    with GigaChat(credentials=KEY, scope="GIGACHAT_API_PERS", verify_ssl_certs=False) as client:
        for i in range(0, len(venues), BATCH):
            batch = venues[i:i + BATCH]
            for attempt in (1, 2):   # один повтор при сбое
                try:
                    for item in enrich_batch(client, batch):
                        v = by_id.get(item["id"])
                        if v:
                            for t in item.get("vibe", []):
                                if t not in v["tags"]:
                                    v["tags"].append(t)
                    print(f"обогащено {min(i + BATCH, len(venues))}/{len(venues)}")
                    break
                except Exception as ex:
                    if attempt == 2:
                        print(f"батч {i}-{i + BATCH} пропущен:", ex)

    ensure_baseline(venues)
    json.dump(venues, open("venues.json", "w", encoding="utf-8"),
              ensure_ascii=False, indent=2)
    print("готово")


if __name__ == "__main__":
    main()
