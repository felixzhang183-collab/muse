"""add renders table

Revision ID: 0003
Revises: 0002
Create Date: 2026-03-27
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0003"
down_revision: Union[str, None] = "0002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "renders",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("song_id", sa.String(), sa.ForeignKey("songs.id"), nullable=False),
        sa.Column(
            "status",
            sa.Enum("pending", "rendering", "done", "error", name="renderstatus"),
            nullable=False,
            server_default="pending",
        ),
        sa.Column("celery_task_id", sa.String(), nullable=True),
        sa.Column("render_file_key", sa.String(), nullable=True),
        sa.Column("duration_sec", sa.Float(), nullable=True),
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
    op.create_index("ix_renders_song_id", "renders", ["song_id"])


def downgrade() -> None:
    op.drop_index("ix_renders_song_id", table_name="renders")
    op.drop_table("renders")
    op.execute("DROP TYPE IF EXISTS renderstatus")
