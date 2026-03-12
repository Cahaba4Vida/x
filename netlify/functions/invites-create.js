import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { getCurrentContext, isManager } from './_lib/auth';
import { query } from './_lib/db';
import { badRequest, forbidden, json, methodNotAllowed, parseJson, unauthorized } from './_lib/http';
const bodySchema = z.object({
    email: z.string().email(),
    role: z.enum(['admin', 'operator', 'viewer']).optional().default('operator')
});
export const handler = async (event) => {
    if (event.httpMethod !== 'POST')
        return methodNotAllowed();
    const context = await getCurrentContext(event);
    if (!context)
        return unauthorized();
    if (!isManager(context.membership.role))
        return forbidden();
    try {
        const body = bodySchema.parse(parseJson(event));
        const token = randomUUID();
        const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 72).toISOString();
        await query(`insert into org_invites (id, organization_id, email, role, token, expires_at, created_by_user_id)
       values ($1,$2,$3,$4,$5,$6,$7)`, [randomUUID(), context.organization.id, body.email.toLowerCase(), body.role, token, expiresAt, context.user.id]);
        return json(200, { token, expires_at: expiresAt });
    }
    catch (error) {
        if (error instanceof z.ZodError)
            return badRequest(error.issues[0]?.message ?? 'Invalid request');
        return badRequest(error.message);
    }
};
