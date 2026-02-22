import { useEffect, useState } from 'react';
import { api } from '../api';
import { AppConfig } from '../types';

const emptyForm = {
  name: '',
  base_url: '',
  auth_type: 'none' as const,
  token_env: '',
  username_env: '',
  password_env: '',
  two_fa_notes: '',
  enabled: true
};

export function AppsPage() {
  const [apps, setApps] = useState<AppConfig[]>([]);
  const [editing, setEditing] = useState<AppConfig | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<any>(emptyForm);

  const load = () => api.getApps().then((r) => setApps(r.apps));
  useEffect(() => { load(); }, []);

  const beginCreate = () => { setCreating(true); setEditing(null); setForm(emptyForm); };
  const beginEdit = (app: AppConfig) => {
    setCreating(false);
    setEditing(app);
    setForm({ ...emptyForm, ...app, token_env: app.token_env || '', username_env: app.username_env || '', password_env: app.password_env || '', two_fa_notes: app.two_fa_notes || '' });
  };

  const save = async () => {
    if (creating) {
      const created = await api.createApp({ name: form.name, base_url: form.base_url });
      await api.updateAppAuth(created.id, form);
    } else if (editing) {
      await api.updateApp(editing.id, { name: form.name, base_url: form.base_url });
      await api.updateAppAuth(editing.id, form);
    }
    setCreating(false);
    setEditing(null);
    load();
  };

  return <div style={{ padding: 12 }}>
    <h2>Configured Apps</h2>
    <button onClick={beginCreate}>Add App</button>
    <table style={{ width: '100%', marginTop: 8 }}>
      <thead><tr><th>Name</th><th>Base URL</th><th>Auth</th><th /></tr></thead>
      <tbody>
        {apps.map((app) => <tr key={app.id}><td>{app.name}</td><td>{app.base_url}</td><td>{app.auth_type}</td><td><button onClick={() => beginEdit(app)}>Edit</button></td></tr>)}
      </tbody>
    </table>

    {(creating || editing) && <div style={{ border: '1px solid #ddd', padding: 12, marginTop: 12 }}>
      <h3>{creating ? 'Add App' : `Edit ${editing?.name}`}</h3>
      <div><input placeholder="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
      <div><input placeholder="https://..." value={form.base_url} onChange={(e) => setForm({ ...form, base_url: e.target.value })} /></div>
      <div>
        <select value={form.auth_type} onChange={(e) => setForm({ ...form, auth_type: e.target.value })}>
          <option value="none">none</option>
          <option value="token">token</option>
          <option value="username_password">username_password</option>
        </select>
      </div>
      <div><input placeholder="TOKEN_ENV" value={form.token_env} onChange={(e) => setForm({ ...form, token_env: e.target.value })} /></div>
      <div><input placeholder="USERNAME_ENV" value={form.username_env} onChange={(e) => setForm({ ...form, username_env: e.target.value })} /></div>
      <div><input placeholder="PASSWORD_ENV" value={form.password_env} onChange={(e) => setForm({ ...form, password_env: e.target.value })} /></div>
      <div><textarea placeholder="2FA notes" value={form.two_fa_notes} onChange={(e) => setForm({ ...form, two_fa_notes: e.target.value })} /></div>
      <div><button onClick={save}>Save</button> <button onClick={() => { setCreating(false); setEditing(null); }}>Cancel</button></div>
    </div>}
  </div>;
}
