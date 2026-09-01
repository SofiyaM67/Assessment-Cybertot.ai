import { describe, it, expect } from 'vitest';
import { createTestContext, BASE_TIME, isoAt } from './helpers.js';

describe('RewardBank ledger invariant', () => {
  it('holds across a complex sequence of operations', async () => {
    const { service, parent, child } = createTestContext(15);

    const t1 = service.createTask(parent.id, child.id, 'Homework', 30);
    const t2 = service.createTask(parent.id, child.id, 'Dishes', 10);
    const t3 = service.createTask(parent.id, child.id, 'Reading', 20);

    service.markTaskDone(child.id, t1.id);
    service.markTaskDone(child.id, t2.id);
    service.approveTask(parent.id, t1.id);
    service.rejectTask(parent.id, t2.id);

    await service.reportUsageBatch(child.id, [
      { appId: 'youtube', start: isoAt(BASE_TIME, 0), end: isoAt(BASE_TIME, 20) },
      { appId: 'minecraft', start: isoAt(BASE_TIME, 20), end: isoAt(BASE_TIME, 35) },
    ]);

    service.markTaskDone(child.id, t3.id);
    service.approveTask(parent.id, t3.id);

    await service.reportUsageBatch(child.id, [
      { appId: 'youtube', start: isoAt(BASE_TIME, 40), end: isoAt(BASE_TIME, 55) },
    ]);

    const t4 = service.createTask(parent.id, child.id, 'Extra chore', 25);
    service.markTaskDone(child.id, t4.id);
    service.approveTask(parent.id, t4.id);
    service.undoApproval(parent.id, t4.id);

    service.assertInvariant(child.id);
    const { valid, sum, balance } = service.verifyInvariant(child.id);
    expect(valid).toBe(true);
    expect(sum).toBe(balance);
  });
});

describe('double-click approve', () => {
  it('credits reward only once and returns idempotent on second call', () => {
    const { service, parent, child } = createTestContext(0);
    const task = service.createTask(parent.id, child.id, 'Tidy room', 30);
    service.markTaskDone(child.id, task.id);

    const first = service.approveTask(parent.id, task.id);
    const second = service.approveTask(parent.id, task.id);

    expect(first.idempotent).toBe(false);
    expect(second.idempotent).toBe(true);
    expect(first.ledgerEntry.id).toBe(second.ledgerEntry.id);
    expect(service.getBalance(child.id)).toBe(30);

    const approvals = service
      .getLedger(child.id)
      .filter((e) => e.type === 'TASK_APPROVAL' && e.referenceId === task.id);
    expect(approvals).toHaveLength(1);
    service.assertInvariant(child.id);
  });
});

describe('concurrent usage exceeding balance', () => {
  it('processes sessions in start-time order and records exact cutoff', async () => {
    const { service, child } = createTestContext(10);
    const start = BASE_TIME;

    const results = await service.reportUsageBatch(child.id, [
      { appId: 'roblox', start: isoAt(start, 0), end: isoAt(start, 8) },
      { appId: 'tiktok', start: isoAt(start, 0), end: isoAt(start, 8) },
    ]);

    const roblox = results.find((r) => r.appId === 'roblox')!;
    const tiktok = results.find((r) => r.appId === 'tiktok')!;
    const totalCovered = roblox.coveredMinutes + tiktok.coveredMinutes;

    expect(totalCovered).toBe(10);
    expect(service.getBalance(child.id)).toBe(0);

    const rejected = results.flatMap((r) =>
      r.rejectedMinutes > 0 ? [{ appId: r.appId, rejected: r.rejectedMinutes, at: r.balanceExhaustedAt }] : []
    );
    expect(rejected.length).toBeGreaterThan(0);

    service.assertInvariant(child.id);
    const ledger = service.getLedger(child.id);
    const usageDebits = ledger.filter((e) => e.type === 'USAGE');
    expect(usageDebits.reduce((s, e) => s + Math.abs(e.amount), 0)).toBe(10);
  });
});

describe('undo approval', () => {
  it('reverses only available balance when minutes were already spent', async () => {
    const { service, parent, child } = createTestContext(0);
    const task = service.createTask(parent.id, child.id, 'Mow lawn', 30);
    service.markTaskDone(child.id, task.id);
    service.approveTask(parent.id, task.id);

    await service.reportUsageBatch(child.id, [
      { appId: 'youtube', start: isoAt(BASE_TIME, 0), end: isoAt(BASE_TIME, 22) },
    ]);
    expect(service.getBalance(child.id)).toBe(8);

    const undo = service.undoApproval(parent.id, task.id);
    expect(undo.reversedAmount).toBe(8);
    expect(undo.unrecoverableAmount).toBe(22);
    expect(service.getBalance(child.id)).toBe(0);
    service.assertInvariant(child.id);
  });

  it('is idempotent on repeated undo', () => {
    const { service, parent, child } = createTestContext(0);
    const task = service.createTask(parent.id, child.id, 'Sweep', 15);
    service.markTaskDone(child.id, task.id);
    service.approveTask(parent.id, task.id);

    const first = service.undoApproval(parent.id, task.id);
    const second = service.undoApproval(parent.id, task.id);
    expect(second.reversedAmount).toBe(first.reversedAmount);
    expect(service.getBalance(child.id)).toBe(0);
    expect(first.reversedAmount).toBe(15);
    service.assertInvariant(child.id);
  });
});

describe('duplicate and late sessions', () => {
  it('ignores duplicate session reports', async () => {
    const { service, child } = createTestContext(20);
    const session = { appId: 'netflix', start: isoAt(BASE_TIME, 0), end: isoAt(BASE_TIME, 5) };

    const first = await service.reportUsageBatch(child.id, [session]);
    const second = await service.reportUsageBatch(child.id, [session]);

    expect(first[0].duplicate).toBe(false);
    expect(first[0].coveredMinutes).toBe(5);
    expect(second[0].duplicate).toBe(true);
    expect(service.getBalance(child.id)).toBe(15);
    service.assertInvariant(child.id);
  });

  it('applies late sessions chronologically against current ledger state', async () => {
    const { service, child } = createTestContext(10);

    await service.reportUsageBatch(child.id, [
      { appId: 'game', start: isoAt(BASE_TIME, 30), end: isoAt(BASE_TIME, 35) },
    ]);
    expect(service.getBalance(child.id)).toBe(5);

    await service.reportUsageBatch(child.id, [
      { appId: 'game', start: isoAt(BASE_TIME, 0), end: isoAt(BASE_TIME, 3) },
    ]);
    expect(service.getBalance(child.id)).toBe(2);
    service.assertInvariant(child.id);
  });
});

describe('balance exhaustion', () => {
  it('reports exact cutoff timestamp and partial coverage', async () => {
    const { service, child } = createTestContext(7);
    const start = BASE_TIME;
    const end = isoAt(start, 12);

    const [result] = await service.reportUsageBatch(child.id, [
      { appId: 'youtube', start, end },
    ]);

    expect(result.coveredMinutes).toBe(7);
    expect(result.rejectedMinutes).toBe(5);
    expect(result.balanceExhaustedAt).toBe(isoAt(start, 7));
    expect(service.getBalance(child.id)).toBe(0);
    service.assertInvariant(child.id);
  });
});
