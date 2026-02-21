import { Handler } from '@netlify/functions';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { ensureAuth } from './lib/auth';
import { loadState, saveState } from './lib/store';
import { PendingAction, Task } from './lib/types';

const createTaskSchema = z.object({ type: z.string(), args: z.record(z.unknown()).default({}) });
const toolsUpdateSchema = z.object({ tools: z.record(z.boolean()) });
const heartbeatSchema = z.object({ leaseToken: z.string() });
const taskUpdateSchema = z.object({ leaseToken: z.string() });
const claimSchema = z.object({ runnerId: z.string() });
const pendingActionSchema = z.object({ id: z.string(), type: z.string(), payload: z.record(z.unknown()), status: z.enum(['PENDING', 'APPROVED', 'DENIED']).default('PENDING') });
const approvalSchema = z.object({ actionId: z.string() });

const LEASE_MS = 30_000;
const now = () => new Date();
const nowIso = () => now().toISOString();

function isLeaseExpired(task: Task): boolean {
  return !!task.lease && new Date(task.lease.expiresAt).getTime() <= Date.now();
}

function releaseExpiredLeases(tasks: Task[]) {
  for (const task of tasks) {
    if (task.status === 'RUNNING' && isLeaseExpired(task)) {
      task.status = 'PENDING';
      task.lease = undefined;
      task.updatedAt = nowIso();
    }
  }
}

function leaseFor(runnerId: string) {
  return { runnerId, token: uuidv4(), expiresAt: new Date(Date.now() + LEASE_MS).toISOString() };
}

function validateLease(task: Task, leaseToken: string): boolean {
  return Boolean(task.lease && task.lease.token === leaseToken && !isLeaseExpired(task));
}

