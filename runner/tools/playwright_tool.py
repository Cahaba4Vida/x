from __future__ import annotations

import base64
import io
import json
import os
import time
from typing import Any

from openai import OpenAI
from PIL import Image
from playwright.sync_api import sync_playwright

TOOL_META = {
    'name': 'playwright_tool',
    'description': 'Natural language web automation via screenshot-driven planning',
    'input_schema': {'type': 'object'},
    'output_schema': {'type': 'object'},
    'risk_level': 'HIGH',
    'default_requires_approval': True
}


def _resize_jpeg(jpeg_bytes: bytes, max_width: int = 1280) -> bytes:
    img = Image.open(io.BytesIO(jpeg_bytes)).convert('RGB')
    if img.width > max_width:
        ratio = max_width / img.width
        img = img.resize((max_width, int(img.height * ratio)))
    out = io.BytesIO()
    img.save(out, format='JPEG', quality=70)
    return out.getvalue()


def _ask_model(instruction: str, current_url: str, screenshot_b64: str, auth_hints: dict[str, Any]):
    client = OpenAI(api_key=os.environ['OPENAI_API_KEY'])
    prompt = (
        'Return strict JSON object with {actions:[...], needsApproval:boolean, approvalReason:string|null}. '
        'Allowed action kinds: click,type,press,wait,scroll,reload,assert. '
        f'Instruction: {instruction}\nCurrent URL: {current_url}\nAuth hints: {json.dumps(auth_hints)}'
    )
    resp = client.responses.create(
        model=os.getenv('OPENAI_MODEL', 'gpt-4.1-mini'),
        input=[{
            'role': 'user',
            'content': [
                {'type': 'input_text', 'text': prompt},
                {'type': 'input_image', 'image_url': f'data:image/jpeg;base64,{screenshot_b64}'}
            ]
        }]
    )
    text = resp.output_text.strip()
    start = text.find('{')
    end = text.rfind('}')
    data = json.loads(text[start:end + 1])
    if not isinstance(data, dict) or 'actions' not in data:
        raise ValueError('invalid model response schema')
    return data


def _run_action(page, action: dict[str, Any]):
    kind = action.get('kind')
    if kind == 'click':
        page.click(action['selector'])
    elif kind == 'type':
        page.fill(action['selector'], action.get('text', ''))
    elif kind == 'press':
        page.press(action['selector'], action.get('key', 'Enter'))
    elif kind == 'wait':
        page.wait_for_timeout(int(action.get('ms', 1000)))
    elif kind == 'scroll':
        page.mouse.wheel(0, int(action.get('deltaY', 800)))
    elif kind == 'reload':
        page.reload()
    elif kind == 'assert':
        page.wait_for_selector(action['selector'], timeout=int(action.get('timeoutMs', 5000)))
    else:
        raise ValueError(f'Unsupported action kind: {kind}')


def execute(context, args):
    if args.get('mode') != 'instruction':
        return {'ok': True, 'note': 'Use specific tools for workflows in MVP'}

    task_id = context.task_id
    cockpit = context.clients['cockpit']
    app_id = str(args.get('appId') or '')
    instruction = str(args.get('instructionText') or '')
    if not app_id or not instruction:
        raise ValueError('appId and instructionText required')

    app_export = cockpit.export_app(app_id)
    auth = app_export.get('auth', {})

    # Resolve local secrets by env var name only; never log values.
    resolved_auth = {
        'auth_type': auth.get('auth_type', 'none'),
        'has_token': bool(os.getenv(auth.get('token_env') or '')),
        'has_username': bool(os.getenv(auth.get('username_env') or '')),
        'has_password': bool(os.getenv(auth.get('password_env') or '')),
        'two_fa_notes': auth.get('two_fa_notes')
    }

    cockpit.add_task_step(task_id, 'plan', 'Starting web instruction execution', {'appId': app_id})

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=bool(os.getenv('PLAYWRIGHT_HEADLESS', '1') == '1'))
        page = browser.new_page(viewport={'width': 1440, 'height': 900})
        page.goto(app_export['base_url'], wait_until='networkidle')

        for cycle in range(1, 8):
            raw = page.screenshot(type='jpeg', quality=70)
            jpeg = _resize_jpeg(raw)
            cockpit.upload_watch_latest_screenshot(task_id, jpeg)
            cockpit.add_task_step(task_id, 'observe', f'Cycle {cycle} screenshot captured', {'url': page.url})

            model_plan = _ask_model(instruction, page.url, base64.b64encode(jpeg).decode('utf-8'), resolved_auth)
            actions = model_plan.get('actions', [])
            cockpit.add_task_step(task_id, 'plan', f'Cycle {cycle} plan', {'actions': actions})

            if model_plan.get('needsApproval'):
                reason = model_plan.get('approvalReason') or 'Model requested approval'
                cockpit.create_approval(task_id, reason, actions)
                cockpit.add_task_step(task_id, 'action', 'Waiting for approval', {'reason': reason})
                while True:
                    task = cockpit.get_task(task_id)
                    pending = [a for a in task.get('approvals', []) if a.get('status') == 'pending']
                    if not pending:
                        denied = [a for a in task.get('approvals', []) if a.get('status') == 'denied']
                        if denied:
                            raise RuntimeError('Approval denied')
                        break
                    time.sleep(2)

            if not actions:
                cockpit.add_task_step(task_id, 'result', 'No more actions; finishing', {'cycle': cycle})
                browser.close()
                return {'ok': True, 'finalUrl': page.url, 'cycles': cycle}

            for action in actions:
                _run_action(page, action)
                cockpit.add_task_step(task_id, 'action', f"Executed {action.get('kind')}", {'action': action})

        browser.close()

    cockpit.add_task_step(task_id, 'error', 'Max cycles reached', {})
    return {'ok': False, 'error': 'max cycles reached'}
