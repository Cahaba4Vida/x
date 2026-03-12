import process from 'node:process';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';

const SITE_URL = process.env.SITE_URL;
const WORKER_SHARED_SECRET = process.env.WORKER_SHARED_SECRET;
const BOT_ID = process.env.BOT_ID;
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS || 5000);
const EXECUTOR_MODE = process.env.EXECUTOR_MODE || 'mock';
const OPENCLAW_WEBHOOK_URL = process.env.OPENCLAW_WEBHOOK_URL;
const OPENCLAW_COMMAND = process.env.OPENCLAW_COMMAND;
const EXECUTOR_TIMEOUT_MS = Number(process.env.EXECUTOR_TIMEOUT_MS || 1000 * 60 * 20);
const WORKER_ID = process.env.WORKER_ID || `${os.hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;
const MACHINE_NAME = process.env.MACHINE_NAME || os.hostname();

if (!SITE_URL || !WORKER_SHARED_SECRET || !BOT_ID) {
  console.error('Missing SITE_URL, WORKER_SHARED_SECRET, or BOT_ID');
  process.exit(1);
}

async function api(path, body) {
  const response = await fetch(`${SITE_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-worker-secret': WORKER_SHARED_SECRET,
      'x-worker-id': WORKER_ID
    },
    body: JSON.stringify(body)
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(text || response.statusText);
  }
  return text ? JSON.parse(text) : {};
}

async function heartbeat(status = 'idle') {
  await api('/api/worker-heartbeat', { botId: BOT_ID, status, machineName: MACHINE_NAME });
}

async function emit(taskId, runId, eventType, payload = {}) {
  await api('/api/worker-event', { taskId, runId, eventType, payload });
}

async function uploadArtifact(taskId, runId, artifact) {
  await api('/api/worker-artifact', {
    taskId,
    runId,
    artifactType: artifact.kind || artifact.artifact_type || 'other',
    name: artifact.name || null,
    storageUrl: artifact.path || artifact.storage_url,
    metadata: artifact
  });
}

async function getControl(taskId, runId) {
  return api('/api/worker-control', { taskId, runId });
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function startControlPolling(task, onCancel) {
  let stopped = false;
  const interval = setInterval(async () => {
    if (stopped) return;
    try {
      const control = await getControl(task.id, task.run_id);
      if (control.cancel_requested) {
        stopped = true;
        clearInterval(interval);
        await emit(task.id, task.run_id, 'cancellation_observed', {
          reason: control.cancellation_reason || 'Cancellation requested from dashboard'
        });
        await onCancel(control.cancellation_reason || 'Cancellation requested');
      }
    } catch (error) {
      console.error('[worker-control]', error);
    }
  }, 3000);

  return () => {
    stopped = true;
    clearInterval(interval);
  };
}

async function runMock(task) {
  await emit(task.id, task.run_id, 'executor_started', { mode: 'mock' });
  await wait(2000);
  return {
    status: 'succeeded',
    output: `Mock executor completed: ${task.title}`,
    usage: {
      llm_cost_usd: 0.08,
      browser_seconds: 30,
      desktop_seconds: 45,
      screenshots: 2,
      retries: 0
    },
    artifacts: [],
    logs: []
  };
}

async function runWebhook(task) {
  if (!OPENCLAW_WEBHOOK_URL) throw new Error('OPENCLAW_WEBHOOK_URL is required for webhook mode');
  const controller = new AbortController();
  const stopPolling = startControlPolling(task, async () => controller.abort());
  try {
    const response = await fetch(OPENCLAW_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({ task, worker: { workerId: WORKER_ID, machineName: MACHINE_NAME } })
    });
    const text = await response.text();
    if (!response.ok) throw new Error(text || 'Webhook executor failed');
    return JSON.parse(text);
  } catch (error) {
    if (error?.name === 'AbortError') {
      return {
        status: 'cancelled',
        output: '',
        errorMessage: 'Execution cancelled from dashboard',
        usage: { retries: 0 },
        artifacts: [],
        logs: []
      };
    }
    throw error;
  } finally {
    stopPolling();
  }
}

