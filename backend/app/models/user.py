from datetime import datetime

from sqlalchemy import DateTime, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, new_uuid


class User(Base, TimestampMixin):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_uuid)
    email: Mapped[str] = mapped_column(String, unique=True, nullable=False, index=True)
    password_hash: Mapped[str] = mapped_column(String, nullable=False)
    display_name: Mapped[str] = mapped_column(String, nullable=False)
    artist_name: Mapped[str] = mapped_column(String, nullable=False)

    # TikTok OAuth tokens
    tiktok_open_id: Mapped[str | None] = mapped_column(String, nullable=True)
    tiktok_access_token: Mapped[str | None] = mapped_column(String, nullable=True)
    tiktok_refresh_token: Mapped[str | None] = mapped_column(String, nullable=True)
    tiktok_token_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    songs: Mapped[list["Song"]] = relationship("Song", back_populates="user")  # noqa: F821
