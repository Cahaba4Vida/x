import process from 'node:process';

const LOCAL_RUNTIME_URL = (process.env.LOCAL_RUNTIME_URL || 'http://127.0.0.1:3002').replace(/\/$/, '');
const LOCAL_RUNTIME_SECRET = process.env.LOCAL_RUNTIME_SECRET || '';

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', async () => {
  try {
    const envelope = input ? JSON.parse(input) : {};
    const task = envelope.task || envelope;
    const headers = {
      'Content-Type': 'application/json',
      ...(LOCAL_RUNTIME_SECRET ? { 'X-Runtime-Secret': LOCAL_RUNTIME_SECRET } : {})
    };

    const isResume = !!task.resume_approval?.approval_id;
    const url = isResume
      ? `${LOCAL_RUNTIME_URL}/v1/approvals/${task.resume_approval.approval_id}/resume`
      : `${LOCAL_RUNTIME_URL}/v1/tasks/execute`;
    const body = isResume
      ? {
          decision: task.resume_approval.decision === 'denied' ? 'deny' : 'approve',
          approved_by: task.resume_approval.decided_by || 'operator',
          resume_payload: null
        }
      : {
          task_id: task.id,
          run_id: task.run_id,
          bot_id: task.bot_id,
          session_id: task.session_id,
          agent_id: task.agent_id,
          type: task.task_type || task.type,
          action: task.action,
          payload: task.payload,
          approval_policy: task.approval_policy,
          priority: task.priority,
          created_at: task.created_at,
          title: task.title,
          prompt: task.prompt
        };

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    });

    const raw = await response.text();
    const runtimeResult = raw ? JSON.parse(raw) : {};
    if (!response.ok && runtimeResult?.status !== 'failed') {
      throw new Error(runtimeResult?.error?.message || raw || `Runtime bridge returned ${response.status}`);
    }

    process.stdout.write(JSON.stringify({
      status: runtimeResult.status === 'approval_pending' ? 'awaiting_approval' : (runtimeResult.status || 'failed'),
      output: runtimeResult.result ? JSON.stringify(runtimeResult.result) : '',
      errorMessage: runtimeResult.error?.message || '',
      usage: {
        llm_cost_usd: Number(runtimeResult.usage?.llm_cost_usd || 0),
        browser_seconds: Number(runtimeResult.usage?.browser_seconds || 0),
        desktop_seconds: Number(runtimeResult.usage?.desktop_seconds || 0),
        screenshots: Number(runtimeResult.usage?.screenshots || 0),
        retries: Number(runtimeResult.usage?.retries || 0)
      },
      approval: runtimeResult.result?.approval || null,
      result: runtimeResult.result || {},
      artifacts: runtimeResult.artifacts || [],
      logs: runtimeResult.logs || [],
      raw: runtimeResult
    }));
  } catch (error) {
    process.stderr.write(error.stack || error.message || String(error));
    process.exit(1);
  }
});
