import enum

from sqlalchemy import JSON, Enum, Float, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, new_uuid


class SongStatus(str, enum.Enum):
    uploaded = "uploaded"
    analyzing = "analyzing"
    analyzed = "analyzed"
    error = "error"


class Song(Base, TimestampMixin):
    __tablename__ = "songs"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_uuid)
    user_id: Mapped[str] = mapped_column(String, ForeignKey("users.id"), nullable=False, index=True)

    title: Mapped[str] = mapped_column(String, nullable=False)
    file_key: Mapped[str] = mapped_column(String, nullable=False)  # R2/S3 object key
    file_name: Mapped[str] = mapped_column(String, nullable=False)  # original filename

    status: Mapped[SongStatus] = mapped_column(
        Enum(SongStatus), nullable=False, default=SongStatus.uploaded
    )
    celery_task_id: Mapped[str | None] = mapped_column(String, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Audio analysis results
    duration_sec: Mapped[float | None] = mapped_column(Float, nullable=True)
    bpm: Mapped[float | None] = mapped_column(Float, nullable=True)
    key: Mapped[str | None] = mapped_column(String, nullable=True)  # e.g. "C major"

    # 4-axis vibe vector (0.0 – 1.0 each)
    energy: Mapped[float | None] = mapped_column(Float, nullable=True)
    warmth: Mapped[float | None] = mapped_column(Float, nullable=True)
    chaos: Mapped[float | None] = mapped_column(Float, nullable=True)
    intimacy: Mapped[float | None] = mapped_column(Float, nullable=True)

    # Beat/section data stored as JSON arrays
    beat_timestamps: Mapped[list | None] = mapped_column(JSON, nullable=True)  # [0.42, 0.85, ...]
    section_markers: Mapped[list | None] = mapped_column(JSON, nullable=True)
    # [{"start": 0, "end": 32.0, "label": "intro"}, ...]
    lyrics_lines: Mapped[list | None] = mapped_column(JSON, nullable=True)
    # [{"start": 12.2, "end": 14.8, "text": "line text"}, ...]
    lyrics_status: Mapped[str] = mapped_column(String, nullable=False, default="not_started")
    lyrics_celery_task_id: Mapped[str | None] = mapped_column(String, nullable=True)
    lyrics_error_message: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Optional clip region — null means "use full song"
    clip_start: Mapped[float | None] = mapped_column(Float, nullable=True)
    clip_end: Mapped[float | None] = mapped_column(Float, nullable=True)

    user: Mapped["User"] = relationship("User", back_populates="songs")  # noqa: F821
