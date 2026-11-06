"""Reset the database: drop every table and enum, then build the schema with
`alembic upgrade head`. Destructive. For a schema *change* on a database with
data in it, write an Alembic migration instead (see CLAUDE.md).

    python -m server.initialize_database          # asks for confirmation
    python -m server.initialize_database --yes    # doesn't
"""
import os
import sys

from alembic import command
from alembic.config import Config

from server.database import dispose_engine, drop_all, init_engine

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

if __name__ == "__main__":
    if "--yes" not in sys.argv:
        name = os.environ.get("DATABASE", "?")
        answer = input(f"This DROPS every table in database '{name}'. Type the database name to continue: ")
        if answer.strip() != name:
            sys.exit("Aborted; nothing changed.")
    init_engine()
    drop_all()
    dispose_engine()
    command.upgrade(Config(os.path.join(ROOT, "alembic.ini")), "head")
    print("✓ schema created by alembic upgrade head")
