from datetime import datetime

from pydantic import BaseModel


class DistributionOut(BaseModel):
    id: str
    render_id: str
    song_id: str
    platform: str
    status: str
    celery_task_id: str | None
    caption: str | None
    platform_post_id: str | None
    error_message: str | None
    view_count: int | None
    like_count: int | None
    share_count: int | None
    comment_count: int | None
    metrics_fetched_at: datetime | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
