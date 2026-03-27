import sys

from .snapshot import save_snapshot

label = sys.argv[1] if len(sys.argv) > 1 else None
path = save_snapshot(label)
print(f"Snapshot saved: {path}")
