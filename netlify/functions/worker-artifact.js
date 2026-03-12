import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { query } from './_lib/db';
import { badRequest, json, methodNotAllowed, parseJson, unauthorized } from './_lib/http';
import { requireWorkerId, validWorker } from './_lib/worker';
const bodySchema = z.object({
    taskId: z.string().uuid(),
    runId: z.string().uuid().optional(),
    artifactType: z.enum(['screenshot', 'html', 'json', 'text', 'video', 'other']),
    name: z.string().max(200).optional(),
    storageUrl: z.string().url(),
    metadata: z.record(z.string(), z.unknown()).optional().default({})
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
        const artifactId = randomUUID();
        await query(`insert into task_artifacts (id, task_id, run_id, artifact_type, name, storage_url, metadata)
       values ($1,$2,$3,$4,$5,$6,$7::jsonb)`, [artifactId, body.taskId, body.runId ?? null, body.artifactType, body.name ?? null, body.storageUrl, JSON.stringify({ ...body.metadata, worker_id: workerId })]);
        await query(`insert into task_events (task_id, run_id, event_type, payload)
       values ($1,$2,'artifact_added',$3::jsonb)`, [body.taskId, body.runId ?? null, JSON.stringify({ artifact_id: artifactId, artifact_type: body.artifactType, name: body.name ?? null, storage_url: body.storageUrl, worker_id: workerId })]);
        return json(200, { ok: true, artifact_id: artifactId });
    }
    catch (error) {
        if (error instanceof z.ZodError)
            return badRequest(error.issues[0]?.message ?? 'Invalid request');
        return badRequest(error.message);
    }
};
