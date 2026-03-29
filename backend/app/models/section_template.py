from sqlalchemy import JSON, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, new_uuid


class SectionTemplate(Base, TimestampMixin):
    __tablename__ = "section_templates"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_uuid)
    user_id: Mapped[str] = mapped_column(
        String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String, nullable=False)
    # Cut positions as fractions of song duration (0.0–1.0), e.g. [0.25, 0.5, 0.75]
    cuts_ratio: Mapped[list] = mapped_column(JSON, nullable=False)
    # One label per section, len == len(cuts_ratio) + 1
    labels: Mapped[list] = mapped_column(JSON, nullable=False)
