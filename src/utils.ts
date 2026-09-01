import { randomUUID } from 'crypto';

export function generateId(): string {
  return randomUUID();
}

export function generateToken(): string {
  return `tok_${randomUUID().replace(/-/g, '')}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function parseIso(iso: string): Date {
  return new Date(iso);
}

export function sessionMinutes(start: string, end: string): number {
  const ms = parseIso(end).getTime() - parseIso(start).getTime();
  if (ms < 0) throw new Error('Session end must be after start');
  return Math.ceil(ms / 60_000);
}

export function sessionKey(childId: string, appId: string, start: string, end: string): string {
  return `${childId}:${appId}:${start}:${end}`;
}

export function addMinutes(iso: string, minutes: number): string {
  return new Date(parseIso(iso).getTime() + minutes * 60_000).toISOString();
}

export function assertLedgerInvariant(entries: { amount: number }[], balance: number): void {
  const sum = entries.reduce((acc, e) => acc + e.amount, 0);
  if (sum !== balance) {
    throw new Error(`Ledger invariant violated: sum=${sum}, balance=${balance}`);
  }
}
