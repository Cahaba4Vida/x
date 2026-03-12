import bcrypt from 'bcryptjs';
import { SignJWT, jwtVerify } from 'jose';
import { one } from './db';
import { unauthorized } from './http';
const SESSION_COOKIE = 'bot_session';
function getSecret() {
    const secret = process.env.SESSION_SECRET;
    if (!secret) {
        throw new Error('Missing SESSION_SECRET');
    }
    return new TextEncoder().encode(secret);
}
function parseCookie(cookieHeader, name) {
    if (!cookieHeader)
        return null;
    const match = cookieHeader
        .split(';')
        .map((part) => part.trim())
        .find((part) => part.startsWith(`${name}=`));
    return match ? decodeURIComponent(match.split('=').slice(1).join('=')) : null;
}
export async function hashPassword(password) {
    return bcrypt.hash(password, 10);
}
export async function verifyPassword(password, hash) {
    return bcrypt.compare(password, hash);
}
export async function createSessionCookie(claims) {
    const token = await new SignJWT(claims)
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime('7d')
        .sign(getSecret());
    return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800`;
}
export function clearSessionCookie() {
    return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}
export async function getSession(event) {
    const token = parseCookie(event.headers.cookie, SESSION_COOKIE);
    if (!token)
        return null;
    try {
        const { payload } = await jwtVerify(token, getSecret());
        return {
            userId: String(payload.userId),
            orgId: String(payload.orgId),
            role: String(payload.role)
        };
    }
    catch {
        return null;
    }
}
export async function requireSession(event) {
    const session = await getSession(event);
    if (!session) {
        return unauthorized();
    }
    return session;
}
export async function getCurrentContext(event) {
    const session = await getSession(event);
    if (!session)
        return null;
    const row = await one(`select
       u.id as user_id,
       u.email,
       u.full_name,
       o.id as organization_id,
       o.name as organization_name,
       m.role
     from users u
     join memberships m on m.user_id = u.id and m.organization_id = $2
     join organizations o on o.id = m.organization_id
     where u.id = $1`, [session.userId, session.orgId]);
    if (!row)
        return null;
    return {
        session,
        user: {
            id: row.user_id,
            email: row.email,
            full_name: row.full_name
        },
        organization: {
            id: row.organization_id,
            name: row.organization_name
        },
        membership: {
            role: row.role
        }
    };
}
export function isManager(role) {
    return role === 'owner' || role === 'admin';
}
export function withSessionCookie(response, cookie) {
    return {
        ...response,
        headers: {
            ...(response.headers ?? {}),
            'Set-Cookie': cookie
        }
    };
}
