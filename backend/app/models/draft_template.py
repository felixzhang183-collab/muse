from sqlalchemy import Float, ForeignKey, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, new_uuid


class DraftTemplate(Base, TimestampMixin):
    __tablename__ = "draft_templates"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_uuid)
    user_id: Mapped[str] = mapped_column(
        String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    aesthetic_id: Mapped[str] = mapped_column(
        String, ForeignKey("aesthetics.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String, nullable=False)
    # Reference duration used to generate start/end ratios.
    base_duration_sec: Mapped[float] = mapped_column(Float, nullable=False)
    # List of template sections:
    # {section_index, section_label, start_ratio, end_ratio,
    #  video_id, video_title, video_thumbnail, ai_reason}
    assignments: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    lyric_style: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    ai_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
