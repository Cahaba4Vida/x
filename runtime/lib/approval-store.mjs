import { nowIso, randomId } from './utils.mjs';

export class ApprovalStore {
  constructor(stateStore) {
    this.stateStore = stateStore;
  }

  async create(run, reason, requestedAction) {
    const approval = {
      approval_id: randomId('appr'),
      task_id: run.task_id,
      run_id: run.run_id,
      status: 'pending',
      reason,
      requested_action: requestedAction,
      created_at: nowIso()
    };
    await this.stateStore.saveApproval(approval);
    return approval;
  }

  async get(approvalId) {
    return this.stateStore.loadApproval(approvalId);
  }

  async decide(approvalId, decision, approvedBy, resumePayload = null) {
    const approval = await this.get(approvalId);
    if (!approval) return null;
    approval.status = decision === 'approve' ? 'approved' : 'denied';
    approval.approved_by = approvedBy;
    approval.decided_at = nowIso();
    approval.resume_payload = resumePayload;
    await this.stateStore.saveApproval(approval);
    return approval;
  }
}
