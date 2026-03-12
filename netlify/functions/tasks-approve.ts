import type { Handler } from '@netlify/functions';
import { z } from 'zod';
import { getCurrentContext } from './_lib/auth';
import { one, query } from './_lib/db';
import { badRequest, json, methodNotAllowed, unauthorized } from './_lib/http';

const bodySchema = z.object({
  approval_id: z.string().min(1),
  decision: z.enum(['approved', 'denied'])
});

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') return methodNotAllowed();
  const context = await getCurrentContext(event);
  if (!context) return unauthorized();

  try {
    const body = bodySchema.parse(JSON.parse(event.body || '{}'));
    const approval = await one<{ task_id: string; status: string }>(`select task_id, status from approvals where id = $1`, [body.approval_id]);
    if (!approval) return badRequest('Approval not found');
    if (approval.status !== 'pending') return json(200, { ok: true, status: approval.status });

    await query(
      `update approvals
       set status = $2, decided_by_user_id = $3, decided_at = now()
       where id = $1 and status = 'pending'`,
      [body.approval_id, body.decision, context.user.id]
    );
    await query(
      `insert into task_events (task_id, event_type, payload)
       values ($1,'approval_decision',$2::jsonb)`,
      [approval.task_id, JSON.stringify({ approval_id: body.approval_id, decision: body.decision, by: context.user.email })]
    );
    return json(200, { ok: true });
  } catch (error) {
    if (error instanceof z.ZodError) return badRequest(error.issues[0]?.message ?? 'Invalid request');
    return badRequest((error as Error).message);
  }
};
