import { Task } from './types';

const tokenKey = 'adminToken';

export function getToken() {
  return localStorage.getItem(tokenKey) || '';
}

export function setToken(token: string) {
  localStorage.setItem(tokenKey, token);
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getToken()}`,
      ...(options.headers || {})
    }
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response.json();
}

export const api = {
  listTasks: (status?: string) => request<{ tasks: Task[] }>(`/tasks${status ? `?status=${status}` : ''}`),
  createTask: (payload: { type: string; args: Record<string, unknown> }) => request<Task>('/tasks', { method: 'POST', body: JSON.stringify(payload) }),
  getTask: (id: string) => request<Task>(`/tasks/${id}`),
  getLogs: (taskId: string) => request<{ logs: Array<Record<string, unknown>> }>(`/logs?taskId=${taskId}`),
  getArtifacts: (taskId: string) => request<{ artifacts: Array<Record<string, unknown>> }>(`/artifacts?taskId=${taskId}`),
  approve: (taskId: string, actionId: string) => request(`/tasks/${taskId}/approve`, { method: 'POST', body: JSON.stringify({ actionId }) }),
  deny: (taskId: string, actionId: string) => request(`/tasks/${taskId}/deny`, { method: 'POST', body: JSON.stringify({ actionId }) }),
  getPolicy: () => request<Record<string, unknown>>('/policy'),
  updatePolicy: (policy: Record<string, unknown>) => request('/policy', { method: 'POST', body: JSON.stringify(policy) }),
  getTools: () => request<{ tools: Array<Record<string, unknown>> }>('/tools'),
  updateTools: (tools: Record<string, boolean>) => request('/tools', { method: 'POST', body: JSON.stringify({ tools }) }),
  getDigest: () => request<Record<string, unknown>>('/email/digest'),
  getApps: () => request<{ apps: Array<Record<string, unknown>> }>('/apps')
};
