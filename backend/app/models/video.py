import enum

from sqlalchemy import JSON, Enum, Float, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, new_uuid


class VideoStatus(str, enum.Enum):
    pending = "pending"
    analyzing = "analyzing"
    analyzed = "analyzed"
    error = "error"


class Video(Base, TimestampMixin):
    __tablename__ = "videos"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_uuid)
    user_id: Mapped[str | None] = mapped_column(String, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    platform: Mapped[str] = mapped_column(String, nullable=False, default="youtube")
    youtube_id: Mapped[str] = mapped_column(String, nullable=False, unique=True, index=True)
    source_url: Mapped[str | None] = mapped_column(String, nullable=True)
    title: Mapped[str] = mapped_column(String, nullable=False)
    channel: Mapped[str] = mapped_column(String, nullable=False)
    duration_sec: Mapped[float | None] = mapped_column(Float, nullable=True)
    thumbnail_url: Mapped[str] = mapped_column(String, nullable=False)
    search_query: Mapped[str] = mapped_column(String, nullable=False)

    status: Mapped[VideoStatus] = mapped_column(
        Enum(VideoStatus), nullable=False, default=VideoStatus.pending
    )
    celery_task_id: Mapped[str | None] = mapped_column(String, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)

    # GPT-4o Vision analysis results
    visual_mood: Mapped[str | None] = mapped_column(Text, nullable=True)
    color_palette: Mapped[list | None] = mapped_column(JSON, nullable=True)  # ["#1a1a2e", ...]

    # 4-axis visual vibe vector (0.0 – 1.0), mirrors song vibe axes
    visual_energy: Mapped[float | None] = mapped_column(Float, nullable=True)
    visual_warmth: Mapped[float | None] = mapped_column(Float, nullable=True)
    visual_chaos: Mapped[float | None] = mapped_column(Float, nullable=True)
    visual_intimacy: Mapped[float | None] = mapped_column(Float, nullable=True)

    # Qdrant point ID for similarity search
    qdrant_id: Mapped[str | None] = mapped_column(String, nullable=True)

    # MinIO object key for cached preview download (set on first proxy-stream request)
    video_storage_key: Mapped[str | None] = mapped_column(String, nullable=True)

    # Aesthetics this video belongs to (many-to-many via aesthetic_videos)
    aesthetics: Mapped[list["Aesthetic"]] = relationship(  # type: ignore[name-defined]
        "Aesthetic",
        secondary="aesthetic_videos",
        back_populates="videos",
    )
