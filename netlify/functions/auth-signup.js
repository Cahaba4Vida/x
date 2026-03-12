import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { createSessionCookie, hashPassword, withSessionCookie } from './_lib/auth';
import { one, query } from './_lib/db';
import { badRequest, json, methodNotAllowed, parseJson, serverError } from './_lib/http';
const bodySchema = z.object({
    email: z.string().email(),
    password: z.string().min(8),
    full_name: z.string().min(1).max(120),
    organization_name: z.string().optional().default(''),
    invite_token: z.string().optional().default('')
});
export const handler = async (event) => {
    if (event.httpMethod !== 'POST')
        return methodNotAllowed();
    try {
        const body = bodySchema.parse(parseJson(event));
        const existing = await one(`select id from users where email = $1`, [body.email.toLowerCase()]);
        if (existing)
            return badRequest('Email already in use');
        const userId = randomUUID();
        const passwordHash = await hashPassword(body.password);
        let orgId = '';
        let role = 'owner';
        if (body.invite_token) {
            const invite = await one(`select organization_id, role, email, expires_at, used_at from org_invites where token = $1`, [body.invite_token]);
            if (!invite)
                return badRequest('Invite not found');
            if (invite.used_at)
                return badRequest('Invite already used');
            if (new Date(invite.expires_at).getTime() < Date.now())
                return badRequest('Invite expired');
            if (invite.email && invite.email.toLowerCase() !== body.email.toLowerCase()) {
                return badRequest('Invite email does not match');
            }
            orgId = invite.organization_id;
            role = invite.role;
            await query(`insert into users (id, email, password_hash, full_name, default_org_id)
         values ($1,$2,$3,$4,$5)`, [userId, body.email.toLowerCase(), passwordHash, body.full_name, orgId]);
            await query(`insert into memberships (organization_id, user_id, role) values ($1,$2,$3)`, [orgId, userId, role]);
            await query(`update org_invites set used_at = now() where token = $1`, [body.invite_token]);
        }
        else {
            if (!body.organization_name.trim()) {
                return badRequest('Organization name is required when not using an invite');
            }
            orgId = randomUUID();
            await query(`insert into organizations (id, name) values ($1,$2)`, [orgId, body.organization_name.trim()]);
            await query(`insert into users (id, email, password_hash, full_name, default_org_id)
         values ($1,$2,$3,$4,$5)`, [userId, body.email.toLowerCase(), passwordHash, body.full_name, orgId]);
            await query(`insert into memberships (organization_id, user_id, role) values ($1,$2,'owner')`, [orgId, userId]);
        }
        const cookie = await createSessionCookie({ userId, orgId, role });
        return withSessionCookie(json(200, { ok: true }), cookie);
    }
    catch (error) {
        if (error instanceof z.ZodError) {
            return badRequest(error.issues[0]?.message ?? 'Invalid request');
        }
        return serverError(error.message);
    }
};
