from __future__ import annotations

import random
import threading
import time
from dotenv import load_dotenv

from approvals.client import ApprovalClient
from agent.orchestrator import Orchestrator
from clients import GmailClient, InstagramClient, WebAppClient
from cockpit_client import CockpitClient
from auditlog.audit import AuditLogger
from policy import validate_policy
from storage.local_state import LocalState
from tools.base import ToolContext, ToolRegistry
from tools import gmail_tool, instagram_tool, netlify_app_insights_tool, playwright_tool


def heartbeat_loop(api: CockpitClient, task_id: str, lease_token: str, stop_event: threading.Event):
    while not stop_event.is_set():
        try:
            api.heartbeat(task_id, lease_token)
        except Exception:
            pass
        stop_event.wait(15)


def execute_with_retries(fn, retries: int = 3):
    delay = 1.0
    for attempt in range(1, retries + 1):
        try:
            return fn()
        except Exception:
            if attempt == retries:
                raise
            time.sleep(delay + random.uniform(0.1, 0.5))
            delay *= 2


def run():
    load_dotenv('runner/.env')
    api = CockpitClient()
    local_state = LocalState()
    registry = ToolRegistry()
    for module in [gmail_tool, instagram_tool, netlify_app_insights_tool, playwright_tool]:
        registry.register(module)

    while True:
        try:
            queued = api.list_tasks(status='PENDING') + api.list_tasks(status='NEEDS_MANUAL')
            if not queued:
                time.sleep(5)
                continue

            task = queued[0]
            if local_state.is_done(task['id']):
                time.sleep(1)
                continue

            claim = api.claim_task(task['id'])
            if not claim:
                time.sleep(1)
                continue

            lease_token = claim['lease']['token']
            policy = api.get_policy()
            validate_policy(policy)

            logger = AuditLogger(api.log, task['id'])
            approvals = ApprovalClient(api)
            context = ToolContext(
                task_id=task['id'],
                policy=policy,
                logger=logger,
                approvals=approvals,
                clients={'cockpit': api, 'gmail': GmailClient(), 'instagram': InstagramClient(), 'webapp': WebAppClient()}
            )
            orchestrator = Orchestrator(registry, logger)

            stop = threading.Event()
            threading.Thread(target=heartbeat_loop, args=(api, task['id'], lease_token, stop), daemon=True).start()
            try:
                result = execute_with_retries(lambda: orchestrator.run_task(task, context), retries=3)
                api.complete(task['id'], lease_token, result)
                local_state.mark_done(task['id'], time.strftime('%Y-%m-%dT%H:%M:%SZ'))
            except Exception as exc:
                err = str(exc)
                api.fail(task['id'], lease_token, err, needs_manual='NEEDS_MANUAL' in err)
            finally:
                stop.set()
        except Exception:
            time.sleep(5)


if __name__ == '__main__':
    run()
