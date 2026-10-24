# Three workstreams

Initial owners: Arya, Gabriel, and Benjamin. Matias remains a team member and can pair on a stream or own demo testing. Reassign owners in GitHub Issues as needed.

| Owner | Workstream | Files to start with | First deliverable |
| --- | --- | --- | --- |
| Arya (`WILDROP321`) | Backend and business lifecycle — [issue #1](https://github.com/WILDROP321/sme-lending-pools/issues/1) | `services/api/lending_pool/routes.py`, `db.py`, `migrations/`, `reviews.py`, `tests/` | Investor records, contribution intents, and an explicit review/funding state model |
| Gabriel (`gableguen`) | Investor and SME experience — [issue #2](https://github.com/WILDROP321/sme-lending-pools/issues/2) | `services/api/lending_pool/templates/`, `static/` | Browse pools, select a pool, and submit an SME funding request using the existing API |
| Benjamin (`Benjileguen`) | XRPL Devnet integration — [issue #3](https://github.com/WILDROP321/sme-lending-pools/issues/3) | `services/api/lending_pool/ledger.py`, new ledger tests | Document the on-ledger pool model, create Devnet test accounts with a local script, and verify one validated test transaction |

Issues #1 and #2 are assigned in GitHub. Benjamin is named as the owner of #3 and now has write access to the repository.

## Shared rules

- Use one feature branch and pull request per task; request review from another owner.
- Agree on endpoint and JSON changes in `docs/API.md` before modifying shared contracts.
- Gabriel owns templates/static assets; Arya owns routes/schema; Benjamin owns ledger integration. Coordinate changes across those boundaries.
- Keep wallet seeds and local databases out of Git. Use only Devnet test accounts.
- Tests in CI must run without a live network. Put live Devnet experiments in separate opt-in scripts.

## Integration sequence

1. **Local skeleton (implemented):** Flask, local draft pools, SME requests, and read-only ledger status.
2. **Investor selection:** build the UI and investor/contribution intent records. An intent is not a confirmed deposit.

   Backend API ready for UI integration: `POST /api/investors`, `POST /api/contribution-intents`, and intent filtering by investor/pool. Local review endpoints and audit history are also available. See [API.md](API.md) for payloads and [DATABASE.md](DATABASE.md) before upgrading a local database.
3. **Devnet deposits:** choose and document the ledger mechanism, verify network/account settings, then attach validated transaction hashes to intents. Make reconciliation idempotent so repeated observations cannot credit twice.

   Implemented: `POST /api/contribution-intents/<id>/deposit` verifies a claimed `tx_hash` against Devnet itself (validated, sender, destination, delivered amount) before moving an intent from `pending` to `funded`. See [API.md](API.md) and [LEDGER_DESIGN.md](LEDGER_DESIGN.md).
4. **SME funding:** add review decisions and enforce available pool balance before disbursement. Record validated ledger results before marking requests funded.
5. **Repayment:** reconcile receipts and update balances, then build the demo story.

The pool records in the starter are application-level groups of capital. They do not create an XRPL AMM or any native lending object. Benjamin's first design task is to establish which ledger primitives and Devnet features fit this product before implementing custody, shares, or transfers.
