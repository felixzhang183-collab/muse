from datetime import datetime
from pydantic import BaseModel


class DraftCreate(BaseModel):
    aesthetic_id: str
    clip_start: float | None = None
    clip_end: float | None = None


class DraftUpdate(BaseModel):
    assignments: list[dict] | None = None
    lyric_style: dict | None = None


class DraftOut(BaseModel):
    id: str
    song_id: str
    aesthetic_id: str
    clip_start: float | None
    clip_end: float | None
    assignments: list[dict]
    lyric_style: dict | None
    ai_notes: str | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
