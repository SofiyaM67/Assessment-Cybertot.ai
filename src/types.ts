export type LedgerEntryType =
  | 'TASK_APPROVAL'
  | 'TASK_APPROVAL_REVERSAL'
  | 'USAGE'
  | 'USAGE_REJECTED'
  | 'INITIAL_BALANCE';

export type TaskStatus = 'pending' | 'done' | 'approved' | 'rejected';

export interface Parent {
  id: string;
  name: string;
  token: string;
}

export interface Child {
  id: string;
  name: string;
  parentId: string;
  token: string;
}

export interface Task {
  id: string;
  parentId: string;
  childId: string;
  title: string;
  reward: number;
  status: TaskStatus;
  createdAt: string;
  doneAt?: string;
  resolvedAt?: string;
}

export interface LedgerEntry {
  id: string;
  childId: string;
  type: LedgerEntryType;
  amount: number;
  balanceAfter: number;
  timestamp: string;
  referenceId?: string;
  metadata?: Record<string, unknown>;
}

export interface UsageSession {
  appId: string;
  start: string;
  end: string;
}

export interface UsageSessionResult {
  sessionKey: string;
  appId: string;
  start: string;
  end: string;
  totalMinutes: number;
  coveredMinutes: number;
  rejectedMinutes: number;
  balanceExhaustedAt?: string;
  duplicate: boolean;
  ledgerEntryIds: string[];
}

export interface UndoApprovalResult {
  taskId: string;
  originalReward: number;
  reversedAmount: number;
  unrecoverableAmount: number;
  ledgerEntryIds: string[];
}

export interface AuthContext {
  role: 'parent' | 'child';
  parentId?: string;
  childId?: string;
}
