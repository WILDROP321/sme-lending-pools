# SME Lending Pools

**Helping small and medium-sized enterprises access cash today against future incoming payments.**

## About our group

We are a group of friends building together for a hackathon. Our team is working across product, design, and engineering to explore how lending pools could help small businesses bridge the gap between making a sale and receiving payment.

This repository is our shared workspace. We will build different parts of the product, review one another's changes, and bring them together into a working demo.

### Our team

- Arya Prabhu
- [Gabriel Leguen](https://github.com/gableguen)
- [Benjamin Leguen](https://github.com/Benjileguen)
- Matias Neira

## The product

Small businesses often have incoming payments on the horizon while needing cash now for inventory, payroll, or day-to-day operations. Our idea is **lending pools that help SMEs unlock liquidity against future incoming transactions**.

In our proposed experience, a business submits an eligible future payment for review. A pool of capital can then fund an advance against that payment. When the payment arrives, it is reconciled with the outstanding advance under the agreed terms.

This is a hackathon prototype. The workflows below describe what we intend to explore; they are not claims of implemented features or a live lending service.

## Native Devnet lending

The app now uses real XRPL Devnet vaults, loans and repayments. Only the asset is mock: **MOCKRLUSD**, an issued Devnet token with no monetary value and no association with official Ripple RLUSD. Local balance simulation has been removed.

Three native closed-ended vaults and LoanBroker objects were deployed. Real Flask API flows validated deposits, withdrawals, two-party LoanSet origination and regular LoanPay repayment. The Devnet explorer confirms the native loan. See [transaction evidence](docs/native-devnet-evidence.json) and [workflow/setup](docs/LENDING_INTEGRATION.md).

GemWallet authenticates the user and signs user transactions. Native transaction signing through the actual extension still needs user-wallet testing; automated live tests used freshly generated test-wallet keys. Invoices and underwriting remain off-chain. The test broker has a fixed test-credit policy, not real invoice approval.

## Run locally

Use Python 3.13 and Node >=20.19:

```sh
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements-dev.txt
cp .env.example .env
python -m flask init-db
npm ci --prefix scripts/native --ignore-scripts
node scripts/native/deploy.mjs
python -m flask run --debug
```

The deployment script makes real Devnet transactions using new faucet-funded test accounts. It saves keys with restricted permissions under ignored `services/api/instance/`; never commit or share that file. The public manifest is loaded by Flask on startup. Restart Flask after deployment. Set `FLOW_NODE` to a compatible Node executable if necessary.

Open http://127.0.0.1:5001. The current preview uses port 5002. Connect GemWallet on standard Devnet, establish the MOCKRLUSD trust line in Your positions, then request test tokens. Deposits and withdrawals depend on each vault's subscription/redemption schedule. Get funded prepares native test loans from vaults in their investment phase.

```sh
python -m pytest -q
# Optional: submits REAL test transactions, using deployment test accounts:
python scripts/prove_native_lending.py
```

135 offline tests pass. Live proof results and the rejected early-full repayment are documented separately; offline tests are not presented as blockchain evidence.

## Three workstreams

| Owner | Focus | First task |
| --- | --- | --- |
| Arya | Flask backend and data | Investor records, contribution intents, and request lifecycle |
| Gabriel | Investor and SME UI | Pool browsing/selection and funding request form |
| Benjamin | XRPL Devnet | Ledger pool design, test accounts, and validated transaction proof |

Matias remains a team member and can pair on a stream or help test the demo. Full ownership boundaries and milestones are in [docs/TEAM_TASKS.md](docs/TEAM_TASKS.md).

## Project structure

```text
services/api/
  app.py                 Flask CLI entry point
  lending_pool/
    __init__.py          Application factory and configuration
    routes.py            JSON API — backend workstream
    db.py, migrations/   Versioned local persistence — backend workstream
    reviews.py           Funding request review state rules
    ledger.py            XRPL boundary — ledger workstream
    templates/, static/  Web screens — UI workstream
  instance/              Ignored local SQLite data
apps/web/                Reserved for a separate frontend if needed later
packages/shared/         Reserved for cross-service types if needed later
tests/                   Offline API and persistence tests
docs/                    API contract and team task plan
```

## Building together

Read [CONTRIBUTING.md](CONTRIBUTING.md). Pick your assigned GitHub issue, create a feature branch, and open a pull request into `main`. Ask another teammate to review. Agree on changes to shared endpoint fields in [docs/API.md](docs/API.md) before integrating them.

See [live integration and workflow](docs/LENDING_INTEGRATION.md) for protocol boundaries and remaining work.

## Mock company funding demo

Run `python -m flask init-db` to apply migration 006 and seed 50 fictional companies once. Get funded (`#borrow`) accepts company name, requested amount, debtor, and invoice due date without a wallet. SQLite persists applications through `GET/POST /api/mock-companies`; Applications (`#applications`) lists and filters them. Pool detail pages display matching mock companies separately from ledger assets.

Scores are random integers from 35–90 for new requests. Ranges are 0–19 Decline, 20–49 Risky (Opportunity), 50–69 Medium (Balanced Growth), and 70–100 Safe (Core Income). Higher scores mean safer companies. Seed records cover all four categories. “From” is the invoice start/submission date. The decided disbursement is an illustrative requested amount × score / 100, rounded to cents; declined seed records have zero. Amounts are stored as integer cents. No mock application or estimate initiates a loan or transfers funds.

## Hosted company database (Supabase)

The `flow-lending` project hosts `public.mock_companies`. Set `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, and `FLOW_SUPABASE_API_KEY` in the server's ignored `.env`, then restart Flask. The funding form, Applications list, Edit action, and pool company lists use this hosted store. `PATCH /api/mock-companies/<id>` updates the four form fields and recalculates the mock assessment. The pool is a generated Postgres column, so score changes always update its classification.

Only the company store moved to Supabase; wallet sessions, native lending intents, and the legacy invoice workflow still use SQLite. Hosted outages return 503 instead of falling back to a separate local company store. Without Supabase configuration, SQLite remains available for local development and isolated tests.

`supabase/schema.sql` documents the hosted schema and RLS policies. To provision another project, replace `FLOW_API_KEY_SHA256` with the SHA-256 hex digest of a new random server-only `FLOW_SUPABASE_API_KEY` before applying the schema. The publishable key alone cannot read or modify companies: RLS also verifies the backend header credential. No service-role key is used. Keep the backend credential out of browser code and Git. `supabase/seed.sql` contains only the fictional initial company snapshot; run it once on an empty table. New form submissions remain stored in Supabase across application restarts. This is a shared fictional demo; the Flask form and Applications list are available without user authentication.

## Mock vault accounting and funding certificates

The investment views now use mock vault accounts in Supabase, labelled **Mock vault assets**. The underlying XRPL balances are unchanged. Apply `supabase/mock_vaults.sql` once after `schema.sql`, replacing the same `FLOW_API_KEY_SHA256` placeholder. SQLite development uses migration 007. Each pool's opening balance is twice the sum of decided disbursements at initialization. It is a fixed opening balance, not recalculated when applications are added or edited.

- Deposit: `POST /api/mock-vaults/<Safe|Medium|Risky>/deposits` with `amount` and UUID `request_key`. The database credits the balance and records a transaction. Reusing the same key and amount returns the existing transaction; using that key for different details is rejected.
- Approval: `POST /api/mock-vaults/approvals/<company_id>` with `{}`. The database locks the application and pool, verifies pending status, a future invoice date and adequate funds, deducts the decided score-based amount, records a permanent certificate snapshot and marks the application approved. Repeated approval returns the same transaction. Declined applications cannot be funded. Approved applications cannot be edited.
- Accounts/history: `GET /api/mock-vaults` returns opening balances, current balances, deposited and disbursed totals, and transaction history. Balances never go negative. PostgreSQL functions run as the caller, with RLS requiring the private Flask backend header.
- Certificate: `GET /api/mock-vaults/certificates/<company_id>` is available only after successful approval. The printable HTML certificate includes the transaction reference, source pool, recipient company, approved transfer, invoice debtor/start/due dates and repayment terms. Use **Print / Save as PDF** to export it. Repayment is the full requested amount due on the invoice date; the transferred amount is the score-based advance. The certificate clearly identifies the transaction as simulated.

All these actions are a shared fictional demo. They do not require a wallet and do not transfer real currency, move on-chain tokens, or issue legally binding agreements. Native wallet and lending endpoints remain separate from mock accounting.

## Automatic mock funding

Apply `supabase/automatic_mock_funding.sql` after `mock_vaults.sql`. New requests (and edits to unfunded requests) automatically deduct their score-based decided amount and create their certificate within the database transaction. There is no manual approval step in the UI. Existing historical records are not backfilled. Requests with insufficient liquidity remain unfunded; add funds and resubmit the request. SQLite development follows the same flow in the company store.

The pool displays **Total vault assets** (remaining vault cash), **Assets on loan** (recorded disbursements), and **Current available withdrawal** (remaining available cash). Deposits increase cash, while automatic funding reduces cash and increases assets on loan.

## Current investor balances and earnings

Apply `supabase/investor_metrics.sql` after automatic funding (SQLite migration 008). Each pool has **1,000,000 MOCKRLUSD opening capital**. Existing deposits and company transfers remain recorded and are preserved when rebasing opening capital. Current pool cash is opening capital + deposits - company disbursements.

- **Total vault assets**: current pool cash.
- **Assets on loan**: the demo investor's deposited principal in this pool, not company disbursements.
- **Current available withdrawal**: accrued investment earnings only, capped by current pool cash. Principal is not included.

Rates stored in the database are Safe **5% APR**, Medium **10% APR**, Risky **20% APR**. Simple interest accrues from each deposit's UTC timestamp using a 365-day year: deposited cents × APR × elapsed seconds / seconds per year. Earnings are summed with decimal arithmetic and rounded down to cents. Rates, deposit amounts and timestamps persist; earnings are derived from those records at read time. Deposits immediately increase invested principal and pool cash. Company funding reduces pool cash without changing invested principal. The pool page refreshes earnings every 30 seconds without resetting the deposit form. Your positions shows the same calculated figures across all pools.

This prototype uses one shared mock investor account, matching its existing unauthenticated demo. All demo deposits contribute to that account's principal and earnings. These are simulated earnings, not realized on-chain returns. No earnings withdrawal transaction is implemented by displaying the availability figure.

### Existing company funding reconciliation

The 41 eligible initial mock companies are now funded in Supabase using the same atomic approval operation as new applications. Each has one disbursement receipt and certificate; declined companies receive no funds. `supabase/reconcile_existing_companies.sql` records this explicitly authorized one-time operation and is not run at startup. Replays skip approved companies.

Pool cash follows opening capital (1,000,000 MOCKRLUSD) + investor deposits − funded company disbursements. Investor principal remains the sum of deposits; company funding does not reduce it. Available withdrawal contains accrued interest only, capped by pool cash.
