import type { HandlerEvent, HandlerResponse } from '@netlify/functions';

export function json(statusCode: number, body: unknown, headers: Record<string, string> = {}): HandlerResponse {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      ...headers
    },
    body: JSON.stringify(body)
  };
}

export function methodNotAllowed(): HandlerResponse {
  return json(405, { error: 'Method not allowed' });
}

export function badRequest(message: string): HandlerResponse {
  return json(400, { error: message });
}

export function unauthorized(message = 'Unauthorized'): HandlerResponse {
  return json(401, { error: message });
}

export function forbidden(message = 'Forbidden'): HandlerResponse {
  return json(403, { error: message });
}

export function notFound(message = 'Not found'): HandlerResponse {
  return json(404, { error: message });
}

export function serverError(message = 'Server error'): HandlerResponse {
  return json(500, { error: message });
}

export function parseJson<T>(event: HandlerEvent): T {
  if (!event.body) {
    return {} as T;
  }
  return JSON.parse(event.body) as T;
}
