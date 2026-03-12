import { z } from 'zod';
import { createSessionCookie, verifyPassword, withSessionCookie } from './_lib/auth';
import { one } from './_lib/db';
import { badRequest, json, methodNotAllowed, parseJson, unauthorized } from './_lib/http';
const bodySchema = z.object({
    email: z.string().email(),
    password: z.string().min(1)
});
export const handler = async (event) => {
    if (event.httpMethod !== 'POST')
        return methodNotAllowed();
    try {
        const body = bodySchema.parse(parseJson(event));
        const user = await one(`select u.id as user_id, u.password_hash, m.organization_id, m.role
       from users u
       join memberships m on m.user_id = u.id and m.organization_id = u.default_org_id
       where u.email = $1`, [body.email.toLowerCase()]);
        if (!user)
            return unauthorized('Invalid credentials');
        const ok = await verifyPassword(body.password, user.password_hash);
        if (!ok)
            return unauthorized('Invalid credentials');
        const cookie = await createSessionCookie({ userId: user.user_id, orgId: user.organization_id, role: user.role });
        return withSessionCookie(json(200, { ok: true }), cookie);
    }
    catch (error) {
        if (error instanceof z.ZodError)
            return badRequest(error.issues[0]?.message ?? 'Invalid request');
        return unauthorized('Login failed');
    }
};
