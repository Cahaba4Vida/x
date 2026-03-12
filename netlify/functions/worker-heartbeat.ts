import type { Handler } from '@netlify/functions';
import { z } from 'zod';
import { query } from './_lib/db';
import { badRequest, json, methodNotAllowed, parseJson, unauthorized } from './_lib/http';
import { requireWorkerId, validWorker, workerLeaseSeconds } from './_lib/worker';

const bodySchema = z.object({
  botId: z.string().uuid(),
  status: z.enum(['idle', 'busy', 'error']).optional().default('idle'),
  machineName: z.string().min(1).max(200).optional()
});

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') return methodNotAllowed();
  if (!validWorker(event)) return unauthorized('Invalid worker secret');

  const workerId = requireWorkerId(event);
  if (!workerId) return unauthorized('Missing worker id');

  try {
    const body = bodySchema.parse(parseJson(event));
    const leaseSeconds = workerLeaseSeconds();

    await query(
      `update bots
       set status = $2,
           machine_name = coalesce($3, machine_name),
           last_heartbeat_at = now(),
           updated_at = now()
       where id = $1`,
      [body.botId, body.status, body.machineName ?? null]
    );

    await query(
      `insert into worker_leases (bot_id, lease_owner, lease_expires_at, heartbeat_at, created_at, updated_at)
       values ($1, $2, now() + ($3::text || ' seconds')::interval, now(), now(), now())
       on conflict (bot_id) do update set
         lease_owner = case
           when worker_leases.lease_owner = excluded.lease_owner or worker_leases.lease_expires_at < now()
           then excluded.lease_owner
           else worker_leases.lease_owner
         end,
         lease_expires_at = case
           when worker_leases.lease_owner = excluded.lease_owner or worker_leases.lease_expires_at < now()
           then excluded.lease_expires_at
           else worker_leases.lease_expires_at
         end,
         heartbeat_at = case
           when worker_leases.lease_owner = excluded.lease_owner or worker_leases.lease_expires_at < now()
           then excluded.heartbeat_at
           else worker_leases.heartbeat_at
         end,
         updated_at = now()`,
      [body.botId, workerId, String(leaseSeconds)]
    );

    return json(200, { ok: true, lease_seconds: leaseSeconds });
  } catch (error) {
    if (error instanceof z.ZodError) return badRequest(error.issues[0]?.message ?? 'Invalid request');
    return badRequest((error as Error).message);
  }
};
