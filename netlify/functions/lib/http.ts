export const json = (statusCode: number, body: unknown) => ({ statusCode, body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
