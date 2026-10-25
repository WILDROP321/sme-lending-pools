> Historical prototype documentation. Legacy financial APIs require `ENABLE_SIMULATION=true`; they are not native RLUSD lending. See [current integration](LENDING_INTEGRATION.md).

# RLUSD demo market

## Risk classification and pricing

This is a deterministic, versioned classifier (`invoice-v1`), not unsupervised clustering or a calibrated default model. Businesses are grouped by their computed score. The score is displayed as a percentage for the product's risk tiers; it must not be treated as a probability of loss.

Inputs and score components:

| Component | Points |
| --- | --- |
| Base | 0.5 |
| Maturity | 3 × days to deadline / 180 |
| Advance ratio | 3 × (advance / invoice / 0.85)² |
| Debtor history | 5 × historical late-payment percentage / 100 |
| Business history | 3 × (1 − min(years trading, 10) / 10) |

Components are rounded to four decimal places and their sum to two. At a fixed set of other inputs, later deadlines, larger advance ratios, more late payments, and shorter operating histories increase the score. Industry and use of funds are recorded for review and concentration visibility, but do not silently alter the score.

| Pool | Score band | Illustrative annual principal-loss scenario |
| --- | --- | --- |
| Core Income | 0 through 3 | 2% |
| Balanced Growth | greater than 3 through 7 | 6% |
| Opportunity | greater than 7 through 15 | 12% |

All supported inputs produce a score within these bands. Sample companies and new applications use the same function. Sample maturities are relative to today so the demo remains usable; they do not represent historical loans.

Borrowing APR (%) = 6 + 1.2 × score. Interest in RLUSD cents = round-half-up(advance cents × APR / 100 × days / 365). Repayment = principal + interest. Approval recomputes the assessment using the remaining term and checks that the invoice covers repayment.

These coefficients and rates are demonstration assumptions. A production model needs calibrated credit and debtor data, external invoice verification, validation against outcomes, concentration limits, and pricing decisions.

## Capital and returns

Money is stored as integer RLUSD cents, independent of XRP drops. Each pool starts with fictional base capital; fixtures consume part of it. Approved requests add allocations without increasing pool capital. Deposits add capital and reserve; they are not automatically lent.

- Capital = base capital + all saved deposits.
- Allocated = fixture advances + approved advances.
- Reserve = capital − allocated.
- Investor ownership = that investor's cumulative deposits / pool capital.
- Pool annual yield = sum(loan principal × loan APR) / pool capital.
- Stress yield = pool annual yield − deployed fraction × loss-scenario percentage.

Quotes include the new deposit in the capital denominator, so they account for dilution while that deposit sits idle. Projected earnings apply that diluted yield to the new investment and requested number of months. Ownership includes the investor's prior deposits. The current-ownership row is separate from projected ownership after another deposit.

Charts and projections use simple interest without compounding or fees. Annualizing assumes loans that mature are replaced at the same rates; the stress scenario is a hypothetical annual loss haircut, not an expected-loss prediction. No realized earnings, repayment, or default events are posted by this prototype.

## HTTP contract

All routes use `/api/market`. Errors follow the existing `{ "error": { "code": 400, "message": "..." } }` convention. Amount inputs are decimal strings or numbers in RLUSD, with at most two meaningful decimal places. Monetary response fields end in `_cents`.

| Method / route | Payload / result |
| --- | --- |
| `GET /api/market` | Pools, companies, applications, review history, and current investor (or null). Pool holdings refer to the current session only. |
| `POST /investors` | JSON: `name`, `email`, `password` (10–128 characters), `preference` (pool id), `risk_acknowledged: true`. Creates account and signs in. |
| `POST /login` | JSON: `email`, `password`. Signs in and returns snapshot. |
| `POST /logout` | Clears session and returns anonymous snapshot. |
| `POST /deposits` | Signed-in session; JSON: `pool`, `amount`, `operation_key` (UUID). First save returns 201; identical retry returns 200 without duplicating capital. Reusing a key with different data returns 409. |
| `POST /quote` | JSON: `pool`, `amount`, integer `months` (1–60). Returns `quote` containing earnings, stress earnings, diluted APR and ownership percentage. |
| `POST /requests` | Multipart: `company`, `sector`, `purpose`, `invoice_ref`, `debtor`, `due_date` (YYYY-MM-DD), `invoice`, `amount`, `years_trading` (0–100), `late_payment_pct` (0–100), `document` (PDF/PNG/JPEG, ≤5 MB). Creates pending application. |
| `GET /requests/:id/document` | Downloads attached invoice with a safe filename and attachment disposition. |
| `POST /requests/:id/review` | JSON: `decision` (`approved` or `rejected`), `reviewer`, `note`, `checks`. Approval requires boolean true for `invoice_authentic`, `debtor_confirmed`, `not_financed`. |

## Integrity and boundaries

- Case-insensitive, whitespace-normalized debtor and invoice-reference pairs cannot be submitted twice, including after rejection. Reviewers must check aliases and external financing manually.
- Approval requires a document, underwriting inputs, a still-future invoice, sufficient invoice coverage, and sufficient pool reserve.
- Allocation and review history are committed in one transaction under a SQLite write lock. Competing approvals cannot overdraw the reserve. A reviewed application cannot be reviewed again.
- Read snapshots use a consistent transaction for capital and holdings.
- Legacy anonymous deposits are retained without assigning them to newly registered investors. Legacy applications lacking evidence can be rejected but cannot be approved.
- Investor passwords use Werkzeug password hashing; sessions use HTTP-only, SameSite=Lax cookies. Cross-origin mutations are rejected. Persistent session secrets stay in the ignored instance directory, or use `FLASK_SECRET_KEY`.
- Borrower records and documents, plus the review console, are available to local demo users. There is no production borrower privacy boundary or reviewer role enforcement. Do not deploy this demo with real data. Signature checks do not prove invoice authenticity.

## Verification

`pytest -q` covers risk bands and monotonicity, money and deadline validation, required evidence, duplicate invoices, registration/login, account isolation, idempotent deposits, diluted return calculations, manual review checks, approval/rejection audit history, expired invoices, legacy data, and concurrent approval capacity.

Browser walkthrough: create a fictional investor, make a simulated deposit, verify portfolio share, submit a fictional PDF invoice, attempt approval without checks, complete simulated checks, approve, reload, and verify the borrower and updated yield in its assigned pool. Desktop and mobile layouts are checked for page overflow. Test-only browser records are labeled as demo data.
