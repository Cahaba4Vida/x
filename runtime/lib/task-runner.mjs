import { z } from 'zod';
import { buildError, getDomainFromUrl, isAuthLikeUrl, isStateChangingAction, normalizeTask, nowIso } from './utils.mjs';

const taskSchema = z.object({
  task_id: z.string().min(1),
  run_id: z.string().min(1),
  bot_id: z.string().min(1),
  session_id: z.string().min(1),
  agent_id: z.string().min(1),
  type: z.string().min(1).default('browser.workflow'),
  action: z.enum(['goto', 'click', 'type', 'extract', 'screenshot', 'composed']),
  payload: z.record(z.string(), z.any()).default({}),
  approval_policy: z.enum(['auto', 'ask', 'required']).default('ask'),
  priority: z.number().default(100),
  created_at: z.string().default(nowIso),
  title: z.string().nullable().optional(),
  prompt: z.string().nullable().optional(),
  resume_approval: z.any().nullable().optional()
});

function baseRun(task) {
  return {
    task_id: task.task_id,
    run_id: task.run_id,
    bot_id: task.bot_id,
    session_id: task.session_id,
    agent_id: task.agent_id,
    status: 'running',
    action: task.action,
    payload: task.payload,
    result: {},
    artifacts: [],
    logs: [],
    usage: {
      browser_actions: 0,
      browser_seconds: 0,
      screenshots: 0,
      approvals_requested: 0,
      llm_cost_usd: 0,
      desktop_seconds: 0,
      retries: 0
    },
    error: null,
    started_at: nowIso(),
    finished_at: null,
    completed_steps: 0,
    next_step_index: 0,
    pending_action: null,
    last_url: null
  };
}

export class TaskRunner {
  constructor({ stateStore, approvalStore, artifactStore, browserApi }) {
    this.stateStore = stateStore;
    this.approvalStore = approvalStore;
    this.artifactStore = artifactStore;
    this.browserApi = browserApi;
  }

  log(run, level, message, extra = {}) {
    run.logs.push({ ts: nowIso(), level, source: 'runtime', message, ...extra });
  }

  async currentDomain(run) {
    const url = run.last_url || (await this.browserApi.state(run.bot_id).catch(() => ({}))).current_url;
    return getDomainFromUrl(url || '');
  }

  async shouldPauseForApproval(run, task, candidateAction, payload) {
    if (task.approval_policy === 'auto') return null;
    if (task.approval_policy === 'required') {
      return 'Task requires operator approval before execution';
    }
    if (!isStateChangingAction(candidateAction)) return null;
    const domain = await this.currentDomain(run);
    const url = payload?.url || run.last_url || '';
    const effectiveDomain = getDomainFromUrl(url) || domain;
    const looksSensitive = isAuthLikeUrl(url) || isAuthLikeUrl(run.last_url || '');
    if (!effectiveDomain) return 'State-changing browser action requires approval before first domain is established';
    if (!this.stateStore.hasApprovedDomain(task.bot_id, effectiveDomain)) return 'State-changing browser action requires approval on a new domain';
    if (looksSensitive) return 'State-changing browser action on an authenticated-looking page requires approval';
    return null;
  }

  async makeApprovalPending(run, task, requestedAction, reason) {
    const approval = await this.approvalStore.create(run, reason, requestedAction);
    run.status = 'approval_pending';
    run.pending_action = requestedAction;
    run.result = {
      approval,
      completed_steps: run.completed_steps,
      next_step_index: run.next_step_index
    };
    run.usage.approvals_requested += 1;
    await this.stateStore.saveRun(run);
    return run;
  }

  async executeAction(run, task, action, payload) {
    if (this.stateStore.isCancelRequested(run.run_id)) {
      return this.cancelled(run, 'Cancelled by operator');
    }
    const approvalReason = await this.shouldPauseForApproval(run, task, action, payload);
    if (approvalReason) {
      return this.makeApprovalPending(run, task, { action, payload }, approvalReason);
    }
    const started = Date.now();
    let result;
    switch (action) {
      case 'goto':
        result = await this.browserApi.goto(task.bot_id, payload);
        break;
      case 'click':
        result = await this.browserApi.click(task.bot_id, payload);
        break;
      case 'type':
        result = await this.browserApi.type(task.bot_id, payload);
        break;
      case 'extract':
        result = await this.browserApi.extract(task.bot_id, payload);
        break;
      case 'screenshot': {
        const screenshotPath = await this.artifactStore.nextScreenshotPath(run.run_id, payload?.path_hint || 'screenshot.png');
        result = await this.browserApi.screenshot(task.bot_id, { ...payload, path: screenshotPath });
        const artifact = await this.artifactStore.fromPath(run.run_id, result.screenshot, 'screenshot', payload?.path_hint || 'screenshot.png');
        run.artifacts.push(artifact);
        run.usage.screenshots += 1;
        break;
      }
      default:
        throw Object.assign(new Error(`Unsupported action: ${action}`), { runtimeError: buildError('UNSUPPORTED_ACTION', `Unsupported action: ${action}`, false) });
    }
    run.usage.browser_actions += 1;
    run.usage.browser_seconds += Number(((Date.now() - started) / 1000).toFixed(3));
    run.last_url = result?.url || run.last_url;
    if (action === 'goto' || action === 'click') {
      const domain = getDomainFromUrl(run.last_url || payload?.url || '');
      if (domain) await this.stateStore.noteApprovedDomain(task.bot_id, domain);
    }
    this.log(run, 'info', `${action} completed`);
    run.result = result || {};
    run.pending_action = null;
    await this.stateStore.saveRun(run);
    return run;
  }

