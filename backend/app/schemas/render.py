from datetime import datetime

from pydantic import BaseModel, ConfigDict


class RenderOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    song_id: str
    status: str
    celery_task_id: str | None
    render_file_key: str | None
    duration_sec: float | None
    error_message: str | None
    created_at: datetime
