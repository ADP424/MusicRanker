"""per-guild nationalities

Nationalities stop being a native enum. Each guild gets its own list
(`nationalities`), seeded with the defaults plus anything its people/artists
already use; `people` / `artists` keep the name as text with a composite FK
into that list (renames cascade). "Unknown" becomes NULL.

Revision ID: a7c3e91d2b45
Revises: fbe86cb47879
Create Date: 2026-11-06 12:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

from server.database_models.nationality import DEFAULT_NATIONALITIES
from server.normalize import norm


revision: str = 'a7c3e91d2b45'
down_revision: Union[str, None] = 'fbe86cb47879'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLES = ("people", "artists")
COLS = ("birth_nationality", "core_nationality")

#: The enum's labels before this revision, for the downgrade.
OLD_ENUM = (
    'Algerian', 'American', 'Andorran', 'Argentinian', 'Armenian', 'Australian', 'Austrian', 'Belgian', 'Beninois',
    'Brazilian', 'Canadian', 'Channel Islander', 'Chilean', 'Chinese', 'Colombian', 'Croatian', 'Cuban', 'Cypriot',
    'Czech', 'Danish', 'Dutch', 'Ecuadorian', 'Egyptian', 'English', 'Filipino', 'Finnish', 'French', 'German',
    'Ghanaian', 'Greek', 'Guatemalan', 'Guyanese', 'Hongkongese', 'Hungarian', 'Icelandic', 'Indian', 'Indonesian',
    'Iranian', 'Irish', 'Israeli', 'Italian', 'Jamaican', 'Japanese', 'Kenyan', 'Korean', 'Latvian', 'Lebanese',
    'Liberian', 'Libyan', 'Lithuanian', 'Luxembourgish', 'Malaysian', 'Malian', 'Mexican', 'New Zealander',
    'Nigerian', 'Northern Irish', 'Norwegian', 'Omani', 'Panamanian', 'Polish', 'Portuguese', 'Romanian', 'Russian',
    'Saudi', 'Scottish', 'Serbian', 'Singaporean', 'Somalian', 'South African', 'Spanish', 'Swazi', 'Swedish',
    'Swiss', 'Syrian', 'Taiwanese', 'Thai', 'Trinidadian and Tobagonian', 'Ukrainian', 'Unknown', 'Uruguayan',
    'Venezuelan', 'Vietnamese', 'Welsh', 'Yugoslav', 'Zimbabwean',
)


def upgrade() -> None:
    op.create_table('nationalities',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('name', sa.Text(), nullable=False),
    sa.Column('guild_id', sa.Integer(), nullable=False),
    sa.Column('name_norm', sa.Text(), nullable=False),
    sa.Column('name_en_norm', sa.Text(), nullable=True),
    sa.ForeignKeyConstraint(['guild_id'], ['guilds.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('name', 'guild_id', name='uq_nationalities_name_guild'),
    )
    op.create_index(op.f('ix_nationalities_guild_id'), 'nationalities', ['guild_id'], unique=False)
    op.create_index(op.f('ix_nationalities_name_norm'), 'nationalities', ['name_norm'], unique=False)
    op.create_index(op.f('ix_nationalities_name_en_norm'), 'nationalities', ['name_en_norm'], unique=False)
    op.create_index('uq_nationalities_guild_norm', 'nationalities', ['guild_id', 'name_norm'], unique=True)

    # Enum -> text first; "Unknown" becomes NULL.
    for table in TABLES:
        for col in COLS:
            op.execute(f"ALTER TABLE {table} ALTER COLUMN {col} DROP NOT NULL")
            op.execute(f"ALTER TABLE {table} ALTER COLUMN {col} TYPE text USING NULLIF({col}::text, 'Unknown')")

    # Every guild: the defaults, plus whatever it already uses.
    conn = op.get_bind()
    guild_ids = conn.execute(sa.text("SELECT id FROM guilds")).scalars().all()
    used: dict[int, set[str]] = {g: set() for g in guild_ids}
    for table in TABLES:
        for col in COLS:
            for g, v in conn.execute(sa.text(f"SELECT DISTINCT guild_id, {col} FROM {table} WHERE {col} IS NOT NULL")):
                used.setdefault(g, set()).add(v)
    nat = sa.table('nationalities', sa.column('guild_id'), sa.column('name'), sa.column('name_norm'))
    rows = []
    for g in guild_ids:
        names: dict[str, str] = {}
        for n in (*DEFAULT_NATIONALITIES, *sorted(used.get(g, ()))):
            names.setdefault(norm(n), n)
        rows += [{"guild_id": g, "name": n, "name_norm": k} for k, n in names.items()]
    if rows:
        op.bulk_insert(nat, rows)

    for table in TABLES:
        for col in COLS:
            op.create_foreign_key(f'fk_{table}_{col}', table, 'nationalities',
                                  [col, 'guild_id'], ['name', 'guild_id'], onupdate='CASCADE')

    op.execute("DROP TYPE IF EXISTS nationality")


def downgrade() -> None:
    labels = ", ".join(f"'{v}'" for v in OLD_ENUM)
    op.execute(f"CREATE TYPE nationality AS ENUM ({labels})")
    for table in TABLES:
        for col in COLS:
            op.drop_constraint(f'fk_{table}_{col}', table, type_='foreignkey')
            # Values the old enum doesn't know (added per guild) fall back to Unknown.
            op.execute(
                f"ALTER TABLE {table} ALTER COLUMN {col} TYPE nationality USING "
                f"(CASE WHEN {col} IN ({labels}) THEN {col} ELSE 'Unknown' END)::nationality"
            )
            op.execute(f"ALTER TABLE {table} ALTER COLUMN {col} SET NOT NULL")
    op.drop_index('uq_nationalities_guild_norm', table_name='nationalities')
    op.drop_index(op.f('ix_nationalities_name_en_norm'), table_name='nationalities')
    op.drop_index(op.f('ix_nationalities_name_norm'), table_name='nationalities')
    op.drop_index(op.f('ix_nationalities_guild_id'), table_name='nationalities')
    op.drop_table('nationalities')
