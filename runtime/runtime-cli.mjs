import process from 'node:process';
import path from 'node:path';
import { StateStore } from './lib/state-store.mjs';
import { ApprovalStore } from './lib/approval-store.mjs';
import { ArtifactStore } from './lib/artifact-store.mjs';
import { BrowserApiClient } from './lib/browser-api-client.mjs';
import { TaskRunner } from './lib/task-runner.mjs';

const RUNTIME_ROOT = process.env.RUNTIME_ROOT || path.join(process.cwd(), '.runtime-state');
const stateStore = new StateStore(RUNTIME_ROOT);
await stateStore.init();
const taskRunner = new TaskRunner({
  stateStore,
  approvalStore: new ApprovalStore(stateStore),
  artifactStore: new ArtifactStore(stateStore),
  browserApi: new BrowserApiClient({
    baseUrl: process.env.BROWSER_API_URL || 'http://127.0.0.1:3001',
    secret: process.env.BROWSER_API_SECRET || ''
  })
});

const mode = process.argv[2] || 'execute';
let input = '';
for await (const chunk of process.stdin) input += chunk.toString();
const payload = input.trim() ? JSON.parse(input) : {};

const result = mode === 'resume'
  ? await taskRunner.resume(payload.approval_id, payload.decision || 'approve', payload.approved_by || 'operator', payload.resume_payload || null)
  : await taskRunner.execute(payload.task || payload);

process.stdout.write(JSON.stringify(result));
