import { defaultPolicy } from './defaultPolicy';
import { State, Task } from './types';
import { query } from './db';

const defaultTools = {
  gmail_tool: true,
  instagram_tool: true,
  playwright_tool: true,
  netlify_app_insights_tool: true
};

const initialState = (): State => ({
  tasks: [], logs: [], artifacts: [], policy: defaultPolicy, tools: defaultTools, emailDigest: {}, apps: []
});

function toTask(row: any): Task {
  const lease = row.lease_token ? {
    runnerId: row.lease_runner_id,
    token: row.lease_token,
    expiresAt: new Date(row.lease_expires_at).toISOString()
  } : undefined;
  return {
    id: row.id,
    type: row.type,
    args: row.args || {},
    status: row.status,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    lease,
    pendingActions: row.pending_actions || [],
    result: row.result ?? undefined,
    error: row.error ?? undefined
  };
}

export async function loadState(): Promise<State> {
  const state = initialState();

  const tasksRes = await query('select * from tasks order by created_at desc');
  state.tasks = tasksRes.rows.map(toTask);

  const kvRes = await query('select key, value from app_state where key = any($1)', [['policy', 'tools', 'emailDigest', 'apps']]);
  for (const row of kvRes.rows as Array<{ key: string; value: any }>) {
    if (row.key === 'policy') state.policy = row.value;
    if (row.key === 'tools') state.tools = row.value;
    if (row.key === 'emailDigest') state.emailDigest = row.value;
    if (row.key === 'apps') state.apps = row.value;
  }

  return state;
}

export async function saveState(state: State): Promise<void> {
  await query('begin');
  try {
    await query('delete from tasks');
    for (const t of state.tasks) {
      await query(
        `insert into tasks(id,type,args,status,created_at,updated_at,lease_runner_id,lease_token,lease_expires_at,pending_actions,result,error)
         values($1,$2,$3::jsonb,$4,$5::timestamptz,$6::timestamptz,$7,$8,$9::timestamptz,$10::jsonb,$11::jsonb,$12)`,
        [
          t.id,
          t.type,
          JSON.stringify(t.args || {}),
          t.status,
          t.createdAt,
          t.updatedAt,
          t.lease?.runnerId || null,
          t.lease?.token || null,
          t.lease?.expiresAt || null,
          JSON.stringify(t.pendingActions || []),
          t.result === undefined ? null : JSON.stringify(t.result),
          t.error || null
        ]
      );
    }

    await query(`insert into app_state(key, value) values ('policy',$1::jsonb)
      on conflict (key) do update set value=excluded.value`, [JSON.stringify(state.policy || {})]);
    await query(`insert into app_state(key, value) values ('tools',$1::jsonb)
      on conflict (key) do update set value=excluded.value`, [JSON.stringify(state.tools || defaultTools)]);
    await query(`insert into app_state(key, value) values ('emailDigest',$1::jsonb)
      on conflict (key) do update set value=excluded.value`, [JSON.stringify(state.emailDigest || {})]);
    await query(`insert into app_state(key, value) values ('apps',$1::jsonb)
      on conflict (key) do update set value=excluded.value`, [JSON.stringify(state.apps || [])]);

    await query('commit');
  } catch (err) {
    await query('rollback');
    throw err;
  }
}
