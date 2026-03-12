import { z } from 'zod';
import { query } from './_lib/db';
import { badRequest, json, methodNotAllowed, parseJson, unauthorized } from './_lib/http';
import { requireWorkerId, validWorker } from './_lib/worker';
const bodySchema = z.object({
    taskId: z.string().uuid(),
    runId: z.string().uuid(),
    eventType: z.string().min(1),
    payload: z.record(z.string(), z.unknown()).optional().default({})
});
export const handler = async (event) => {
    if (event.httpMethod !== 'POST')
        return methodNotAllowed();
    if (!validWorker(event))
        return unauthorized('Invalid worker secret');
    const workerId = requireWorkerId(event);
    if (!workerId)
        return unauthorized('Missing worker id');
    try {
        const body = bodySchema.parse(parseJson(event));
        await query(`insert into task_events (task_id, run_id, event_type, payload)
       values ($1,$2,$3,$4::jsonb)`, [body.taskId, body.runId, body.eventType, JSON.stringify({ ...body.payload, worker_id: workerId })]);
        return json(200, { ok: true });
    }
    catch (error) {
        if (error instanceof z.ZodError)
            return badRequest(error.issues[0]?.message ?? 'Invalid request');
        return badRequest(error.message);
    }
};
