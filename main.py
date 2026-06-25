"""
Launch both the FastAPI backend and the Vite frontend dev server together.

Usage:
    python main.py

Both processes share stdout/stderr with the parent.  Ctrl-C (or SIGTERM on
Unix) shuts both down cleanly.
"""

import signal
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).parent
FRONTEND = ROOT / "frontend"


def _terminate(procs: list[subprocess.Popen]) -> None:
    for p in procs:
        if p.poll() is None:
            p.terminate()
    for p in procs:
        try:
            p.wait(timeout=5)
        except subprocess.TimeoutExpired:
            p.kill()


def main() -> None:
    backend = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "server.main:app", "--reload"],
        cwd=ROOT,
    )
    frontend = subprocess.Popen(
        ["npm", "run", "dev"],
        cwd=FRONTEND,
        # On Windows, npm is a .cmd file; shell=True is needed to find it.
        shell=(sys.platform == "win32"),
    )

    procs = [backend, frontend]

    # Forward SIGTERM to children (Unix).
    if sys.platform != "win32":
        signal.signal(signal.SIGTERM, lambda *_: _terminate(procs))

    try:
        # Wait until either process exits (e.g. crash or user closes it).
        while all(p.poll() is None for p in procs):
            pass
    except KeyboardInterrupt:
        pass
    finally:
        _terminate(procs)

    # Exit with the first non-zero return code, or 0 if both were clean.
    codes = [p.returncode for p in procs]
    sys.exit(next((c for c in codes if c not in (0, -15, None)), 0))


if __name__ == "__main__":
    main()
