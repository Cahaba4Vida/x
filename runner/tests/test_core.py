from datetime import datetime, timedelta, timezone

import pytest

from runner.lease import create_lease, lease_expired
from runner.auditlog.audit import redact
from runner.policy import validate_policy


def test_redaction_hides_secrets():
    payload = {'token': 'abc', 'nested': {'password': 'x'}, 'message': 'Authorization: Bearer qwerty'}
    redacted = redact(payload)
    assert redacted['token'] == '[REDACTED]'
    assert redacted['nested']['password'] == '[REDACTED]'
    assert '[REDACTED]' in redacted['message']


def test_policy_validation_requires_sections():
    with pytest.raises(ValueError):
        validate_policy({'limits': {}})


def test_lease_expiration():
    lease = create_lease('runner-1', ttl_seconds=1)
    future = datetime.now(timezone.utc) + timedelta(seconds=2)
    assert lease_expired(lease, now=future)
