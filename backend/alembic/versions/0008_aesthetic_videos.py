"""aesthetic_videos junction table (many-to-many)

Revision ID: 0008_aesthetic_videos
Revises: 0007
Create Date: 2026-03-28
"""
from alembic import op
import sqlalchemy as sa

revision = "0008_aesthetic_videos"
down_revision = "0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Create junction table
    op.create_table(
        "aesthetic_videos",
        sa.Column("aesthetic_id", sa.String(), sa.ForeignKey("aesthetics.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("video_id", sa.String(), sa.ForeignKey("videos.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("NOW()")),
    )

    # Migrate existing aesthetic_id assignments into the junction table
    op.execute("""
        INSERT INTO aesthetic_videos (aesthetic_id, video_id, created_at)
        SELECT aesthetic_id, id, created_at
        FROM videos
        WHERE aesthetic_id IS NOT NULL
        ON CONFLICT DO NOTHING
    """)

    # Drop the old FK column from videos
    op.drop_constraint("fk_videos_aesthetic_id", "videos", type_="foreignkey")
    op.drop_index("ix_videos_aesthetic_id", table_name="videos")
    op.drop_column("videos", "aesthetic_id")


def downgrade() -> None:
    op.add_column("videos", sa.Column("aesthetic_id", sa.String(), nullable=True))
    op.create_foreign_key(
        "videos_aesthetic_id_fkey", "videos", "aesthetics", ["aesthetic_id"], ["id"]
    )
    op.create_index("ix_videos_aesthetic_id", "videos", ["aesthetic_id"])
    op.execute("""
        UPDATE videos v
        SET aesthetic_id = av.aesthetic_id
        FROM aesthetic_videos av
        WHERE av.video_id = v.id
    """)
    op.drop_table("aesthetic_videos")
