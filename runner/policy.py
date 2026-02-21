from __future__ import annotations


def validate_policy(policy: dict) -> None:
    required = ['limits', 'approvals', 'gmail', 'instagram', 'webapps']
    for key in required:
        if key not in policy:
            raise ValueError(f'missing policy section: {key}')
    if policy['approvals'].get('instagram.post_feed') != 'ALWAYS':
        raise ValueError('instagram.post_feed must be ALWAYS in MVP')
