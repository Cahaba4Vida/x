import type { Handler } from '@netlify/functions';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { getCurrentContext } from './_lib/auth';
import { estimateUnitsFromPrompt } from './_lib/billing';
import { query } from './_lib/db';
import { badRequest, json, methodNotAllowed, parseJson, unauthorized } from './_lib/http';

const bodySchema = z.object({
  title: z.string().min(2).max(120),
  prompt: z.string().min(2).max(20000),
  task_type: z.string().min(1).max(80).optional().default('browser.workflow'),
  action: z.enum(['goto', 'click', 'type', 'extract', 'screenshot', 'composed']).optional().default('composed'),
  payload: z.union([z.record(z.string(), z.unknown()), z.string()]).optional().default({}),
  approval_policy: z.enum(['auto', 'ask', 'required']).optional().default('ask'),
  session_id: z.string().min(1).max(200).optional().default('agent:main:main'),
  agent_id: z.string().min(1).max(80).optional().default('main')
});

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') return methodNotAllowed();
  const context = await getCurrentContext(event);
  if (!context) return unauthorized();

  try {
    const raw = parseJson(event);
    const body = bodySchema.parse({
      ...raw,
      payload: typeof raw?.payload === 'string' ? JSON.parse(raw.payload || '{}') : raw?.payload
    });
    const id = randomUUID();
    const estimatedUnits = estimateUnitsFromPrompt(body.prompt);
    await query(
      `insert into tasks (id, organization_id, created_by_user_id, title, prompt, task_type, action, payload, approval_policy, session_id, agent_id, status, estimated_units)
       values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,'queued',$12)`,
      [id, context.organization.id, context.user.id, body.title, body.prompt, body.task_type, body.action, JSON.stringify(body.payload), body.approval_policy, body.session_id, body.agent_id, estimatedUnits]
    );
    await query(
      `insert into task_events (task_id, event_type, payload) values ($1,'queued',$2::jsonb)`,
      [id, JSON.stringify({ by: context.user.email, estimated_units: estimatedUnits, action: body.action, approval_policy: body.approval_policy })]
    );
    return json(200, { id, estimated_units: estimatedUnits });
  } catch (error) {
    if (error instanceof z.ZodError) return badRequest(error.issues[0]?.message ?? 'Invalid request');
    return badRequest((error as Error).message);
  }
};
