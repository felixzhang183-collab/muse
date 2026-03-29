"""add video_storage_key for cached preview downloads

Revision ID: 0012_video_storage_key
Revises: 0011_drafts
Create Date: 2026-03-28
"""
from alembic import op
import sqlalchemy as sa

revision = "0012_video_storage_key"
down_revision = "0011_drafts"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("videos", sa.Column("video_storage_key", sa.String(), nullable=True))


def downgrade():
    op.drop_column("videos", "video_storage_key")
