import { Store } from './store.js';
import {
  LedgerEntry,
  Task,
  UndoApprovalResult,
  UsageSession,
  UsageSessionResult,
} from './types.js';
import {
  addMinutes,
  assertLedgerInvariant,
  generateId,
  nowIso,
  sessionKey,
  sessionMinutes,
} from './utils.js';

export class RewardBankService {
  constructor(private readonly store: Store) {}

  createTask(parentId: string, childId: string, title: string, reward: number): Task {
    const child = this.store.getChild(childId);
    if (!child || child.parentId !== parentId) {
      throw new ServiceError(404, 'Child not found for this parent');
    }
    if (reward <= 0) throw new ServiceError(400, 'Reward must be positive');

    const task: Task = {
      id: generateId(),
      parentId,
      childId,
      title,
      reward,
      status: 'pending',
      createdAt: nowIso(),
    };
    this.store.tasks.set(task.id, task);
    return task;
  }

  markTaskDone(childId: string, taskId: string): Task {
    const task = this.requireTask(taskId);
    if (task.childId !== childId) throw new ServiceError(403, 'Task belongs to another child');
    if (task.status !== 'pending') {
      throw new ServiceError(409, `Task is already ${task.status}`);
    }
    task.status = 'done';
    task.doneAt = nowIso();
    return task;
  }

  approveTask(parentId: string, taskId: string): { task: Task; ledgerEntry: LedgerEntry; idempotent: boolean } {
    const task = this.requireTask(taskId);
    if (task.parentId !== parentId) throw new ServiceError(403, 'Task belongs to another parent');
    if (task.status === 'approved') {
      const existing = this.store
        .getLedger(task.childId)
        .find((e) => e.type === 'TASK_APPROVAL' && e.referenceId === taskId);
      if (!existing) throw new ServiceError(500, 'Approved task missing ledger entry');
      return { task, ledgerEntry: existing, idempotent: true };
    }
    if (task.status !== 'done') {
      throw new ServiceError(409, `Cannot approve task in status ${task.status}`);
    }

    task.status = 'approved';
    task.resolvedAt = nowIso();
    const ledgerEntry = this.store.appendLedger(task.childId, {
      type: 'TASK_APPROVAL',
      amount: task.reward,
      referenceId: task.id,
      metadata: { title: task.title },
    });
    return { task, ledgerEntry, idempotent: false };
  }

  rejectTask(parentId: string, taskId: string): Task {
    const task = this.requireTask(taskId);
    if (task.parentId !== parentId) throw new ServiceError(403, 'Task belongs to another parent');
    if (task.status !== 'done') {
      throw new ServiceError(409, `Cannot reject task in status ${task.status}`);
    }
    task.status = 'rejected';
    task.resolvedAt = nowIso();
    return task;
  }

  undoApproval(parentId: string, taskId: string): UndoApprovalResult {
    const task = this.requireTask(taskId);
    if (task.parentId !== parentId) throw new ServiceError(403, 'Task belongs to another parent');

    const existingReversal = this.store
      .getLedger(task.childId)
      .find((e) => e.type === 'TASK_APPROVAL_REVERSAL' && e.referenceId === taskId);
    if (existingReversal) {
      const meta = existingReversal.metadata ?? {};
      return {
        taskId,
        originalReward: task.reward,
        reversedAmount: Math.abs(existingReversal.amount),
        unrecoverableAmount: Number(meta.unrecoverableAmount ?? 0),
        ledgerEntryIds: [existingReversal.id],
      };
    }

    if (task.status !== 'approved') {
      throw new ServiceError(409, `Cannot undo approval for task in status ${task.status}`);
    }

    const balance = this.store.getBalance(task.childId);
    const reversedAmount = Math.min(task.reward, balance);
    const unrecoverableAmount = task.reward - reversedAmount;

    const ledgerEntryIds: string[] = [];
    if (reversedAmount > 0) {
      const entry = this.store.appendLedger(task.childId, {
        type: 'TASK_APPROVAL_REVERSAL',
        amount: -reversedAmount,
        referenceId: task.id,
        metadata: {
          title: task.title,
          originalReward: task.reward,
          unrecoverableAmount,
        },
      });
      ledgerEntryIds.push(entry.id);
    } else {
      const entry = this.store.appendLedger(task.childId, {
        type: 'TASK_APPROVAL_REVERSAL',
        amount: 0,
        referenceId: task.id,
        metadata: {
          title: task.title,
          originalReward: task.reward,
          unrecoverableAmount,
          note: 'No balance available to reverse; minutes already spent',
        },
      });
      ledgerEntryIds.push(entry.id);
    }

    task.status = 'done';
    task.resolvedAt = nowIso();

    return {
      taskId,
      originalReward: task.reward,
      reversedAmount,
      unrecoverableAmount,
      ledgerEntryIds,
    };
  }

