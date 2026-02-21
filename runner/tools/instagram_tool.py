from __future__ import annotations

from uuid import uuid4

TOOL_META = {
    'name': 'instagram_tool',
    'description': 'Instagram DM, comments, and post workflows',
    'input_schema': {'type': 'object'},
    'output_schema': {'type': 'object'},
    'risk_level': 'WRITE',
    'default_requires_approval': False
}

CHECKPOINT_WORDS = ['challenge', "confirm it's you", 'suspicious login', 'checkpoint']


def execute(context, args):
    ig = context.clients['instagram']
    mode = args['mode']
    if ig.detect_checkpoint(CHECKPOINT_WORDS):
        raise RuntimeError('NEEDS_MANUAL: Instagram checkpoint detected. Open runner browser and complete challenge, then approve RESUME_AFTER_MANUAL.')

    if mode == 'dm_triage':
        replies = ig.auto_reply_dms(limit=20, max_per_hour=context.policy['limits']['max_dm_replies_per_hour'])
        return {'mode': mode, 'replied': replies}

    if mode == 'comment_mod':
        replies = ig.auto_reply_comments(limit=50, blocklist=context.policy['instagram']['blocklist_phrases'], max_per_hour=context.policy['limits']['max_comment_replies_per_hour'])
        return {'mode': mode, 'replied': replies}

    if mode == 'post':
        action_id = str(uuid4())
        context.clients['cockpit'].add_pending_action(context.task_id, {'id': action_id, 'type': 'instagram.post_feed', 'payload': args, 'status': 'PENDING'})
        decision = context.approvals.wait_for_action(context.task_id, action_id)
        if decision != 'APPROVED':
            return {'status': 'denied'}
        artifacts = ig.publish_post(args['media_paths'], args['caption'])
        for artifact in artifacts:
            context.clients['cockpit'].add_artifact(context.task_id, artifact)
        return {'status': 'posted', 'artifacts': artifacts}

    raise ValueError('unsupported mode')
