"""job heartbeat and attempts

Revision ID: 8e1b3783623e
Revises: fd4be9b4c502
Create Date: 2026-11-02 09:23:50.879900
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '8e1b3783623e'
down_revision: Union[str, None] = 'fd4be9b4c502'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("jobs", sa.Column("attempts", sa.Integer(), server_default="0", nullable=False))
    op.add_column("jobs", sa.Column("heartbeat_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("jobs", "heartbeat_at")
    op.drop_column("jobs", "attempts")