async function runCommand(task) {
  if (!OPENCLAW_COMMAND) throw new Error('OPENCLAW_COMMAND is required for command mode');

  return new Promise((resolve, reject) => {
    const child = spawn(OPENCLAW_COMMAND, {
      shell: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        OPENCLAW_TASK_ID: task.id,
        OPENCLAW_RUN_ID: task.run_id,
        OPENCLAW_WORKER_ID: WORKER_ID,
        OPENCLAW_MACHINE_NAME: MACHINE_NAME
      }
    });

    let stdout = '';
    let stderr = '';
    let settled = false;
    const settle = (fn) => (value) => { if (!settled) { settled = true; fn(value); } };
    const resolveOnce = settle(resolve);
    const rejectOnce = settle(reject);

    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      rejectOnce(new Error(`Executor timed out after ${EXECUTOR_TIMEOUT_MS}ms`));
    }, EXECUTOR_TIMEOUT_MS);

    const stopPolling = startControlPolling(task, async (reason) => {
      child.kill('SIGTERM');
      resolveOnce({
        status: 'cancelled',
        output: '',
        errorMessage: reason || 'Execution cancelled from dashboard',
        usage: { retries: 0 },
        artifacts: [],
        logs: []
      });
    });

    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', (error) => { clearTimeout(timeout); stopPolling(); rejectOnce(error); });
    child.on('exit', (code) => {
      clearTimeout(timeout);
      stopPolling();
      if (settled) return;
      if (code !== 0) {
        rejectOnce(new Error(stderr || `Executor exited with code ${code}`));
        return;
      }
      try {
        resolveOnce(JSON.parse(stdout));
      } catch {
        rejectOnce(new Error(`Executor returned non-JSON output: ${stdout}`));
      }
    });
    child.stdin.write(JSON.stringify({ task, worker: { workerId: WORKER_ID, machineName: MACHINE_NAME } }));
    child.stdin.end();
  });
}

async function executeTask(task) {
  switch (EXECUTOR_MODE) {
    case 'webhook': return runWebhook(task);
    case 'command': return runCommand(task);
    default: return runMock(task);
  }
}

async function normalizeAndPersistResult(task, result) {
  const artifacts = Array.isArray(result.artifacts) ? result.artifacts : [];
  const logs = Array.isArray(result.logs) ? result.logs : [];

  for (const log of logs) {
    await emit(task.id, task.run_id, `runtime_${log.level || 'info'}`, log);
  }
  for (const artifact of artifacts) {
    if (artifact.path || artifact.storage_url) {
      await uploadArtifact(task.id, task.run_id, artifact);
    }
  }

  const resultPayload = typeof result.result === 'string' ? result.result : JSON.stringify(result.result || {});
  const usage = {
    llm_cost_usd: Number(result.usage?.llm_cost_usd || 0),
    browser_seconds: Number(result.usage?.browser_seconds || 0),
    desktop_seconds: Number(result.usage?.desktop_seconds || 0),
    screenshots: Number(result.usage?.screenshots || artifacts.filter((a) => (a.kind || a.artifact_type) === 'screenshot').length || 0),
    retries: Number(result.usage?.retries || 0)
  };

  const mappedStatus = result.status === 'approval_pending' ? 'awaiting_approval' : (result.status || 'failed');

  await api('/api/worker-complete', {
    taskId: task.id,
    runId: task.run_id,
    status: mappedStatus,
    output: result.output || resultPayload || '',
    errorMessage: result.errorMessage || result.error?.message || '',
    usage,
    approval: result.result?.approval || result.approval || null,
    runtimeResult: result.result || {},
    logs,
    artifacts
  });
}

async function pollOnce() {
  const claim = await api('/api/worker-claim', { botId: BOT_ID });
  if (!claim.task) return false;

  const task = claim.task;
  try {
    await heartbeat('busy');
    await emit(task.id, task.run_id, 'executor_dispatch', { mode: EXECUTOR_MODE, resume: !!task.resume_approval });
    const result = await executeTask(task);
    await normalizeAndPersistResult(task, result);
  } catch (error) {
    await emit(task.id, task.run_id, 'executor_error', { message: error.message });
    await api('/api/worker-complete', {
      taskId: task.id,
      runId: task.run_id,
      status: 'failed',
      output: '',
      errorMessage: error.message,
      usage: { retries: 1 },
      approval: null,
      runtimeResult: {},
      logs: [],
      artifacts: []
    });
  } finally {
    await heartbeat('idle');
  }
  return true;
}

async function main() {
  console.log(`[worker] bot=${BOT_ID} worker=${WORKER_ID} mode=${EXECUTOR_MODE}`);
  while (true) {
    try {
      await heartbeat('idle');
      const didWork = await pollOnce();
      if (!didWork) await wait(POLL_INTERVAL_MS);
    } catch (error) {
      console.error('[worker]', error);
      await heartbeat('error').catch(() => {});
      await wait(Math.max(POLL_INTERVAL_MS, 5000));
    }
  }
}

main();
