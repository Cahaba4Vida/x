import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api';
import { Task } from '../types';

export function TaskPage() {
  const { id = '' } = useParams();
  const [task, setTask] = useState<Task>();
  const [logs, setLogs] = useState<Array<Record<string, unknown>>>([]);
  const [artifacts, setArtifacts] = useState<Array<Record<string, unknown>>>([]);
  const load = async () => {
    setTask(await api.getTask(id));
    setLogs((await api.getLogs(id)).logs);
    setArtifacts((await api.getArtifacts(id)).artifacts);
  };

  useEffect(() => {
    load();
    const i = setInterval(load, 5000);
    return () => clearInterval(i);
  }, [id]);

  if (!task) return <div>Loading...</div>;

  return <div style={{ padding: 12 }}>
    <h2>{task.type} / {task.status}</h2>
    {task.status === 'NEEDS_MANUAL' && <p><b>Manual takeover required:</b> open Instagram in the runner's non-headless browser, complete challenge, then approve RESUME_AFTER_MANUAL.</p>}
    <pre>{JSON.stringify(task.result ?? task.error ?? task.args, null, 2)}</pre>
    <h3>Pending Actions</h3>
    {task.pendingActions.map((a) => <div key={a.id}><code>{a.type}</code> {a.status}
      <button onClick={() => api.approve(id, a.id).then(load)}>Approve</button>
      <button onClick={() => api.deny(id, a.id).then(load)}>Deny</button>
    </div>)}
    <h3>Artifacts</h3>
    <pre>{JSON.stringify(artifacts, null, 2)}</pre>
    <h3>Logs</h3>
    <pre>{JSON.stringify(logs, null, 2)}</pre>
  </div>;
}
