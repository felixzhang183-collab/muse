import enum

from sqlalchemy import Enum, Float, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, new_uuid


class RenderStatus(str, enum.Enum):
    pending = "pending"
    rendering = "rendering"
    done = "done"
    error = "error"


class Render(Base, TimestampMixin):
    __tablename__ = "renders"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_uuid)
    song_id: Mapped[str] = mapped_column(String, ForeignKey("songs.id"), nullable=False, index=True)

    status: Mapped[RenderStatus] = mapped_column(
        Enum(RenderStatus), nullable=False, default=RenderStatus.pending
    )
    celery_task_id: Mapped[str | None] = mapped_column(String, nullable=True)
    render_file_key: Mapped[str | None] = mapped_column(String, nullable=True)
    duration_sec: Mapped[float | None] = mapped_column(Float, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Aesthetic used for this render's video pool
    aesthetic_id: Mapped[str | None] = mapped_column(
        String, ForeignKey("aesthetics.id"), nullable=True, index=True
    )
    aesthetic: Mapped["Aesthetic | None"] = relationship("Aesthetic")  # type: ignore[name-defined]
