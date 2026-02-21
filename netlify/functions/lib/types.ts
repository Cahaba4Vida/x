export type TaskStatus = 'PENDING'|'RUNNING'|'WAITING_APPROVAL'|'NEEDS_MANUAL'|'COMPLETED'|'FAILED';
export interface PendingAction { id: string; type: string; payload: Record<string, unknown>; status: 'PENDING'|'APPROVED'|'DENIED'; }
export interface TaskLease { runnerId: string; token: string; expiresAt: string }
export interface Task { id: string; type: string; args: Record<string, unknown>; status: TaskStatus; createdAt: string; updatedAt: string; lease?: TaskLease; pendingActions: PendingAction[]; result?: unknown; error?: string; }
export interface AppConfigSummary { id: string; name: string; base_url: string }
export interface State { tasks: Task[]; logs: Array<Record<string, unknown>>; artifacts: Array<Record<string, unknown>>; policy: Record<string, unknown>; tools: Record<string, boolean>; emailDigest: Record<string, unknown>; apps: AppConfigSummary[]; }
