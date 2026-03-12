import { FormEvent, useEffect, useMemo, useState } from 'react';
import { apiGet, apiPost } from './lib/api';
import { Section } from './components/Section';
import { StatCard } from './components/StatCard';

type Session = {
  user: { id: string; email: string; full_name: string | null };
  organization: { id: string; name: string };
  membership: { role: string };
};

type Task = {
  id: string;
  title: string;
  prompt: string;
  task_type?: string;
  action?: string;
  approval_policy?: string;
  status: string;
  estimated_units: number | null;
  actual_units: number | null;
  created_at: string;
  completed_at: string | null;
  cancellation_requested_at?: string | null;
  cancellation_reason?: string | null;
  created_by_email?: string;
  bot_name?: string | null;
};

type TaskEvent = {
  id: number;
  event_type: string;
  payload: Record<string, unknown>;
  created_at: string;
};

type TaskArtifact = {
  id: string;
  artifact_type: string;
  name: string | null;
  storage_url: string;
  created_at: string;
};

type Approval = {
  id: string;
  requested_action: string;
  requested_action_json?: Record<string, unknown>;
  reason?: string | null;
  status: string;
  decided_by_user_id?: string | null;
  decided_at?: string | null;
  created_at: string;
};

type TaskDetail = {
  task: Task & {
    payload?: Record<string, unknown> | null;
    output_text?: string | null;
    error_message?: string | null;
    usage_json?: Record<string, unknown> | null;
    runtime_result?: Record<string, unknown> | null;
  };
  events: TaskEvent[];
  artifacts: TaskArtifact[];
  approvals: Approval[];
};

type Bot = {
  id: string;
  name: string;
  status: string;
  last_heartbeat_at: string | null;
};

type Invite = { token: string; expires_at: string };

type UsageSummary = {
  month_units: number;
  month_task_count: number;
  stripe_connected: boolean;
  subscription_status: string | null;
};

const initialAuth = {
  email: '',
  password: '',
  full_name: '',
  organization_name: '',
  invite_token: ''
};

