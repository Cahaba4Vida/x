from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

SECRET_PATTERNS = [r"(?i)authorization:\s*bearer\s+\S+", r"(?i)(password|token|secret|api_key)\s*[=:]\s*\S+"]


def redact(value: Any) -> Any:
    if isinstance(value, str):
        out = value
        for pattern in SECRET_PATTERNS:
            out = re.sub(pattern, lambda _: "[REDACTED]", out)
        return out
    if isinstance(value, dict):
        return {k: ('[REDACTED]' if any(s in k.lower() for s in ('token', 'password', 'secret', 'key')) else redact(v)) for k, v in value.items()}
    if isinstance(value, list):
        return [redact(v) for v in value]
    return value


def hash_text(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()[:16]


@dataclass
class AuditLogger:
    sender: Any
    task_id: str

    def log(self, level: str, event: str, payload: dict[str, Any] | None = None) -> None:
        body = {
            "ts": datetime.now(timezone.utc).isoformat(),
            "level": level,
            "event": event,
            "taskId": self.task_id,
            "payload": redact(payload or {})
        }
        self.sender(body)
