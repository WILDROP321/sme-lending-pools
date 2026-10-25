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

## Interactive investor demo

Open `http://127.0.0.1:5002/#pool/core`. The website uses `/api/investor-demo` for pool accounting, companies, receipts and certificates. Once the demo is initialized, the old mock API endpoints delegate to the same engine, so existing tabs cannot write into a separate balance store. Native Devnet APIs remain separate.

### Investor behavior

- A deposit immediately buys a proportional share of the current pool. The screen previews the new 30-day earnings before submission, including its increase over the current projection.
- **Safe 4–8%, Medium 8–12%, Risky 12–18%** are annual pool quote bands. The initial quote is each band's midpoint. Opening capital is represented by ten fictional founding investors; existing deposits are imported as the `You` account.
- Further deposits to `You` increase invested capital without inventing another investor. Select **New demo investor** on the Invest page, enter a name, then invest through a pool. Its first deposit creates a distinct participant, increasing the count and lowering the quote. Switch accounts from the same selector.
- **Get funded** creates a verified fictional request. Eligible companies join their score group, raise demand, and receive funding from available pool cash. Excess requests queue and are reconsidered when deposits or repayments add liquidity. Funding skips requests that cannot fit; requests are never partially disbursed.
- Investor joins below the floor and investor exits above the ceiling are rejected atomically. Company entries are always permitted, with the quote capped at the ceiling. Company exits below the floor are rejected; an outstanding loan must also be repaid before exit. Repayment itself is always allowed regardless of the membership guard.
- Withdrawals cannot exceed the investor's principal or available cash after reserving interest already credited to investors.

The rate formula uses a fixed baseline captured at initialization:

```
raw APR bps = midpoint bps × (active company members + 1) × baseline investor count
              / ((baseline company members + 1) × current investor count)
quoted APR = raw APR limited to the pool's permitted range
```

Membership includes queued and funded companies, plus repaid companies until they explicitly exit. The raw rate is checked before a guarded membership change; the UI shows the bounded quote. More company entries may increase raw demand beyond the ceiling without increasing the quote further.

### Projections and actual simulated receipts

```
your pool share = your invested principal / total invested capital
30-day projection = your share × outstanding funded principal × current APR × 30/365
annual projection = your share × outstanding funded principal × current APR
capital + received interest reserve = available cash + outstanding funded principal
```

These are forward scenarios at today's quote and utilization, not accrued balances or the sum of existing certificate obligations. Idle capital earns no projected interest. Increasing a deposit increases its share of projected interest; adding an investor changes both membership and utilization. Adding a funded company changes demand and deployed principal. Money uses integer cents, with projections rounded down.

**Simulate repayment** records an external fictional borrower payment of the certificate's agreed amount. It returns principal to cash and credits the actual agreed interest to current investor shares; rounding remainders are allocated deterministically so every cent balances. Interest received is displayed separately from projected earnings and reserved from principal withdrawals. It is a simulated account credit, not an on-chain payment. Loan repayment and repeated deposits are idempotent.

New loans keep the 5% origination fee. Their interest uses the pool APR at funding, locked for the term, with actual/365 day counting and maturity one day after the invoice payment date. Historical certificates retain their original terms. Amy's original walkthrough contract still has 70,000 principal, 66,500 net cash, a 3,500 fee and 5,600 fixed interest, totaling 75,600 due November 20, 2026.

### Amy's Cookies walkthrough

Open `/#workflow`: six interactive scenes show fictional sign-in, the Walmart invoice, scripted verification, Medium pool selection, animated disbursement and the actual saved certificate. Replaying uses the same request and receipt and never transfers twice. The login and checks are clearly marked as demo role-play; no real identity verification or invoice validation is claimed. The final screen embeds the printable certificate.

### Storage and deployment

Apply `supabase/investor_demo.sql` to the existing configured hosted project. It adds `demo_state` and `demo_revision` to the existing protected `mock_vaults` rows, with **no new grants, RPCs or RLS policies**. Existing private backend-header access is retained. SQLite uses migration 010; back up local data and run `python -m flask migrate-db`.

The engine imports existing company records, balances and receipts once per pool. Each subsequent mutation updates one complete pool document (accounts, memberships, queue and events) with compare-and-swap on the revision. Concurrent writes retry against the current state. An unsuccessful action does not commit. The original SQL columns and tables remain an import archive; the demo document is the authoritative current state after initialization. Restarting the app does not reseed or discard the simulation. Hosted outages never switch to a local store.

Primary API routes:

- `GET /api/investor-demo/vaults`, `GET /api/investor-demo/companies`
- `POST /api/investor-demo/<pool>/preview` — read-only hypothetical deposit and queue allocation
- `POST /api/investor-demo/<pool>/deposits` — amount, UUID request key, optional investor ID/name
- `POST /api/investor-demo/<pool>/withdrawals` — principal amount and UUID request key
- `POST /api/investor-demo/companies` — verified fictional request, classified and funded/queued
- `POST /api/investor-demo/companies/<id>/repay` or `/exit`
- `POST /api/investor-demo/approvals/<id>` — explicit funding for a queued/unverified request
- `POST /api/investor-demo/walkthrough` — create/retrieve Amy's fictional request once
- `GET /api/investor-demo/certificates/<id>` — preserved approval terms

Run `.venv/bin/python -m pytest -q`, `node --check services/api/lending_pool/static/app.js` and `git diff --check`. Tests cover preview parity, larger deposits, headcount and rate guards, company entry and exit, automatic queue funding, actual/365 interest, cash conservation, concurrent deposits, replay safety, repayments and preservation of Amy's original agreement.
