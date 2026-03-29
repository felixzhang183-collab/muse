"""initial schema: users and songs

Revision ID: 0001
Revises:
Create Date: 2026-03-27
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("email", sa.String(), nullable=False),
        sa.Column("password_hash", sa.String(), nullable=False),
        sa.Column("display_name", sa.String(), nullable=False),
        sa.Column("artist_name", sa.String(), nullable=False),
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
    op.create_index("ix_users_email", "users", ["email"], unique=True)

    op.create_table(
        "songs",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("user_id", sa.String(), nullable=False),
        sa.Column("title", sa.String(), nullable=False),
        sa.Column("file_key", sa.String(), nullable=False),
        sa.Column("file_name", sa.String(), nullable=False),
        sa.Column(
            "status",
            sa.Enum("uploaded", "analyzing", "analyzed", "error", name="songstatus"),
            nullable=False,
            server_default="uploaded",
        ),
        sa.Column("celery_task_id", sa.String(), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("duration_sec", sa.Float(), nullable=True),
        sa.Column("bpm", sa.Float(), nullable=True),
        sa.Column("key", sa.String(), nullable=True),
        sa.Column("energy", sa.Float(), nullable=True),
        sa.Column("warmth", sa.Float(), nullable=True),
        sa.Column("chaos", sa.Float(), nullable=True),
        sa.Column("intimacy", sa.Float(), nullable=True),
        sa.Column("beat_timestamps", sa.JSON(), nullable=True),
        sa.Column("section_markers", sa.JSON(), nullable=True),
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
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_songs_user_id", "songs", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_songs_user_id", table_name="songs")
    op.drop_table("songs")
    op.drop_index("ix_users_email", table_name="users")
    op.drop_table("users")
    op.execute("DROP TYPE IF EXISTS songstatus")
