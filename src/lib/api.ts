export type ApiError = { error: string };

async function parseResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error((data as ApiError).error || 'Request failed');
  }
  return data as T;
}

export async function apiGet<T>(path: string): Promise<T> {
  return parseResponse<T>(await fetch(path, { credentials: 'include' }));
}

export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  return parseResponse<T>(
    await fetch(path, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json'
      },
      body: body ? JSON.stringify(body) : undefined
    })
  );
}
