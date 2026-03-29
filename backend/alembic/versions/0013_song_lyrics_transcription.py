"""add song lyrics transcription fields

Revision ID: 0013_song_lyrics_transcription
Revises: 0012_video_storage_key
Create Date: 2026-03-29
"""
from alembic import op
import sqlalchemy as sa

revision = "0013_song_lyrics_transcription"
down_revision = "0012_video_storage_key"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("songs", sa.Column("lyrics_lines", sa.JSON(), nullable=True))
    op.add_column(
        "songs",
        sa.Column("lyrics_status", sa.String(), nullable=False, server_default="not_started"),
    )
    op.add_column("songs", sa.Column("lyrics_celery_task_id", sa.String(), nullable=True))
    op.add_column("songs", sa.Column("lyrics_error_message", sa.Text(), nullable=True))


def downgrade():
    op.drop_column("songs", "lyrics_error_message")
    op.drop_column("songs", "lyrics_celery_task_id")
    op.drop_column("songs", "lyrics_status")
    op.drop_column("songs", "lyrics_lines")
