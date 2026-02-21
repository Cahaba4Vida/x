import { json } from './http';

export function ensureAuth(headers: Record<string, string | undefined>) {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected) {
    return json(500, { error: 'server_misconfigured', message: 'ADMIN_TOKEN is not set' });
  }
  const auth = headers.authorization || headers.Authorization;
  if (auth !== `Bearer ${expected}`) {
    return json(401, { error: 'unauthorized' });
  }
  return null;
}
