import fs from "node:fs/promises";
import fssync from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

export function nowIso() { return new Date().toISOString(); }
export function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
export function jsonResponse(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}
export async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  return raw ? JSON.parse(raw) : {};
}
export function routeMatch(url, pattern) {
  const match = url.match(pattern);
  return match ? match.slice(1) : null;
}
export async function ensureDir(dir) { await fs.mkdir(dir, { recursive: true }); return dir; }
export function ensureDirSync(dir) { fssync.mkdirSync(dir, { recursive: true }); return dir; }
export function slugify(value = 'artifact') {
  return String(value).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'artifact';
}
export function safeParseJson(value, fallback = {}) {
  if (!value) return fallback;
  try { return typeof value === 'string' ? JSON.parse(value) : value; } catch { return fallback; }
}
export function buildError(code, message, retryable = false, details = undefined) {
  return { code, message, retryable, ...(details ? { details } : {}) };
}
export function withDefaultHeaders(headers = {}, secret = '') {
  return {
    'Content-Type': 'application/json',
    ...(secret ? { 'X-Browser-Api-Secret': secret } : {}),
    ...headers
  };
}
export function randomId(prefix = 'id') { return `${prefix}_${randomUUID()}`; }
export function isStateChangingAction(action) { return action === 'click' || action === 'type'; }
export function getDomainFromUrl(url) {
  try { return new URL(url).hostname; } catch { return null; }
}
export function isAuthLikeUrl(url) {
  return /login|signin|auth|account|dashboard|settings/i.test(String(url || ''));
}
export async function fileExists(filePath) {
  try { await fs.access(filePath); return true; } catch { return false; }
}
export function isPrivateHost(hostname) {
  if (!hostname) return false;
  if (hostname === 'localhost' || hostname === '127.0.0.1') return true;
  if (/^10\./.test(hostname) || /^192\.168\./.test(hostname)) return true;
  const m = hostname.match(/^172\.(\d+)\./);
  return !!(m && Number(m[1]) >= 16 && Number(m[1]) <= 31);
}
export function normalizeTask(task) {
  return {
    task_id: task.task_id || task.id,
    run_id: task.run_id,
    bot_id: task.bot_id,
    session_id: task.session_id || 'agent:main:main',
    agent_id: task.agent_id || 'main',
    type: task.type || task.task_type || 'browser.workflow',
    action: task.action || 'composed',
    payload: task.payload || {},
    approval_policy: task.approval_policy || 'ask',
    priority: task.priority ?? 100,
    created_at: task.created_at || nowIso(),
    title: task.title || null,
    prompt: task.prompt || null,
    resume_approval: task.resume_approval || null
  };
}
