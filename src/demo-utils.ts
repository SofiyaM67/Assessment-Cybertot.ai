import { LedgerEntry } from './types.js';

export function formatLedgerEntry(entry: LedgerEntry): string {
  const sign = entry.amount >= 0 ? '+' : '';
  const meta = entry.metadata ? ` ${JSON.stringify(entry.metadata)}` : '';
  return `  [${entry.timestamp}] ${entry.type} ${sign}${entry.amount} -> balance ${entry.balanceAfter}${meta}`;
}

export function printStep(title: string, balance: number, newEntries: LedgerEntry[]): void {
  console.log(`\n=== ${title} ===`);
  console.log(`Balance: ${balance} minutes`);
  if (newEntries.length === 0) {
    console.log('Ledger entries created: (none)');
  } else {
    console.log('Ledger entries created:');
    for (const e of newEntries) console.log(formatLedgerEntry(e));
  }
}

export function printFullLedger(ledger: LedgerEntry[]): void {
  console.log('\n=== FULL LEDGER ===');
  if (ledger.length === 0) {
    console.log('(empty)');
    return;
  }
  for (const e of ledger) console.log(formatLedgerEntry(e));
}

export function assertInvariant(ledger: LedgerEntry[], balance: number): void {
  const sum = ledger.reduce((acc, e) => acc + e.amount, 0);
  if (sum !== balance) {
    throw new Error(`INVARIANT FAILED: ledger sum=${sum}, balance=${balance}`);
  }
  console.log(`\n✓ Invariant holds: sum(${sum}) === balance(${balance})`);
}

export function entriesSince(ledger: LedgerEntry[], beforeCount: number): LedgerEntry[] {
  return ledger.slice(beforeCount);
}
