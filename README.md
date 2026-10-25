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
