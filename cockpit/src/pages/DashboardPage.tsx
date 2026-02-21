import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { Task } from '../types';

const templates = [
  'EMAIL_DIGEST','EMAIL_SEND','INSTAGRAM_DM_TRIAGE','INSTAGRAM_COMMENT_MOD','INSTAGRAM_POST','WEBAPP_INSIGHTS','WEBAPP_SMOKE_TEST'
];

export function DashboardPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [type, setType] = useState('EMAIL_DIGEST');
  const [args, setArgs] = useState('{}');
  const refresh = () => api.listTasks().then((d) => setTasks(d.tasks));
  useEffect(() => { refresh(); const i = setInterval(refresh, 5000); return () => clearInterval(i); }, []);

  return <div style={{ padding: 12 }}>
    <h2>Tasks</h2>
    <div>
      <select value={type} onChange={(e) => setType(e.target.value)}>{templates.map((t) => <option key={t}>{t}</option>)}</select>
      <textarea value={args} onChange={(e) => setArgs(e.target.value)} rows={4} cols={50} />
      <button onClick={async () => { await api.createTask({ type, args: JSON.parse(args || '{}') }); refresh(); }}>Create</button>
    </div>
    <ul>{tasks.map((t) => <li key={t.id}><Link to={`/tasks/${t.id}`}>{t.type}</Link> - {t.status}</li>)}</ul>
  </div>;
}
