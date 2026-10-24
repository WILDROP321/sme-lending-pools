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

## Proposed demo flow

1. **Business submits a request:** enter the expected payment amount, due date, and supporting details.
2. **Request is reviewed:** assess eligibility and show proposed advance and repayment terms.
3. **Pool funds the advance:** simulate allocating available pool capital to an approved request.
4. **Business tracks progress:** view the request, advance, and expected repayment status.
5. **Payment is reconciled:** simulate receipt of the future payment and update the pool balance.

## MVP scope

- A business dashboard for submitting and tracking funding requests.
- A pool dashboard showing available capital and funded requests.
- A review flow with explicit approval and rejection states.
- A simulated funding and repayment lifecycle.
- Seeded demo data so the team can show the full experience.

For the demo, use synthetic business and transaction data. Real payment integrations, custody, underwriting, pricing, and production lending requirements remain future design decisions.

## Stack and current status

Python 3.13, Flask, SQLite, and `xrpl-py`, configured for **XRP Ledger (XRPL) Devnet**.

Implemented: a Flask homepage, local pools, demo investor records, pending contribution intents, SME funding requests, review decisions with history, versioned SQLite migrations, demo seeding, and a read-only Devnet status check. Deposits, wallet ownership, disbursement, and repayment are upcoming work. No ledger pool or wallet is created by the starter; local approval sends no funds.

## Run locally

Each teammate should clone the repository and create their own environment:

```sh
git clone https://github.com/WILDROP321/sme-lending-pools.git
cd sme-lending-pools
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements-dev.txt
cp .env.example .env
python -m flask init-db
python -m flask seed-demo
python -m flask run --debug
```

Use Python 3.13. On Windows, activate with `.venv\Scripts\activate` and copy the environment file with `copy .env.example .env`.

Open **http://127.0.0.1:5001**. Port 5001 avoids the common macOS port 5000 conflict. The development server binds to your own machine; this unauthenticated prototype is for local development.

If you are working in the original project folder where the environment is already prepared, start with `source .venv/bin/activate` and `python -m flask run --debug`.

`init-db` applies versioned migrations without deleting existing records. `seed-demo` adds a demo pool and investor when their tables are empty. SQLite data lives under `services/api/instance/` and is ignored by Git. Each teammate has independent demo data.

**Already using the original starter?** Back up your database, then run `python -m flask migrate-db` before starting the updated server. See [docs/DATABASE.md](docs/DATABASE.md) for backup and migration instructions. Pending migrations run together in a transaction and roll back if they fail.

The app works locally without XRPL access. Only `/api/xrpl/status` requires an internet connection. Keep `XRPL_JSON_RPC_URL` on Devnet. No credentials or wallet seed are needed for this starter.

## Check the setup

```sh
python -m pytest -q
python -m pip check
curl http://127.0.0.1:5001/api/health
curl http://127.0.0.1:5001/api/pools
curl http://127.0.0.1:5001/api/xrpl/status
```

Tests use temporary databases and mock ledger responses. GitHub Actions runs them on pushes and pull requests.

With Flask running, try the investor and review flow:

```sh
python scripts/demo_backend.py
```

Each run creates demo records, including a pending contribution intent and a locally approved request with review history. No funds move. The endpoint contracts and individual examples are in [docs/API.md](docs/API.md).

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

The local draft pool is an application record, not an XRPL AMM or native lending object. The XRPL workstream will choose the appropriate ledger mechanism before adding deposits or payments. Use synthetic business data and Devnet test funds throughout the hackathon.

References: [Flask application factories](https://flask.palletsprojects.com/en/stable/patterns/appfactories/), [XRPL Python quickstart](https://xrpl.org/docs/tutorials/get-started/get-started-python), [XRPL Devnet features](https://xrpl.org/docs/tutorials/advanced-developer-topics/protocol-development/testing-devnet-features).
