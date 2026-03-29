"""add videos table

Revision ID: 0002
Revises: 0001
Create Date: 2026-03-27
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0002"
down_revision: Union[str, None] = "0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "videos",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("youtube_id", sa.String(), nullable=False),
        sa.Column("title", sa.String(), nullable=False),
        sa.Column("channel", sa.String(), nullable=False),
        sa.Column("duration_sec", sa.Float(), nullable=True),
        sa.Column("thumbnail_url", sa.String(), nullable=False),
        sa.Column("search_query", sa.String(), nullable=False),
        sa.Column(
            "status",
            sa.Enum("pending", "analyzing", "analyzed", "error", name="videostatus"),
            nullable=False,
            server_default="pending",
        ),
        sa.Column("celery_task_id", sa.String(), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("visual_mood", sa.Text(), nullable=True),
        sa.Column("color_palette", sa.JSON(), nullable=True),
        sa.Column("visual_energy", sa.Float(), nullable=True),
        sa.Column("visual_warmth", sa.Float(), nullable=True),
        sa.Column("visual_chaos", sa.Float(), nullable=True),
        sa.Column("visual_intimacy", sa.Float(), nullable=True),
        sa.Column("qdrant_id", sa.String(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_videos_youtube_id", "videos", ["youtube_id"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_videos_youtube_id", table_name="videos")
    op.drop_table("videos")
    op.execute("DROP TYPE IF EXISTS videostatus")
