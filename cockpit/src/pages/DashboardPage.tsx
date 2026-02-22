import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { AppConfig, Task } from '../types';

const templates = [
  'EMAIL_DIGEST','EMAIL_SEND','INSTAGRAM_DM_TRIAGE','INSTAGRAM_COMMENT_MOD','INSTAGRAM_POST','WEBAPP_INSIGHTS','WEBAPP_SMOKE_TEST','WEBAPP_INSTRUCTION'
];

export function DashboardPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [apps, setApps] = useState<AppConfig[]>([]);
  const [type, setType] = useState('EMAIL_DIGEST');
  const [args, setArgs] = useState('{}');
  const [instructionText, setInstructionText] = useState('');
  const [appId, setAppId] = useState('');
  const refresh = () => api.listTasks().then((d) => setTasks(d.tasks));
  useEffect(() => { refresh(); const i = setInterval(refresh, 5000); api.getApps().then((r) => { setApps(r.apps); if (!appId && r.apps[0]) setAppId(r.apps[0].id); }); return () => clearInterval(i); }, []);

  const createTask = async () => {
    if (type === 'WEBAPP_INSTRUCTION') {
      await api.createTask({ type, args: { appId, instructionText } });
    } else {
      await api.createTask({ type, args: JSON.parse(args || '{}') });
    }
    refresh();
  };

  return <div style={{ padding: 12 }}>
    <h2>Tasks</h2>
    <div>
      <select value={type} onChange={(e) => setType(e.target.value)}>{templates.map((t) => <option key={t}>{t}</option>)}</select>
      {type === 'WEBAPP_INSTRUCTION' ? <>
        <select value={appId} onChange={(e) => setAppId(e.target.value)}>{apps.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
        <textarea value={instructionText} onChange={(e) => setInstructionText(e.target.value)} rows={4} cols={50} placeholder="Natural language instruction" />
      </> : <textarea value={args} onChange={(e) => setArgs(e.target.value)} rows={4} cols={50} />}
      <button onClick={createTask}>Create</button>
    </div>
    <ul>{tasks.map((t) => <li key={t.id}><Link to={`/tasks/${t.id}`}>{t.type}</Link> - {t.status}</li>)}</ul>
  </div>;
}
