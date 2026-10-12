import os
from pathlib import Path
from sqlalchemy import event
from sqlmodel import create_engine

DB_PATH = Path(__file__).resolve().parents[1] / "anbit.db"
engine = create_engine(
    os.getenv("DATABASE_URL", f"sqlite:///{DB_PATH}"),
    connect_args={"check_same_thread": False},
)


@event.listens_for(engine, "connect")
def foreign_keys(connection, _):
    if engine.dialect.name == "sqlite":
        connection.execute("PRAGMA foreign_keys=ON")
