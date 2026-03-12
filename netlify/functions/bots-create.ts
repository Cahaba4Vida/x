import type { Handler } from '@netlify/functions';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { getCurrentContext, isManager } from './_lib/auth';
import { query } from './_lib/db';
import { badRequest, forbidden, json, methodNotAllowed, parseJson, unauthorized } from './_lib/http';

const bodySchema = z.object({
  name: z.string().min(2).max(100)
});

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') return methodNotAllowed();
  const context = await getCurrentContext(event);
  if (!context) return unauthorized();
  if (!isManager(context.membership.role)) return forbidden();

  try {
    const body = bodySchema.parse(parseJson(event));
    const id = randomUUID();
    await query(
      `insert into bots (id, organization_id, name, status)
       values ($1,$2,$3,'offline')`,
      [id, context.organization.id, body.name]
    );
    return json(200, { id });
  } catch (error) {
    if (error instanceof z.ZodError) return badRequest(error.issues[0]?.message ?? 'Invalid request');
    return badRequest((error as Error).message);
  }
};
