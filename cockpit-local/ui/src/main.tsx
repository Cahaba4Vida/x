import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';

type AppRow = { id: string; name: string; baseUrl: string; auth: any };

type TaskRow = { id: string; app_id: string; instruction_text: string; status: string; error?: string; summary?: string };

async function j(path: string, init?: RequestInit) {
  const res = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) }
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

function AppsPanel({ refresh }: { refresh: () => void }) {
  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('https://zinvestz.netlify.app');
  const [authType, setAuthType] = useState('token');
  const [tokenEnv, setTokenEnv] = useState('ZINVESTZ_ADMIN_TOKEN');
  const [twoFaNotes, setTwoFaNotes] = useState('');

  return <section>
    <h2>Apps</h2>
    <div style={{ display: 'grid', gap: 8, maxWidth: 520 }}>
      <input placeholder="App name" value={name} onChange={(e) => setName(e.target.value)} />
      <input placeholder="Base URL" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
      <select value={authType} onChange={(e) => setAuthType(e.target.value)}>
        <option value="none">none</option>
        <option value="token">token</option>
        <option value="username_password">username/password</option>
      </select>
      {authType === 'token' && <input placeholder="token env var" value={tokenEnv} onChange={(e) => setTokenEnv(e.target.value)} />}
      <input placeholder="2FA notes (optional)" value={twoFaNotes} onChange={(e) => setTwoFaNotes(e.target.value)} />
      <button onClick={async () => {
        await j('/api/apps', { method: 'POST', body: JSON.stringify({ name, baseUrl, auth: { authType, tokenEnv, twoFaNotes } }) });
        setName('');
        refresh();
      }}>Add App</button>
    </div>
  </section>;
}

function TaskCreator({ apps, refresh }: { apps: AppRow[]; refresh: () => void }) {
  const [appId, setAppId] = useState('');
  const [instructionText, setInstructionText] = useState('Open the app. If prompted for admin token, enter the token and submit. Then scroll to Add Position. Add positions:\n- AAPL shares 10 avg cost 150\n- TSLA shares 2 avg cost 180\nClick Add Position for each. Then refresh the page and confirm both positions are still present in the portfolio list/table. If successful, finish.');

  useEffect(() => {
    if (!appId && apps[0]) setAppId(apps[0].id);
  }, [apps, appId]);

  return <section>
    <h2>Task Creator</h2>
    <div style={{ display: 'grid', gap: 8 }}>
      <select value={appId} onChange={(e) => setAppId(e.target.value)}>
        {apps.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
      </select>
      <textarea rows={8} value={instructionText} onChange={(e) => setInstructionText(e.target.value)} />
      <button disabled={!appId} onClick={async () => {
        await j('/api/tasks', { method: 'POST', body: JSON.stringify({ appId, instructionText }) });
        refresh();
      }}>Create Task</button>
    </div>
  </section>;
}

function TaskDetail({ taskId }: { taskId: string }) {
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    const tick = async () => {
      try {
        setData(await j(`/api/tasks/${taskId}`));
      } catch {
      }
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [taskId]);

  if (!data) return <div>Loading task...</div>;

  return <section>
    <h2>Task Detail</h2>
    <p>Status: <b>{data.task.status}</b></p>
    {data.task.error && <p style={{ color: 'red' }}>{data.task.error}</p>}
    {data.task.summary && <p>{data.task.summary}</p>}
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
      <div>
        <h3>Live logs</h3>
        <div style={{ maxHeight: 280, overflow: 'auto', border: '1px solid #ddd', padding: 8 }}>
          {data.steps.map((s: any) => <div key={s.id}>{s.step_index}. [{s.kind}] {s.message}</div>)}
        </div>
      </div>
      <div>
        <h3>Latest screenshot</h3>
        <img style={{ width: '100%', border: '1px solid #ddd' }} src={`/api/tasks/${taskId}/screenshot?ts=${Date.now()}`} />
      </div>
    </div>
    <div>
      <h3>Approvals</h3>
      {data.approvals.map((a: any) => <div key={a.id} style={{ border: '1px solid #ddd', marginBottom: 8, padding: 8 }}>
        <div>{a.reason}</div>
        <div>Status: {a.status}</div>
      </div>)}
      <button onClick={async () => { await j(`/api/tasks/${taskId}/approve`, { method: 'POST' }); }}>Approve pending</button>
      <button onClick={async () => { await j(`/api/tasks/${taskId}/cancel`, { method: 'POST' }); }}>Cancel task</button>
    </div>
  </section>;
}

function App() {
  const [apps, setApps] = useState<AppRow[]>([]);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [selectedTask, setSelectedTask] = useState('');

  const refresh = async () => {
    const a = await j('/api/apps');
    const t = await j('/api/tasks');
    setApps(a.apps);
    setTasks(t.tasks);
    if (!selectedTask && t.tasks[0]) setSelectedTask(t.tasks[0].id);
  };

  useEffect(() => { refresh(); }, []);
  useEffect(() => {
    const t = setInterval(refresh, 1000);
    return () => clearInterval(t);
  });

  return <main style={{ fontFamily: 'sans-serif', padding: 16, display: 'grid', gap: 20 }}>
    <h1>Cockpit Local</h1>
    <AppsPanel refresh={refresh} />
    <TaskCreator apps={apps} refresh={refresh} />

    <section>
      <h2>Tasks</h2>
      <div style={{ display: 'grid', gap: 6 }}>
        {tasks.map((t) => <button key={t.id} onClick={() => setSelectedTask(t.id)} style={{ textAlign: 'left' }}>{t.id.slice(0, 8)} - {t.status}</button>)}
      </div>
    </section>

    {selectedTask && <TaskDetail taskId={selectedTask} />}
  </main>;
}

ReactDOM.createRoot(document.getElementById('root')!).render(<App />);
