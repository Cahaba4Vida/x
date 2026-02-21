from __future__ import annotations

import time


class ApprovalClient:
    def __init__(self, api, poll_interval: int = 5):
        self.api = api
        self.poll_interval = poll_interval

    def wait_for_action(self, task_id: str, action_id: str) -> str:
        while True:
            task = self.api.get_task(task_id)
            for action in task.get('pendingActions', []):
                if action['id'] == action_id and action['status'] in ('APPROVED', 'DENIED'):
                    return action['status']
            time.sleep(self.poll_interval)
