import { neon } from '@neondatabase/serverless';
function requireEnv(name) {
    const value = process.env[name];
    if (!value) {
        throw new Error(`Missing environment variable: ${name}`);
    }
    return value;
}
export const sql = neon(requireEnv('DATABASE_URL'));
export async function query(text, params = []) {
    return (await sql.query(text, params));
}
export async function one(text, params = []) {
    const rows = await query(text, params);
    return rows[0] ?? null;
}
export function nowPlusHours(hours) {
    const date = new Date();
    date.setHours(date.getHours() + hours);
    return date.toISOString();
}
