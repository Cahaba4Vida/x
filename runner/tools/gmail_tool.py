from __future__ import annotations

from datetime import datetime
from email.mime.text import MIMEText
import base64
from uuid import uuid4

TOOL_META = {
    'name': 'gmail_tool',
    'description': 'Digest, archive and send Gmail messages',
    'input_schema': {'type': 'object'},
    'output_schema': {'type': 'object'},
    'risk_level': 'WRITE',
    'default_requires_approval': True
}


def _newsletter_like(message: dict) -> bool:
    text = f"{message.get('from','')} {message.get('subject','')} {message.get('snippet','')}".lower()
    return 'list-unsubscribe' in text or 'newsletter' in text or 'promo' in text


def execute(context, args):
    mode = args.get('mode', 'digest')
    gmail = context.clients.get('gmail')
    if mode == 'digest':
        messages = gmail.list_messages(max_results=30)
        important_keywords = context.policy['gmail']['important_rules']['keywords']
        important = [m for m in messages if any(k in (m.get('subject', '') + m.get('snippet', '')).lower() for k in important_keywords)]
        archived = []
        if context.policy['gmail']['auto_archive']['enabled']:
            for m in messages:
                if _newsletter_like(m):
                    gmail.archive_message(m['id'])
                    archived.append({'id': m['id'], 'reason': 'newsletter_heuristic'})
        digest = {'generatedAt': datetime.utcnow().isoformat(), 'important': important[:10], 'archiveSummary': archived, 'suggestedReplies': []}
        context.clients['cockpit'].set_digest(digest)
        return digest

    if mode == 'send':
        action_id = str(uuid4())
        context.clients['cockpit'].add_pending_action(context.task_id, {'id': action_id, 'type': 'gmail.send', 'payload': args, 'status': 'PENDING'})
        decision = context.approvals.wait_for_action(context.task_id, action_id)
        if decision != 'APPROVED':
            return {'status': 'denied'}
        message = MIMEText(args['body'])
        message['to'] = args['to']
        message['subject'] = args['subject']
        raw = base64.urlsafe_b64encode(message.as_bytes()).decode()
        gmail.send_raw(raw)
        return {'status': 'sent', 'to': args['to']}

    raise ValueError('unsupported mode')
