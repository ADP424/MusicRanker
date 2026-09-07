import os

from dotenv import load_dotenv
from sqlalchemy import URL, create_engine, event, text
from sqlalchemy.orm import Session, sessionmaker

from .database_models import Base
from .database_models.mixins import NormalizedNames
from .normalize import norm, norm_or_none

load_dotenv()

_engine = None
SessionLocal: sessionmaker[Session] | None = None

_ENUMS = (
    "nationality", "cast_role", "band_role", "game_role",
    "guild_role", "invitation_status", "job_lane", "job_status",
)


def _sync_norms(session: Session, _flush_ctx, _instances):
    """Single place where name_norm/name_en_norm are maintained. If this ever
    drifts from `normalize.norm`, merge conflict detection drifts with it."""
    for obj in (*session.new, *session.dirty):
        if isinstance(obj, NormalizedNames):
            obj.name_norm = norm(obj.name)
            obj.name_en_norm = norm_or_none(getattr(obj, "name_en", None))


def init_engine() -> None:
    global _engine, SessionLocal
    url = URL.create(
        drivername="postgresql+psycopg",
        username=os.environ["DB_USER"],
        password=os.environ["DB_PASSWORD"],
        host=os.environ.get("DB_HOST", "localhost"),
        port=int(os.environ.get("DB_PORT", 5432)),
        database=os.environ["DATABASE"],
    )
    _engine = create_engine(url, pool_size=10, pool_pre_ping=True)
    SessionLocal = sessionmaker(bind=_engine, autoflush=False, expire_on_commit=False)
    event.listen(SessionLocal, "before_flush", _sync_norms)


def dispose_engine() -> None:
    if _engine:
        _engine.dispose()


def get_database():
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
        for name in _ENUMS:
            conn.execute(text(f"DROP TYPE IF EXISTS {name} CASCADE"))
