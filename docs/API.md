# Starter API contract

Base URL: `http://127.0.0.1:5001`. Request and response bodies use JSON. POST requests require `Content-Type: application/json`.

This is an unauthenticated local development API. It does not submit payments, accept deposits, or approve loans. All IDs belong to the local SQLite database.

| Method | Endpoint | Result |
| --- | --- | --- |
| GET | `/api/health` | Local process health; no ledger dependency |
| GET | `/api/pools` | `{"pools": [...]}` |
| POST | `/api/pools` | Create local draft pool; `{"pool": {...}}`, HTTP 201 |
| GET | `/api/pools/<id>` | `{"pool": {...}}` or HTTP 404 |
| GET | `/api/funding-requests` | `{"funding_requests": [...]}` |
| POST | `/api/funding-requests` | Create submitted request; `{"funding_request": {...}}`, HTTP 201 |
| GET | `/api/xrpl/status` | Read-only Devnet status, or HTTP 503 if unavailable |

## Create a pool

```sh
curl -X POST http://127.0.0.1:5001/api/pools \
  -H 'Content-Type: application/json' \
  -d '{"name":"Working Capital","description":"Demo SME pool"}'
```

Fields: `name` (required, 1–120 characters after trimming; original input at most 120), `description` (optional text, at most 2,000 characters). Server-owned fields include `id`, `currency: "XRP"`, `status: "draft"`, and `created_at` (UTC database timestamp).

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

## Errors

```json
{"error":{"code":400,"message":"name must be non-empty text, up to 120 characters."}}
```

Malformed or invalid JSON fields return 400; missing resources return 404; a missing JSON content type returns 415. Ledger connectivity failures return 503 without affecting local health.

## XRPL boundary

The configured default is `https://s.devnet.rippletest.net:51234/`. Keep `XRPL_JSON_RPC_URL` on Devnet. `/api/xrpl/status` calls `server_info` through `xrpl-py` and returns `network`, `read_only`, `server_state`, and `validated_ledger`. It never creates an account or sends a transaction.

References: [XRPL Python getting started](https://xrpl.org/docs/tutorials/get-started/get-started-python), [XRPL Devnet features](https://xrpl.org/docs/tutorials/advanced-developer-topics/protocol-development/testing-devnet-features), [Flask application factories](https://flask.palletsprojects.com/en/stable/patterns/appfactories/).
