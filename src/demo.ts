import { createApp } from './index.js';
import {
  assertInvariant,
  entriesSince,
  printFullLedger,
  printStep,
} from './demo-utils.js';
import { isoAt } from './test/helpers.js';

const BASE = '2026-09-01T14:00:00.000Z';

async function main() {
  console.log('RewardBank End-to-End Demo');
  console.log('==========================\n');

  const { store, service } = createApp();
  const parent = store.createParent('Alex (Parent)');
  const child = store.createChild(parent.id, 'Sam (Child)', 20);

  let ledgerCount = 0;
  const snapshot = () => {
    const ledger = service.getLedger(child.id);
    const newEntries = entriesSince(ledger, ledgerCount);
    ledgerCount = ledger.length;
    return { ledger, newEntries, balance: service.getBalance(child.id) };
  };

  let { balance, newEntries } = snapshot();
  printStep('Setup: parent, child, starting balance 20', balance, newEntries);

  const usage1 = await service.reportUsageBatch(child.id, [
    { appId: 'YouTube', start: isoAt(BASE, 0), end: isoAt(BASE, 12) },
  ]);
  ({ balance, newEntries } = snapshot());
  printStep(
    `Child uses YouTube 12 min (covered ${usage1[0].coveredMinutes}, rejected ${usage1[0].rejectedMinutes})`,
    balance,
    newEntries
  );

  const usage2 = await service.reportUsageBatch(child.id, [
    { appId: 'Minecraft', start: isoAt(BASE, 12), end: isoAt(BASE, 25) },
  ]);
  ({ balance, newEntries } = snapshot());
  const u2 = usage2[0];
  printStep(
    `Balance hits zero: Minecraft 13 min requested, covered ${u2.coveredMinutes}, rejected ${u2.rejectedMinutes}, cutoff ${u2.balanceExhaustedAt}`,
    balance,
    newEntries
  );

  const task = service.createTask(parent.id, child.id, 'Finish homework', 30);
  service.markTaskDone(child.id, task.id);
  service.approveTask(parent.id, task.id);
  ({ balance, newEntries } = snapshot());
  printStep('Parent approves homework (+30 minutes)', balance, newEntries);

  const usage3 = await service.reportUsageBatch(child.id, [
    { appId: 'Roblox', start: isoAt(BASE, 30), end: isoAt(BASE, 40) },
  ]);
  ({ balance, newEntries } = snapshot());
  printStep(
    `Child resumes on new balance: Roblox 10 min (covered ${usage3[0].coveredMinutes})`,
    balance,
    newEntries
  );

  const undo = service.undoApproval(parent.id, task.id);
  ({ balance, newEntries } = snapshot());
  printStep(
    `Undo approval: reversed ${undo.reversedAmount} min, unrecoverable ${undo.unrecoverableAmount} min already spent`,
    balance,
    newEntries
  );

  const ledger = service.getLedger(child.id);
  printFullLedger(ledger);
  assertInvariant(ledger, service.getBalance(child.id));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
