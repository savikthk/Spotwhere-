"""Работа с PostgreSQL: пользователи и веса их предпочтений."""

import os

import psycopg
from dotenv import load_dotenv

load_dotenv()


def get_conn():
    return psycopg.connect(
        host=os.getenv("DB_HOST"),
        port=os.getenv("DB_PORT"),
        dbname=os.getenv("DB_NAME"),
        user=os.getenv("DB_USER"),
        password=os.getenv("DB_PASSWORD"),
    )


def init_db():
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute("""
            CREATE TABLE IF NOT EXISTS user_tag_weights (
                user_id BIGINT,
                tag     TEXT,
                weight  REAL
            )
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS users (
                telegram_id BIGINT PRIMARY KEY,
                username    TEXT,
                first_name  TEXT
            )
        """)
        conn.commit()


init_db()


def save_weight(user_id: int, tag: str, delta: float):
    """Прибавить delta к весу тега (обновить существующий или создать)."""
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute("SELECT weight FROM user_tag_weights WHERE user_id = %s AND tag = %s",
                    (user_id, tag))
        row = cur.fetchone()
        if row:
            cur.execute("UPDATE user_tag_weights SET weight = %s WHERE user_id = %s AND tag = %s",
                        (row[0] + delta, user_id, tag))
        else:
            cur.execute("INSERT INTO user_tag_weights (user_id, tag, weight) VALUES (%s, %s, %s)",
                        (user_id, tag, delta))
        conn.commit()


def get_weights(user_id: int) -> dict:
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute("SELECT tag, weight FROM user_tag_weights WHERE user_id = %s", (user_id,))
        rows = cur.fetchall()
    return {tag: weight for tag, weight in rows}


def save_user(telegram_id: int, username: str, first_name: str):
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO users (telegram_id, username, first_name) VALUES (%s, %s, %s) "
            "ON CONFLICT (telegram_id) DO NOTHING",
            (telegram_id, username, first_name),
        )
        conn.commit()
