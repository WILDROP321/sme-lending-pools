> Historical prototype documentation. Legacy financial APIs require `ENABLE_SIMULATION=true`; they are not native RLUSD lending. See [current integration](LENDING_INTEGRATION.md).

# Starter API contract

Base URL: `http://127.0.0.1:5001`. Request and response bodies use JSON. POST requests require `Content-Type: application/json`.

This is an unauthenticated local development API. Review decisions are local demo records, not lending authorization. It does not submit payments or accept deposits. All IDs belong to the local SQLite database. Demo investors are records, not authenticated users or verified wallet owners.

| Method | Endpoint | Result |
| --- | --- | --- |
| GET | `/api/health` | Local process health; no ledger dependency |
| GET | `/api/pools` | `{"pools": [...]}` |
| POST | `/api/pools` | Create local draft pool; `{"pool": {...}}`, HTTP 201 |
| GET | `/api/pools/<id>` | `{"pool": {...}}` or HTTP 404 |
| GET | `/api/investors` | `{"investors": [...]}` |
| POST | `/api/investors` | Create demo investor; `{"investor": {...}}`, HTTP 201 |
| GET | `/api/investors/<id>` | `{"investor": {...}}` or HTTP 404 |
| GET | `/api/contribution-intents` | `{"contribution_intents": [...]}`; optional `pool_id` and `investor_id` filters |
| POST | `/api/contribution-intents` | Create pending intent; `{"contribution_intent": {...}}`, HTTP 201 |
| GET | `/api/contribution-intents/<id>` | `{"contribution_intent": {...}}` or HTTP 404 |
| GET | `/api/funding-requests` | `{"funding_requests": [...]}` |
| POST | `/api/funding-requests` | Create submitted request; `{"funding_request": {...}}`, HTTP 201 |
| GET | `/api/funding-requests/<id>` | `{"funding_request": {...}, "reviews": [...]}` |
| POST | `/api/funding-requests/<id>/review` | Apply allowed review transition; `{"funding_request": {...}}`, HTTP 200 |
| GET | `/api/xrpl/status` | Read-only Devnet status, or HTTP 503 if unavailable |

## Create a pool

```sh
curl -X POST http://127.0.0.1:5001/api/pools \
  -H 'Content-Type: application/json' \
  -d '{"name":"Working Capital","description":"Demo SME pool"}'
```

Fields: `name` (required, 1–120 characters after trimming; original input at most 120), `description` (optional text, at most 2,000 characters). Server-owned fields include `id`, `currency: "XRP"`, `status: "draft"`, and `created_at` (UTC database timestamp).

## Investor selects a pool

Create a demo investor:

```sh
curl -X POST http://127.0.0.1:5001/api/investors \
  -H 'Content-Type: application/json' \
  -d '{"name":"Demo Investor"}'
```

Only `name` is accepted (non-empty text, at most 120 characters). The response includes `id`, `name`, and `created_at`. Duplicate names are allowed; use IDs to identify records. This endpoint does not create a wallet.

Use the returned investor ID and an existing pool ID to record an intent:

```sh
curl -X POST http://127.0.0.1:5001/api/contribution-intents \
  -H 'Content-Type: application/json' \
  -d '{"investor_id":1,"pool_id":1,"amount_drops":50000000}'
```

All three fields are required positive signed 64-bit integers; booleans, fractions, and numeric strings are rejected. Missing investor/pool records return 404. The response includes `id`, `investor_id`, `pool_id`, `amount_drops`, `status: "pending"`, and `created_at`.

An intent can select a draft pool, because it records interest only. It does not transfer funds, alter a pool balance, or represent withdrawable capital. Client-supplied `status`, transaction hashes, and all other unknown fields are rejected with 400. The database also constrains intent status to `pending`; no confirmation endpoint exists in this milestone. Repeated POSTs create separate pending intents, so the UI should avoid duplicate submissions.

