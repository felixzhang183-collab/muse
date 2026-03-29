from sqlalchemy import Float, ForeignKey, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, new_uuid


class Draft(Base, TimestampMixin):
    __tablename__ = "drafts"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_uuid)
    song_id: Mapped[str] = mapped_column(
        String, ForeignKey("songs.id", ondelete="CASCADE"), nullable=False, index=True
    )
    aesthetic_id: Mapped[str] = mapped_column(
        String, ForeignKey("aesthetics.id", ondelete="CASCADE"), nullable=False, index=True
    )
    clip_start: Mapped[float | None] = mapped_column(Float, nullable=True)
    clip_end: Mapped[float | None] = mapped_column(Float, nullable=True)
    # List of {section_index, section_label, section_start, section_end,
    #          video_id, video_title, video_thumbnail, ai_reason}
    assignments: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    # {"font_size": 11, "bottom_offset": 48, "align": "center"}
    lyric_style: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    ai_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
