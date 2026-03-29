from datetime import datetime

from pydantic import BaseModel, Field


class AestheticCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    description: str | None = Field(default=None, max_length=500)


class AestheticOut(BaseModel):
    id: str
    name: str
    description: str | None
    created_at: datetime
    video_count: int = 0

    model_config = {"from_attributes": True}
