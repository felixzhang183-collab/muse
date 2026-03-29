"""add section_templates table

Revision ID: 0009_section_templates
Revises: 0008_aesthetic_videos
Create Date: 2026-03-28
"""
from alembic import op
import sqlalchemy as sa

revision = "0009_section_templates"
down_revision = "0008_aesthetic_videos"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "section_templates",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column(
            "user_id",
            sa.String(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("cuts_ratio", sa.JSON(), nullable=False),
        sa.Column("labels", sa.JSON(), nullable=False),
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
    op.create_index("ix_section_templates_user_id", "section_templates", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_section_templates_user_id", table_name="section_templates")
    op.drop_table("section_templates")
