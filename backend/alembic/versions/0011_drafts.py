"""add drafts table

Revision ID: 0011_drafts
Revises: 0010_song_clip_region
Create Date: 2026-03-28
"""
from alembic import op
import sqlalchemy as sa

revision = "0011_drafts"
down_revision = "0010_song_clip_region"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    if "drafts" not in tables:
        op.create_table(
            "drafts",
            sa.Column("id", sa.String(), nullable=False),
            sa.Column("song_id", sa.String(), nullable=False),
            sa.Column("aesthetic_id", sa.String(), nullable=False),
            sa.Column("clip_start", sa.Float(), nullable=True),
            sa.Column("clip_end", sa.Float(), nullable=True),
            sa.Column("assignments", sa.JSON(), nullable=False),
            sa.Column("ai_notes", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
            sa.ForeignKeyConstraint(["song_id"], ["songs.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["aesthetic_id"], ["aesthetics.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )

    inspector = sa.inspect(bind)
    indexes = {ix["name"] for ix in inspector.get_indexes("drafts")} if "drafts" in set(inspector.get_table_names()) else set()
    if "ix_drafts_song_id" not in indexes:
        op.create_index("ix_drafts_song_id", "drafts", ["song_id"], unique=False)
    if "ix_drafts_aesthetic_id" not in indexes:
        op.create_index("ix_drafts_aesthetic_id", "drafts", ["aesthetic_id"], unique=False)


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())
    if "drafts" not in tables:
        return

    indexes = {ix["name"] for ix in inspector.get_indexes("drafts")}
    if "ix_drafts_aesthetic_id" in indexes:
        op.drop_index("ix_drafts_aesthetic_id", table_name="drafts")
    if "ix_drafts_song_id" in indexes:
        op.drop_index("ix_drafts_song_id", table_name="drafts")
    op.drop_table("drafts")
