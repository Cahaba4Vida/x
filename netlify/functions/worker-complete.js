import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { recordUsageForTask, syncUsageToStripe } from './_lib/billing';
import { one, query } from './_lib/db';
import { badRequest, json, methodNotAllowed, parseJson, unauthorized } from './_lib/http';
import { requireWorkerId, validWorker } from './_lib/worker';

const bodySchema = z.object({
  taskId: z.string().uuid(),
  runId: z.string().uuid(),
  status: z.enum(['succeeded', 'failed', 'cancelled', 'awaiting_approval']),
  output: z.string().optional().default(''),
  errorMessage: z.string().optional().default(''),
  usage: z.object({
    llm_cost_usd: z.number().optional(),
    browser_seconds: z.number().optional(),
    desktop_seconds: z.number().optional(),
    screenshots: z.number().optional(),
    retries: z.number().optional()
  }).optional().default({}),
  approval: z.object({
    approval_id: z.string().optional(),
    reason: z.string().optional(),
    requested_action: z.record(z.string(), z.unknown()).optional(),
    status: z.string().optional()
  }).nullable().optional(),
  runtimeResult: z.record(z.string(), z.unknown()).optional().default({}),
  logs: z.array(z.record(z.string(), z.unknown())).optional().default([]),
  artifacts: z.array(z.record(z.string(), z.unknown())).optional().default([])
});

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return methodNotAllowed();
  if (!validWorker(event)) return unauthorized('Invalid worker secret');
  const workerId = requireWorkerId(event);
  if (!workerId) return unauthorized('Missing worker id');

  try {
    const body = bodySchema.parse(parseJson(event));
    const task = await one(`select organization_id, created_by_user_id, bot_id, cancellation_requested_at, status from tasks where id = $1`, [body.taskId]);
    if (!task) return badRequest('Task not found');

    if (body.status === 'awaiting_approval') {
      await query(
        `update task_runs
         set status = 'awaiting_approval',
             output_text = $3,
             runtime_result = $4::jsonb,
             usage_json = $5::jsonb,
             error_message = $6,
             updated_at = now()
         where id = $1`,
        [body.runId, body.status, body.output, JSON.stringify(body.runtimeResult), JSON.stringify(body.usage), body.errorMessage || null]
      );
      await query(`update tasks set status = 'awaiting_approval', updated_at = now() where id = $1`, [body.taskId]);
      const approvalId = body.approval?.approval_id || randomUUID();
      await query(
        `insert into approvals (id, task_id, requested_by_run_id, requested_action, requested_action_json, reason, status)
         values ($1,$2,$3,$4,$5::jsonb,$6,'pending')
         on conflict (id) do nothing`,
        [approvalId, body.taskId, body.runId, JSON.stringify(body.approval?.requested_action || {}), JSON.stringify(body.approval?.requested_action || {}), body.approval?.reason || 'Runtime requested approval']
      );
      await query(
        `insert into task_events (task_id, run_id, event_type, payload)
         values ($1,$2,'approval_pending',$3::jsonb)`,
        [body.taskId, body.runId, JSON.stringify({ approval_id: approvalId, reason: body.approval?.reason || null, worker_id: workerId })]
      );
      return json(200, { ok: true, status: 'awaiting_approval', approval_id: approvalId });
    }

    const finalStatus = task.cancellation_requested_at && body.status === 'succeeded' ? 'cancelled' : body.status;
    const usageRecord = await recordUsageForTask({
      organizationId: task.organization_id,
      userId: task.created_by_user_id,
      taskId: body.taskId,
      runId: body.runId,
      usage: body.usage
    });

    await query(
      `update task_runs
       set status = $2,
           output_text = $3,
           runtime_result = $4::jsonb,
           usage_json = $5::jsonb,
           error_message = $6,
           completed_at = now(),
           updated_at = now()
       where id = $1`,
      [body.runId, finalStatus, body.output, JSON.stringify(body.runtimeResult), JSON.stringify(body.usage), body.errorMessage || null]
    );
    await query(
      `update tasks
       set status = $2,
           actual_units = $3,
           completed_at = now(),
           updated_at = now()
       where id = $1`,
      [body.taskId, finalStatus, usageRecord.billableUnits]
    );
    await query(
      `insert into task_events (task_id, run_id, event_type, payload)
       values ($1,$2,$3,$4::jsonb)`,
      [body.taskId, body.runId, finalStatus, JSON.stringify({ output: body.output, errorMessage: body.errorMessage, usage: body.usage, worker_id: workerId })]
    );

    const stripeResult = await syncUsageToStripe({
      usageLedgerId: usageRecord.usageLedgerId,
      userId: task.created_by_user_id,
      billableUnits: usageRecord.billableUnits
    });

    return json(200, { ok: true, billable_units: usageRecord.billableUnits, stripe: stripeResult });
  } catch (error) {
    if (error instanceof z.ZodError) return badRequest(error.issues[0]?.message ?? 'Invalid request');
    return badRequest(error.message);
  }
};
