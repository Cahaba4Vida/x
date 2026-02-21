import { Handler } from '@netlify/functions';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { ensureAuth } from './lib/auth';
import { loadState, saveState } from './lib/store';
import { PendingAction, Task } from './lib/types';
import { query } from './lib/db';

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
  const parseBody = () => (event.body ? JSON.parse(event.body) : {});

  if (path === '/watch/latest_screenshot' && method === 'POST') {
    const taskId = qs.get('taskId');
    if (!taskId) return { statusCode: 400, body: 'taskId required' };
    const bytes = event.body
      ? (event.isBase64Encoded ? Buffer.from(event.body, 'base64') : Buffer.from(event.body, 'binary'))
      : Buffer.alloc(0);
    if (!bytes.length) return { statusCode: 400, body: 'image required' };
    await query(
      `insert into task_watch_latest(task_id, image_jpeg, updated_at)
       values ($1, $2, now())
       on conflict (task_id) do update set image_jpeg = excluded.image_jpeg, updated_at = now()`,
      [taskId, bytes]
    );
    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  }

  if (path === '/watch/latest_screenshot' && method === 'GET') {
    const taskId = qs.get('taskId');
    if (!taskId) return { statusCode: 400, body: 'taskId required' };
    const res = await query<{ image_jpeg: Buffer }>('select image_jpeg from task_watch_latest where task_id=$1', [taskId]);
    if (!res.rows[0]) return { statusCode: 404, body: 'not found' };
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store' },
      body: Buffer.from(res.rows[0].image_jpeg).toString('base64'),
      isBase64Encoded: true
    };
  }

  const state = await loadState();
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
      await query(
        `insert into task_approvals(task_id, action_id, action_type, status, payload)
         values($1,$2,$3,$4,$5::jsonb)`,
        [task.id, body.id, body.type, body.status, JSON.stringify(body.payload || {})]
      );
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
      await query(
        `update task_approvals set status=$1, updated_at=now() where task_id=$2 and action_id=$3`,
        [pending.status, task.id, pending.id]
      );
      await saveState(state);
      return { statusCode: 200, body: JSON.stringify({ ok: true }) };
    }
  }

  if (path === '/logs' && method === 'POST') {
    const entry = parseBody();
    const taskId = String(entry.taskId || '');
    const level = entry.level ? String(entry.level) : null;
    const eventName = entry.event ? String(entry.event) : null;
    const payload = entry.payload ?? {};
    const ts = entry.ts ? new Date(String(entry.ts)).toISOString() : nowIso();
    const inserted = await query<{ id: number }>(
      `insert into task_logs(task_id, ts, level, event, payload, raw)
       values($1,$2::timestamptz,$3,$4,$5::jsonb,$6::jsonb)
       returning id`,
      [taskId, ts, level, eventName, JSON.stringify(payload), JSON.stringify(entry)]
    );
    return { statusCode: 200, body: JSON.stringify({ ok: true, id: inserted.rows[0].id }) };
  }

  if (path === '/logs' && method === 'GET') {
    const taskId = qs.get('taskId');
    const sinceId = Number(qs.get('sinceId') || '0');
    const limit = Math.min(Number(qs.get('limit') || '200'), 1000);
    if (!taskId) return { statusCode: 200, body: JSON.stringify({ logs: [] }) };
    const logsRes = await query(
      `select id, task_id as "taskId", ts, level, event, payload, raw
       from task_logs
       where task_id=$1 and id > $2
       order by id asc
       limit $3`,
      [taskId, sinceId, limit]
    );
    const logs = logsRes.rows.map((r: any) => ({ id: r.id, taskId: r.taskId, ts: r.ts, level: r.level, event: r.event, payload: r.payload, ...r.raw }));
    return { statusCode: 200, body: JSON.stringify({ logs }) };
  }

  if (path === '/artifacts' && method === 'POST') {
    const body = parseBody();
    const b64 = typeof body.dataBase64 === 'string' ? body.dataBase64 : '';
    if (b64 && b64.length > 200 * 1024) {
      return { statusCode: 413, body: JSON.stringify({ error: 'artifact dataBase64 exceeds 200KB' }) };
    }
    const metadata = { ...body };
    delete (metadata as any).dataBase64;
    const inserted = await query<{ id: number }>(
      `insert into task_artifacts(task_id, artifact_id, type, mime, note, metadata)
       values($1,$2,$3,$4,$5,$6::jsonb)
       returning id`,
      [String(body.taskId || ''), body.id ? String(body.id) : null, body.type ? String(body.type) : null, body.mime ? String(body.mime) : null, body.note ? String(body.note) : null, JSON.stringify(metadata)]
    );
    return { statusCode: 200, body: JSON.stringify({ ok: true, id: inserted.rows[0].id }) };
  }

  if (path === '/artifacts' && method === 'GET') {
    const taskId = qs.get('taskId');
    if (!taskId) return { statusCode: 200, body: JSON.stringify({ artifacts: [] }) };
    const res = await query(
      `select id, task_id as "taskId", artifact_id as "artifactId", type, mime, note, created_at as "createdAt", metadata
       from task_artifacts where task_id=$1 order by id desc`,
      [taskId]
    );
    const artifacts = res.rows.map((r: any) => ({ id: r.id, taskId: r.taskId, artifactId: r.artifactId, type: r.type, mime: r.mime, note: r.note, createdAt: r.createdAt, ...r.metadata }));
    return { statusCode: 200, body: JSON.stringify({ artifacts }) };
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