  cancelled(run, reason) {
    run.status = 'cancelled';
    run.finished_at = nowIso();
    run.error = buildError('RUN_CANCELLED', reason, false);
    return run;
  }

  terminal(run, status = 'succeeded', error = null) {
    run.status = status;
    run.finished_at = nowIso();
    run.error = error;
    return run;
  }

  async execute(inputTask) {
    const task = taskSchema.parse(normalizeTask(inputTask));
    const existing = await this.stateStore.loadRun(task.run_id);
    if (existing) return existing;
    const run = baseRun(task);
    await this.stateStore.setActiveRun(task.bot_id, task.run_id);
    await this.stateStore.saveRun(run);
    try {
      if (task.action === 'composed') {
        const steps = Array.isArray(task.payload.steps) ? task.payload.steps : [];
        if (!steps.length && task.prompt) {
          throw Object.assign(new Error('Structured steps are required for composed tasks in queue mode.'), { runtimeError: buildError('MISSING_STEPS', 'Structured steps are required for composed tasks in queue mode.', false) });
        }
        for (let i = 0; i < steps.length; i += 1) {
          run.next_step_index = i;
          const step = steps[i] || {};
          const result = await this.executeAction(run, task, step.action, step.payload || {});
          if (result.status === 'approval_pending' || result.status === 'cancelled') return result;
          run.completed_steps = i + 1;
        }
        return this.terminal(run, 'succeeded');
      }
      const result = await this.executeAction(run, task, task.action, task.payload || {});
      if (result.status === 'approval_pending' || result.status === 'cancelled') return result;
      return this.terminal(run, 'succeeded');
    } catch (error) {
      const runtimeError = error?.runtimeError || buildError('RUNTIME_EXECUTION_FAILED', error?.message || 'Runtime execution failed', true);
      this.log(run, 'error', runtimeError.message);
      return this.terminal(run, 'failed', runtimeError);
    } finally {
      if (run.status !== 'approval_pending') {
        await this.stateStore.clearActiveRun(task.bot_id, task.run_id);
        await this.stateStore.clearCancel(task.run_id);
      }
      await this.stateStore.saveRun(run);
    }
  }

  async resume(approvalId, decision, approvedBy, resumePayload = null) {
    const approval = await this.approvalStore.decide(approvalId, decision, approvedBy, resumePayload);
    if (!approval) {
      return {
        task_id: null,
        run_id: null,
        status: 'failed',
        result: {},
        artifacts: [],
        logs: [],
        usage: { browser_actions: 0, browser_seconds: 0, screenshots: 0, approvals_requested: 0, llm_cost_usd: 0, desktop_seconds: 0, retries: 0 },
        error: buildError('APPROVAL_NOT_FOUND', 'Approval not found', false),
        started_at: nowIso(),
        finished_at: nowIso()
      };
    }
    const run = await this.stateStore.loadRun(approval.run_id);
    if (!run) {
      return {
        task_id: approval.task_id,
        run_id: approval.run_id,
        status: 'failed',
        result: {},
        artifacts: [],
        logs: [],
        usage: { browser_actions: 0, browser_seconds: 0, screenshots: 0, approvals_requested: 0, llm_cost_usd: 0, desktop_seconds: 0, retries: 0 },
        error: buildError('RUN_NOT_FOUND', 'Pending run not found', false),
        started_at: nowIso(),
        finished_at: nowIso()
      };
    }
    if (decision === 'deny') {
      run.status = 'cancelled';
      run.finished_at = nowIso();
      run.error = buildError('APPROVAL_DENIED', 'Approval denied by operator', false);
      await this.stateStore.clearActiveRun(run.bot_id, run.run_id);
      await this.stateStore.saveRun(run);
      return run;
    }
    await this.stateStore.setActiveRun(run.bot_id, run.run_id);
    try {
      const pending = run.pending_action;
      if (!pending) {
        return this.terminal(run, 'failed', buildError('NO_PENDING_ACTION', 'No pending action found for approval', false));
      }
      run.status = 'running';
      this.log(run, 'info', 'approval resumed');
      const task = {
        task_id: run.task_id,
        run_id: run.run_id,
        bot_id: run.bot_id,
        session_id: run.session_id,
        agent_id: run.agent_id,
        action: run.action,
        approval_policy: 'auto'
      };
      const result = await this.executeAction(run, task, pending.action, pending.payload || {});
      if (result.status === 'approval_pending' || result.status === 'cancelled') return result;
      if (run.action === 'composed' && Array.isArray(run.payload?.steps)) {
        const steps = run.payload.steps;
        for (let i = run.next_step_index + 1; i < steps.length; i += 1) {
          run.next_step_index = i;
          const step = steps[i] || {};
          const stepResult = await this.executeAction(run, task, step.action, step.payload || {});
          if (stepResult.status === 'approval_pending' || stepResult.status === 'cancelled') return stepResult;
          run.completed_steps = i + 1;
        }
      }
      return this.terminal(run, 'succeeded');
    } catch (error) {
      const runtimeError = error?.runtimeError || buildError('RESUME_FAILED', error?.message || 'Resume failed', true);
      return this.terminal(run, 'failed', runtimeError);
    } finally {
      if (run.status !== 'approval_pending') {
        await this.stateStore.clearActiveRun(run.bot_id, run.run_id);
        await this.stateStore.clearCancel(run.run_id);
      }
      await this.stateStore.saveRun(run);
    }
  }
}