export const handler: Handler = async (event) => {
  const authError = ensureAuth(event.headers as Record<string, string | undefined>);
  if (authError) return authError;

  const path = (event.path || '').replace(/^.*\/api/, '');
  const method = event.httpMethod;
  const qs = new URLSearchParams(event.queryStringParameters as Record<string, string>);
  const state = await loadState();
  const parseBody = () => (event.body ? JSON.parse(event.body) : {});

  releaseExpiredLeases(state.tasks);

  if (path === '/tasks' && method === 'GET') {
    const status = qs.get('status');
    const tasks = status ? state.tasks.filter((t) => t.status === status) : state.tasks;
    await saveState(state);
    return { statusCode: 200, body: JSON.stringify({ tasks }) };
  }

  if (path === '/tasks' && method === 'POST') {
    const payload = createTaskSchema.parse(parseBody());
    const task = { id: uuidv4(), type: payload.type, args: payload.args, status: 'PENDING', createdAt: nowIso(), updatedAt: nowIso(), pendingActions: [] as PendingAction[] };
    state.tasks.unshift(task);
    await saveState(state);
    return { statusCode: 200, body: JSON.stringify(task) };
  }

  const taskMatch = path.match(/^\/tasks\/([^/]+)(?:\/(.+))?$/);
  if (taskMatch) {
    const taskId = taskMatch[1];
    const action = taskMatch[2];
    const task = state.tasks.find((t) => t.id === taskId);
    if (!task) return { statusCode: 404, body: 'not found' };
    if (!action && method === 'GET') return { statusCode: 200, body: JSON.stringify(task) };

    if (action === 'claim' && method === 'POST') {
      const body = claimSchema.parse(parseBody());
      const resumeApproved = task.pendingActions.some((a) => a.type === 'RESUME_AFTER_MANUAL' && a.status === 'APPROVED');
      const claimable = task.status === 'PENDING' || (task.status === 'NEEDS_MANUAL' && resumeApproved);
      if (!claimable) return { statusCode: 409, body: 'task is not claimable' };
      task.status = 'RUNNING';
      task.lease = leaseFor(body.runnerId);
      task.updatedAt = nowIso();
      await saveState(state);
      return { statusCode: 200, body: JSON.stringify({ lease: task.lease, task }) };
    }

    if (action === 'pending-action' && method === 'POST') {
      const body = pendingActionSchema.parse(parseBody());
      task.pendingActions.push(body);
      task.status = task.status === 'NEEDS_MANUAL' ? 'NEEDS_MANUAL' : 'WAITING_APPROVAL';
      task.updatedAt = nowIso();
      await saveState(state);
      return { statusCode: 200, body: JSON.stringify({ ok: true }) };
    }

    if (action === 'heartbeat' && method === 'POST') {
      const body = heartbeatSchema.parse(parseBody());
      if (!validateLease(task, body.leaseToken)) return { statusCode: 409, body: 'invalid lease token' };
      task.lease = { ...(task.lease as NonNullable<Task['lease']>), expiresAt: new Date(Date.now() + LEASE_MS).toISOString() };
      task.updatedAt = nowIso();
      await saveState(state);
      return { statusCode: 200, body: JSON.stringify({ ok: true, lease: task.lease }) };
    }

    if (action === 'complete' && method === 'POST') {
      const body = taskUpdateSchema.extend({ result: z.unknown().optional() }).parse(parseBody());
      if (!validateLease(task, body.leaseToken)) return { statusCode: 409, body: 'invalid lease token' };
      task.status = 'COMPLETED';
      task.result = body.result;
      task.lease = undefined;
      task.updatedAt = nowIso();
      await saveState(state);
      return { statusCode: 200, body: JSON.stringify(task) };
    }

    if (action === 'fail' && method === 'POST') {
      const body = taskUpdateSchema.extend({ error: z.string(), needsManual: z.boolean().optional() }).parse(parseBody());
      if (!validateLease(task, body.leaseToken)) return { statusCode: 409, body: 'invalid lease token' };
      task.status = body.needsManual ? 'NEEDS_MANUAL' : 'FAILED';
      task.error = body.error;
      task.lease = undefined;
      if (body.needsManual) {
        task.pendingActions.push({ id: uuidv4(), type: 'RESUME_AFTER_MANUAL', payload: { instructions: 'Complete Instagram challenge in local browser and tap resume.' }, status: 'PENDING' });
      }
      task.updatedAt = nowIso();
      await saveState(state);
      return { statusCode: 200, body: JSON.stringify(task) };
    }

    if ((action === 'approve' || action === 'deny') && method === 'POST') {
      const body = approvalSchema.parse(parseBody());
      const pending = task.pendingActions.find((a) => a.id === body.actionId);
      if (!pending) return { statusCode: 404, body: 'action not found' };
      pending.status = action === 'approve' ? 'APPROVED' : 'DENIED';
      if (pending.type === 'RESUME_AFTER_MANUAL') {
        task.status = pending.status === 'APPROVED' ? 'PENDING' : 'FAILED';
      } else {
        task.status = task.status === 'NEEDS_MANUAL' ? 'NEEDS_MANUAL' : 'RUNNING';
      }
      task.updatedAt = nowIso();
      await saveState(state);
      return { statusCode: 200, body: JSON.stringify({ ok: true }) };
    }
  }

  if (path === '/logs' && method === 'POST') {
    state.logs.push(parseBody());
    await saveState(state);
    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  }

  if (path === '/logs' && method === 'GET') {
    const taskId = qs.get('taskId');
    return { statusCode: 200, body: JSON.stringify({ logs: state.logs.filter((l) => !taskId || l.taskId === taskId) }) };
  }

  if (path === '/artifacts' && method === 'POST') {
    state.artifacts.push(parseBody());
    await saveState(state);
    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  }

  if (path === '/artifacts' && method === 'GET') {
    const taskId = qs.get('taskId');
    return { statusCode: 200, body: JSON.stringify({ artifacts: state.artifacts.filter((a) => !taskId || a.taskId === taskId) }) };
  }

  if (path === '/policy' && method === 'GET') return { statusCode: 200, body: JSON.stringify(state.policy) };
  if (path === '/policy' && method === 'POST') { state.policy = parseBody(); await saveState(state); return { statusCode: 200, body: JSON.stringify({ ok: true }) }; }

  if (path === '/tools' && method === 'GET') {
    return { statusCode: 200, body: JSON.stringify({ tools: Object.entries(state.tools).map(([name, enabled]) => ({ name, enabled })) }) };
  }

  if (path === '/tools' && method === 'POST') {
    const body = toolsUpdateSchema.parse(parseBody());
    state.tools = body.tools;
    await saveState(state);
    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  }

  if (path === '/email/digest' && method === 'GET') return { statusCode: 200, body: JSON.stringify(state.emailDigest) };
  if (path === '/email/digest' && method === 'POST') { state.emailDigest = parseBody(); await saveState(state); return { statusCode: 200, body: JSON.stringify({ ok: true }) }; }

  if (path === '/apps' && method === 'GET') return { statusCode: 200, body: JSON.stringify({ apps: state.apps }) };
  if (path === '/apps' && method === 'POST') { state.apps = parseBody().apps || []; await saveState(state); return { statusCode: 200, body: JSON.stringify({ ok: true }) }; }

  return { statusCode: 404, body: JSON.stringify({ error: 'not found' }) };
};
