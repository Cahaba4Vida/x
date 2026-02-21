from __future__ import annotations

import sqlite3
from pathlib import Path


class LocalState:
    def __init__(self, path: str = 'runner/local_data/state.db'):
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(path)
        self.conn.execute('create table if not exists completed_tasks(task_id text primary key, completed_at text)')
        self.conn.commit()

    def is_done(self, task_id: str) -> bool:
        cur = self.conn.execute('select 1 from completed_tasks where task_id=?', (task_id,))
        return cur.fetchone() is not None

    def mark_done(self, task_id: str, completed_at: str) -> None:
        self.conn.execute('insert or replace into completed_tasks(task_id, completed_at) values(?,?)', (task_id, completed_at))
        self.conn.commit()
