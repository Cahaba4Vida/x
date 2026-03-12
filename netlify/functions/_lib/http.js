export function json(statusCode, body, headers = {}) {
    return {
        statusCode,
        headers: {
            'Content-Type': 'application/json',
            ...headers
        },
        body: JSON.stringify(body)
    };
}
export function methodNotAllowed() {
    return json(405, { error: 'Method not allowed' });
}
export function badRequest(message) {
    return json(400, { error: message });
}
export function unauthorized(message = 'Unauthorized') {
    return json(401, { error: message });
}
export function forbidden(message = 'Forbidden') {
    return json(403, { error: message });
}
export function notFound(message = 'Not found') {
    return json(404, { error: message });
}
export function serverError(message = 'Server error') {
    return json(500, { error: message });
}
export function parseJson(event) {
    if (!event.body) {
        return {};
    }
    return JSON.parse(event.body);
}