  async reportUsageBatch(childId: string, sessions: UsageSession[]): Promise<UsageSessionResult[]> {
    return this.store.withChildLock(childId, () => {
      const sorted = [...sessions].sort(
        (a, b) => new Date(a.start).getTime() - new Date(b.start).getTime()
      );
      return sorted.map((session) => this.processUsageSession(childId, session));
    });
  }

  private processUsageSession(childId: string, session: UsageSession): UsageSessionResult {
    const key = sessionKey(childId, session.appId, session.start, session.end);
    if (this.store.isSessionProcessed(key)) {
      return {
        sessionKey: key,
        appId: session.appId,
        start: session.start,
        end: session.end,
        totalMinutes: sessionMinutes(session.start, session.end),
        coveredMinutes: 0,
        rejectedMinutes: 0,
        duplicate: true,
        ledgerEntryIds: [],
      };
    }

    const totalMinutes = sessionMinutes(session.start, session.end);
    let balance = this.store.getBalance(childId);
    const coveredMinutes = Math.min(balance, totalMinutes);
    const rejectedMinutes = totalMinutes - coveredMinutes;
    const ledgerEntryIds: string[] = [];
    let balanceExhaustedAt: string | undefined;

    if (coveredMinutes > 0) {
      const entry = this.store.appendLedger(childId, {
        type: 'USAGE',
        amount: -coveredMinutes,
        referenceId: key,
        timestamp: session.end,
        metadata: {
          appId: session.appId,
          start: session.start,
          end: session.end,
          coveredMinutes,
          rejectedMinutes,
        },
      });
      ledgerEntryIds.push(entry.id);
      balance = entry.balanceAfter;
      if (rejectedMinutes > 0) {
        balanceExhaustedAt = addMinutes(session.start, coveredMinutes);
      }
    }

    if (rejectedMinutes > 0) {
      const entry = this.store.appendLedger(childId, {
        type: 'USAGE_REJECTED',
        amount: 0,
        referenceId: key,
        timestamp: session.end,
        metadata: {
          appId: session.appId,
          start: session.start,
          end: session.end,
          rejectedMinutes,
          balanceExhaustedAt: balanceExhaustedAt ?? session.start,
          reason: balance === 0 && coveredMinutes === 0 ? 'no_balance' : 'partial_or_full_rejection',
        },
      });
      ledgerEntryIds.push(entry.id);
      if (!balanceExhaustedAt) balanceExhaustedAt = session.start;
    }

    this.store.markSessionProcessed(key);
    const result: UsageSessionResult = {
      sessionKey: key,
      appId: session.appId,
      start: session.start,
      end: session.end,
      totalMinutes,
      coveredMinutes,
      rejectedMinutes,
      balanceExhaustedAt,
      duplicate: false,
      ledgerEntryIds,
    };
    this.store.recordUsageResult(childId, result);
    return result;
  }

  getBalance(childId: string): number {
    this.requireChild(childId);
    return this.store.getBalance(childId);
  }

  getLedger(childId: string): LedgerEntry[] {
    this.requireChild(childId);
    return this.store.getLedger(childId);
  }

  verifyInvariant(childId: string): { valid: boolean; sum: number; balance: number } {
    const entries = this.store.getLedger(childId);
    const sum = entries.reduce((acc, e) => acc + e.amount, 0);
    const balance = this.store.getBalance(childId);
    return { valid: sum === balance, sum, balance };
  }

  assertInvariant(childId: string): void {
    const entries = this.store.getLedger(childId);
    assertLedgerInvariant(entries, this.store.getBalance(childId));
  }

  private requireTask(taskId: string): Task {
    const task = this.store.getTask(taskId);
    if (!task) throw new ServiceError(404, 'Task not found');
    return task;
  }

  private requireChild(childId: string): void {
    if (!this.store.getChild(childId)) throw new ServiceError(404, 'Child not found');
  }
}

export class ServiceError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
    this.name = 'ServiceError';
  }
}
