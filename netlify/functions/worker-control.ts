import type { Handler } from '@netlify/functions';
import { z } from 'zod';
import { one } from './_lib/db';
import { badRequest, json, methodNotAllowed, parseJson, unauthorized } from './_lib/http';
import { requireWorkerId, validWorker } from './_lib/worker';

const bodySchema = z.object({
  taskId: z.string().uuid(),
  runId: z.string().uuid().optional()
});

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') return methodNotAllowed();
  if (!validWorker(event)) return unauthorized('Invalid worker secret');

  const workerId = requireWorkerId(event);
  if (!workerId) return unauthorized('Missing worker id');

  try {
    const body = bodySchema.parse(parseJson(event));
    const task = await one<{
      status: string;
      cancellation_requested_at: string | null;
      cancellation_reason: string | null;
    }>(
      `select status, cancellation_requested_at, cancellation_reason
       from tasks where id = $1`,
      [body.taskId]
    );

    if (!task) return badRequest('Task not found');

    return json(200, {
      cancel_requested: Boolean(task.cancellation_requested_at || task.status === 'cancelled'),
      cancellation_reason: task.cancellation_reason,
      task_status: task.status
    });
  } catch (error) {
    if (error instanceof z.ZodError) return badRequest(error.issues[0]?.message ?? 'Invalid request');
    return badRequest((error as Error).message);
  }
};
