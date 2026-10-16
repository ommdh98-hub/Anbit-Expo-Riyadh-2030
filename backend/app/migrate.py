"""Versioned schema migrations: ordered SQL files in app/migrations, recorded in
schema_version. Safe to run on every start: applied versions are skipped, and an
ADD COLUMN whose column already exists (a database created by create_all from
the current models) is skipped too."""

import re
from datetime import datetime, timezone
from pathlib import Path

MIGRATIONS = Path(__file__).resolve().parent / "migrations"
ADD_COLUMN = re.compile(r"^\s*ALTER\s+TABLE\s+(\w+)\s+ADD\s+COLUMN\s+(\w+)", re.IGNORECASE)


def _statements(sql: str):
    body = "\n".join(line for line in sql.splitlines() if not line.strip().startswith("--"))
    return [s.strip() for s in body.split(";") if s.strip()]


def _has_column(conn, table: str, column: str) -> bool:
    return any(row[1] == column for row in conn.exec_driver_sql(f'PRAGMA table_info("{table}")'))


def applied_versions(engine) -> list[int]:
    with engine.begin() as conn:
        conn.exec_driver_sql(
            "CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)"
        )
        return [row[0] for row in conn.exec_driver_sql("SELECT version FROM schema_version ORDER BY version")]


def run_migrations(engine) -> list[str]:
    done = set(applied_versions(engine))
    applied = []
    for path in sorted(MIGRATIONS.glob("[0-9][0-9][0-9][0-9]_*.sql")):
        version = int(path.name[:4])
        if version in done:
            continue
        # One transaction per file: a failure leaves the database as it was.
        with engine.begin() as conn:
            for statement in _statements(path.read_text(encoding="utf-8")):
                match = ADD_COLUMN.match(statement)
                if match and _has_column(conn, match.group(1), match.group(2)):
                    continue
                conn.exec_driver_sql(statement)
            conn.exec_driver_sql(
                "INSERT INTO schema_version (version, name, applied_at) VALUES (?, ?, ?)",
                (version, path.stem, datetime.now(timezone.utc).isoformat()),
            )
        applied.append(path.stem)
    return applied


if __name__ == "__main__":
    from .database import engine

    print(run_migrations(engine) or "schema up to date")
