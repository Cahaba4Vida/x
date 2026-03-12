import type { HandlerEvent } from '@netlify/functions';

export function validWorker(event: HandlerEvent): boolean {
  const secret = process.env.WORKER_SHARED_SECRET;
  const provided = event.headers['x-worker-secret'] || event.headers['X-Worker-Secret'];
  return Boolean(secret && provided === secret);
}

export function requireWorkerId(event: HandlerEvent): string | null {
  return event.headers['x-worker-id'] || event.headers['X-Worker-Id'] || null;
}

export function workerLeaseSeconds(): number {
  return Math.max(15, Number(process.env.WORKER_LEASE_SECONDS || 45));
}
