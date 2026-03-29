"""add clip_start/clip_end columns to songs

Revision ID: 0010_song_clip_region
Revises: 0009_section_templates
Create Date: 2026-03-28
"""
from alembic import op
import sqlalchemy as sa

revision = "0010_song_clip_region"
down_revision = "0009_section_templates"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    cols = {c["name"] for c in inspector.get_columns("songs")}

    if "clip_start" not in cols:
        op.add_column("songs", sa.Column("clip_start", sa.Float(), nullable=True))
    if "clip_end" not in cols:
        op.add_column("songs", sa.Column("clip_end", sa.Float(), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    cols = {c["name"] for c in inspector.get_columns("songs")}

    if "clip_end" in cols:
        op.drop_column("songs", "clip_end")
    if "clip_start" in cols:
        op.drop_column("songs", "clip_start")
