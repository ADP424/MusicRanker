import sys
from pathlib import Path

from .snapshot import list_snapshots, load_snapshot


def resolve(arg: str) -> Path:
    p = Path(arg)
    if p.exists():
        return p
    # try relative to snapshots/
    candidate = Path(__file__).parent / "snapshots" / p
    if candidate.exists():
        return candidate
    raise FileNotFoundError(f"Cannot find snapshot: {arg}")


if len(sys.argv) > 1:
    path = resolve(sys.argv[1])
else:
    snapshots = list_snapshots()
    if not snapshots:
        print("No snapshots found in snapshots/ directory.")
        sys.exit(1)
    path = snapshots[0]
    print(f"No file specified — using most recent: {path.name}")

load_snapshot(path)
print("Snapshot loaded successfully.")
