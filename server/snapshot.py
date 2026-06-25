import os
import re
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
    result = subprocess.run(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env=_db_env(),
        encoding="utf-8",
    )

    if result.returncode != 0:
        print("FAILED")
        print(result.stderr, file=sys.stderr)
        raise RuntimeError(f"pg_dump failed (exit {result.returncode})")

    # PG18: strip \restrict token (blocks psql loading) and add CASCADE to
    # DROP TYPE so enum drops succeed even if dependents linger.
    lines = []
    for line in result.stdout.splitlines():
        if line.startswith("\\restrict") or line.startswith("\\unrestrict"):
            continue
        if line.startswith("DROP TYPE IF EXISTS") and not line.rstrip().endswith("CASCADE;"):
            line = line.rstrip().rstrip(";") + " CASCADE;"
        lines.append(line)
    content = "\n".join(lines) + "\n"

    # pg_dump duplicates enum labels that were added via ALTER TYPE ADD VALUE
    # (lists them at their sorted position AND at the end). Deduplicate each
    # CREATE TYPE ... AS ENUM block so the snapshot loads cleanly.
    def _dedup_enum(m: re.Match) -> str:
        seen: set[str] = set()
        out = []
        for line in m.group(0).splitlines():
            label = line.strip().strip(",").strip("'")
            if line.strip().startswith("'"):
                if label in seen:
                    continue
                seen.add(label)
            out.append(line)
        # Fix trailing comma on the last label line (may be exposed after dedup)
        for i in range(len(out) - 1, -1, -1):
            if out[i].strip().startswith("'"):
                out[i] = out[i].rstrip().rstrip(",")
                break
        return "\n".join(out)

    content = re.sub(r"CREATE TYPE \S+ AS ENUM \(.*?\);", _dedup_enum, content, flags=re.DOTALL)
    path.write_text(content, encoding="utf-8")

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

    # PG18 has a bug where DROP TYPE ... CASCADE leaves stale pg_enum entries,
    # causing the subsequent CREATE TYPE to fail with a duplicate key error.
    # Pre-drop all enum types found in the snapshot before running it.
    enum_types = re.findall(r"CREATE TYPE (\S+) AS ENUM", path.read_text(encoding="utf-8"))
    if enum_types:
        pre_drop = " ".join(f"DROP TYPE IF EXISTS {t} CASCADE;" for t in enum_types)
        subprocess.run(
            ["psql", "--no-password", "-c", pre_drop] + _db_args(),
            env=_db_env(),
            check=True,
        )

    cmd = ["psql", "--no-password", "-f", str(path)] + _db_args()

    print(f"Loading snapshot <- {path.name} ...")
    result = subprocess.run(
        cmd,
        env=_db_env(),
        text=True,
    )

    if result.returncode != 0:
        raise RuntimeError(f"psql failed (exit {result.returncode})")

    print("done")


def list_snapshots() -> list[Path]:
    """Return snapshot files sorted newest-first."""
    if not SNAPSHOTS_DIR.exists():
        return []
    return sorted(SNAPSHOTS_DIR.glob("*.sql"), reverse=True)
