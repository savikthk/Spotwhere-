"""REST API Spotwhere на FastAPI. Логика подбора — в engine.py."""

from fastapi import FastAPI
from pydantic import BaseModel

import engine
import db

app = FastAPI(title="Spotwhere API")


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
