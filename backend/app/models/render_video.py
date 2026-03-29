"""Junction table recording which YouTube videos were used in each render."""

from sqlalchemy import ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class RenderVideo(Base):
    __tablename__ = "render_videos"

    render_id: Mapped[str] = mapped_column(
        String, ForeignKey("renders.id"), primary_key=True
    )
    video_id: Mapped[str] = mapped_column(
        String, ForeignKey("videos.id"), primary_key=True
    )
