export type TaskStatus = 'PENDING' | 'RUNNING' | 'WAITING_APPROVAL' | 'NEEDS_MANUAL' | 'COMPLETED' | 'FAILED';

export interface PendingAction {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  status: 'PENDING' | 'APPROVED' | 'DENIED';
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
  createdAt: string;
  updatedAt: string;
}
