from datetime import datetime

from pydantic import BaseModel, Field


class DraftTemplateCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)


class DraftFromTemplateCreate(BaseModel):
    template_id: str
    clip_start: float | None = None
    clip_end: float | None = None


class DraftTemplateOut(BaseModel):
    id: str
    user_id: str
    aesthetic_id: str
    name: str
    base_duration_sec: float
    assignments: list[dict]
    lyric_style: dict | None
    ai_notes: str | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
