"""Загрузка venues.json в таблицу Postgres (venues) с базовыми вайб-тегами.

Запуск:  venv/bin/python load_to_db.py
"""

import json
import os

import psycopg
from dotenv import load_dotenv

load_dotenv()

BASELINE = {
    "бар": ("шумно", "компания"), "паб": ("шумно", "друзья"),
    "ресторан": ("романтика", "вдвоём"), "кафе": ("тихо", "вдвоём"),
    "быстро": ("шумно", "один"), "клуб": ("шумно", "компания"),
    "кальянная": ("тихо", "компания"), "компьютерный клуб": ("шумно", "друзья"),
    "кино": ("тихо", "вдвоём"), "баня": ("тихо", "компания"),
    "спа": ("тихо", "вдвоём"), "боулинг": ("шумно", "компания"),
    "квест": ("шумно", "компания"), "батутный центр": ("шумно", "компания"),
    "танцы": ("шумно", "компания"), "игровые автоматы": ("шумно", "друзья"),
    "аквапарк": ("шумно", "компания"),
}
MOODS = {"тихо", "шумно", "романтика"}
COMPANIES = {"вдвоём", "компания", "друзья", "один"}


def ensure_baseline(v):
    cat = next((c for c in BASELINE if c in v["tags"]), "кафе")
    mood, company = BASELINE[cat]
    if not (MOODS & set(v["tags"])):
        v["tags"].append(mood)
    if not (COMPANIES & set(v["tags"])):
        v["tags"].append(company)


def get_conn():
    return psycopg.connect(
        host=os.getenv("DB_HOST"), port=os.getenv("DB_PORT"),
        dbname=os.getenv("DB_NAME"), user=os.getenv("DB_USER"),
        password=os.getenv("DB_PASSWORD"),
    )


def main():
    venues = json.load(open("venues.json", encoding="utf-8"))
    for v in venues:
        ensure_baseline(v)

    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute("""
            CREATE TABLE IF NOT EXISTS venues (
                id        BIGINT PRIMARY KEY,
                name      TEXT,
                description TEXT,
                address   TEXT,
                tags      TEXT[],
                avg_bill  INTEGER,
                lat       DOUBLE PRECISION,
                lon       DOUBLE PRECISION,
                maps_url  TEXT
            )
        """)
        cur.execute("ALTER TABLE venues ADD COLUMN IF NOT EXISTS address TEXT")
        cur.execute("TRUNCATE venues")   # свежая загрузка
        for v in venues:
            cur.execute(
                "INSERT INTO venues (id, name, description, address, tags, avg_bill, lat, lon, maps_url) "
                "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)",
                (v["id"], v["name"], v["description"], v.get("address", ""), v["tags"],
                 v["avg_bill"], v.get("lat"), v.get("lon"), v["maps_url"]),
            )
        conn.commit()
        cur.execute("SELECT count(*) FROM venues")
        print("в таблице venues:", cur.fetchone()[0])


if __name__ == "__main__":
    main()