const initialTaskDraft = {
  title: '',
  prompt: '',
  action: 'composed',
  approval_policy: 'ask',
  payloadText: '{\n  "steps": []\n}',
  session_id: 'agent:main:main',
  agent_id: 'main'
};

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [selectedTask, setSelectedTask] = useState<TaskDetail | null>(null);
  const [bots, setBots] = useState<Bot[]>([]);
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [auth, setAuth] = useState(initialAuth);
  const [taskDraft, setTaskDraft] = useState(initialTaskDraft);
  const [botName, setBotName] = useState('Main Bot');
  const [inviteEmail, setInviteEmail] = useState('');
  const [invite, setInvite] = useState<Invite | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);

  const canManage = useMemo(() => session?.membership.role === 'owner' || session?.membership.role === 'admin', [session]);

  async function loadDashboard() {
    const [me, taskData, botData, usageData] = await Promise.all([
      apiGet<Session>('/api/auth-me'),
      apiGet<{ tasks: Task[] }>('/api/tasks-list'),
      apiGet<{ bots: Bot[] }>('/api/bots-list'),
      apiGet<UsageSummary>('/api/usage-summary')
    ]);
    setSession(me);
    setTasks(taskData.tasks);
    setBots(botData.bots);
    setUsage(usageData);
    if (!selectedTaskId && taskData.tasks.length > 0) setSelectedTaskId(taskData.tasks[0].id);
  }

  async function loadTaskDetail(taskId: string) {
    setDetailLoading(true);
    try {
      const detail = await apiGet<TaskDetail>(`/api/tasks-get?id=${encodeURIComponent(taskId)}`);
      setSelectedTask(detail);
    } finally {
      setDetailLoading(false);
    }
  }

  useEffect(() => {
    (async () => {
      try {
        await loadDashboard();
      } catch {
        setSession(null);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (selectedTaskId && session) {
      loadTaskDetail(selectedTaskId).catch((err) => setError((err as Error).message));
    } else {
      setSelectedTask(null);
    }
  }, [selectedTaskId, session]);

  async function refreshAll(taskId?: string | null) {
    await loadDashboard();
    const nextId = taskId ?? selectedTaskId;
    if (nextId) await loadTaskDetail(nextId);
  }

  async function handleSignup(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    try {
      await apiPost('/api/auth-signup', auth);
      await loadDashboard();
      setMessage('Account created.');
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleLogin(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    try {
      await apiPost('/api/auth-login', { email: auth.email, password: auth.password });
      await loadDashboard();
      setMessage('Signed in.');
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleLogout() {
    await apiPost('/api/auth-logout');
    setSession(null);
    setTasks([]);
    setBots([]);
    setUsage(null);
    setSelectedTask(null);
    setSelectedTaskId(null);
    setMessage('Signed out.');
  }

  async function handleCreateTask(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    try {
      JSON.parse(taskDraft.payloadText || '{}');
      const result = await apiPost<{ id: string }>('/api/tasks-create', {
        title: taskDraft.title,
        prompt: taskDraft.prompt,
        action: taskDraft.action,
        task_type: 'browser.workflow',
        approval_policy: taskDraft.approval_policy,
        payload: taskDraft.payloadText,
        session_id: taskDraft.session_id,
        agent_id: taskDraft.agent_id
      });
      setTaskDraft(initialTaskDraft);
      setSelectedTaskId(result.id);
      await refreshAll(result.id);
      setMessage('Task queued.');
    } catch (err) {
      setError((err as Error).message || 'Payload must be valid JSON.');
    }
  }

  async function handleCreateBot(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await apiPost('/api/bots-create', { name: botName });
      setBotName('Main Bot');
      await loadDashboard();
      setMessage('Bot created. Set BOT_ID in your local worker to this bot id.');
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleCreateInvite(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const result = await apiPost<Invite>('/api/invites-create', { email: inviteEmail });
      setInvite(result);
      setInviteEmail('');
      setMessage('Invite created. Share the token with the teammate.');
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleCheckout() {
    const result = await apiPost<{ url: string }>('/api/billing-checkout');
    window.location.href = result.url;
  }

  async function handleBillingPortal() {
    const result = await apiPost<{ url: string }>('/api/billing-portal');
    window.location.href = result.url;
  }

  async function handleCancelTask(taskId: string) {
    setError(null);
    setMessage(null);
    try {
      await apiPost('/api/tasks-cancel', { task_id: taskId });
      await refreshAll(taskId);
      setMessage('Task cancellation requested.');
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleApprovalDecision(approvalId: string, decision: 'approved' | 'denied') {
    setError(null);
    setMessage(null);
    try {
      await apiPost('/api/tasks-approve', { approval_id: approvalId, decision });
      await refreshAll(selectedTaskId);
      setMessage(`Approval ${decision}. Worker will resume on next poll.`);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  if (loading) return <div className="app-shell"><div className="panel">Loading…</div></div>;

  if (!session) {
    return (
      <div className="app-shell auth-shell">
        <header className="hero">
          <h1>OpenClaw Control Plane</h1>
          <p>Netlify UI + Neon queue + Stripe billing + a nonstop local worker.</p>
        </header>

        {error ? <div className="banner error">{error}</div> : null}
        {message ? <div className="banner success">{message}</div> : null}

        <div className="auth-grid">
          <Section title="Create account">
            <form className="stack" onSubmit={handleSignup}>
              <input placeholder="Full name" value={auth.full_name} onChange={(e) => setAuth({ ...auth, full_name: e.target.value })} />
              <input placeholder="Email" type="email" value={auth.email} onChange={(e) => setAuth({ ...auth, email: e.target.value })} />
              <input placeholder="Password" type="password" value={auth.password} onChange={(e) => setAuth({ ...auth, password: e.target.value })} />
              <input placeholder="Organization name (blank if using invite)" value={auth.organization_name} onChange={(e) => setAuth({ ...auth, organization_name: e.target.value })} />
              <input placeholder="Invite token (optional)" value={auth.invite_token} onChange={(e) => setAuth({ ...auth, invite_token: e.target.value })} />
              <button type="submit">Create account</button>
            </form>
          </Section>
          <Section title="Sign in">
            <form className="stack" onSubmit={handleLogin}>
              <input placeholder="Email" type="email" value={auth.email} onChange={(e) => setAuth({ ...auth, email: e.target.value })} />
              <input placeholder="Password" type="password" value={auth.password} onChange={(e) => setAuth({ ...auth, password: e.target.value })} />
              <button type="submit">Sign in</button>
            </form>
          </Section>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <h1>{session.organization.name}</h1>
          <p>{session.user.email} · {session.membership.role}</p>
        </div>
        <div className="row gap-sm">
          <button className="secondary" onClick={handleCheckout}>Start billing</button>
          <button className="secondary" onClick={handleBillingPortal}>Billing portal</button>
          <button className="secondary" onClick={handleLogout}>Sign out</button>
        </div>
      </header>

      {error ? <div className="banner error">{error}</div> : null}
      {message ? <div className="banner success">{message}</div> : null}

      <div className="stats-grid">
        <StatCard label="Tasks this month" value={String(usage?.month_task_count ?? 0)} />
        <StatCard label="Billable units this month" value={(usage?.month_units ?? 0).toFixed(2)} />
        <StatCard label="Stripe" value={usage?.stripe_connected ? 'Connected' : 'Not connected'} detail={usage?.subscription_status ?? 'No active subscription'} />
      </div>

      <div className="content-grid">
        <Section title="Queue a task">
          <form className="stack" onSubmit={handleCreateTask}>
            <input placeholder="Task title" value={taskDraft.title} onChange={(e) => setTaskDraft({ ...taskDraft, title: e.target.value })} />
            <textarea placeholder="Human-readable note" rows={4} value={taskDraft.prompt} onChange={(e) => setTaskDraft({ ...taskDraft, prompt: e.target.value })} />
            <div className="row gap-sm">
              <select value={taskDraft.action} onChange={(e) => setTaskDraft({ ...taskDraft, action: e.target.value })}>
                <option value="goto">goto</option>
                <option value="click">click</option>
                <option value="type">type</option>
                <option value="extract">extract</option>
                <option value="screenshot">screenshot</option>
                <option value="composed">composed</option>
              </select>
              <select value={taskDraft.approval_policy} onChange={(e) => setTaskDraft({ ...taskDraft, approval_policy: e.target.value })}>
                <option value="auto">auto</option>
                <option value="ask">ask</option>
                <option value="required">required</option>
              </select>
            </div>
            <textarea placeholder="Structured payload JSON" rows={12} value={taskDraft.payloadText} onChange={(e) => setTaskDraft({ ...taskDraft, payloadText: e.target.value })} />
            <div className="row gap-sm">
              <input placeholder="Session id" value={taskDraft.session_id} onChange={(e) => setTaskDraft({ ...taskDraft, session_id: e.target.value })} />
              <input placeholder="Agent id" value={taskDraft.agent_id} onChange={(e) => setTaskDraft({ ...taskDraft, agent_id: e.target.value })} />
            </div>
            <button type="submit">Queue task</button>
          </form>
        </Section>

        <Section title="Bots">
          <div className="stack">
            {bots.map((bot) => (
              <div className="list-item" key={bot.id}>
                <div>
                  <strong>{bot.name}</strong>
                  <div className="subtle">{bot.id}</div>
                </div>
                <div>
                  <div>{bot.status}</div>
                  <div className="subtle">{bot.last_heartbeat_at ? new Date(bot.last_heartbeat_at).toLocaleString() : 'Never seen'}</div>
                </div>
              </div>
            ))}
            {canManage ? (
              <form className="row" onSubmit={handleCreateBot}>
                <input placeholder="New bot name" value={botName} onChange={(e) => setBotName(e.target.value)} />
                <button type="submit">Create bot</button>
              </form>
            ) : null}
          </div>
        </Section>
      </div>

      <div className="content-grid">
        <Section title="Task queue">
          <div className="stack">
            {tasks.map((task) => {
              const cancelPending = Boolean(task.cancellation_requested_at) && task.status !== 'cancelled';
              return (
                <div className="list-item vertical" key={task.id}>
                  <div className="row between">
                    <button className="secondary" onClick={() => setSelectedTaskId(task.id)}>{task.title}</button>
                    <span className={`pill pill-${task.status}`}>{task.status}</span>
                  </div>
                  <div className="subtle">{task.prompt}</div>
                  <div className="row between subtle">
                    <span>{task.action ?? 'composed'} · {task.approval_policy ?? 'ask'}</span>
                    <span>{task.bot_name ?? 'Unassigned bot'}</span>
                    <span>{new Date(task.created_at).toLocaleString()}</span>
                  </div>
                  <div className="row between subtle">
                    <span>Est. {Number(task.estimated_units ?? 0).toFixed(2)} units</span>
                    <span>Actual {Number(task.actual_units ?? 0).toFixed(2)} units</span>
                    <span>{cancelPending ? `Cancel requested${task.cancellation_reason ? `: ${task.cancellation_reason}` : ''}` : ''}</span>
                  </div>
                  {(task.status === 'queued' || task.status === 'running' || task.status === 'awaiting_approval') && !cancelPending ? (
                    <div className="row">
                      <button className="secondary" onClick={() => handleCancelTask(task.id)}>Cancel task</button>
                    </div>
                  ) : null}
                </div>
              );
            })}
            {tasks.length === 0 ? <div className="subtle">No tasks yet.</div> : null}
          </div>
        </Section>

        <Section title={selectedTask ? `Task detail · ${selectedTask.task.title}` : 'Task detail'}>
          {detailLoading ? <div className="subtle">Loading task detail…</div> : null}
          {!detailLoading && !selectedTask ? <div className="subtle">Select a task to inspect events and artifacts.</div> : null}
          {selectedTask ? (
            <div className="stack">
              <div className="callout">
                <div className="row between">
                  <strong>Status</strong>
                  <span className={`pill pill-${selectedTask.task.status}`}>{selectedTask.task.status}</span>
                </div>
                <div className="subtle">{selectedTask.task.prompt}</div>
                <div className="subtle">Action: {selectedTask.task.action} · Approval: {selectedTask.task.approval_policy}</div>
                <div className="subtle">Created by {selectedTask.task.created_by_email ?? 'Unknown'} · {selectedTask.task.bot_name ?? 'No bot assigned yet'}</div>
                {selectedTask.task.output_text ? <code>{selectedTask.task.output_text}</code> : null}
                {selectedTask.task.error_message ? <code>{selectedTask.task.error_message}</code> : null}
                {selectedTask.task.runtime_result ? <code>{JSON.stringify(selectedTask.task.runtime_result, null, 2)}</code> : null}
              </div>

              <div className="stack">
                <strong>Approvals</strong>
                {selectedTask.approvals.length === 0 ? <div className="subtle">No approval requests for this task.</div> : null}
                {selectedTask.approvals.map((approval) => (
                  <div className="list-item vertical" key={approval.id}>
                    <div className="row between">
                      <strong>{approval.status}</strong>
                      <span className="subtle">{new Date(approval.created_at).toLocaleString()}</span>
                    </div>
                    <div className="subtle">{approval.reason || 'No reason supplied.'}</div>
                    <code>{JSON.stringify(approval.requested_action_json || approval.requested_action, null, 2)}</code>
                    {approval.status === 'pending' ? (
                      <div className="row gap-sm">
                        <button onClick={() => handleApprovalDecision(approval.id, 'approved')}>Approve</button>
                        <button className="secondary" onClick={() => handleApprovalDecision(approval.id, 'denied')}>Deny</button>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>

              <div className="stack">
                <strong>Event timeline</strong>
                {selectedTask.events.length === 0 ? <div className="subtle">No events yet.</div> : null}
                {selectedTask.events.map((event) => (
                  <div className="list-item vertical" key={event.id}>
                    <div className="row between">
                      <strong>{event.event_type}</strong>
                      <span className="subtle">{new Date(event.created_at).toLocaleString()}</span>
                    </div>
                    <code>{JSON.stringify(event.payload, null, 2)}</code>
                  </div>
                ))}
              </div>

              <div className="stack">
                <strong>Artifacts</strong>
                {selectedTask.artifacts.length === 0 ? <div className="subtle">No artifacts uploaded for this task yet.</div> : null}
                {selectedTask.artifacts.map((artifact) => (
                  <div className="list-item" key={artifact.id}>
                    <div>
                      <strong>{artifact.name || artifact.artifact_type}</strong>
                      <div className="subtle">{new Date(artifact.created_at).toLocaleString()}</div>
                    </div>
                    <a href={artifact.storage_url} target="_blank" rel="noreferrer">Open</a>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </Section>
      </div>

      {canManage ? (
        <div className="content-grid">
          <Section title="Invite teammate">
            <form className="stack" onSubmit={handleCreateInvite}>
              <input type="email" placeholder="Teammate email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} />
              <button type="submit">Create invite</button>
            </form>
            {invite ? (
              <div className="callout">
                <strong>Invite token</strong>
                <code>{invite.token}</code>
                <div className="subtle">Expires {new Date(invite.expires_at).toLocaleString()}</div>
              </div>
            ) : null}
          </Section>

          <Section title="Worker setup">
            <div className="callout">
              <strong>Local runtime starter</strong>
              <code>{`SITE_URL=${window.location.origin}\nWORKER_SHARED_SECRET=...\nBOT_ID=${bots[0]?.id ?? 'replace-with-bot-id'}\nEXECUTOR_MODE=command\nLOCAL_RUNTIME_URL=http://127.0.0.1:3002\nLOCAL_RUNTIME_SECRET=...\nOPENCLAW_COMMAND="node worker/runtime-bridge-executor.mjs"\nnpm run worker`}</code>
            </div>
          </Section>
        </div>
      ) : null}
    </div>
  );
}
