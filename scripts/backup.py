from datetime import datetime
from pathlib import Path
import sqlite3

root = Path(__file__).resolve().parents[1]
source = root / 'backend/anbit.db'
if not source.exists():
    raise SystemExit('Start Anbit once before creating a backup.')
folder = root / 'backups'
folder.mkdir(exist_ok=True)
output = folder / f'anbit-{datetime.now():%Y%m%d-%H%M%S}.db'
with sqlite3.connect(source) as src, sqlite3.connect(output) as dst:
    src.backup(dst)
print(output)
