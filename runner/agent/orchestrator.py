from __future__ import annotations

import time
from dataclasses import dataclass


@dataclass
class RunLimits:
    max_tool_calls_per_task: int
    max_runtime_seconds_per_task: int


class Orchestrator:
    def __init__(self, registry, logger):
        self.registry = registry
        self.logger = logger

    def run_task(self, task, context):
        start = time.time()
        task_type = task['type']
        args = task.get('args', {})
        handlers = {
            'EMAIL_DIGEST': ('gmail_tool', {'mode': 'digest'}),
            'EMAIL_SEND': ('gmail_tool', {'mode': 'send', **args}),
            'INSTAGRAM_DM_TRIAGE': ('instagram_tool', {'mode': 'dm_triage', **args}),
            'INSTAGRAM_POST': ('instagram_tool', {'mode': 'post', **args}),
            'INSTAGRAM_COMMENT_MOD': ('instagram_tool', {'mode': 'comment_mod', **args}),
            'WEBAPP_INSIGHTS': ('netlify_app_insights_tool', {'mode': 'insights', **args}),
            'WEBAPP_SMOKE_TEST': ('netlify_app_insights_tool', {'mode': 'smoke', **args})
        }
        if task_type not in handlers:
            raise ValueError(f'Unsupported task type: {task_type}')
        tool_name, tool_args = handlers[task_type]
        self.logger.log('info', 'tool.execute.start', {'tool': tool_name, 'args': tool_args})
        output = self.registry.execute(tool_name, context, tool_args)
        self.logger.log('info', 'tool.execute.end', {'tool': tool_name, 'result': output, 'runtimeSec': round(time.time() - start, 2)})
        return output
