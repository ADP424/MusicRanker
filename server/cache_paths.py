"""Where the TMDB/IGDB sidecar caches live by default: `var/` under the repo."""
from __future__ import annotations

from pathlib import Path


def default_cache_path(repo_root: Path, name: str) -> Path:
    """`var/<name>`, moving a cache left at the repo root by an older version.
    If the move can't happen (another process has the file open, as on Windows),
    the old location keeps working and the move is retried next start."""
    new, old = repo_root / "var" / name, repo_root / name
    new.parent.mkdir(parents=True, exist_ok=True)
    if old.exists() and not new.exists():
        try:
            for suffix in ("-wal", "-shm"):
                sibling = old.with_name(old.name + suffix)
                if sibling.exists():
                    sibling.replace(new.with_name(new.name + suffix))
            old.replace(new)
        except OSError:
            return old
    return new
