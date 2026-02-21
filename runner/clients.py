from __future__ import annotations

import base64
import json
import os
import time
from datetime import datetime
from pathlib import Path
from typing import Any

from playwright.sync_api import sync_playwright


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
    def __init__(self, config_path: str = 'runner/runner_config.json'):
        self.config = self._load_config(config_path)
        self.apps = {app['id']: app for app in self.config.get('apps', [])}
        self.watch_cfg = self.config.get('watch_mode', {})
        self.watch_enabled = bool(self.watch_cfg.get('enabled', True))
        self.watch_interval_seconds = int(self.watch_cfg.get('interval_seconds', 5))

    def _load_config(self, config_path: str) -> dict[str, Any]:
        primary = Path(config_path)
        fallback = Path('runner/config/runner_config.example.json')
        target = primary if primary.exists() else fallback
        if not target.exists():
            return {'apps': []}
        return json.loads(target.read_text(encoding='utf-8'))

    def _resolve_apps(self, app_ids: list[str] | None) -> list[dict[str, Any]]:
        if app_ids:
            return [self.apps[app_id] for app_id in app_ids if app_id in self.apps]
        return list(self.apps.values())

    def _url(self, base_url: str, path_or_url: str | None) -> str:
        if not path_or_url:
            return base_url
        if path_or_url.startswith('http://') or path_or_url.startswith('https://'):
            return path_or_url
        return f"{base_url.rstrip('/')}/{path_or_url.lstrip('/')}"

    def _log(self, logger, level: str, event: str, payload: dict[str, Any]):
        if logger:
            logger.log(level, event, payload)

    def _perform_login(self, page, app: dict[str, Any], logger=None) -> None:
        login = app.get('login') or {}
        if login.get('method') != 'form':
            return
        username = os.getenv(login.get('username_env', ''), '')
        password = os.getenv(login.get('password_env', ''), '')
        if not username or not password:
            raise RuntimeError(f"Missing login credentials for app {app['id']}")

        login_url = self._url(app['base_url'], login.get('url', '/login'))
        self._log(logger, 'info', 'webapp.login.goto', {'appId': app['id'], 'url': login_url})
        page.goto(login_url, wait_until='domcontentloaded', timeout=30000)
        page.fill(login['username_selector'], username)
        page.fill(login['password_selector'], password)
        page.click(login['submit_selector'])
        wait_selector = login.get('success_selector')
        if wait_selector:
            page.wait_for_selector(wait_selector, timeout=30000)
        else:
            page.wait_for_load_state('networkidle', timeout=30000)
        self._log(logger, 'info', 'webapp.login.success', {'appId': app['id']})

    def _encode_screenshot_artifact(self, app_id: str, screenshot_bytes: bytes, note: str = '') -> dict[str, Any]:
        mime = 'image/png'
        data = screenshot_bytes
        if len(data) > 1_000_000:
            mime = 'image/jpeg'
        return {
            'id': f"{app_id}-{datetime.utcnow().strftime('%Y%m%d%H%M%S%f')}",
            'type': 'screenshot',
            'mime': mime,
            'createdAt': datetime.utcnow().isoformat(),
            'dataBase64': base64.b64encode(data).decode('ascii'),
            'note': note,
        }

    def _capture_artifact(self, page, app_id: str, note: str = '') -> dict[str, Any]:
        shot = page.screenshot(full_page=True, type='png')
        if len(shot) > 1_000_000:
            shot = page.screenshot(full_page=False, type='jpeg', quality=60)
            if len(shot) > 1_000_000:
                shot = page.screenshot(full_page=False, type='jpeg', quality=35)
        return self._encode_screenshot_artifact(app_id, shot, note)

    def _capture_watch_thumbnail(self, page) -> bytes:
        return page.screenshot(type='jpeg', quality=40, full_page=False)

    def _maybe_push_watch(self, page, watch_uploader, last_push_ts: float) -> float:
        if not (self.watch_enabled and watch_uploader):
            return last_push_ts
        now = time.time()
        if now - last_push_ts < self.watch_interval_seconds:
            return last_push_ts
        watch_uploader(self._capture_watch_thumbnail(page))
        return now

    def _execute_smoke_step(self, page, step: dict[str, Any], app: dict[str, Any], logger=None):
        action = step['step']
        if action == 'goto':
            target_url = self._url(app['base_url'], step.get('url'))
            self._log(logger, 'info', 'webapp.smoke.goto', {'appId': app['id'], 'url': target_url})
            page.goto(target_url, wait_until='domcontentloaded', timeout=30000)
            return
        if action == 'click':
            selector = step['selector']
            self._log(logger, 'info', 'webapp.smoke.click', {'appId': app['id'], 'selector': selector})
            page.click(selector)
            return
        if action == 'type':
            selector = step['selector']
            value = str(step.get('value', ''))
            self._log(logger, 'info', 'webapp.smoke.type', {'appId': app['id'], 'selector': selector})
            page.fill(selector, value)
            return
        if action == 'expectVisible':
            selector = step['selector']
            self._log(logger, 'info', 'webapp.smoke.expectVisible', {'appId': app['id'], 'selector': selector})
            page.wait_for_selector(selector, state='visible', timeout=30000)
            return
        if action == 'expectText':
            selector = step['selector']
            expected = str(step.get('text', ''))
            self._log(logger, 'info', 'webapp.smoke.expectText', {'appId': app['id'], 'selector': selector, 'text': expected})
            page.wait_for_selector(selector, state='attached', timeout=30000)
            actual = page.locator(selector).inner_text(timeout=30000)
            if expected not in actual:
                raise AssertionError(f"Expected text '{expected}' in selector '{selector}', got '{actual}'")
            return
        raise ValueError(f"Unsupported smoke step: {action}")

    def collect_insights(self, app_ids=None, logger=None, watch_uploader=None):
        results = []
        apps = self._resolve_apps(app_ids)
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            try:
                for app in apps:
                    context = browser.new_context(viewport={'width': 480, 'height': 900})
                    page = context.new_page()
                    last_watch_push = 0.0
                    try:
                        self._perform_login(page, app, logger)
                        last_watch_push = self._maybe_push_watch(page, watch_uploader, last_watch_push)
                        dashboard_url = self._url(app['base_url'], app.get('dashboard_path', '/dashboard'))
                        self._log(logger, 'info', 'webapp.insights.goto', {'appId': app['id'], 'url': dashboard_url})
                        page.goto(dashboard_url, wait_until='domcontentloaded', timeout=30000)
                        last_watch_push = self._maybe_push_watch(page, watch_uploader, last_watch_push)
                        extracted = {}
                        for insight in app.get('insights', []):
                            name = insight['name']
                            selector = insight['selector']
                            kind = insight.get('type', 'text')
                            self._log(logger, 'info', 'webapp.insights.extract', {'appId': app['id'], 'name': name, 'selector': selector, 'type': kind})
                            page.wait_for_selector(selector, state='attached', timeout=30000)
                            if kind == 'text':
                                extracted[name] = page.locator(selector).inner_text(timeout=30000).strip()
                            else:
                                extracted[name] = page.locator(selector).get_attribute(kind)
                            last_watch_push = self._maybe_push_watch(page, watch_uploader, last_watch_push)
                        artifact = self._capture_artifact(page, app['id'], note='Insights capture')
                        results.append({'appId': app['id'], 'insights': extracted, 'artifact': artifact, 'status': 'ok'})
                    except Exception as exc:
                        artifact = self._capture_artifact(page, app['id'], note=f'Insights failure: {exc}')
                        results.append({'appId': app['id'], 'status': 'failed', 'error': str(exc), 'artifact': artifact})
                    finally:
                        context.close()
            finally:
                browser.close()
        return results

    def run_smoke(self, app_ids=None, logger=None, watch_uploader=None):
        results = []
        apps = self._resolve_apps(app_ids)
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            try:
                for app in apps:
                    context = browser.new_context(viewport={'width': 480, 'height': 900})
                    page = context.new_page()
                    console_errors: list[str] = []
                    network_failures: list[dict[str, Any]] = []
                    last_watch_push = 0.0

                    page.on('console', lambda msg: console_errors.append(msg.text) if msg.type == 'error' else None)
                    page.on('response', lambda response: network_failures.append({'url': response.url, 'status': response.status}) if response.status >= 400 else None)

                    try:
                        self._perform_login(page, app, logger)
                        last_watch_push = self._maybe_push_watch(page, watch_uploader, last_watch_push)
                        for step in app.get('smoke', []):
                            self._execute_smoke_step(page, step, app, logger)
                            last_watch_push = self._maybe_push_watch(page, watch_uploader, last_watch_push)
                        artifact = self._capture_artifact(page, app['id'], note='Smoke pass screenshot')
                        results.append({
                            'appId': app['id'],
                            'passed': True,
                            'consoleErrors': console_errors,
                            'networkFailures': network_failures,
                            'artifact': artifact,
                        })
                    except Exception as exc:
                        artifact = self._capture_artifact(page, app['id'], note=f'Smoke failure: {exc}')
                        results.append({
                            'appId': app['id'],
                            'passed': False,
                            'error': str(exc),
                            'consoleErrors': console_errors,
                            'networkFailures': network_failures,
                            'artifact': artifact,
                        })
                    finally:
                        context.close()
            finally:
                browser.close()
        return results
