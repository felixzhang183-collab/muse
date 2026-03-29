"""add lyric_style json to drafts

Revision ID: 0014_draft_lyric_style
Revises: 0013_song_lyrics_transcription
Create Date: 2026-03-29
"""
from alembic import op
import sqlalchemy as sa

revision = "0014_draft_lyric_style"
down_revision = "0013_song_lyrics_transcription"
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    cols = {c["name"] for c in inspector.get_columns("drafts")}
    if "lyric_style" not in cols:
        op.add_column("drafts", sa.Column("lyric_style", sa.JSON(), nullable=True))


def downgrade():
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    cols = {c["name"] for c in inspector.get_columns("drafts")}
    if "lyric_style" in cols:
        op.drop_column("drafts", "lyric_style")
