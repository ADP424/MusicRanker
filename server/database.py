import os
from contextvars import ContextVar

from dotenv import load_dotenv
from sqlalchemy import URL, create_engine, event, inspect, text
from sqlalchemy.orm import Session, sessionmaker

from .database_models import Base
from .database_models.mixins import NormalizedNames
from .database_models.nationality import HasNationalities, fill_unknown_nationality
from .normalize import norm, norm_or_none

load_dotenv()

_engine = None
SessionLocal: sessionmaker[Session] | None = None

#: `nationality` was a native enum before nationalities became per guild; still
#: dropped so an old database cleans up fully.
_ENUMS = (
    "nationality", "cast_role", "band_role", "book_role", "game_role",
    "guild_role", "invitation_status", "job_lane", "job_status",
)


def _nationality_changed(obj) -> bool:
    attrs = inspect(obj).attrs
    return attrs.birth_nationality.history.has_changes() or attrs.core_nationality.history.has_changes()


def _sync_norms(session: Session, _flush_ctx, _instances):
    """Single place where name_norm/name_en_norm are maintained. If this ever
    drifts from `normalize.norm`, merge conflict detection drifts with it.
    Also the single place a lone Unknown nationality takes the other one."""
    for obj in (*session.new, *session.dirty):
        if isinstance(obj, NormalizedNames):
            obj.name_norm = norm(obj.name)
            obj.name_en_norm = norm_or_none(getattr(obj, "name_en", None))
        if isinstance(obj, HasNationalities) and (obj in session.new or _nationality_changed(obj)):
            fill_unknown_nationality(obj)


def database_url(*, schema: str | None = None) -> URL:
    """The app's Postgres URL from the environment (also used by Alembic).

    `schema` pins the connection's search_path to that one schema, so every
    unqualified table and enum resolves there and `public` is invisible. The
    tests and the Alembic baseline check use this to work in a scratch schema
    of the app database without needing CREATE DATABASE rights. The `DB_SCHEMA`
    env var does the same for the whole app (e.g. a demo copy of the data)."""
    return URL.create(
        drivername="postgresql+psycopg",
        username=os.environ["DB_USER"],
        password=os.environ["DB_PASSWORD"],
        host=os.environ.get("DB_HOST", "localhost"),
        port=int(os.environ.get("DB_PORT", 5432)),
        database=os.environ["DATABASE"],
        query={"options": f"-csearch_path={schema}"} if (schema := schema or os.environ.get("DB_SCHEMA")) else {},
    )


def init_engine(url: URL | None = None) -> None:
    global _engine, SessionLocal
    _engine = create_engine(url or database_url(), pool_size=10, pool_pre_ping=True)
    SessionLocal = sessionmaker(bind=_engine, autoflush=False, expire_on_commit=False)
    event.listen(SessionLocal, "before_flush", _sync_norms)


def dispose_engine() -> None:
    if _engine:
        _engine.dispose()


#: Set by `POST /batch` while it runs its sub-requests: they all share this one
#: session, and the batch commits (or rolls back) once at the end.
batch_session: ContextVar[Session | None] = ContextVar("batch_session", default=None)


def in_batch():
    """The `get_database` body for a sub-request of a batch: the shared session,
    flushed after each request so errors surface on the request that caused them."""
    db = batch_session.get()
    yield db
    db.flush()


def get_database():
    if batch_session.get() is not None:
        yield from in_batch()
        return
    with SessionLocal() as db:
        try:
            yield db
            db.commit()
        except Exception:
            db.rollback()
            raise


def create_all() -> None:
    Base.metadata.create_all(_engine)


def drop_all() -> None:
    Base.metadata.drop_all(_engine)
    with _engine.begin() as conn:
        conn.execute(text("DROP TABLE IF EXISTS alembic_version"))
        for name in _ENUMS:
            conn.execute(text(f"DROP TYPE IF EXISTS {name} CASCADE"))
