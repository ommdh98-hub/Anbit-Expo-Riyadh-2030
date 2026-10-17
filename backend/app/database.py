import os
from pathlib import Path
from sqlalchemy import event
from sqlmodel import create_engine

# Demo data lives in backend/data/demo.db by default, apart from the operational
# backend/anbit.db. ANBIT_DB_PATH selects another file; DATABASE_URL overrides both.
BACKEND = Path(__file__).resolve().parents[1]
DEMO_DB_PATH = BACKEND / "data" / "demo.db"
DB_PATH = Path(os.getenv("ANBIT_DB_PATH") or DEMO_DB_PATH)
DB_PATH.parent.mkdir(parents=True, exist_ok=True)
engine = create_engine(
    os.getenv("DATABASE_URL", f"sqlite:///{DB_PATH}"),
    connect_args={"check_same_thread": False},
)


@event.listens_for(engine, "connect")
def foreign_keys(connection, _):
    if engine.dialect.name == "sqlite":
        connection.execute("PRAGMA foreign_keys=ON")


def is_demo_database(db_engine=None):
    """True only when the engine in use is the file backend/data/demo.db (never
    backend/anbit.db, another file, an in-memory database or DATABASE_URL)."""
    db_engine = db_engine if db_engine is not None else engine
    path = db_engine.url.database if db_engine.url.get_backend_name() == "sqlite" else None
    return bool(path) and path != ":memory:" and Path(path).resolve() == DEMO_DB_PATH.resolve()
