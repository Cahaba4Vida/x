import fs from "node:fs/promises";
import path from "node:path";
import { ensureDir, ensureDirSync, fileExists, nowIso } from './utils.mjs';

export class StateStore {
  constructor(rootDir) {
    this.rootDir = rootDir;
    this.runsDir = path.join(rootDir, 'runs');
    this.approvalsDir = path.join(rootDir, 'approvals');
    this.artifactsDir = path.join(rootDir, 'artifacts');
    this.logsDir = path.join(rootDir, 'logs');
    this.browserProfilesDir = path.join(rootDir, 'browser-profiles');
    this.stateFile = path.join(rootDir, 'state.json');
    ensureDirSync(this.runsDir);
    ensureDirSync(this.approvalsDir);
    ensureDirSync(this.artifactsDir);
    ensureDirSync(this.logsDir);
    ensureDirSync(this.browserProfilesDir);
    this.state = { activeRunsByBot: {}, cancelRequested: {}, approvedDomainsByBot: {} };
  }

  async init() {
    if (await fileExists(this.stateFile)) {
      try {
        const raw = await fs.readFile(this.stateFile, 'utf8');
        this.state = { ...this.state, ...JSON.parse(raw) };
      } catch {}
    }
    await this.flush();
  }

  async flush() {
    await fs.writeFile(this.stateFile, JSON.stringify(this.state, null, 2));
  }

  runJsonPath(runId) { return path.join(this.runsDir, `${runId}.json`); }
  runLogPath(runId) { return path.join(this.runsDir, `${runId}.jsonl`); }
  approvalPath(approvalId) { return path.join(this.approvalsDir, `${approvalId}.json`); }
  artifactDir(runId) { return path.join(this.artifactsDir, runId); }
  browserProfileDir(botId) { return path.join(this.browserProfilesDir, botId); }
  runtimeLogPath() { return path.join(this.logsDir, 'runtime.log'); }

  async writeRuntimeLog(line) {
    await fs.appendFile(this.runtimeLogPath(), `${nowIso()} ${line}\n`);
  }

  async appendRunSnapshot(run) {
    await fs.appendFile(this.runLogPath(run.run_id), JSON.stringify(run) + '\n');
  }

  async saveRun(run) {
    await ensureDir(this.runsDir);
    await fs.writeFile(this.runJsonPath(run.run_id), JSON.stringify(run, null, 2));
    await this.appendRunSnapshot(run);
  }

  async loadRun(runId) {
    if (!(await fileExists(this.runJsonPath(runId)))) return null;
    return JSON.parse(await fs.readFile(this.runJsonPath(runId), 'utf8'));
  }

  async saveApproval(approval) {
    await ensureDir(this.approvalsDir);
    await fs.writeFile(this.approvalPath(approval.approval_id), JSON.stringify(approval, null, 2));
  }

  async loadApproval(approvalId) {
    if (!(await fileExists(this.approvalPath(approvalId)))) return null;
    return JSON.parse(await fs.readFile(this.approvalPath(approvalId), 'utf8'));
  }

  async setActiveRun(botId, runId) {
    const active = this.state.activeRunsByBot[botId];
    if (active && active !== runId) {
      throw new Error(`bot ${botId} already has active run ${active}`);
    }
    this.state.activeRunsByBot[botId] = runId;
    await this.flush();
  }

  async clearActiveRun(botId, runId) {
    if (this.state.activeRunsByBot[botId] === runId) {
      delete this.state.activeRunsByBot[botId];
      await this.flush();
    }
  }

  async requestCancel(runId, reason = 'Cancelled') {
    this.state.cancelRequested[runId] = { requested_at: nowIso(), reason };
    await this.flush();
  }

  isCancelRequested(runId) { return !!this.state.cancelRequested[runId]; }
  getCancelReason(runId) { return this.state.cancelRequested[runId]?.reason || 'Cancelled by operator'; }

  async clearCancel(runId) {
    delete this.state.cancelRequested[runId];
    await this.flush();
  }

  async noteApprovedDomain(botId, domain) {
    if (!domain) return;
    this.state.approvedDomainsByBot[botId] ||= [];
    if (!this.state.approvedDomainsByBot[botId].includes(domain)) {
      this.state.approvedDomainsByBot[botId].push(domain);
      await this.flush();
    }
  }

  hasApprovedDomain(botId, domain) {
    return !!domain && (this.state.approvedDomainsByBot[botId] || []).includes(domain);
  }
}
