from datetime import datetime

from pydantic import BaseModel

from app.models.song import SongStatus


class SongOut(BaseModel):
    id: str
    title: str
    file_name: str
    status: SongStatus
    celery_task_id: str | None
    error_message: str | None

    # Analysis results (null until analyzed)
    duration_sec: float | None
    bpm: float | None
    key: str | None
    energy: float | None
    warmth: float | None
    chaos: float | None
    intimacy: float | None
    beat_timestamps: list | None
    section_markers: list | None
    lyrics_lines: list | None
    lyrics_status: str
    lyrics_celery_task_id: str | None
    lyrics_error_message: str | None
    clip_start: float | None
    clip_end: float | None

    created_at: datetime

    model_config = {"from_attributes": True}


class SongListItem(BaseModel):
    id: str
    title: str
    file_name: str
    status: SongStatus
    bpm: float | None
    duration_sec: float | None
    created_at: datetime

    model_config = {"from_attributes": True}


class JobStatus(BaseModel):
    job_id: str
    status: str         # pending | running | complete | failed
    progress: int = 0   # 0-100
    error: str | None = None
    result: dict | None = None
