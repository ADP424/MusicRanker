import os
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import URL, create_engine, text
from sqlalchemy.orm import Session, sessionmaker

from .database_models import Base

load_dotenv(Path(__file__).parent / ".env")

_engine = None
SessionLocal: sessionmaker[Session] | None = None


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
    SessionLocal = sessionmaker(
        bind=_engine,
        autoflush=False,
        expire_on_commit=False,
    )


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
        conn.execute(text("DROP TYPE IF EXISTS nationality CASCADE"))
