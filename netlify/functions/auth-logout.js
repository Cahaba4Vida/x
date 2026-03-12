import { clearSessionCookie, withSessionCookie } from './_lib/auth';
import { json, methodNotAllowed } from './_lib/http';
export const handler = async (event) => {
    if (event.httpMethod !== 'POST')
        return methodNotAllowed();
    return withSessionCookie(json(200, { ok: true }), clearSessionCookie());
};
