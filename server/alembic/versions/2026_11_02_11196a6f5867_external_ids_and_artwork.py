"""external ids and artwork

Revision ID: 11196a6f5867
Revises: 8e1b3783623e
Create Date: 2026-11-02 09:55:13.488564
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '11196a6f5867'
down_revision: Union[str, None] = '8e1b3783623e'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('games', sa.Column('igdb_id', sa.Integer(), nullable=True))
    op.add_column('games', sa.Column('overview', sa.Text(), nullable=True))
    op.add_column('games', sa.Column('image_url', sa.Text(), nullable=True))
    op.create_index('uq_games_igdb_id', 'games', ['guild_id', 'igdb_id'], unique=True, postgresql_where=sa.text('igdb_id IS NOT NULL'))
    op.add_column('movies', sa.Column('tmdb_id', sa.Integer(), nullable=True))
    op.add_column('movies', sa.Column('overview', sa.Text(), nullable=True))
    op.add_column('movies', sa.Column('image_url', sa.Text(), nullable=True))
    op.create_index('uq_movies_tmdb_id', 'movies', ['guild_id', 'tmdb_id'], unique=True, postgresql_where=sa.text('tmdb_id IS NOT NULL'))
    op.add_column('people', sa.Column('tmdb_id', sa.Integer(), nullable=True))
    op.add_column('people', sa.Column('igdb_id', sa.Integer(), nullable=True))
    op.add_column('people', sa.Column('image_url', sa.Text(), nullable=True))
    op.create_index('uq_people_igdb_id', 'people', ['guild_id', 'igdb_id'], unique=True, postgresql_where=sa.text('igdb_id IS NOT NULL'))
    op.create_index('uq_people_tmdb_id', 'people', ['guild_id', 'tmdb_id'], unique=True, postgresql_where=sa.text('tmdb_id IS NOT NULL'))
    op.add_column('television_episodes', sa.Column('episode_number', sa.Integer(), nullable=True))
    op.add_column('television_episodes', sa.Column('overview', sa.Text(), nullable=True))
    op.add_column('television_episodes', sa.Column('image_url', sa.Text(), nullable=True))
    op.add_column('television_seasons', sa.Column('overview', sa.Text(), nullable=True))
    op.add_column('television_seasons', sa.Column('image_url', sa.Text(), nullable=True))
    op.add_column('television_shows', sa.Column('tmdb_id', sa.Integer(), nullable=True))
    op.add_column('television_shows', sa.Column('overview', sa.Text(), nullable=True))
    op.add_column('television_shows', sa.Column('image_url', sa.Text(), nullable=True))
    op.create_index('uq_television_shows_tmdb_id', 'television_shows', ['guild_id', 'tmdb_id'], unique=True, postgresql_where=sa.text('tmdb_id IS NOT NULL'))


def downgrade() -> None:
    op.drop_index('uq_television_shows_tmdb_id', table_name='television_shows', postgresql_where=sa.text('tmdb_id IS NOT NULL'))
    op.drop_column('television_shows', 'image_url')
    op.drop_column('television_shows', 'overview')
    op.drop_column('television_shows', 'tmdb_id')
    op.drop_column('television_seasons', 'image_url')
    op.drop_column('television_seasons', 'overview')
    op.drop_column('television_episodes', 'image_url')
    op.drop_column('television_episodes', 'overview')
    op.drop_column('television_episodes', 'episode_number')
    op.drop_index('uq_people_tmdb_id', table_name='people', postgresql_where=sa.text('tmdb_id IS NOT NULL'))
    op.drop_index('uq_people_igdb_id', table_name='people', postgresql_where=sa.text('igdb_id IS NOT NULL'))
    op.drop_column('people', 'image_url')
    op.drop_column('people', 'igdb_id')
    op.drop_column('people', 'tmdb_id')
    op.drop_index('uq_movies_tmdb_id', table_name='movies', postgresql_where=sa.text('tmdb_id IS NOT NULL'))
    op.drop_column('movies', 'image_url')
    op.drop_column('movies', 'overview')
    op.drop_column('movies', 'tmdb_id')
    op.drop_index('uq_games_igdb_id', table_name='games', postgresql_where=sa.text('igdb_id IS NOT NULL'))
    op.drop_column('games', 'image_url')
    op.drop_column('games', 'overview')
    op.drop_column('games', 'igdb_id')
