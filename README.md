# RewardBank

A ledger-based "screen time is earned" system. Parents assign tasks; approved tasks credit minutes to a child's balance. Device usage debits minutes. Every balance change is recorded in an append-only ledger, and the balance is always provable from the ledger sum.

## Stack

- **Runtime:** Node.js 20+
- **Language:** TypeScript
- **HTTP:** Express
- **Storage:** In-memory (suitable for assessment; designed for easy SQLite swap)
- **Tests:** Vitest

## Quick start

```bash
npm install
npm test          # run all tests
npm run demo      # end-to-end lifecycle demo with transcript
npm run simulate  # normal day + worst-case simulator scenarios
npm run dev       # start API server on port 3000
```

## API

All endpoints except `/health` and `POST /api/setup` require:

```
Authorization: Bearer <token>
```

| Method | Path | Who | Description |
|--------|------|-----|-------------|
| POST | `/api/setup` | — | Create demo parent + child (returns tokens) |
| POST | `/api/tasks` | Parent | Create task `{ childId, title, reward }` |
| POST | `/api/tasks/:id/done` | Child | Mark task done |
| POST | `/api/tasks/:id/approve` | Parent | Approve done task (credits ledger) |
| POST | `/api/tasks/:id/reject` | Parent | Reject done task |
| POST | `/api/tasks/:id/undo-approval` | Parent | Reverse approval (partial if already spent) |
| POST | `/api/usage/batch` | Child | Report sessions `{ sessions: [{ appId, start, end }] }` |
| GET | `/api/children/:id/balance` | Parent or child | Current balance (minutes) |
| GET | `/api/children/:id/ledger` | Parent or child | Full ledger history |

### Example

```bash
# Start server
npm run dev

# Create accounts
curl -s -X POST http://localhost:3000/api/setup

# Create task (parent token)
curl -s -X POST http://localhost:3000/api/tasks \
  -H "Authorization: Bearer <parent-token>" \
  -H "Content-Type: application/json" \
  -d '{"childId":"<child-id>","title":"Finish homework","reward":30}'

# Report usage (child token)
curl -s -X POST http://localhost:3000/api/usage/batch \
  -H "Authorization: Bearer <child-token>" \
  -H "Content-Type: application/json" \
  -d '{"sessions":[{"appId":"youtube","start":"2026-09-01T10:00:00Z","end":"2026-09-01T10:15:00Z"}]}'
```

## Design highlights

- **Ledger invariant:** `sum(ledger.amount) === currentBalance` — enforced in tests after every complex scenario.
- **Idempotency:** Double-approve and duplicate usage sessions are safe.
- **Per-child lock:** Concurrent usage batches serialize to prevent race conditions.
- **Chronological usage:** Sessions sorted by `start` before processing; late-arriving sessions debit against current balance.
- **Undo approval:** Reverses up to the current balance; minutes already spent are recorded as `unrecoverableAmount` (no negative balance).

## Project layout

```
src/
  index.ts        # HTTP server
  service.ts      # Core business logic
  store.ts        # In-memory persistence
  routes.ts       # API routes + auth
  demo.ts         # End-to-end demo (npm run demo)
  simulator.ts    # Scenario simulator (npm run simulate)
  test/           # Vitest tests
WRITEUP.md        # Design decisions and written answers
```

## Demo output

`npm run demo` prints step-by-step balance and ledger entries, ending with a full ledger dump and invariant assertion. See `WRITEUP.md` for detailed reasoning on edge cases.
