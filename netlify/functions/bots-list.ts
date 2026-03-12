import type { Handler } from '@netlify/functions';
import { getCurrentContext } from './_lib/auth';
import { query } from './_lib/db';
import { json, methodNotAllowed, unauthorized } from './_lib/http';

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'GET') return methodNotAllowed();
  const context = await getCurrentContext(event);
  if (!context) return unauthorized();
  const bots = await query(
    `select id, name, status, last_heartbeat_at, created_at
     from bots where organization_id = $1 order by created_at asc`,
    [context.organization.id]
  );
  return json(200, { bots });
};
