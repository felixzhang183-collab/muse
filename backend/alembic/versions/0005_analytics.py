"""add render_videos junction table and metrics columns on distributions

Revision ID: 0005
Revises: 0004
Create Date: 2026-03-27
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0005"
down_revision: Union[str, None] = "0004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Metrics columns on distributions
    op.add_column("distributions", sa.Column("view_count", sa.Integer(), nullable=True))
    op.add_column("distributions", sa.Column("like_count", sa.Integer(), nullable=True))
    op.add_column("distributions", sa.Column("share_count", sa.Integer(), nullable=True))
    op.add_column("distributions", sa.Column("comment_count", sa.Integer(), nullable=True))
    op.add_column(
        "distributions",
        sa.Column("metrics_fetched_at", sa.DateTime(timezone=True), nullable=True),
    )

    # render_videos junction table
    op.create_table(
        "render_videos",
        sa.Column("render_id", sa.String(), sa.ForeignKey("renders.id"), nullable=False),
        sa.Column("video_id", sa.String(), sa.ForeignKey("videos.id"), nullable=False),
        sa.PrimaryKeyConstraint("render_id", "video_id"),
    )
    op.create_index("ix_render_videos_video_id", "render_videos", ["video_id"])


def downgrade() -> None:
    op.drop_index("ix_render_videos_video_id", table_name="render_videos")
    op.drop_table("render_videos")
    op.drop_column("distributions", "metrics_fetched_at")
    op.drop_column("distributions", "comment_count")
    op.drop_column("distributions", "share_count")
    op.drop_column("distributions", "like_count")
    op.drop_column("distributions", "view_count")
