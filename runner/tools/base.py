from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable


@dataclass
class ToolContext:
    task_id: str
    policy: dict[str, Any]
    logger: Any
    approvals: Any
    clients: dict[str, Any]


class ToolRegistry:
    def __init__(self):
        self._tools: dict[str, Any] = {}

    def register(self, module: Any) -> None:
        self._tools[module.TOOL_META['name']] = module

    def list(self) -> list[dict[str, Any]]:
        return [tool.TOOL_META for tool in self._tools.values()]

    def execute(self, name: str, context: ToolContext, args: dict[str, Any]) -> dict[str, Any]:
        return self._tools[name].execute(context, args)
