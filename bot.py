import asyncio
import logging
import os

from aiogram import Bot, Dispatcher, F
from aiogram.filters import Command
from aiogram.types import (
    Message,
    CallbackQuery,
    InlineKeyboardMarkup,
    InlineKeyboardButton,
)
from dotenv import load_dotenv

import engine
import db

load_dotenv()
TOKEN = os.getenv("TG_TOKEN")
if not TOKEN:
    raise RuntimeError("Не найден TG_TOKEN — проверь файл .env")

logging.basicConfig(level=logging.INFO)
bot = Bot(token=TOKEN)
dp = Dispatcher()

SESSIONS = {}
NARROW_THRESHOLD = 10   # с какого числа вариантов уточняем настроение


def format_card(venue: dict) -> str:
    return (
        f"📍 <b>{venue['name']}</b>\n"
        f"{venue['description']}\n"
        f"💰 средний счёт: {venue['avg_bill']} ₽"
    )


def more_keyboard() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(inline_keyboard=[[
        InlineKeyboardButton(text="🔁 Не то, показать другие", callback_data="more")
    ]])


def like_keyboard(venue_id: int) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(inline_keyboard=[[
        InlineKeyboardButton(text="👍 Нравится", callback_data=f"like:{venue_id}")
    ]])


def mood_keyboard() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(inline_keyboard=[[
        InlineKeyboardButton(text="🤫 Тихо", callback_data="mood:тихо"),
        InlineKeyboardButton(text="🎉 Шумно", callback_data="mood:шумно"),
        InlineKeyboardButton(text="❤️ Романтика", callback_data="mood:романтика"),
    ]])


async def send_cards(chat_id: int):
    session = SESSIONS.get(chat_id)
    if not session:
        await bot.send_message(chat_id, "Напиши, куда хочешь пойти 🙂")
        return

    chunk = session["ranked"][session["offset"]:session["offset"] + 3]
    if not chunk:
        await bot.send_message(chat_id, "Больше вариантов нет 🤷 Попробуй другой запрос.")
        return

    for venue, score in chunk:
        await bot.send_message(chat_id, format_card(venue), parse_mode="HTML",
                               reply_markup=like_keyboard(venue["id"]))
    await bot.send_message(chat_id, "Ну как, подходит?", reply_markup=more_keyboard())


@dp.message(Command("start"))
async def cmd_start(message: Message):
    await message.answer(
        "👋 Привет! Я Spotwhere — подскажу, куда сходить.\n\n"
        "Опиши ситуацию своими словами — например:\n"
        "<b>тихое место вдвоём, бюджет 1500</b>",
        parse_mode="HTML",
    )


@dp.message(F.text)
async def on_query(message: Message):
    user = message.from_user
    db.save_user(user.id, user.username, user.first_name)

    features = engine.parse_text(message.text)
    ranked = engine.rank_by_features(features, user.id)

    is_vague = not features.get("mood") and not features.get("company")
    if is_vague and len(ranked) > NARROW_THRESHOLD:
        await message.answer("Понял не до конца 🙂 Какое настроение сегодня?",
                             reply_markup=mood_keyboard())
        return

    SESSIONS[message.chat.id] = {"ranked": ranked, "offset": 0}
    await send_cards(message.chat.id)


@dp.callback_query(F.data == "more")
async def on_more(callback: CallbackQuery):
    session = SESSIONS.get(callback.message.chat.id)
    if session:
        session["offset"] += 3
    await send_cards(callback.message.chat.id)
    await callback.answer()


@dp.callback_query(F.data.startswith("like:"))
async def on_like(callback: CallbackQuery):
    venue = engine.find_venue(int(callback.data.split(":")[1]))
    if venue:
        for tag in venue["tags"]:
            db.save_weight(callback.from_user.id, tag, 0.2)
    await callback.answer("Запомнил, что тебе такое нравится 👍")


@dp.callback_query(F.data.startswith("mood:"))
async def on_mood(callback: CallbackQuery):
    mood = callback.data.split(":")[1]
    features = {"mood": mood, "company": "", "budget_max": 1_000_000}
    ranked = engine.rank_by_features(features, callback.from_user.id)
    SESSIONS[callback.message.chat.id] = {"ranked": ranked, "offset": 0}
    await send_cards(callback.message.chat.id)
    await callback.answer()


async def main():
    await dp.start_polling(bot)


if __name__ == "__main__":
    asyncio.run(main())
