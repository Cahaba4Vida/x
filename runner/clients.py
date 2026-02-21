from __future__ import annotations

import random
from datetime import datetime


class GmailClient:
    def list_messages(self, max_results=30):
        return [{'id': f'msg-{i}', 'from': 'news@example.com', 'subject': f'Newsletter {i}', 'snippet': 'promo update list-unsubscribe'} for i in range(3)] + [{'id': 'important-1', 'from': 'billing@example.com', 'subject': 'Invoice due', 'snippet': 'urgent payment reminder'}]

    def archive_message(self, message_id):
        return {'id': message_id, 'archived': True}

    def send_raw(self, raw):
        return {'id': 'sent-1'}


class InstagramClient:
    def detect_checkpoint(self, keywords):
        return False

    def auto_reply_dms(self, limit, max_per_hour):
        return [{'thread': f'thread-{i}', 'status': 'sent'} for i in range(min(2, limit, max_per_hour))]

    def auto_reply_comments(self, limit, blocklist, max_per_hour):
        return [{'commentId': f'c-{i}', 'status': 'sent'} for i in range(min(2, limit, max_per_hour))]

    def publish_post(self, media_paths, caption):
        return [{'id': 'a1', 'type': 'screenshot', 'mime': 'image/png', 'createdAt': datetime.utcnow().isoformat(), 'dataBase64': '', 'note': f'Posted {len(media_paths)} media items'}]


class WebAppClient:
    def collect_insights(self, app_ids=None):
        return [{'appId': app_id or 'myapp1', 'insights': {'activeUsers': '123', 'mrr': '$1,999'}, 'screenshot': 'captured'} for app_id in (app_ids or ['myapp1'])]

    def run_smoke(self, app_ids=None):
        return [{'appId': app_id or 'myapp1', 'passed': True, 'consoleErrors': [], 'networkFailures': []} for app_id in (app_ids or ['myapp1'])]
