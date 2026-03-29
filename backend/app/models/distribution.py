import enum
from datetime import datetime

from sqlalchemy import DateTime, Enum, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, new_uuid


class DistributionStatus(str, enum.Enum):
    pending = "pending"
    posting = "posting"
    posted = "posted"
    error = "error"


class Distribution(Base, TimestampMixin):
    __tablename__ = "distributions"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_uuid)
    render_id: Mapped[str] = mapped_column(String, ForeignKey("renders.id"), nullable=False, index=True)
    song_id: Mapped[str] = mapped_column(String, ForeignKey("songs.id"), nullable=False, index=True)
    user_id: Mapped[str] = mapped_column(String, ForeignKey("users.id"), nullable=False, index=True)

    platform: Mapped[str] = mapped_column(String, nullable=False, default="tiktok")
    status: Mapped[DistributionStatus] = mapped_column(
        Enum(DistributionStatus), nullable=False, default=DistributionStatus.pending
    )
    celery_task_id: Mapped[str | None] = mapped_column(String, nullable=True)

    caption: Mapped[str | None] = mapped_column(Text, nullable=True)
    platform_post_id: Mapped[str | None] = mapped_column(String, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)

    # TikTok metrics (synced periodically)
    view_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    like_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    share_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    comment_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    metrics_fetched_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
