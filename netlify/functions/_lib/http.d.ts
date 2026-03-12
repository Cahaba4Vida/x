import type { HandlerEvent, HandlerResponse } from '@netlify/functions';
export declare function json(statusCode: number, body: unknown, headers?: Record<string, string>): HandlerResponse;
export declare function methodNotAllowed(): HandlerResponse;
export declare function badRequest(message: string): HandlerResponse;
export declare function unauthorized(message?: string): HandlerResponse;
export declare function forbidden(message?: string): HandlerResponse;
export declare function notFound(message?: string): HandlerResponse;
export declare function serverError(message?: string): HandlerResponse;
export declare function parseJson<T>(event: HandlerEvent): T;
