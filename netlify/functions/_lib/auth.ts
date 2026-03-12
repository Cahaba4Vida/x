import type { HandlerEvent, HandlerResponse } from '@netlify/functions';
import bcrypt from 'bcryptjs';
import { SignJWT, jwtVerify } from 'jose';
import { one } from './db';
import { json, unauthorized } from './http';

const SESSION_COOKIE = 'bot_session';

type SessionClaims = {
  userId: string;
  orgId: string;
  role: string;
};

function getSecret(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error('Missing SESSION_SECRET');
  }
  return new TextEncoder().encode(secret);
}

function parseCookie(cookieHeader: string | undefined, name: string): string | null {
  if (!cookieHeader) return null;
  const match = cookieHeader
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.split('=').slice(1).join('=')) : null;
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export async function createSessionCookie(claims: SessionClaims): Promise<string> {
  const token = await new SignJWT(claims)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(getSecret());

  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800`;
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export async function getSession(event: HandlerEvent): Promise<SessionClaims | null> {
  const token = parseCookie(event.headers.cookie, SESSION_COOKIE);
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getSecret());
    return {
      userId: String(payload.userId),
      orgId: String(payload.orgId),
      role: String(payload.role)
    };
  } catch {
    return null;
  }
}

export async function requireSession(event: HandlerEvent): Promise<SessionClaims | HandlerResponse> {
  const session = await getSession(event);
  if (!session) {
    return unauthorized();
  }
  return session;
}

export async function getCurrentContext(event: HandlerEvent) {
  const session = await getSession(event);
  if (!session) return null;

  const row = await one<{
    user_id: string;
    email: string;
    full_name: string | null;
    organization_id: string;
    organization_name: string;
    role: string;
  }>(
    `select
       u.id as user_id,
       u.email,
       u.full_name,
       o.id as organization_id,
       o.name as organization_name,
       m.role
     from users u
     join memberships m on m.user_id = u.id and m.organization_id = $2
     join organizations o on o.id = m.organization_id
     where u.id = $1`,
    [session.userId, session.orgId]
  );

  if (!row) return null;

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

export function isManager(role: string): boolean {
  return role === 'owner' || role === 'admin';
}

export function withSessionCookie(response: HandlerResponse, cookie: string): HandlerResponse {
  return {
    ...response,
    headers: {
      ...(response.headers ?? {}),
      'Set-Cookie': cookie
    }
  };
}
