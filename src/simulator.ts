import { createApp } from './index.js';
import { isoAt } from './test/helpers.js';

const BASE = '2026-09-01T07:00:00.000Z';

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function normalDay() {
  console.log('\n########## NORMAL DAY ##########\n');
  const { store, service } = createApp();
  const parent = store.createParent('Jordan');
  const child = store.createChild(parent.id, 'Riley', 30);

  const chores = [
    service.createTask(parent.id, child.id, 'Make bed', 5),
    service.createTask(parent.id, child.id, 'Walk dog', 15),
    service.createTask(parent.id, child.id, 'Practice piano', 20),
  ];

  for (const t of chores) service.markTaskDone(child.id, t.id);
  service.approveTask(parent.id, chores[0].id);
  service.approveTask(parent.id, chores[1].id);
  service.rejectTask(parent.id, chores[2].id);

  await service.reportUsageBatch(child.id, [
    { appId: 'youtube', start: isoAt(BASE, 0), end: isoAt(BASE, 10) },
    { appId: 'minecraft', start: isoAt(BASE, 10), end: isoAt(BASE, 25) },
  ]);

  const lateTask = service.createTask(parent.id, child.id, 'Read chapter', 10);
  service.markTaskDone(child.id, lateTask.id);
  service.approveTask(parent.id, lateTask.id);

  await service.reportUsageBatch(child.id, [
    { appId: 'kindle', start: isoAt(BASE, -60), end: isoAt(BASE, -45) },
  ]);

  service.assertInvariant(child.id);
  console.log('Normal day complete. Final balance:', service.getBalance(child.id));
}

async function everythingGoesWrong() {
  console.log('\n########## EVERYTHING GOES WRONG ##########\n');
  const { store, service } = createApp();
  const parent = store.createParent('Morgan');
  const child = store.createChild(parent.id, 'Casey', 15);

  const task = service.createTask(parent.id, child.id, 'Clean room', 40);
  service.markTaskDone(child.id, task.id);

  const a1 = service.approveTask(parent.id, task.id);
  const a2 = service.approveTask(parent.id, task.id);
  console.log('Double approve idempotent:', a2.idempotent, 'same entry:', a1.ledgerEntry.id === a2.ledgerEntry.id);

  const session = { appId: 'tiktok', start: isoAt(BASE, 0), end: isoAt(BASE, 10) };
  const [u1, u2] = await Promise.all([
    service.reportUsageBatch(child.id, [session]),
    service.reportUsageBatch(child.id, [session]),
  ]);
  console.log('Duplicate retry handled:', u1[0].duplicate === false, u2[0].duplicate === true);

  await service.reportUsageBatch(child.id, [
    { appId: 'roblox', start: isoAt(BASE, 0), end: isoAt(BASE, 12) },
    { appId: 'fortnite', start: isoAt(BASE, 0), end: isoAt(BASE, 12) },
  ]);

  await service.reportUsageBatch(child.id, [
    { appId: 'late-game', start: isoAt(BASE, -120), end: isoAt(BASE, -110) },
  ]);

  const wrongTask = service.createTask(parent.id, child.id, 'Wrong task approved', 25);
  service.markTaskDone(child.id, wrongTask.id);
  service.approveTask(parent.id, wrongTask.id);
  await service.reportUsageBatch(child.id, [
    { appId: 'youtube', start: isoAt(BASE, 60), end: isoAt(BASE, 80) },
  ]);
  const undo = service.undoApproval(parent.id, wrongTask.id);
  console.log('Undo after spending:', undo);

  const reapprove = service.approveTask(parent.id, wrongTask.id);
  console.log('Re-approve after undo credits again:', reapprove.idempotent === false);

  service.assertInvariant(child.id);
  console.log('Worst-case complete. Final balance:', service.getBalance(child.id));
  console.log('Ledger entries:', service.getLedger(child.id).length);
}

async function main() {
  console.log('RewardBank Simulator');
  await normalDay();
  await sleep(100);
  await everythingGoesWrong();
  console.log('\nAll simulator scenarios passed invariant checks.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
