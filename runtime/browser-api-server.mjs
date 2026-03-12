import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { chromium } from 'playwright';
import { buildError, ensureDir, isPrivateHost, jsonResponse, nowIso, readJson } from './lib/utils.mjs';

const HOST = process.env.BROWSER_API_HOST || '127.0.0.1';
const PORT = Number(process.env.BROWSER_API_PORT || 3001);
const SECRET = process.env.BROWSER_API_SECRET || '';
const RUNTIME_ROOT = process.env.RUNTIME_ROOT || path.join(process.cwd(), '.runtime-state');
const PROFILE_ROOT = path.join(RUNTIME_ROOT, 'browser-profiles');
const instances = new Map();

function authorized(req) {
  if (!SECRET) return true;
  return req.headers['x-browser-api-secret'] === SECRET;
}

async function getInstance(botId) {
  if (instances.has(botId)) return instances.get(botId);
  const userDataDir = path.join(PROFILE_ROOT, botId);
  await ensureDir(userDataDir);
  const context = await chromium.launchPersistentContext(userDataDir, { headless: process.env.PLAYWRIGHT_HEADLESS !== '0', viewport: { width: 1440, height: 900 } });
  let page = context.pages()[0] || await context.newPage();
  const instance = { context, page, userDataDir, current_url: page.url() || null };
  page.on('framenavigated', () => { instance.current_url = page.url(); });
  instances.set(botId, instance);
  return instance;
}

async function rejectIfUnsafe(url) {
  const parsed = new URL(url);
  if (!/^https?:$/.test(parsed.protocol)) throw new Error('Only http/https URLs are allowed');
  if (isPrivateHost(parsed.hostname)) throw new Error('Private, localhost, and file targets are blocked');
}

async function handleAction(req, res, fn) {
  try {
    if (!authorized(req)) return jsonResponse(res, 401, { error: buildError('UNAUTHORIZED', 'Invalid browser API secret', false) });
    const body = await readJson(req);
    const botId = body.bot_id || 'default';
    const instance = await getInstance(botId);
    const result = await fn(instance, body);
    return jsonResponse(res, 200, result);
  } catch (error) {
    return jsonResponse(res, 500, { error: buildError('BROWSER_ACTION_FAILED', error?.message || 'Browser action failed', true) });
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host}`);
  if (req.method === 'GET' && url.pathname === '/healthz') {
    return jsonResponse(res, 200, { status: 'ok', service: 'oc-browser-api', time: nowIso() });
  }
  if (req.method === 'GET' && url.pathname === '/state') {
    if (!authorized(req)) return jsonResponse(res, 401, { error: buildError('UNAUTHORIZED', 'Invalid browser API secret', false) });
    const botId = url.searchParams.get('bot_id') || 'default';
    const instance = instances.get(botId);
    return jsonResponse(res, 200, { bot_id: botId, has_live_browser: !!instance, current_url: instance?.current_url || null, profile_dir: path.join(PROFILE_ROOT, botId) });
  }
  if (req.method === 'POST' && url.pathname === '/goto') {
    return handleAction(req, res, async (instance, body) => {
      await rejectIfUnsafe(body.url);
      await instance.page.goto(body.url, { waitUntil: body.wait_until || 'domcontentloaded', timeout: Number(body.timeout_ms || 60000) });
      instance.current_url = instance.page.url();
      return { url: instance.current_url, title: await instance.page.title() };
    });
  }
  if (req.method === 'POST' && url.pathname === '/click') {
    return handleAction(req, res, async (instance, body) => {
      await instance.page.locator(body.selector).click({ timeout: Number(body.timeout_ms || 30000) });
      if (body.wait_after) await instance.page.waitForLoadState('domcontentloaded').catch(() => {});
      instance.current_url = instance.page.url();
      return { clicked: body.selector, url: instance.current_url, title: await instance.page.title() };
    });
  }
  if (req.method === 'POST' && url.pathname === '/type') {
    return handleAction(req, res, async (instance, body) => {
      const locator = instance.page.locator(body.selector);
      if (body.clear !== false) await locator.clear().catch(() => {});
      await locator.fill(body.text || '', { timeout: Number(body.timeout_ms || 30000) });
      return { typed: body.selector, text_length: String(body.text || '').length };
    });
  }
  if (req.method === 'POST' && url.pathname === '/extract') {
    return handleAction(req, res, async (instance, body) => {
      const max = Number(body.max_chars || 50000);
      const text = ((await instance.page.locator('body').innerText().catch(() => '')) || '').slice(0, max);
      instance.current_url = instance.page.url();
      return { url: instance.current_url, title: await instance.page.title(), text };
    });
  }
  if (req.method === 'POST' && url.pathname === '/screenshot') {
    return handleAction(req, res, async (instance, body) => {
      await ensureDir(path.dirname(body.path));
      await instance.page.screenshot({ path: body.path, fullPage: body.full_page !== false });
      return { screenshot: body.path };
    });
  }
  if (req.method === 'POST' && url.pathname === '/wait-for-selector') {
    return handleAction(req, res, async (instance, body) => {
      await instance.page.waitForSelector(body.selector, { timeout: Number(body.timeout_ms || 30000), state: body.state || 'visible' });
      return { selector: body.selector, state: body.state || 'visible', ok: true };
    });
  }
  if (req.method === 'POST' && url.pathname === '/wait-for-text') {
    return handleAction(req, res, async (instance, body) => {
      await instance.page.getByText(body.text, { exact: body.exact === true }).waitFor({ timeout: Number(body.timeout_ms || 30000) });
      return { text: body.text, ok: true };
    });
  }
  if (req.method === 'POST' && url.pathname === '/close') {
    return handleAction(req, res, async (instance, body) => {
      await instance.context.close();
      instances.delete(body.bot_id || 'default');
      return { closed: true };
    });
  }
  return jsonResponse(res, 404, { error: buildError('NOT_FOUND', 'Unknown route', false) });
});

server.listen(PORT, HOST, () => {
  console.log(`oc-browser-api listening on http://${HOST}:${PORT}`);
});
