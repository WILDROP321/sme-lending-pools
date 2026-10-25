> Historical prototype documentation. Legacy financial APIs require `ENABLE_SIMULATION=true`; they are not native RLUSD lending. See [current integration](LENDING_INTEGRATION.md).

# XRPL Devnet pool design (Benjamin, issue #3)

## Mechanism chosen

Pooled investor capital is **not** modeled as an XRPL AMM, an issued-currency
token, or any other native "pool" primitive. For this milestone it is:

- **Custody:** one Devnet account per lending pool, acting as a plain custodial
  wallet. A single secret controls it for the hackathon; multisigning
  (`SignerListSet`) or regular-key rotation is a later hardening step, not
  needed to prove the integration.
- **Deposit primitive:** a native **Payment** transaction of XRP (drops) from an
  investor's Devnet account to the pool's Devnet account. No issued currencies,
  no AMM, no escrow — the simplest primitive that Devnet supports well and that
  `xrpl-py` can submit and verify directly.
- **Intent correlation:** each Payment carries a **Memo** (`MemoType: intent_id`,
  `MemoData: <contribution intent id>`, both hex-encoded per XRPL convention) so
  a validated transaction can be matched back to the application-level
  contribution intent that requested it.
- **Balance / share accounting:** stays **off-ledger**, in the existing SQLite
  database (Arya's workstream). The ledger only proves "this amount of XRP
  moved, in this validated transaction, for this intent." Investor share of a
  pool is a future calculation over the recorded, validated deposits for that
  pool — it is not an on-ledger object.
- **Idempotent crediting:** reconciliation must key off the transaction's
  `hash`, not off the act of observing it. The same validated transaction can
  be observed more than once (polling, retries, webhooks firing twice) and must
  only be credited once. See `ledger.ProcessedDeposits` below; a real
  implementation should back this with a unique constraint on `tx_hash` in
  whatever table eventually records deposits.

## Why not an AMM

An AMM prices a swap between two assets and is designed for anyone to trade
against. A lending pool here needs custody of contributions and a record of
who contributed what, not a market-making curve. Using an AMM would need the
pool to hold a second asset and would expose the pool's funds to impermanent
loss from unrelated trading — neither of which has anything to do with
funding SME advances.

## Why delivered_amount, not the requested Amount

`ledger._integration_result_from_tx_result` reads `meta.delivered_amount`,
not `tx_json.Amount`/`DeliverMax`. XRPL Payments can partially deliver (e.g.
with `tfPartialPayment`), so the requested amount and the amount that actually
moved can differ. Crediting the requested amount instead of the delivered
amount would let a payer under-fund a contribution while the pool recorded
the amount they intended to send.

## What's implemented (`services/api/lending_pool/ledger.py`)

- `fetch_server_info` — unchanged read-only Devnet status (existing starter).
- `IntegrationResult` — `tx_hash`, `validated`, `amount_drops`, `intent_id`.
  This is the shape Arya's reconciliation step needs to credit one intent.
- `submit_test_payment(client, wallet, destination, amount_drops, intent_id)` —
  builds, signs, submits, and waits for validation of one memo-tagged Payment.
- `fetch_validated_transaction(client, tx_hash, intent_id)` — looks up an
  existing transaction by hash and reports whether it is validated, independent
  of whichever process originally submitted it.
- `ProcessedDeposits` — in-memory idempotency guard; `record_if_new(result)`
  returns `True` only the first time a given *validated* `tx_hash` is seen.

None of this is wired into a Flask route. Deposits, disbursement, and
repayment reconciliation are later milestones per `docs/TEAM_TASKS.md`.

## Opt-in Devnet scripts (`scripts/`)

Not part of the test suite or CI — both talk to the live Devnet and the
faucet.

```sh
python scripts/devnet_create_test_accounts.py
python scripts/devnet_submit_test_payment.py [intent_id] [amount_drops]
```

`devnet_create_test_accounts.py` funds two Devnet accounts (pool custodian,
investor) via the Devnet faucet and writes their addresses and seeds to
`services/api/instance/devnet_accounts.json`. That path is covered by the
existing `instance/` rule in `.gitignore` — **never commit that file.**

`devnet_submit_test_payment.py` reads those seeds, submits one memo-tagged
Payment from the investor account to the pool account, waits for a validated
result, prints the `IntegrationResult`, and writes it to
`services/api/instance/devnet_proof.json` (also git-ignored).

## Reproduced validated transaction (proof)

Run on Devnet while building this milestone:

- `tx_hash`: `EEC615ACB705D77793EEE2F7D5403F9CE8AFF75C43ABA5CF94E361B8F7976BB5`
- `validated`: `true`
- `amount_drops`: `1000000` (1 XRP)
- `intent_id`: `intent-demo-001`
- Inspect: <https://devnet.xrpl.org/transactions/EEC615ACB705D77793EEE2F7D5403F9CE8AFF75C43ABA5CF94E361B8F7976BB5>

To reproduce from a clean checkout:

1. `python -m venv .venv && source .venv/bin/activate` (or `.venv\Scripts\activate` on Windows)
2. `pip install -r requirements-dev.txt`
3. `python scripts/devnet_create_test_accounts.py`
4. `python scripts/devnet_submit_test_payment.py my-intent-id 1000000`
5. Copy the printed `tx_hash` into the explorer URL above to inspect it independently of this repo.

The same hash can also be re-verified at any time with
`ledger.fetch_validated_transaction(client, tx_hash, intent_id)`, which does not
depend on having submitted the transaction in the same process.

## Integration result for Arya

`IntegrationResult(tx_hash, validated, amount_drops, intent_id)` is the record
a future `/api/*` reconciliation endpoint should store once per validated
`tx_hash`: look up the `funding_requests`/contribution-intent row by
`intent_id`, and only mark a deposit credited if
`ProcessedDeposits.record_if_new(result)` returns `True`.
