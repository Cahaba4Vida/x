import type { Handler } from '@netlify/functions';
import { getCurrentContext } from './_lib/auth';
import { query } from './_lib/db';
import { json, methodNotAllowed, unauthorized } from './_lib/http';

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'GET') return methodNotAllowed();
  const context = await getCurrentContext(event);
  if (!context) return unauthorized();
  const tasks = await query(
    `select
       t.id,
       t.title,
       t.prompt,
       t.task_type,
       t.action,
       t.approval_policy,
       t.status,
       t.estimated_units,
       t.actual_units,
       t.created_at,
       t.completed_at,
       t.cancellation_requested_at,
       t.cancellation_reason,
       u.email as created_by_email,
       b.name as bot_name
     from tasks t
     join users u on u.id = t.created_by_user_id
     left join bots b on b.id = t.bot_id
     where t.organization_id = $1
     order by t.created_at desc
     limit 100`,
    [context.organization.id]
  );
  return json(200, { tasks });
};
