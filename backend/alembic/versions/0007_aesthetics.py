"""add aesthetics table and aesthetic_id to videos and renders

Revision ID: 0007
Revises: 0006
Create Date: 2026-03-28
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0007"
down_revision: Union[str, None] = "0006"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "aesthetics",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("user_id", sa.String(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
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
    op.create_index("ix_aesthetics_user_id", "aesthetics", ["user_id"])

    op.add_column("videos", sa.Column("aesthetic_id", sa.String(), nullable=True))
    op.create_foreign_key(
        "fk_videos_aesthetic_id", "videos", "aesthetics", ["aesthetic_id"], ["id"], ondelete="SET NULL"
    )
    op.create_index("ix_videos_aesthetic_id", "videos", ["aesthetic_id"])

    op.add_column("renders", sa.Column("aesthetic_id", sa.String(), nullable=True))
    op.create_foreign_key(
        "fk_renders_aesthetic_id", "renders", "aesthetics", ["aesthetic_id"], ["id"], ondelete="SET NULL"
    )
    op.create_index("ix_renders_aesthetic_id", "renders", ["aesthetic_id"])


def downgrade() -> None:
    op.drop_index("ix_renders_aesthetic_id", "renders")
    op.drop_constraint("fk_renders_aesthetic_id", "renders", type_="foreignkey")
    op.drop_column("renders", "aesthetic_id")

    op.drop_index("ix_videos_aesthetic_id", "videos")
    op.drop_constraint("fk_videos_aesthetic_id", "videos", type_="foreignkey")
    op.drop_column("videos", "aesthetic_id")

    op.drop_index("ix_aesthetics_user_id", "aesthetics")
    op.drop_table("aesthetics")
