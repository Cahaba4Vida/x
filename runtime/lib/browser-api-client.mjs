import { buildError, withDefaultHeaders } from './utils.mjs';

export class BrowserApiClient {
  constructor({ baseUrl, secret }) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.secret = secret || '';
  }

  async call(path, body = {}, options = {}) {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: options.method || 'POST',
      headers: withDefaultHeaders({}, this.secret),
      body: options.method === 'GET' ? undefined : JSON.stringify(body)
    });
    const raw = await response.text();
    const data = raw ? JSON.parse(raw) : {};
    if (!response.ok) {
      throw Object.assign(new Error(data?.error?.message || data?.error || `Browser API ${response.status}`), { runtimeError: data?.error || buildError('BROWSER_API_ERROR', `Browser API error at ${path}`, true) });
    }
    return data;
  }

  goto(botId, payload) { return this.call('/goto', { bot_id: botId, ...payload }); }
  click(botId, payload) { return this.call('/click', { bot_id: botId, ...payload }); }
  type(botId, payload) { return this.call('/type', { bot_id: botId, ...payload }); }
  extract(botId, payload) { return this.call('/extract', { bot_id: botId, ...payload }); }
  screenshot(botId, payload) { return this.call('/screenshot', { bot_id: botId, ...payload }); }
  waitForSelector(botId, payload) { return this.call('/wait-for-selector', { bot_id: botId, ...payload }); }
  waitForText(botId, payload) { return this.call('/wait-for-text', { bot_id: botId, ...payload }); }
  close(botId) { return this.call('/close', { bot_id: botId }); }
  async health() { return this.call('/healthz', {}, { method: 'GET' }); }
  async state(botId) { return this.call(`/state?bot_id=${encodeURIComponent(botId)}`, {}, { method: 'GET' }); }
}
