"""add draft templates

Revision ID: 0015_draft_templates
Revises: 0014_draft_lyric_style
Create Date: 2026-03-29
"""

from alembic import op
import sqlalchemy as sa

revision = "0015_draft_templates"
down_revision = "0014_draft_lyric_style"
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())
    if "draft_templates" in tables:
        return

    op.create_table(
        "draft_templates",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("user_id", sa.String(), nullable=False),
        sa.Column("aesthetic_id", sa.String(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("base_duration_sec", sa.Float(), nullable=False),
        sa.Column("assignments", sa.JSON(), nullable=False),
        sa.Column("lyric_style", sa.JSON(), nullable=True),
        sa.Column("ai_notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["aesthetic_id"], ["aesthetics.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_draft_templates_user_id"), "draft_templates", ["user_id"], unique=False)
    op.create_index(op.f("ix_draft_templates_aesthetic_id"), "draft_templates", ["aesthetic_id"], unique=False)


def downgrade():
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())
    if "draft_templates" not in tables:
        return

    op.drop_index(op.f("ix_draft_templates_aesthetic_id"), table_name="draft_templates")
    op.drop_index(op.f("ix_draft_templates_user_id"), table_name="draft_templates")
    op.drop_table("draft_templates")