Filter selections with `GET /api/contribution-intents?investor_id=1&pool_id=1`. Filters must be positive signed 64-bit integers. Matching no records returns an empty array. For a single record, use `GET /api/contribution-intents/<id>`.

## Submit a funding request

Use an existing pool ID and replace the sample date with a future date.

```json
{
  "pool_id": 1,
  "business_name": "Demo Bakery",
  "amount_drops": 25000000,
  "expected_payment_date": "2099-12-01"
}
```

`amount_drops` is a positive integer, never a decimal or boolean. 1 XRP = 1,000,000 drops. The starter stores amounts up to the SQLite signed 64-bit integer limit; this is a storage limit, not an underwriting or ledger eligibility rule. `business_name` must be non-empty text up to 160 characters. Dates must be future dates in `YYYY-MM-DD` format, evaluated using the server's date. The initial status is `submitted`.

## Review a funding request

Use `POST /api/funding-requests/<id>/review` with `status` and optional `note` (text up to 2,000 characters). Only those two fields are accepted.

```json
{"status":"under_review","note":"Checking the synthetic invoice"}
```

Then, after review:

```json
{"status":"approved","note":"Demo request meets our example criteria"}
```

| Current state | Allowed next states | Available in this API? |
| --- | --- | --- |
| `submitted` | `under_review`, `cancelled` | Yes |
| `under_review` | `approved`, `rejected`, `cancelled` | Yes |
| `approved` | `cancelled` | Yes |
| `approved` | `funded` | Reserved for validated disbursement integration |
| `funded` | `repaid`, `defaulted` | Reserved for repayment/default integration |
| `rejected`, `cancelled`, `repaid`, `defaulted` | None | Terminal states |

Review calls cannot set `funded`, `repaid`, or `defaulted`; unsupported targets return 400. A valid review target that cannot follow the current state returns 409, including a repeated decision. Direct `submitted → approved` is disallowed. A review changes no balance and sends no funds.

Every successful review creates a history record with `funding_request_id`, `from_status`, `to_status`, `note`, `id`, and UTC `created_at`. The status update and audit insert are one transaction; concurrent reviews are serialized so an invalid repeat cannot create a second audit record. Read history with `GET /api/funding-requests/<id>`. The prototype has no reviewer authentication or authorization; notes are not proof of who made a decision.

## Reproduce the backend flow

After migrating the database and starting Flask, run:

```sh
python scripts/demo_backend.py
```

This adds a new investor, pool, pending intent, and submitted request, advances the request through review to local approval, and prints the records and history. Each run adds new demo records. No live ledger access is needed. See [DATABASE.md](DATABASE.md) for upgrades from the original starter.

## Errors

```json
{"error":{"code":400,"message":"name must be non-empty text, up to 120 characters."}}
```

Malformed or invalid JSON fields return 400; missing resources return 404; illegal review transitions return 409; a missing JSON content type returns 415. Ledger connectivity failures return 503 without affecting local health. Existing create-pool/request fields and response envelopes are unchanged.

## XRPL boundary

The configured default is `https://s.devnet.rippletest.net:51234/`. Keep `XRPL_JSON_RPC_URL` on Devnet. `/api/xrpl/status` calls `server_info` through `xrpl-py` and returns `network`, `read_only`, `server_state`, and `validated_ledger`. It never creates an account or sends a transaction.

For Benjamin's next milestone: reconcile a pending intent only after independently verifying a successful, validated Devnet transaction, its destination/pool, sender ownership, amount/currency, and a unique transaction hash. A claimed client hash or local approval is insufficient. The current migration intentionally provides neither confirmation nor balance-crediting functionality; add that with the reconciliation design and tests in a later migration.

References: [XRPL Python getting started](https://xrpl.org/docs/tutorials/get-started/get-started-python), [XRPL Devnet features](https://xrpl.org/docs/tutorials/advanced-developer-topics/protocol-development/testing-devnet-features), [Flask application factories](https://flask.palletsprojects.com/en/stable/patterns/appfactories/).
