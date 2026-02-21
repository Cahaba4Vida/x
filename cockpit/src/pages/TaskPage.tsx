import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, getToken } from '../api';
import { Task } from '../types';

export function TaskPage() {
  const { id = '' } = useParams();
  const [task, setTask] = useState<Task>();
  const [logs, setLogs] = useState<Array<Record<string, unknown>>>([]);
  const [artifacts, setArtifacts] = useState<Array<Record<string, unknown>>>([]);
  const [watchSrc, setWatchSrc] = useState('');
  const sinceIdRef = useRef(0);

  const loadTaskAndArtifacts = async () => {
    setTask(await api.getTask(id));
    setArtifacts((await api.getArtifacts(id)).artifacts);
  };

  const loadLogsDelta = async () => {
    const delta = await api.getLogs(id, sinceIdRef.current, 200);
    if (!delta.logs.length) return;
    const maxId = delta.logs.reduce((m, l) => Math.max(m, Number(l.id || 0)), sinceIdRef.current);
    sinceIdRef.current = maxId;
    setLogs((prev) => [...prev, ...delta.logs].slice(-500));
  };

  const loadWatch = async () => {
    try {
      const res = await fetch(`/api/watch/latest_screenshot?taskId=${encodeURIComponent(id)}`, {
        headers: { Authorization: `Bearer ${getToken()}` }
      });
      if (!res.ok) return;
      const blob = await res.blob();
      const next = URL.createObjectURL(blob);
      setWatchSrc((old) => {
        if (old) URL.revokeObjectURL(old);
        return next;
      });
    } catch {
      // noop
    }
  };

  useEffect(() => {
    sinceIdRef.current = 0;
    setLogs([]);
    loadTaskAndArtifacts();
    loadLogsDelta();
    loadWatch();

    const detailsPoll = setInterval(loadTaskAndArtifacts, 5000);
    const logsPoll = setInterval(loadLogsDelta, 1500);
    const screenshotPoll = setInterval(loadWatch, 4000);

    return () => {
      clearInterval(detailsPoll);
      clearInterval(logsPoll);
      clearInterval(screenshotPoll);
      setWatchSrc((old) => {
        if (old) URL.revokeObjectURL(old);
        return '';
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (!task) return <div>Loading...</div>;

  return <div style={{ padding: 12 }}>
    <h2>{task.type} / {task.status}</h2>
    {task.status === 'NEEDS_MANUAL' && <p><b>Manual takeover required:</b> open Instagram in the runner's non-headless browser, complete challenge, then approve RESUME_AFTER_MANUAL.</p>}
    <pre>{JSON.stringify(task.result ?? task.error ?? task.args, null, 2)}</pre>

    <h3>Watch</h3>
    <div style={{ border: '1px solid #ddd', padding: 8, marginBottom: 12, minHeight: 140 }}>
      {watchSrc ? <img src={watchSrc} alt="latest watch screenshot" style={{ width: '100%', maxWidth: 480, borderRadius: 8 }} /> : <div>No live screenshot yet.</div>}
    </div>

    <h3>Pending Actions</h3>
    {task.pendingActions.map((a) => <div key={a.id}><code>{a.type}</code> {a.status}
      <button onClick={() => api.approve(id, a.id).then(loadTaskAndArtifacts)}>Approve</button>
      <button onClick={() => api.deny(id, a.id).then(loadTaskAndArtifacts)}>Deny</button>
    </div>)}
    <h3>Artifacts</h3>
    <pre>{JSON.stringify(artifacts, null, 2)}</pre>
    <h3>Logs (live)</h3>
    <pre>{JSON.stringify(logs, null, 2)}</pre>
  </div>;
}
