import { getStore } from '@netlify/blobs';
import { defaultPolicy } from './defaultPolicy';
import { State } from './types';

const initialState = (): State => ({
  tasks: [], logs: [], artifacts: [], policy: defaultPolicy, tools: {
    gmail_tool: true, instagram_tool: true, playwright_tool: true, netlify_app_insights_tool: true
  }, emailDigest: {}, apps: []
});

export async function loadState(): Promise<State> {
  try {
    const store = getStore('agent-cockpit');
    const value = await store.get('state', { type: 'json' }) as State | null;
    return value || initialState();
  } catch {
    const g = globalThis as unknown as { __state?: State };
    g.__state = g.__state || initialState();
    return g.__state;
  }
}

export async function saveState(state: State): Promise<void> {
  try {
    const store = getStore('agent-cockpit');
    await store.setJSON('state', state);
  } catch {
    const g = globalThis as unknown as { __state?: State };
    g.__state = state;
  }
}
