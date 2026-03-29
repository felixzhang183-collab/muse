from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field, model_validator

from app.models.video import VideoStatus


class VideoOut(BaseModel):
    id: str
    platform: str
    youtube_id: str
    source_url: str | None
    title: str
    channel: str
    duration_sec: float | None
    thumbnail_url: str
    search_query: str
    status: VideoStatus
    celery_task_id: str | None
    error_message: str | None

    visual_mood: str | None
    color_palette: list | None
    visual_energy: float | None
    visual_warmth: float | None
    visual_chaos: float | None
    visual_intimacy: float | None

    aesthetic_ids: list[str] = []

    created_at: datetime

    model_config = {"from_attributes": True}

    @model_validator(mode="before")
    @classmethod
    def extract_aesthetic_ids(cls, v: Any) -> Any:
        # When constructed from an ORM Video object, derive aesthetic_ids from the relationship
        if hasattr(v, "aesthetics"):
            object.__setattr__(v, "_aesthetic_ids_cache", [a.id for a in (v.aesthetics or [])])
        return v

    @classmethod
    def model_validate(cls, obj: Any, **kwargs):  # type: ignore[override]
        instance = super().model_validate(obj, **kwargs)
        if hasattr(obj, "aesthetics") and instance.aesthetic_ids == []:
            instance.aesthetic_ids = [a.id for a in (obj.aesthetics or [])]
        return instance


class ScrapeRequest(BaseModel):
    query: str = Field(..., min_length=1, max_length=200)
    max_results: int = Field(default=10, ge=1, le=50)
    platform: str = Field(default="tiktok", pattern="^(youtube|tiktok)$")
    aesthetic_id: str | None = Field(default=None, description="Aesthetic to link footage to (optional)")
