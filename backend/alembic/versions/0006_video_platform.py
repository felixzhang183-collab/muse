"""add platform and source_url columns to videos

Revision ID: 0006
Revises: 0005
Create Date: 2026-03-28
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0006"
down_revision: Union[str, None] = "0005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("videos", sa.Column("platform", sa.String(), nullable=False, server_default="youtube"))
    op.add_column("videos", sa.Column("source_url", sa.String(), nullable=True))
    # Back-fill source_url for existing YouTube rows
    op.execute("UPDATE videos SET source_url = 'https://www.youtube.com/watch?v=' || youtube_id")


def downgrade() -> None:
    op.drop_column("videos", "source_url")
    op.drop_column("videos", "platform")
