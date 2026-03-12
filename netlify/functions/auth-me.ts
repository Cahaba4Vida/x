import type { Handler } from '@netlify/functions';
import { getCurrentContext } from './_lib/auth';
import { json, methodNotAllowed, unauthorized } from './_lib/http';

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'GET') return methodNotAllowed();
  const context = await getCurrentContext(event);
  if (!context) return unauthorized();
  return json(200, context);
};
