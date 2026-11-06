"""rank added_at and show-wide episode order

Revision ID: fbe86cb47879
Revises: 11196a6f5867
Create Date: 2026-11-03 19:08:26.766557
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'fbe86cb47879'
down_revision: Union[str, None] = '11196a6f5867'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

RANK_TABLES = (
    "user_artist_ranks", "user_album_ranks", "user_book_ranks", "user_movie_ranks", "user_game_ranks",
    "user_television_show_ranks", "user_television_season_ranks", "user_television_episode_ranks",
)


def upgrade() -> None:
    op.create_table('television_show_episode_comparison',
    sa.Column('show_id', sa.Integer(), nullable=False),
    sa.Column('winner_id', sa.Integer(), nullable=False),
    sa.Column('loser_id', sa.Integer(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('guild_id', sa.Integer(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['guild_id'], ['guilds.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['loser_id', 'guild_id'], ['television_episodes.id', 'television_episodes.guild_id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['show_id'], ['television_shows.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['winner_id', 'guild_id'], ['television_episodes.id', 'television_episodes.guild_id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('show_id', 'winner_id', 'loser_id', 'user_id')
    )

    # Added without a default first, so existing rows stay NULL ("before we kept
    # track") instead of all claiming to have been added just now.
    for table in RANK_TABLES:
        op.add_column(table, sa.Column('added_at', sa.DateTime(timezone=True), nullable=True))
        op.alter_column(table, 'added_at', server_default=sa.text('now()'))

    op.add_column('user_television_episode_ranks', sa.Column('show_rank', sa.Numeric(), nullable=True))
    # Seed the show-wide order from what each list already says: airing order of
    # seasons, then the per-season order within each.
    op.execute("""
        UPDATE user_television_episode_ranks r SET show_rank = o.pos
        FROM (
            SELECT er.user_id, er.episode_id,
                   row_number() OVER (PARTITION BY er.user_id, er.guild_id, er.show_id
                                      ORDER BY s.season_rank, er.rank, er.episode_id) AS pos
            FROM user_television_episode_ranks er JOIN television_seasons s ON s.id = er.season_id
        ) o
        WHERE r.user_id = o.user_id AND r.episode_id = o.episode_id
    """)
    op.create_index('idx_user_television_episode_ranks_show_order', 'user_television_episode_ranks', ['user_id', 'guild_id', 'show_id', 'show_rank'], unique=False)


def downgrade() -> None:
    op.drop_index('idx_user_television_episode_ranks_show_order', table_name='user_television_episode_ranks')
    op.drop_column('user_television_episode_ranks', 'show_rank')
    for table in RANK_TABLES:
        op.drop_column(table, 'added_at')
    op.drop_table('television_show_episode_comparison')
