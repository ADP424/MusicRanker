"""Set a new password for an account, from the command line.

Passwords are stored only as Argon2 hashes, so a forgotten one can't be read
back; this replaces it. Every existing sign-in of that account is ended.

    python -m server.set_password <username or email>                         # local
    docker compose exec app python -m server.set_password <username or email>  # Docker

Asks for the new password twice (it's never echoed or passed on the command line).
"""

import getpass
import sys

from sqlalchemy import delete, select

from server.database import dispose_engine, init_engine
from server import database
from server.database_models import Session, User
from server.normalize import norm
from server.security import MIN_PASSWORD_LEN, hash_password


def main() -> int:
    if len(sys.argv) != 2:
        print(__doc__.strip().split("\n\n")[2])
        return 2
    ident = sys.argv[1]
    init_engine()
    try:
        with database.SessionLocal() as db:
            user = db.scalar(select(User).where((User.username_norm == norm(ident)) | (User.email_norm == ident.casefold())))
            if user is None:
                print(f"No account with the username or email {ident!r}.")
                return 1
            print(f"Setting a new password for {user.username} ({user.email}).")
            new = getpass.getpass("New password: ")
            if len(new) < MIN_PASSWORD_LEN:
                print(f"Passwords need at least {MIN_PASSWORD_LEN} characters. Nothing changed.")
                return 1
            if getpass.getpass("Again: ") != new:
                print("They don't match. Nothing changed.")
                return 1
            user.password_hash = hash_password(new)
            ended = db.execute(delete(Session).where(Session.user_id == user.id)).rowcount
            db.commit()
            print(f"Done. {ended} existing sign-in{'' if ended == 1 else 's'} ended; sign in with the new password.")
            return 0
    finally:
        dispose_engine()


if __name__ == "__main__":
    sys.exit(main())
