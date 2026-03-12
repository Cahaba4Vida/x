import type { Handler } from '@netlify/functions';
import { z } from 'zod';
import { getCurrentContext } from './_lib/auth';
import { one, query } from './_lib/db';
import { badRequest, forbidden, json, methodNotAllowed, parseJson, unauthorized } from './_lib/http';

const bodySchema = z.object({
  task_id: z.string().uuid(),
  reason: z.string().max(500).optional().default('Cancelled from dashboard')
});

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') return methodNotAllowed();
  const context = await getCurrentContext(event);
  if (!context) return unauthorized();

  try {
    const body = bodySchema.parse(parseJson(event));
    const task = await one<{
      id: string;
      status: string;
      created_by_user_id: string;
    }>(
      `select id, status, created_by_user_id
       from tasks
       where id = $1 and organization_id = $2`,
      [body.task_id, context.organization.id]
    );

    if (!task) return badRequest('Task not found');

    const canManageAny = context.membership.role === 'owner' || context.membership.role === 'admin';
    const isOwner = context.user.id === task.created_by_user_id;
    if (!canManageAny && !isOwner) return forbidden();

    if (task.status === 'succeeded' || task.status === 'failed' || task.status === 'cancelled') {
      return badRequest(`Task is already ${task.status}`);
    }

    if (task.status === 'queued') {
      await query(
        `update tasks
         set status = 'cancelled',
             cancellation_requested_at = now(),
             cancellation_requested_by_user_id = $2,
             cancellation_reason = $3,
             completed_at = now(),
             updated_at = now()
         where id = $1`,
        [body.task_id, context.user.id, body.reason]
      );
      await query(
        `insert into task_events (task_id, event_type, payload)
         values ($1, 'cancelled', $2::jsonb)`,
        [body.task_id, JSON.stringify({ by: context.user.email, reason: body.reason, immediate: true })]
      );
      return json(200, { ok: true, status: 'cancelled' });
    }

    await query(
      `update tasks
       set cancellation_requested_at = now(),
           cancellation_requested_by_user_id = $2,
           cancellation_reason = $3,
           updated_at = now()
       where id = $1`,
      [body.task_id, context.user.id, body.reason]
    );
    await query(
      `insert into task_events (task_id, event_type, payload)
       values ($1, 'cancellation_requested', $2::jsonb)`,
      [body.task_id, JSON.stringify({ by: context.user.email, reason: body.reason })]
    );
    return json(200, { ok: true, status: 'cancellation_requested' });
  } catch (error) {
    if (error instanceof z.ZodError) return badRequest(error.issues[0]?.message ?? 'Invalid request');
    return badRequest((error as Error).message);
  }
};
