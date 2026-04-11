import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

SNAPSHOTS_DIR = Path(__file__).parent / "snapshots"


def _db_env() -> dict[str, str]:
    """Return the env vars needed for pg_dump / psql (PGPASSWORD etc.)."""
    env = os.environ.copy()
    env["PGPASSWORD"] = os.environ["DB_PASSWORD"]
    return env


def _db_args() -> list[str]:
    """Common connection flags shared by pg_dump and psql."""
    return [
        "-h",
        os.environ.get("DB_HOST", "localhost"),
        "-p",
        str(os.environ.get("DB_PORT", "5432")),
        "-U",
        os.environ["DB_USER"],
        os.environ["DATABASE"],
    ]


def _snapshot_path(label: str | None) -> Path:
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H-%M-%S")
    name = f"{ts}_{label}.sql" if label else f"{ts}.sql"
    return SNAPSHOTS_DIR / name


def save_snapshot(label: str | None = None) -> Path:
    """
    Dump the current database to a .sql file and return its path.

    Args:
        label: Optional short label appended to the filename (e.g. "before-migration").
               Avoid spaces; underscores or hyphens work best.
    """

    SNAPSHOTS_DIR.mkdir(exist_ok=True)
    path = _snapshot_path(label)

    cmd = ["pg_dump", "--no-password", "--clean", "--if-exists"] + _db_args()

    print(f"Saving snapshot -> {path.name} ...", end=" ", flush=True)
    with path.open("w", encoding="utf-8") as f:
        result = subprocess.run(
            cmd,
            stdout=f,
            stderr=subprocess.PIPE,
            env=_db_env(),
            text=True,
        )

    if result.returncode != 0:
        path.unlink(missing_ok=True)
        print("FAILED")
        print(result.stderr, file=sys.stderr)
        raise RuntimeError(f"pg_dump failed (exit {result.returncode})")

    size_kb = path.stat().st_size // 1024
    print(f"done ({size_kb} KB)")
    return path


def load_snapshot(path: str | Path) -> None:
    """
    Restore the database from a .sql snapshot file.

    The file is executed with psql. Because snapshots are saved with
    --clean --if-exists, this drops and recreates all objects in place —
    no need to reinitialize the schema separately.

    Args:
        path: Path to the .sql snapshot file (absolute or relative to repo root).
    """

    path = Path(path)
    if not path.is_absolute():
        path = Path(__file__).parent / path
    if not path.exists():
        raise FileNotFoundError(f"Snapshot not found: {path}")

    cmd = ["psql", "--no-password", "-f", str(path)] + _db_args()

    print(f"Loading snapshot <- {path.name} ...", end=" ", flush=True)
    result = subprocess.run(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env=_db_env(),
        text=True,
    )

    if result.returncode != 0:
        print("FAILED")
        print(result.stderr, file=sys.stderr)
        raise RuntimeError(f"psql failed (exit {result.returncode})")

    print("done")


def list_snapshots() -> list[Path]:
    """Return snapshot files sorted newest-first."""
    if not SNAPSHOTS_DIR.exists():
        return []
    return sorted(SNAPSHOTS_DIR.glob("*.sql"), reverse=True)
