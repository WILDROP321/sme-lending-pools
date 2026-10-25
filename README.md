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

## Current implementation

The Flask UI reads validated XRPL data, authenticates wallet ownership through GemWallet signatures, and prepares RLUSD VaultDeposit, VaultWithdraw, TrustSet and LoanPay transactions for wallet signing. Only validated `tesSUCCESS` results are confirmed. Historical simulated balances are never imported into live positions.

**Default: standard Devnet, explicitly selected by Gabriel. Live RLUSD lending is blocked.** On 24 October 2026, standard Devnet supported native lending but no official RLUSD issuer could be verified there. Ripple documents an issuer on Testnet, where the native lending amendments were disabled. The dedicated Lending Devnet hostname was unavailable. No live deposit, loan or repayment has been submitted by this integration.

Pool detail pages follow the supplied dashboard reference. Missing balances and historical rates remain unavailable rather than displaying fictional data. Investor/borrower workflow and implementation limits are available in the app's **Workflow** screen and [integration documentation](docs/LENDING_INTEGRATION.md).

## Run locally

Use Python 3.13:

```sh
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements-dev.txt
cp .env.example .env
python -m flask init-db
python -m flask run --debug
```

Open http://127.0.0.1:5001. Existing users should back up SQLite and run `python -m flask migrate-db`. See [database instructions](docs/DATABASE.md). No seed data or private keys are needed. Keep the prototype bound to localhost and use synthetic invoice documents.

Install GemWallet and select the exact configured network. The backend checks the network ID; the frontend checks the wallet WebSocket endpoint. Configure a verified official issuer and real RLUSD Vault IDs only after these exist on the chosen network. See `.env.example` and the integration guide. Never substitute a self-issued token labelled RLUSD.

## Validation

```sh
python -m pytest -q
python scripts/check_lending_network.py --account YOUR_PUBLIC_ADDRESS
```

Unit tests mock RPC responses and exercise real local signature cryptography; they do not prove live lending. The diagnostic makes read-only network requests and exits 2 when prerequisites are missing. Browser checks cover pool navigation, mobile overflow, unavailable balances, missing wallet handling, workflow and invoice form rendering.

Historical simulation APIs are disabled by default. `ENABLE_SIMULATION=true` enables legacy local demonstration endpoints for development only; the current UI remains the ledger UI. Historical contracts are retained in `docs/API.md` and `docs/MARKET.md`.

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
