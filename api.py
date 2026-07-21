"""Spotwhere REST API (FastAPI). Recommendation logic lives in engine.py."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

import engine
import db

app = FastAPI(title="Spotwhere API")

# Dev: allow the frontend (any origin) to call this API from the browser.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {"status": "ok", "service": "spotwhere"}


@app.get("/venues")
def venues():
    return engine.VENUES


class RecommendIn(BaseModel):
    text: str
    user_id: int


@app.post("/recommend")
def recommend(body: RecommendIn):
    ranked = engine.recommend(body.text, body.user_id)
    return {"results": [venue for venue, _ in ranked]}


class LikeIn(BaseModel):
    user_id: int
    venue_id: int


@app.post("/like")
def like(body: LikeIn):
    venue = engine.find_venue(body.venue_id)
    if venue:
        for tag in venue["tags"]:
            db.save_weight(body.user_id, tag, 0.2)
    return {"status": "ok"}
