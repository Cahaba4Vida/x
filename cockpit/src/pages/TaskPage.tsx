import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, getToken } from '../api';
import { Task } from '../types';

export function TaskPage() {
  const { id = '' } = useParams();
  const [task, setTask] = useState<Task>();
  const [steps, setSteps] = useState<Array<Record<string, unknown>>>([]);
  const [artifacts, setArtifacts] = useState<Array<Record<string, unknown>>>([]);
  const [watchSrc, setWatchSrc] = useState('');
  const sinceIdRef = useRef(0);

  const loadTaskAndArtifacts = async () => {
    const loadedTask = await api.getTask(id);
    setTask(loadedTask);
    setArtifacts((await api.getArtifacts(id)).artifacts);
  };

  const loadStepsDelta = async () => {
    const delta = await api.getSteps(id, sinceIdRef.current, 200);
    if (!delta.steps.length) return;
    const maxId = delta.steps.reduce((m, l: any) => Math.max(m, Number(l.id || 0)), sinceIdRef.current);
    sinceIdRef.current = maxId;
    setSteps((prev) => [...prev, ...delta.steps].slice(-500));
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
    setSteps([]);
    loadTaskAndArtifacts();
    loadStepsDelta();
    loadWatch();

    const detailsPoll = setInterval(loadTaskAndArtifacts, 5000);
    const stepsPoll = setInterval(loadStepsDelta, 1500);
    const screenshotPoll = setInterval(loadWatch, 4000);

    return () => {
      clearInterval(detailsPoll);
      clearInterval(stepsPoll);
      clearInterval(screenshotPoll);
      setWatchSrc((old) => {
        if (old) URL.revokeObjectURL(old);
        return '';
      });
    };
  }, [id]);

  if (!task) return <div>Loading...</div>;

  return <div style={{ padding: 12 }}>
    <h2>{task.type} / {task.status}</h2>
    {task.type === 'WEBAPP_INSTRUCTION' && <p><b>Instruction:</b> {String(task.args.instructionText || '')}</p>}
    <pre>{JSON.stringify(task.result ?? task.error ?? task.args, null, 2)}</pre>

    <h3>Watch</h3>
    <div style={{ border: '1px solid #ddd', padding: 8, marginBottom: 12, minHeight: 140 }}>
      {watchSrc ? <img src={watchSrc} alt="latest watch screenshot" style={{ width: '100%', maxWidth: 480, borderRadius: 8 }} /> : <div>No live screenshot yet.</div>}
    </div>

    <h3>Approvals</h3>
    {(task.approvals || []).map((a: any) => <div key={a.id}><code>{a.reason}</code> {a.status}
      <button onClick={() => api.approveTask(id).then(loadTaskAndArtifacts)}>Approve</button>
      <button onClick={() => api.denyTask(id).then(loadTaskAndArtifacts)}>Deny</button>
    </div>)}

    <h3>Artifacts</h3>
    <pre>{JSON.stringify(artifacts, null, 2)}</pre>
    <h3>Steps (live)</h3>
    <pre>{JSON.stringify(steps, null, 2)}</pre>
  </div>;
}
