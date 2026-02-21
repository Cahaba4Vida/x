from __future__ import annotations

from datetime import datetime, timedelta, timezone


def create_lease(runner_id: str, ttl_seconds: int = 30) -> dict:
    expires = datetime.now(timezone.utc) + timedelta(seconds=ttl_seconds)
    return {'runnerId': runner_id, 'expiresAt': expires.isoformat()}


def lease_expired(lease: dict, now: datetime | None = None) -> bool:
    now = now or datetime.now(timezone.utc)
    return datetime.fromisoformat(lease['expiresAt']) <= now
