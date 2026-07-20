"""Ядро Spotwhere: разбор запроса и подбор заведений. Общее для бота и API."""

import json
import logging
import os
import re

from dotenv import load_dotenv
from gigachat import GigaChat

import db

load_dotenv()
GIGACHAT_KEY = os.getenv("GIGACHAT_KEY")

with open("venues.json", encoding="utf-8") as f:
    VENUES = json.load(f)

SYSTEM_PROMPT = (
    "Ты — модуль разбора запроса сервиса, который советует, куда сходить.\n"
    "Пользователь описывает ситуацию своими словами. Извлеки признаки и верни\n"
    "СТРОГО JSON без пояснений, по схеме:\n"
    "{\n"
    '  "mood": "тихо" | "шумно" | "романтика" | "",\n'
    '  "company": "вдвоём" | "компания" | "",\n'
    '  "budget_max": число в рублях, или 1000000 если не указан\n'
    "}\n"
    "Отвечай ТОЛЬКО валидным JSON."
)


def parse_text_llm(text: str) -> dict:
    with GigaChat(credentials=GIGACHAT_KEY, scope="GIGACHAT_API_PERS",
                  verify_ssl_certs=False) as client:
        response = client.chat({
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": text},
            ],
            "temperature": 0.1,
        })
    content = response.choices[0].message.content
    start, end = content.find("{"), content.rfind("}")
    data = json.loads(content[start:end + 1])
    return {
        "mood": data.get("mood", ""),
        "company": data.get("company", ""),
        "budget_max": int(data.get("budget_max") or 1_000_000),
    }


def parse_text_keywords(text: str) -> dict:
    t = text.lower()
    features = {"mood": "", "company": "", "budget_max": 1_000_000}
    if "тих" in t or "спок" in t:
        features["mood"] = "тихо"
    elif "шум" in t or "весел" in t:
        features["mood"] = "шумно"
    elif "рома" in t:
        features["mood"] = "романтика"
    if "вдвоём" in t or "вдвоем" in t or "пар" in t:
        features["company"] = "вдвоём"
    elif "друз" in t or "компан" in t:
        features["company"] = "компания"
    numbers = re.findall(r"\d+", t)
    if numbers:
        features["budget_max"] = max(int(n) for n in numbers)
    return features


def parse_text(text: str) -> dict:
    """Разбор запроса нейросетью; при сбое — откат на ключевые слова."""
    try:
        return parse_text_llm(text)
    except Exception as e:
        logging.warning("LLM недоступен (%s), откат на ключевые слова", e)
        return parse_text_keywords(text)


def score_venues(features: dict, weights: dict) -> list:
    scored = []
    for venue in VENUES:
        if venue["avg_bill"] > features["budget_max"]:
            continue
        score = 0
        if features["mood"] in venue["tags"]:
            score += 1
        if features["company"] in venue["tags"]:
            score += 1
        for tag in venue["tags"]:
            score += weights.get(tag, 0)
        scored.append((venue, score))
    return scored


def rank_by_features(features: dict, user_id: int) -> list:
    weights = db.get_weights(user_id)
    scored = score_venues(features, weights)
    scored.sort(key=lambda pair: pair[1], reverse=True)
    return [(venue, score) for venue, score in scored if score > 0]


def recommend(text: str, user_id: int) -> list:
    return rank_by_features(parse_text(text), user_id)


def find_venue(venue_id: int):
    for venue in VENUES:
        if venue["id"] == venue_id:
            return venue
    return None
