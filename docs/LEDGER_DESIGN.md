# XRPL Devnet pool design (Benjamin, issue #3)

Covers both directions of the same mechanism: investor → pool (deposits,
`deposits.py`) and pool → business (disbursements, `disbursements.py`).

## Mechanism chosen

Pooled investor capital is **not** modeled as an XRPL AMM, an issued-currency
token, or any other native "pool" primitive. For this milestone it is:

- **Custody:** one Devnet account per lending pool, acting as a plain custodial
  wallet. A single secret controls it for the hackathon; multisigning
  (`SignerListSet`) or regular-key rotation is a later hardening step, not
  needed to prove the integration.
- **Deposit and disbursement primitive:** a native **Payment** transaction of
  XRP (drops) — investor → pool for a deposit, pool → business for a
  disbursement. No issued currencies, no AMM, no escrow — the simplest
  primitive that Devnet supports well and that `xrpl-py` can submit and
  verify directly.
- **Correlation:** each Payment carries a **Memo** (`MemoType: reference_id`,
  `MemoData: <intent or funding-request id>`, both hex-encoded per XRPL
  convention) so a validated transaction can be matched back to the
  application-level record that requested it.
- **Balance / share accounting:** stays **off-ledger**, in the existing SQLite
  database (Arya's workstream). The ledger only proves "this amount of XRP
  moved, in this validated transaction, for this record." Investor share of a
  pool, and a pool's available balance for disbursement, are calculations
  over the recorded, validated transactions for that pool — never on-ledger
  objects.
- **Idempotent crediting:** reconciliation must key off the transaction's
  `hash`, not off the act of observing it. The same validated transaction can
  be observed more than once (polling, retries, webhooks firing twice) and must
  only be credited once. Enforced two ways: `ledger_receipts.tx_hash` (deposits,
  migration 005) and `disbursements.tx_hash` (disbursements, migration 006)
  are both `UNIQUE`, so the database itself refuses a second row for the same
  transaction; `ledger.ProcessedDeposits` is the same guard for code paths
  (scripts, polling loops) that check a transaction before it would hit that
  constraint.

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
- `IntegrationResult` — `tx_hash`, `validated`, `amount_drops`, `reference_id`
  (an opaque caller label, not read from the chain), `sender_address`,
  `destination_address` (both read from the transaction). This is the shape
  both reconciliation modules below need to credit one record.
- `submit_test_payment(client, wallet, destination, amount_drops, reference_id)` —
  builds, signs, submits, and waits for validation of one memo-tagged Payment.
- `fetch_validated_transaction(client, tx_hash, reference_id)` — looks up an
  existing transaction by hash and reports whether it is validated, independent
  of whichever process originally submitted it.
- `ProcessedDeposits` — in-memory idempotency guard; `record_if_new(result)`
  returns `True` only the first time a given *validated* `tx_hash` is seen.

Two modules wire this into the app, each owning one direction:

- `services/api/lending_pool/deposits.py` — `confirm_deposit(client, intent_id,
  tx_hash)` loads the intent, investor, and pool; requires both to have a
  registered `xrpl_address`; verifies sender (investor), destination (pool),
  and delivered amount; inserts a `ledger_receipts` row and flips the intent
  to `funded`. Called only by `POST /api/contribution-intents/<id>/deposit`.
- `services/api/lending_pool/disbursements.py` — `confirm_disbursement(client,
  request_id, tx_hash)` loads the funding request and its pool; requires the
  request to be `approved` and both to have a registered `xrpl_address`;
  computes the pool's available balance (sum of its `funded` contribution
  intents minus everything already disbursed against it) and rejects if the
  request exceeds it; verifies sender (pool), destination (business), and
  delivered amount; inserts a `disbursements` row and flips the request to
  `funded`. Called only by `POST /api/funding-requests/<id>/disburse`.

Both run their checks and the final write in one `BEGIN IMMEDIATE` SQLite
transaction, so a concurrent attempt against the same record serializes
rather than racing. Repayment reconciliation is the next milestone per
`docs/TEAM_TASKS.md`.

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

## Reproduced validated transactions (proof)

Run on Devnet while building these milestones:

| Direction | tx_hash | amount_drops | sender | destination |
| --- | --- | --- | --- | --- |
| Deposit (investor → pool) | [`EEC615ACB705D77793EEE2F7D5403F9CE8AFF75C43ABA5CF94E361B8F7976BB5`](https://devnet.xrpl.org/transactions/EEC615ACB705D77793EEE2F7D5403F9CE8AFF75C43ABA5CF94E361B8F7976BB5) | `1000000` | `rp6DmgUgmNJKDSA3fvp7mcBrVPb7nf5Ukw` (investor) | `rha121AnWYSBKebkxjzVFgfgEpsFVZ4C8E` (pool) |
| Disbursement (pool → business) | [`29C2A1DBE71AC7446EAF6F9534EFDC6A2252E62EE43B8547F72ECD9B2C7FF7D7`](https://devnet.xrpl.org/transactions/29C2A1DBE71AC7446EAF6F9534EFDC6A2252E62EE43B8547F72ECD9B2C7FF7D7) | `1000000` | `rha121AnWYSBKebkxjzVFgfgEpsFVZ4C8E` (pool) | `rEqBWHm1jSCU2VJw4VMiYuyCsqyjqzhB3b` (business) |

To reproduce from a clean checkout:

1. `python -m venv .venv && source .venv/bin/activate` (or `.venv\Scripts\activate` on Windows)
2. `pip install -r requirements-dev.txt`
3. `python scripts/devnet_create_test_accounts.py`
4. `python scripts/devnet_submit_test_payment.py my-reference-id 1000000`
5. Copy the printed `tx_hash` into the explorer URL above to inspect it independently of this repo.

A disbursement needs a third Devnet account to act as the business, funded
the same way (`xrpl.wallet.generate_faucet_wallet`); `scripts/
devnet_submit_test_payment.py` currently models the investor → pool
direction only, so the pool → business transaction above was submitted with
`ledger.submit_test_payment` directly rather than via a dedicated script.

Either hash can also be re-verified at any time with
`ledger.fetch_validated_transaction(client, tx_hash, reference_id)`, which
does not depend on having submitted the transaction in the same process.

Both transactions were also used to exercise the full app end to end
against live Devnet (not mocked), through the `/devnet` UI: the deposit
hash funded a contribution intent (and a replay against a second intent,
and a re-confirmation of the first, both correctly returned 409); the
disbursement hash then moved an approved funding request to `funded` (and a
second request exceeding the pool's remaining balance was correctly
rejected with the exact insufficient-balance message before any ledger
lookup was even needed).

## IntegrationResult shape

`IntegrationResult` carries `sender_address` and `destination_address`, read
from the transaction itself (`tx_json.Account`/`Destination`), not supplied
by the caller — a caller cannot claim a different sender or destination than
what actually signed and received the payment. `reference_id` is the one
field callers do supply, purely for their own correlation; it is never used
to decide whether to credit anything. This is the record `deposits.confirm_deposit`
and `disbursements.confirm_disbursement` each store once per validated
`tx_hash`, after independently matching sender/destination/amount against
the investor+pool or pool+business on file.
