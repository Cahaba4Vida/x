import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import process from 'node:process';
import { StateStore } from './lib/state-store.mjs';
import { ApprovalStore } from './lib/approval-store.mjs';
import { ArtifactStore } from './lib/artifact-store.mjs';
import { BrowserApiClient } from './lib/browser-api-client.mjs';
import { TaskRunner } from './lib/task-runner.mjs';
import { buildError, jsonResponse, nowIso, readJson, routeMatch } from './lib/utils.mjs';

const HOST = process.env.RUNTIME_HOST || '127.0.0.1';
const PORT = Number(process.env.RUNTIME_PORT || 3002);
const RUNTIME_ROOT = process.env.RUNTIME_ROOT || path.join(process.cwd(), '.runtime-state');
const RUNTIME_SECRET = process.env.LOCAL_RUNTIME_SECRET || '';
const BROWSER_API_URL = process.env.BROWSER_API_URL || 'http://127.0.0.1:3001';
const BROWSER_API_SECRET = process.env.BROWSER_API_SECRET || '';
const OPENCLAW_BASE_URL = process.env.OPENCLAW_BASE_URL || 'http://127.0.0.1:18789';

const stateStore = new StateStore(RUNTIME_ROOT);
await stateStore.init();
const approvalStore = new ApprovalStore(stateStore);
const artifactStore = new ArtifactStore(stateStore);
const browserApi = new BrowserApiClient({ baseUrl: BROWSER_API_URL, secret: BROWSER_API_SECRET });
const taskRunner = new TaskRunner({ stateStore, approvalStore, artifactStore, browserApi });

function unauthorized(res) {
  return jsonResponse(res, 401, { error: buildError('UNAUTHORIZED', 'Missing or invalid runtime secret', false) });
}

function hasAuth(req) {
  if (!RUNTIME_SECRET) return true;
  return req.headers['x-runtime-secret'] === RUNTIME_SECRET;
}

function tcpCheck(host, port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port, timeout: 1000 }, () => {
      socket.destroy();
      resolve(true);
    });
    socket.on('error', () => resolve(false));
    socket.on('timeout', () => { socket.destroy(); resolve(false); });
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || `${HOST}:${PORT}`}`);
    if (!hasAuth(req)) return unauthorized(res);

    if (req.method === 'GET' && url.pathname === '/healthz') {
      return jsonResponse(res, 200, { status: 'ok', service: 'oc-runtime', time: nowIso(), version: '0.3.0' });
    }

    if (req.method === 'GET' && url.pathname === '/readyz') {
      const [browserOk, openclawOk] = await Promise.all([
        browserApi.health().then(() => true).catch(() => false),
        tcpCheck('127.0.0.1', 18789)
      ]);
      const botId = url.searchParams.get('bot_id') || 'default';
      const browserProfilePath = stateStore.browserProfileDir(botId);
      const body = {
        status: browserOk ? 'ready' : 'degraded',
        checks: {
          openclaw_gateway: { status: openclawOk ? 'ok' : 'down', port: 18789, base_url: OPENCLAW_BASE_URL },
          browser_api: { status: browserOk ? 'ok' : 'down', base_url: BROWSER_API_URL },
          browser_profile: { status: 'ok', path: browserProfilePath }
        }
      };
      return jsonResponse(res, browserOk ? 200 : 503, body);
    }

    if (req.method === 'GET' && url.pathname === '/v1/state') {
      const botId = url.searchParams.get('bot_id') || 'default';
      const current = await browserApi.state(botId).catch(() => ({ current_url: null, has_live_browser: false }));
      return jsonResponse(res, 200, { bot_id: botId, session_id: 'agent:main:main', current_url: current.current_url || null, has_live_browser: !!current.has_live_browser, active_run_id: stateStore.state.activeRunsByBot[botId] || null });
    }

    const runMatch = routeMatch(url.pathname, /^\/v1\/runs\/([^/]+)$/);
    if (req.method === 'GET' && runMatch) {
      const run = await stateStore.loadRun(runMatch[0]);
      return jsonResponse(res, run ? 200 : 404, run || { error: buildError('RUN_NOT_FOUND', 'Run not found', false) });
    }

    const cancelMatch = routeMatch(url.pathname, /^\/v1\/runs\/([^/]+)\/cancel$/);
    if (req.method === 'POST' && cancelMatch) {
      const body = await readJson(req);
      await stateStore.requestCancel(cancelMatch[0], body.reason || 'Cancelled by operator');
      return jsonResponse(res, 200, { run_id: cancelMatch[0], status: 'cancellation_requested' });
    }

    if (req.method === 'POST' && url.pathname === '/v1/tasks/execute') {
      const body = await readJson(req);
      const result = await taskRunner.execute(body);
      return jsonResponse(res, result.status === 'failed' ? 500 : 200, result);
    }

    const resumeMatch = routeMatch(url.pathname, /^\/v1\/approvals\/([^/]+)\/resume$/);
    if (req.method === 'POST' && resumeMatch) {
      const body = await readJson(req);
      const result = await taskRunner.resume(resumeMatch[0], body.decision || 'approve', body.approved_by || 'operator', body.resume_payload || null);
      return jsonResponse(res, result.status === 'failed' ? 500 : 200, result);
    }

    return jsonResponse(res, 404, { error: buildError('NOT_FOUND', `Unknown route: ${url.pathname}`, false) });
  } catch (error) {
    await stateStore.writeRuntimeLog(`error ${error?.stack || error?.message || error}`);
    return jsonResponse(res, 500, { error: buildError('RUNTIME_SERVER_ERROR', error?.message || 'Runtime server error', true) });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`oc-runtime listening on http://${HOST}:${PORT}`);
});
