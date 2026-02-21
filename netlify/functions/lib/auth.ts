export function ensureAuth(headers: Record<string, string | undefined>) {
  const auth = headers.authorization || headers.Authorization;
  const expected = process.env.ADMIN_TOKEN;
  if (!expected || auth !== `Bearer ${expected}`) {
    return { statusCode: 401, body: 'unauthorized' };
  }
  return null;
}
