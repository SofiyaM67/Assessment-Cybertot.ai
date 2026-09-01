# RewardBank — Writeup

## Assumptions

- **Minutes are whole numbers.** Usage duration is rounded up to the nearest minute (`ceil` of elapsed ms). Fractional minutes would require a policy (floor vs ceil); ceil is stricter for parents.
- **Sessions are half-open intervals** from `start` (inclusive) to `end` (exclusive in spirit, but we use `ceil` on the delta). A 10:00–10:01 session is 1 minute.
- **One parent, one child per assessment scope.** Multi-child families would share the same patterns with `parentId` scoping.
- **In-memory storage** is sufficient for the assessment; the `Store` abstraction is the seam where SQLite/Postgres would plug in.
- **Auth is a static bearer token** per actor — no expiry, no refresh. Good enough to demonstrate authorization boundaries.
- **Late sessions debit against the balance at processing time**, not retroactively re-writing history. The ledger is append-only; we do not go back and alter past `balanceAfter` values. Late sessions still record their historical `start`/`end` in metadata.
- **Concurrent sessions with the same start time** are ordered deterministically by stable sort (input order for ties). In production I would add an explicit `sessionId` from the device.

## Double-click Approve (200ms apart)

**Behavior:** The first request transitions the task `done → approved` and appends one `TASK_APPROVAL` ledger entry. The second request sees status `approved`, finds the existing ledger entry, and returns it with `idempotent: true`. **No second credit.**

**Proof:** `src/test/service.test.ts` — test `"credits reward only once and returns idempotent on second call"`.

```typescript
const first = service.approveTask(parent.id, task.id);
const second = service.approveTask(parent.id, task.id);
expect(first.ledgerEntry.id).toBe(second.ledgerEntry.id);
expect(service.getBalance(child.id)).toBe(30); // not 60
```

## Two apps, same time, balance exceeded — ledger walkthrough

**Setup:** Child has **10** minutes. Two sessions arrive in one batch, both `start=T0`, both 8 minutes long (Roblox and TikTok).

**Processing:** Sessions are sorted by `start` (tie → stable order). A per-child lock ensures one batch at a time.

| Step | Entry type | Amount | Balance after | Notes |
|------|-----------|--------|---------------|-------|
| 0 | (starting) | — | 10 | |
| 1 | `USAGE` | -8 | 2 | Roblox: 8 covered, 0 rejected. Cutoff would be T0+8m if partial |
| 2 | `USAGE` | -2 | 0 | TikTok: 2 covered, 6 rejected |
| 3 | `USAGE_REJECTED` | 0 | 0 | Metadata: `rejectedMinutes: 6`, `balanceExhaustedAt: T0+2m` |

**Total debited:** 10. **Invariant holds:** sum(entries) = 10 = balance.

The `USAGE_REJECTED` entry has `amount: 0` so the invariant is not disturbed, but the rejection is auditable in metadata.

## Undo approval when balance would go negative

**Design:** Reverse `min(originalReward, currentBalance)`. Record `unrecoverableAmount = originalReward - reversedAmount` in metadata.

**Example:** Approve +30, child spends 22, balance = 8. Undo reverses 8, `unrecoverableAmount = 22`. Balance becomes 0, not -22.

**Why this is right for a parent-child product:**

- **No punishment debt.** Negative balance would mean the child "owes" future screen time before they've earned it — confusing and demoralizing.
- **Honest accounting.** The ledger shows exactly what was recovered and what was already consumed. Parents see "22 minutes were already used and cannot be clawed back."
- **Forward-looking.** The child keeps any other legitimately earned minutes untouched; we only pull back what's still in the "account."
- **Alternative rejected:** Blocking undo entirely when balance < reward frustrates parents who mis-clicked. Full clawback via negative balance creates a support nightmare.

If zero balance remains, we still write a `TASK_APPROVAL_REVERSAL` entry with `amount: 0` and explanatory metadata so the action is on the audit trail.

## Scaling to 100,000 children

**First thing that breaks:** The **per-process in-memory store and per-child mutex in a single Node process**. All state lives in one heap; one server can't hold 100k active children with streaming usage, and horizontal scaling breaks the in-memory lock.

**Fix (first step):**

1. **Persistent ledger in PostgreSQL** (or similar) with `child_id` partitioning.
2. **Serialize mutations per child** using `SELECT ... FOR UPDATE` on a `child_balances` row, or a per-child queue (SQS/Kafka keyed by `childId`).
3. **Stateless API tier** behind a load balancer; no in-memory session state.
4. **Idempotency keys** on usage sessions stored in DB with a unique constraint.

Later: read replicas for ledger queries, event sourcing for analytics, rate limiting on usage ingest.

## Deliberately not built (one more week)

| Not built | How I'd add it |
|-----------|----------------|
| Persistent database | SQLite via `better-sqlite3` or Postgres; migrate `Store` to repository pattern |
| Parent dashboard / UI | React SPA or mobile app consuming the same API |
| Push notifications | Notify child on approval, parent on task-done |
| Scheduled "daily allowance" | Cron job + `ALLOWANCE` ledger entry type |
| Multi-parent households | `parent_child` join table, shared custody rules |
| Device registration | Device tokens separate from child tokens; bind device → child |
| Webhook callbacks | Parent webhook on balance zero, task done |
| Admin audit export | CSV export of ledger with signed checksum |
| Rate limiting / abuse prevention | Per-token rate limits on usage batch endpoint |
| True retroactive session reordering | If business required "process as if session arrived on time", a recomputation job would need to rebuild ledger from a canonical event log — intentionally avoided to keep append-only semantics simple |

## Additional edge cases handled

- **Duplicate usage reports:** Session key = `childId:appId:start:end`. Second report returns `duplicate: true`, no ledger change.
- **Late offline sessions:** Processed when received; debit current balance; metadata preserves original timestamps.
- **Reject task:** Status change only, no ledger entry (no credit was ever made).
- **Re-approve after undo:** Task returns to `done`; parent can approve again for a fresh credit.
