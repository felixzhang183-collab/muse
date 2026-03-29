"""add user_id to videos

Revision ID: 0016_video_user_id
Revises: 0015_draft_templates
Create Date: 2026-03-28
"""

from alembic import op
import sqlalchemy as sa

revision = "0016_video_user_id"
down_revision = "0015_draft_templates"
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = {c["name"] for c in inspector.get_columns("videos")}
    if "user_id" in columns:
        return

    op.add_column("videos", sa.Column("user_id", sa.String(), nullable=True))
    op.create_index("ix_videos_user_id", "videos", ["user_id"], unique=False)
    op.create_foreign_key(
        "fk_videos_user_id_users",
        "videos", "users",
        ["user_id"], ["id"],
        ondelete="SET NULL",
    )


def downgrade():
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = {c["name"] for c in inspector.get_columns("videos")}
    if "user_id" not in columns:
        return

    op.drop_constraint("fk_videos_user_id_users", "videos", type_="foreignkey")
    op.drop_index("ix_videos_user_id", table_name="videos")
    op.drop_column("videos", "user_id")
