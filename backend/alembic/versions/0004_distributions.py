"""add distributions table and tiktok token columns on users

Revision ID: 0004
Revises: 0003
Create Date: 2026-03-27
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0004"
down_revision: Union[str, None] = "0003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # TikTok token columns on users
    op.add_column("users", sa.Column("tiktok_open_id", sa.String(), nullable=True))
    op.add_column("users", sa.Column("tiktok_access_token", sa.String(), nullable=True))
    op.add_column("users", sa.Column("tiktok_refresh_token", sa.String(), nullable=True))
    op.add_column(
        "users",
        sa.Column("tiktok_token_expires_at", sa.DateTime(timezone=True), nullable=True),
    )

    op.create_table(
        "distributions",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("render_id", sa.String(), sa.ForeignKey("renders.id"), nullable=False),
        sa.Column("song_id", sa.String(), sa.ForeignKey("songs.id"), nullable=False),
        sa.Column("user_id", sa.String(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("platform", sa.String(), nullable=False, server_default="tiktok"),
        sa.Column(
            "status",
            sa.Enum("pending", "posting", "posted", "error", name="distributionstatus"),
            nullable=False,
            server_default="pending",
        ),
        sa.Column("celery_task_id", sa.String(), nullable=True),
        sa.Column("caption", sa.Text(), nullable=True),
        sa.Column("platform_post_id", sa.String(), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
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
    op.create_index("ix_distributions_render_id", "distributions", ["render_id"])
    op.create_index("ix_distributions_song_id", "distributions", ["song_id"])
    op.create_index("ix_distributions_user_id", "distributions", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_distributions_user_id", table_name="distributions")
    op.drop_index("ix_distributions_song_id", table_name="distributions")
    op.drop_index("ix_distributions_render_id", table_name="distributions")
    op.drop_table("distributions")
    op.execute("DROP TYPE IF EXISTS distributionstatus")
    op.drop_column("users", "tiktok_token_expires_at")
    op.drop_column("users", "tiktok_refresh_token")
    op.drop_column("users", "tiktok_access_token")
    op.drop_column("users", "tiktok_open_id")
