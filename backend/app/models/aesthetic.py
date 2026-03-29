from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, new_uuid


class AestheticVideo(Base):
    """Junction table — many-to-many between aesthetics and videos."""
    __tablename__ = "aesthetic_videos"

    aesthetic_id: Mapped[str] = mapped_column(
        String, ForeignKey("aesthetics.id", ondelete="CASCADE"), primary_key=True
    )
    video_id: Mapped[str] = mapped_column(
        String, ForeignKey("videos.id", ondelete="CASCADE"), primary_key=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )


class Aesthetic(Base, TimestampMixin):
    __tablename__ = "aesthetics"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_uuid)
    user_id: Mapped[str] = mapped_column(String, ForeignKey("users.id"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    videos: Mapped[list["Video"]] = relationship(  # type: ignore[name-defined]
        "Video",
        secondary="aesthetic_videos",
        back_populates="aesthetics",
        order_by="Video.created_at.desc()",
    )
