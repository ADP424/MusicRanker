"""Alembic environment. Run from the repo root: `alembic upgrade head`.

`-x schema=<name>` targets a scratch schema of the app database instead of
`public` (the tests build theirs this way; see `database_url`)."""
from alembic import context
from sqlalchemy import create_engine, pool

from server.database import database_url
from server.database_models import Base

config = context.config
target_metadata = Base.metadata

#: Pre-shared-genre leftovers that still exist (with rows) in older databases.
#: Not part of the models; never autogenerate a DROP for them.
LEGACY_TABLES = {"movie_genre_parents", "game_genre_parents"}


def _include_object(obj, name, type_, reflected, compare_to):
    table = obj if type_ == "table" else getattr(obj, "table", None)
    return not (reflected and compare_to is None and table is not None and table.name in LEGACY_TABLES)


def _url():
    return database_url(schema=context.get_x_argument(as_dictionary=True).get("schema"))


def run_migrations_offline() -> None:
    context.configure(
        url=_url().render_as_string(hide_password=False),
        target_metadata=target_metadata,
        literal_binds=True,
        compare_type=True,
        include_object=_include_object,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    engine = create_engine(_url(), poolclass=pool.NullPool)
    with engine.connect() as connection:
        context.configure(
            connection=connection, target_metadata=target_metadata,
            compare_type=True, include_object=_include_object,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
