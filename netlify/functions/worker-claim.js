import { z } from 'zod';
import { one, query } from './_lib/db';
import { badRequest, json, methodNotAllowed, parseJson, unauthorized } from './_lib/http';
import { requireWorkerId, validWorker, workerLeaseSeconds } from './_lib/worker';

const bodySchema = z.object({
  botId: z.string().uuid()
});

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return methodNotAllowed();
  if (!validWorker(event)) return unauthorized('Invalid worker secret');

  const workerId = requireWorkerId(event);
  if (!workerId) return unauthorized('Missing worker id');

  try {
    const body = bodySchema.parse(parseJson(event));
    const leaseSeconds = workerLeaseSeconds();

    const lease = await one(
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
         updated_at = now()
       returning lease_owner`,
      [body.botId, workerId, String(leaseSeconds)]
    );

    if (lease?.lease_owner !== workerId) return json(200, { task: null });

    const resumeCandidate = await one(
      `select
         t.id as task_id,
         tr.id as run_id,
         t.title,
         t.prompt,
         t.task_type,
         t.action,
         t.payload,
         t.approval_policy,
         t.session_id,
         t.agent_id,
         t.priority,
         t.created_at,
         a.id as approval_id,
         a.status as approval_status
       from tasks t
       join task_runs tr on tr.task_id = t.id and tr.status = 'awaiting_approval'
       join lateral (
         select * from approvals
         where task_id = t.id and status in ('approved', 'denied')
         order by decided_at asc nulls last, created_at asc
         limit 1
       ) a on true
       where t.bot_id = $1 and t.status = 'awaiting_approval'
       order by a.decided_at asc nulls last
       limit 1`,
      [body.botId]
    );

    if (resumeCandidate) {
      await query(
        `insert into task_events (task_id, run_id, event_type, payload)
         values ($1,$2,'resume_claimed',$3::jsonb)`,
        [resumeCandidate.task_id, resumeCandidate.run_id, JSON.stringify({ approval_id: resumeCandidate.approval_id, worker_id: workerId })]
      );
      return json(200, {
        task: {
          id: resumeCandidate.task_id,
          run_id: resumeCandidate.run_id,
          title: resumeCandidate.title,
          prompt: resumeCandidate.prompt,
          task_type: resumeCandidate.task_type,
          action: resumeCandidate.action,
          payload: resumeCandidate.payload,
          approval_policy: resumeCandidate.approval_policy,
          session_id: resumeCandidate.session_id,
          agent_id: resumeCandidate.agent_id,
          priority: resumeCandidate.priority,
          created_at: resumeCandidate.created_at,
          bot_id: body.botId,
          resume_approval: {
            approval_id: resumeCandidate.approval_id,
            decision: resumeCandidate.approval_status,
            decided_by: 'operator'
          }
        }
      });
    }

    const claimed = await one(
      `with bot_org as (
         select organization_id from bots where id = $1
       ),
       next_task as (
         select t.id
         from tasks t
         where t.organization_id = (select organization_id from bot_org)
           and t.status = 'queued'
           and t.cancellation_requested_at is null
         order by t.priority asc, t.created_at asc
         limit 1
         for update skip locked
       ),
       updated as (
         update tasks
         set status = 'running',
             bot_id = $1,
             started_at = now(),
             updated_at = now()
         where id = (select id from next_task)
           and status = 'queued'
         returning id, title, prompt, task_type, action, payload, approval_policy, session_id, agent_id, created_by_user_id, organization_id, estimated_units, priority, created_at
       ),
       inserted as (
         insert into task_runs (id, task_id, bot_id, status, started_at, created_at, updated_at)
         select gen_random_uuid(), id, $1, 'running', now(), now(), now() from updated
         returning id, task_id
       )
       select
         u.id as task_id,
         i.id as run_id,
         u.title,
         u.prompt,
         u.task_type,
         u.action,
         u.payload,
         u.approval_policy,
         u.session_id,
         u.agent_id,
         u.created_by_user_id,
         u.organization_id,
         u.estimated_units,
         u.priority,
         u.created_at
       from updated u
       join inserted i on i.task_id = u.id`,
      [body.botId]
    );

    if (!claimed) return json(200, { task: null });

    await query(
      `insert into task_events (task_id, run_id, event_type, payload)
       values ($1,$2,'claimed',$3::jsonb)`,
      [claimed.task_id, claimed.run_id, JSON.stringify({ bot_id: body.botId, worker_id: workerId })]
    );

    return json(200, {
      task: {
        id: claimed.task_id,
        run_id: claimed.run_id,
        title: claimed.title,
        prompt: claimed.prompt,
        task_type: claimed.task_type,
        action: claimed.action,
        payload: claimed.payload,
        approval_policy: claimed.approval_policy,
        session_id: claimed.session_id,
        agent_id: claimed.agent_id,
        created_by_user_id: claimed.created_by_user_id,
        organization_id: claimed.organization_id,
        estimated_units: claimed.estimated_units,
        priority: claimed.priority,
        created_at: claimed.created_at,
        bot_id: body.botId
      }
    });
  } catch (error) {
    if (error instanceof z.ZodError) return badRequest(error.issues[0]?.message ?? 'Invalid request');
    return badRequest(error.message);
  }
};
