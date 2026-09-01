import {
  Child,
  LedgerEntry,
  Parent,
  Task,
  UsageSessionResult,
} from './types.js';
import { generateId, generateToken, nowIso } from './utils.js';

export class Store {
  parents = new Map<string, Parent>();
  children = new Map<string, Child>();
  tasks = new Map<string, Task>();
  ledger = new Map<string, LedgerEntry[]>();
  processedSessions = new Set<string>();
  childLocks = new Map<string, Promise<void>>();

  reset(): void {
    this.parents.clear();
    this.children.clear();
    this.tasks.clear();
    this.ledger.clear();
    this.processedSessions.clear();
    this.childLocks.clear();
  }

  createParent(name: string): Parent {
    const parent: Parent = { id: generateId(), name, token: generateToken() };
    this.parents.set(parent.id, parent);
    return parent;
  }

  createChild(parentId: string, name: string, initialBalance = 0): Child {
    const child: Child = {
      id: generateId(),
      name,
      parentId,
      token: generateToken(),
    };
    this.children.set(child.id, child);
    this.ledger.set(child.id, []);

    if (initialBalance > 0) {
      this.appendLedger(child.id, {
        type: 'INITIAL_BALANCE',
        amount: initialBalance,
        referenceId: child.id,
        metadata: { reason: 'starting balance' },
      });
    }

    return child;
  }

  getParentByToken(token: string): Parent | undefined {
    return [...this.parents.values()].find((p) => p.token === token);
  }

  getChildByToken(token: string): Child | undefined {
    return [...this.children.values()].find((c) => c.token === token);
  }

  getChild(childId: string): Child | undefined {
    return this.children.get(childId);
  }

  getTasksForChild(childId: string): Task[] {
    return [...this.tasks.values()].filter((t) => t.childId === childId);
  }

  getTask(taskId: string): Task | undefined {
    return this.tasks.get(taskId);
  }

  getLedger(childId: string): LedgerEntry[] {
    return [...(this.ledger.get(childId) ?? [])];
  }

  getBalance(childId: string): number {
    const entries = this.ledger.get(childId) ?? [];
    if (entries.length === 0) return 0;
    return entries[entries.length - 1].balanceAfter;
  }

  appendLedger(
    childId: string,
    entry: Omit<LedgerEntry, 'id' | 'childId' | 'balanceAfter' | 'timestamp'> & {
      timestamp?: string;
    }
  ): LedgerEntry {
    const entries = this.ledger.get(childId) ?? [];
    const balanceAfter = (entries.at(-1)?.balanceAfter ?? 0) + entry.amount;
    const full: LedgerEntry = {
      id: generateId(),
      childId,
      type: entry.type,
      amount: entry.amount,
      balanceAfter,
      timestamp: entry.timestamp ?? nowIso(),
      referenceId: entry.referenceId,
      metadata: entry.metadata,
    };
    entries.push(full);
    this.ledger.set(childId, entries);
    return full;
  }

  async withChildLock<T>(childId: string, fn: () => Promise<T> | T): Promise<T> {
    const prev = this.childLocks.get(childId) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const chain = prev.then(() => gate);
    this.childLocks.set(childId, chain);
    await prev;
    try {
      return await fn();
    } finally {
      release();
    }
  }

  markSessionProcessed(key: string): void {
    this.processedSessions.add(key);
  }

  isSessionProcessed(key: string): boolean {
    return this.processedSessions.has(key);
  }

  recordUsageResult(_childId: string, _result: UsageSessionResult): void {
    // Reserved for future persistence of session outcomes
  }
}
