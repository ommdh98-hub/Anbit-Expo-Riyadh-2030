import os
from pathlib import Path
from sqlalchemy import event
from sqlmodel import create_engine

# Demo data lives in backend/data/demo.db by default, apart from the operational
# backend/anbit.db. ANBIT_DB_PATH selects another file; DATABASE_URL overrides both.
BACKEND = Path(__file__).resolve().parents[1]
DB_PATH = Path(os.getenv("ANBIT_DB_PATH") or BACKEND / "data" / "demo.db")
DB_PATH.parent.mkdir(parents=True, exist_ok=True)
engine = create_engine(
    os.getenv("DATABASE_URL", f"sqlite:///{DB_PATH}"),
    connect_args={"check_same_thread": False},
)


@event.listens_for(engine, "connect")
def foreign_keys(connection, _):
    if engine.dialect.name == "sqlite":
        connection.execute("PRAGMA foreign_keys=ON")
