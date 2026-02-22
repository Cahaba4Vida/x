export type TaskStatus = 'PENDING' | 'RUNNING' | 'WAITING_APPROVAL' | 'NEEDS_MANUAL' | 'COMPLETED' | 'FAILED';

export interface PendingAction {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  status: 'PENDING' | 'APPROVED' | 'DENIED';
}

export interface TaskStep {
  id: number;
  taskId: string;
  ts: string;
  kind: string;
  message: string;
  data: Record<string, unknown>;
}

export interface Approval {
  id: number;
  task_id: string;
  status: 'pending' | 'approved' | 'denied';
  reason: string;
  proposed_actions: unknown[];
  created_at: string;
  updated_at: string;
}

export interface Task {
  id: string;
  type: string;
  args: Record<string, unknown>;
  status: TaskStatus;
  lease?: { runnerId: string; token: string; expiresAt: string };
  result?: unknown;
  error?: string;
  pendingActions: PendingAction[];
  steps?: TaskStep[];
  approvals?: Approval[];
  artifacts?: Array<Record<string, unknown>>;
  createdAt: string;
  updatedAt: string;
}

export interface AppConfig {
  id: string;
  name: string;
  base_url: string;
  auth_type: 'none' | 'token' | 'username_password';
  token_env?: string | null;
  username_env?: string | null;
  password_env?: string | null;
  two_fa_notes?: string | null;
  enabled?: boolean;
}
