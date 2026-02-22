import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { chromium } from 'playwright';
import OpenAI from 'openai';
import { v4 as uuidv4 } from 'uuid';

const PORT = Number(process.env.LOCAL_SERVER_PORT || 8787);
const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, 'local_data');
const SCREENSHOT_DIR = path.join(DATA_DIR, 'screenshots');
const PROFILE_DIR = path.join(DATA_DIR, 'profiles');
const DB_PATH = path.join(DATA_DIR, 'state.db');

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
fs.mkdirSync(PROFILE_DIR, { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.exec(`
CREATE TABLE IF NOT EXISTS apps (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  base_url TEXT NOT NULL,
  auth_type TEXT NOT NULL DEFAULT 'none',
  auth_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL,
  instruction_text TEXT NOT NULL,
  status TEXT NOT NULL,
  summary TEXT,
  error TEXT,
  latest_screenshot_path TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(app_id) REFERENCES apps(id)
);
CREATE TABLE IF NOT EXISTS task_steps (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  step_index INTEGER NOT NULL,
  kind TEXT NOT NULL,
  message TEXT NOT NULL,
  payload_json TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(task_id) REFERENCES tasks(id)
);
CREATE TABLE IF NOT EXISTS task_artifacts (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  file_path TEXT NOT NULL,
  metadata_json TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(task_id) REFERENCES tasks(id)
);
CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  proposed_actions_json TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(task_id) REFERENCES tasks(id)
);
`);

const app = express();
app.use(cors());
app.use(express.json({ limit: '5mb' }));

const runningTasks = new Map();
const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

const now = () => new Date().toISOString();

function resolveAuth(authJson) {
  const auth = JSON.parse(authJson || '{}');
  const resolved = { authType: auth.authType || 'none' };
  const pick = (envKey, fallback) => (envKey ? process.env[envKey] || fallback || '' : fallback || '');
  if (auth.authType === 'token') {
    resolved.token = pick(auth.tokenEnv, auth.tokenValue);
    resolved.tokenSource = auth.tokenEnv || 'token_value';
  }
  if (auth.authType === 'username_password') {
    resolved.username = pick(auth.usernameEnv, auth.usernameValue);
    resolved.password = pick(auth.passwordEnv, auth.passwordValue);
    resolved.usernameSource = auth.usernameEnv || 'username_value';
    resolved.passwordSource = auth.passwordEnv || 'password_value';
  }
  resolved.twoFaNotes = auth.twoFaNotes || '';
  return resolved;
}

function logStep(taskId, kind, message, payload = null) {
  const stepIndex = db.prepare('SELECT COALESCE(MAX(step_index), -1) + 1 as idx FROM task_steps WHERE task_id = ?').get(taskId).idx;
  db.prepare('INSERT INTO task_steps (id, task_id, step_index, kind, message, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(uuidv4(), taskId, stepIndex, kind, message, payload ? JSON.stringify(payload) : null, now());
}

function updateTask(taskId, patch) {
  const existing = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
  if (!existing) return;
  db.prepare(`UPDATE tasks SET
    status = @status,
    summary = @summary,
    error = @error,
    latest_screenshot_path = @latest_screenshot_path,
    updated_at = @updated_at
    WHERE id = @id`).run({
    id: taskId,
    status: patch.status ?? existing.status,
    summary: patch.summary ?? existing.summary,
    error: patch.error ?? existing.error,
    latest_screenshot_path: patch.latest_screenshot_path ?? existing.latest_screenshot_path,
    updated_at: now()
  });
}

async function captureScreenshot(taskId, page, step) {
  const dir = path.join(SCREENSHOT_DIR, taskId);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${String(step).padStart(3, '0')}.jpg`);
  await page.screenshot({ path: filePath, type: 'jpeg', quality: 60, fullPage: true });
  db.prepare('INSERT INTO task_artifacts (id, task_id, kind, file_path, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(uuidv4(), taskId, 'screenshot', filePath, JSON.stringify({ step }), now());
  updateTask(taskId, { latest_screenshot_path: filePath });
  return filePath;
}

function parseSelector(page, selector) {
  if (!selector || typeof selector !== 'string') throw new Error('Missing selector');
  if (selector.startsWith('css=')) return page.locator(selector.slice(4));
  if (selector.startsWith('text=')) return page.locator(selector);
  if (selector.startsWith('role=')) {
    const body = selector.slice(5);
    const [role, ...nameParts] = body.split('|name=');
    const name = nameParts.join('|name=');
    return page.getByRole(role, name ? { name } : {});
  }
  return page.locator(selector);
}

function isPotentiallyDestructive(action) {
  const hay = JSON.stringify(action).toLowerCase();
  return ['delete', 'remove', 'send', 'publish', 'drop', 'destroy'].some((w) => hay.includes(w));
}

async function askModel({ instructionText, currentUrl, auth, screenshotPath, recentLogs }) {
  if (!openai) throw new Error('OPENAI_API_KEY missing');
  const image = fs.readFileSync(screenshotPath).toString('base64');
  const schema = {
    type: 'object',
    additionalProperties: false,
    properties: {
      thought: { type: 'string' },
      actions: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: true,
          properties: {
            type: { type: 'string' }
          },
          required: ['type']
        }
      }
    },
    required: ['actions']
  };

  const response = await openai.responses.create({
    model: process.env.OPENAI_MODEL || 'gpt-4.1-mini',
    input: [
      {
        role: 'system',
        content: [
          { type: 'input_text', text: 'You are a web automation agent. Output ONLY strict JSON matching schema. Use deterministic selectors. Prefer role=button|name=Save or text=Save over brittle css. If action can be destructive, output requestApproval first.' }
        ]
      },
      {
        role: 'user',
        content: [
          { type: 'input_text', text: `Instruction:\n${instructionText}\n\nCurrent URL: ${currentUrl}\nAuth available: ${JSON.stringify(auth)}\nRecent logs: ${recentLogs.slice(-8).join(' | ')}\nReturn actions to progress.` },
          { type: 'input_image', image_url: `data:image/jpeg;base64,${image}` }
        ]
      }
    ],
    text: {
      format: {
        type: 'json_schema',
        name: 'agent_actions',
        schema,
        strict: true
      }
    }
  });

  const out = response.output_text;
  return JSON.parse(out);
}

async function executeTask(taskId) {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
  const appRow = db.prepare('SELECT * FROM apps WHERE id = ?').get(task.app_id);
  if (!task || !appRow) return;
  const controller = runningTasks.get(taskId);
  updateTask(taskId, { status: 'RUNNING', error: null });
  logStep(taskId, 'info', 'Task started', { appId: appRow.id });

  const profilePath = path.join(PROFILE_DIR, appRow.id);
  fs.mkdirSync(profilePath, { recursive: true });
  const context = await chromium.launchPersistentContext(profilePath, { headless: true });
  const page = context.pages()[0] || await context.newPage();

  try {
    await page.goto(appRow.base_url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    let step = 0;
    const recentLogs = [];
    const auth = resolveAuth(appRow.auth_json);

    while (step < 40 && !controller.cancelled) {
      const shot = await captureScreenshot(taskId, page, step);
      const decision = await askModel({
        instructionText: task.instruction_text,
        currentUrl: page.url(),
        auth,
        screenshotPath: shot,
        recentLogs
      });

      if (!decision.actions?.length) {
        throw new Error('Model returned no actions');
      }

      for (const action of decision.actions) {
        if (controller.cancelled) break;
        recentLogs.push(`${action.type}`);
        if (action.type === 'done') {
          updateTask(taskId, { status: 'COMPLETED', summary: action.summary || 'Completed' });
          logStep(taskId, 'done', action.summary || 'Completed', action.extractedData || {});
          await captureScreenshot(taskId, page, step + 1);
          await context.close();
          runningTasks.delete(taskId);
          return;
        }

        if (action.type === 'requestApproval' || isPotentiallyDestructive(action)) {
          const approvalId = uuidv4();
          db.prepare('INSERT INTO approvals (id, task_id, reason, proposed_actions_json, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
            .run(approvalId, taskId, action.reason || 'Potentially destructive action', JSON.stringify(action.proposedActions || [action]), 'PENDING', now(), now());
          updateTask(taskId, { status: 'NEEDS_APPROVAL' });
          logStep(taskId, 'approval', action.reason || 'Approval required', { approvalId });
          controller.waitingApproval = approvalId;
          await context.close();
          runningTasks.delete(taskId);
          return;
        }

        const timeout = Math.min(Number(action.timeoutMs || 15000), 45000);
        if (action.type === 'click') {
          const loc = parseSelector(page, action.selector);
          await loc.first().click({ timeout });
        } else if (action.type === 'type') {
          const loc = parseSelector(page, action.selector);
          await loc.first().fill('');
          await loc.first().type(action.text || '', { timeout });
        } else if (action.type === 'press') {
          await page.keyboard.press(action.key || 'Enter', { timeout });
        } else if (action.type === 'waitFor') {
          const loc = parseSelector(page, action.selector);
          await loc.first().waitFor({ state: 'visible', timeout });
        } else if (action.type === 'scroll') {
          await page.mouse.wheel(0, Number(action.deltaY || 500));
        } else if (action.type === 'navigate') {
          await page.goto(action.url, { waitUntil: 'domcontentloaded', timeout });
        } else if (action.type === 'refresh') {
          await page.reload({ waitUntil: 'domcontentloaded', timeout });
        } else if (action.type === 'assert') {
          const loc = parseSelector(page, action.selector);
          const text = await loc.first().innerText({ timeout });
          if (action.mustContainText && !text.includes(action.mustContainText)) {
            throw new Error(`Assertion failed: missing ${action.mustContainText}`);
          }
        }

        if (['click', 'type', 'press', 'navigate', 'refresh'].includes(action.type)) {
          await page.waitForLoadState('networkidle', { timeout: 4000 }).catch(() => {});
        }
        logStep(taskId, 'action', `Executed ${action.type}`, {
          ...action,
          text: action.mask ? '***' : action.text
        });
        step += 1;
      }
      step += 1;
    }

    if (controller.cancelled) {
      updateTask(taskId, { status: 'FAILED', error: 'Task cancelled by user' });
      logStep(taskId, 'error', 'Task cancelled');
    } else {
      updateTask(taskId, { status: 'FAILED', error: 'Max steps reached without done action' });
      logStep(taskId, 'error', 'Max steps reached', { maxSteps: 40 });
    }
  } catch (error) {
    updateTask(taskId, { status: 'FAILED', error: String(error.message || error) });
    logStep(taskId, 'error', 'Task failed', { error: String(error.message || error) });
  } finally {
    await context.close().catch(() => {});
    runningTasks.delete(taskId);
  }
}

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.post('/api/apps', (req, res) => {
  const { name, baseUrl, auth } = req.body;
  if (!name || !baseUrl) return res.status(400).json({ error: 'name and baseUrl required' });
  const id = uuidv4();
  db.prepare('INSERT INTO apps (id, name, base_url, auth_type, auth_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, name, baseUrl, auth?.authType || 'none', JSON.stringify(auth || {}), now(), now());
  res.json({ id, name, baseUrl, auth: auth || { authType: 'none' } });
});

app.get('/api/apps', (_req, res) => {
  const apps = db.prepare('SELECT * FROM apps ORDER BY created_at DESC').all().map((a) => ({
    id: a.id,
    name: a.name,
    baseUrl: a.base_url,
    auth: JSON.parse(a.auth_json)
  }));
  res.json({ apps });
});

app.put('/api/apps/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM apps WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const name = req.body.name ?? existing.name;
  const baseUrl = req.body.baseUrl ?? existing.base_url;
  const auth = req.body.auth ?? JSON.parse(existing.auth_json);
  db.prepare('UPDATE apps SET name = ?, base_url = ?, auth_type = ?, auth_json = ?, updated_at = ? WHERE id = ?')
    .run(name, baseUrl, auth.authType || 'none', JSON.stringify(auth), now(), req.params.id);
  res.json({ id: req.params.id, name, baseUrl, auth });
});

app.post('/api/tasks', (req, res) => {
  const { appId, instructionText } = req.body;
  if (!appId || !instructionText) return res.status(400).json({ error: 'appId and instructionText required' });
  const id = uuidv4();
  db.prepare('INSERT INTO tasks (id, app_id, instruction_text, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, appId, instructionText, 'PENDING', now(), now());
  runningTasks.set(id, { cancelled: false, waitingApproval: null });
  executeTask(id);
  res.json({ id, appId, instructionText, status: 'PENDING' });
});

app.get('/api/tasks', (_req, res) => {
  const tasks = db.prepare('SELECT * FROM tasks ORDER BY created_at DESC').all();
  res.json({ tasks });
});

app.get('/api/tasks/:id', (req, res) => {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!task) return res.status(404).json({ error: 'Not found' });
  const steps = db.prepare('SELECT * FROM task_steps WHERE task_id = ? ORDER BY step_index ASC').all(req.params.id);
  const approvals = db.prepare('SELECT * FROM approvals WHERE task_id = ? ORDER BY created_at DESC').all(req.params.id);
  res.json({
    task,
    steps: steps.map((s) => ({ ...s, payload: s.payload_json ? JSON.parse(s.payload_json) : null })),
    approvals: approvals.map((a) => ({ ...a, proposedActions: JSON.parse(a.proposed_actions_json) }))
  });
});

app.post('/api/tasks/:id/approve', (req, res) => {
  const pending = db.prepare("SELECT * FROM approvals WHERE task_id = ? AND status = 'PENDING' ORDER BY created_at ASC LIMIT 1").get(req.params.id);
  if (!pending) return res.status(404).json({ error: 'No pending approval' });
  db.prepare("UPDATE approvals SET status = 'APPROVED', updated_at = ? WHERE id = ?").run(now(), pending.id);
  updateTask(req.params.id, { status: 'RUNNING' });
  logStep(req.params.id, 'approval', 'Approval granted', { approvalId: pending.id });
  const controller = { cancelled: false, waitingApproval: null };
  runningTasks.set(req.params.id, controller);
  executeTask(req.params.id);
  res.json({ ok: true });
});

app.post('/api/tasks/:id/cancel', (req, res) => {
  const controller = runningTasks.get(req.params.id);
  if (controller) controller.cancelled = true;
  updateTask(req.params.id, { status: 'FAILED', error: 'Cancelled by user' });
  logStep(req.params.id, 'error', 'Cancelled by user');
  res.json({ ok: true });
});

app.get('/api/tasks/:id/screenshot', (req, res) => {
  const task = db.prepare('SELECT latest_screenshot_path FROM tasks WHERE id = ?').get(req.params.id);
  if (!task?.latest_screenshot_path || !fs.existsSync(task.latest_screenshot_path)) return res.status(404).json({ error: 'No screenshot' });
  res.setHeader('Content-Type', 'image/jpeg');
  fs.createReadStream(task.latest_screenshot_path).pipe(res);
});

app.listen(PORT, () => {
  console.log(`cockpit-local server running on http://localhost:${PORT}`);
});
