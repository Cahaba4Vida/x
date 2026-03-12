import type { HandlerEvent } from '@netlify/functions';
export declare function validWorker(event: HandlerEvent): boolean;
export declare function requireWorkerId(event: HandlerEvent): string | null;
export declare function workerLeaseSeconds(): number;
