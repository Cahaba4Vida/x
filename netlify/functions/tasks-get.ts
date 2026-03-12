import type { Handler } from '@netlify/functions';
import { getCurrentContext } from './_lib/auth';
import { one, query } from './_lib/db';
import { badRequest, json, methodNotAllowed, notFound, unauthorized } from './_lib/http';

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'GET') return methodNotAllowed();
  const context = await getCurrentContext(event);
  if (!context) return unauthorized();
  const taskId = event.queryStringParameters?.id;
  if (!taskId) return badRequest('Missing task id');

  const task = await one(
    `select
       t.id,
       t.title,
       t.prompt,
       t.task_type,
       t.action,
       t.payload,
       t.approval_policy,
       t.session_id,
       t.agent_id,
       t.status,
       t.estimated_units,
       t.actual_units,
       t.created_at,
       t.completed_at,
       t.cancellation_requested_at,
       t.cancellation_reason,
       u.email as created_by_email,
       b.name as bot_name,
       tr.id as latest_run_id,
       tr.output_text,
       tr.error_message,
       tr.usage_json,
       tr.runtime_result
     from tasks t
     join users u on u.id = t.created_by_user_id
     left join bots b on b.id = t.bot_id
     left join lateral (
       select * from task_runs where task_id = t.id order by created_at desc limit 1
     ) tr on true
     where t.id = $1 and t.organization_id = $2`,
    [taskId, context.organization.id]
  );
  if (!task) return notFound('Task not found');
  const events = await query(
    `select id, event_type, payload, created_at from task_events where task_id = $1 order by id asc`,
    [taskId]
  );
  const artifacts = await query(
    `select id, artifact_type, name, storage_url, metadata, created_at
     from task_artifacts where task_id = $1 order by created_at desc`,
    [taskId]
  );
  const approvals = await query(
    `select id, requested_action, requested_action_json, reason, status, decided_by_user_id, decided_at, created_at
     from approvals where task_id = $1 order by created_at desc`,
    [taskId]
  );
  return json(200, { task, events, artifacts, approvals });
};
