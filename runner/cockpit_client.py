from __future__ import annotations

import os
import httpx


class CockpitClient:
    def __init__(self):
        self.base_url = os.environ['COCKPIT_BASE_URL'].rstrip('/')
        self.token = os.environ['ADMIN_TOKEN']
        self.runner_id = os.getenv('RUNNER_ID', 'winbox-1')
        self.http = httpx.Client(timeout=30)

    def _headers(self):
        return {'Authorization': f'Bearer {self.token}'}

    def list_tasks(self, status: str | None = None):
        url = f'{self.base_url}/api/tasks'
        if status:
            url = f'{url}?status={status}'
        r = self.http.get(url, headers=self._headers())
        r.raise_for_status()
        return r.json()['tasks']

    def list_pending_tasks(self):
        return self.list_tasks(status='PENDING')

    def claim_task(self, task_id):
        r = self.http.post(f'{self.base_url}/api/tasks/{task_id}/claim', json={'runnerId': self.runner_id}, headers=self._headers())
        if r.status_code >= 400:
            return None
        return r.json()

    def heartbeat(self, task_id, lease_token: str):
        self.http.post(f'{self.base_url}/api/tasks/{task_id}/heartbeat', json={'leaseToken': lease_token}, headers=self._headers()).raise_for_status()

    def complete(self, task_id, lease_token: str, result):
        self.http.post(f'{self.base_url}/api/tasks/{task_id}/complete', json={'leaseToken': lease_token, 'result': result}, headers=self._headers()).raise_for_status()

    def fail(self, task_id, lease_token: str, error, needs_manual=False):
        self.http.post(f'{self.base_url}/api/tasks/{task_id}/fail', json={'leaseToken': lease_token, 'error': error, 'needsManual': needs_manual}, headers=self._headers()).raise_for_status()

    def log(self, entry):
        self.http.post(f'{self.base_url}/api/logs', json=entry, headers=self._headers()).raise_for_status()

    def get_policy(self):
        r = self.http.get(f'{self.base_url}/api/policy', headers=self._headers())
        r.raise_for_status()
        return r.json()

    def get_task(self, task_id):
        r = self.http.get(f'{self.base_url}/api/tasks/{task_id}', headers=self._headers())
        r.raise_for_status()
        return r.json()

    def add_pending_action(self, task_id, action):
        self.http.post(f'{self.base_url}/api/tasks/{task_id}/pending-action', json=action, headers=self._headers()).raise_for_status()

    def add_artifact(self, task_id, artifact):
        payload = {'taskId': task_id, **artifact}
        self.http.post(f'{self.base_url}/api/artifacts', json=payload, headers=self._headers()).raise_for_status()

    def set_digest(self, digest):
        self.http.post(f'{self.base_url}/api/email/digest', json=digest, headers=self._headers()).raise_for_status()

    def upload_watch_latest_screenshot(self, task_id: str, jpeg_bytes: bytes):
        self.http.post(
            f'{self.base_url}/api/watch/latest_screenshot?taskId={task_id}',
            content=jpeg_bytes,
            headers={**self._headers(), 'Content-Type': 'image/jpeg'}
        ).raise_for_status()
