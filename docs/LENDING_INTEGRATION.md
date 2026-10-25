# RLUSD ledger integration and workflow

## Current evidence — 24 October 2026

Live read-only RPC checks (approximately 01:10 UTC on 25 October) found:

| Network | Observed result | Lending availability |
| --- | --- | --- |
| Standard Devnet (selected default) | Network ID 2, rippled 3.4.1; SingleAssetVault, LendingProtocol and LendingProtocolV1_1 enabled | No verified official RLUSD issuer; actions blocked |
| Dedicated Lending Devnet | Official `lend.devnet.rippletest.net` hostname did not resolve | Unavailable; no automatic fallback |
| Testnet | Network ID 1, documented RLUSD issuer account exists | All three lending amendments disabled |

Gabriel's supplied public Devnet wallet had 17 XRP and no trust lines. XRP is needed for network fees/reserves; it is never used as lending principal. **Zero transactions were submitted. There is no new transaction hash or explorer-verified deposit, loan or repayment to report.** These findings are time-specific; rerun `scripts/check_lending_network.py` for current evidence.

Sources: [official network definitions](https://github.com/XRPLF/xrpl-dev-portal/blob/master/resources/dev-tools/faucets.json), [Ripple RLUSD issuers](https://docs.ripple.com/products/stablecoin/developer-resources/rlusd-on-the-xrpl), [native lending specification](https://xls.xrpl.org/xls/XLS-0066-lending-protocol.html), [GemWallet API](https://gemwallet.app/docs/api/gemwallet-api-reference).

## Investor workflow

1. Select the configured network in GemWallet, connect and sign the app's one-time ownership challenge. Flask verifies the signature and public-key-derived address; the session expires after one hour.
2. Read the wallet's validated RLUSD trust-line balance and available native positions. Missing data is unavailable, not a synthetic zero.
3. Establish the exact issuer's RLUSD trust line if necessary. This does not supply RLUSD: acquisition/faucet funding is separate.
4. Open a pool detail page. Once mapped to a deployed RLUSD Vault, deposit with VaultDeposit, signed in GemWallet. Wait for validated success before treating it as confirmed.
5. View native MPT vault shares. Withdraw RLUSD through VaultWithdraw to the same wallet, subject to protocol liquidity and permissions.

Steps 3–5 are currently blocked on Devnet by the missing verified issuer and deployed RLUSD vaults. Displayed pool names/risk categories are product metadata, not deployed pools, live yields or underwriting guarantees.

## Borrower workflow

1. Connect and prove wallet ownership.
2. Submit invoice details and a synthetic supporting file. The request and document are private to the wallet session. This is an off-chain application; the risk assessment is illustrative.
3. Intended next step: an authorized broker reviews the invoice, verifies the debtor and agrees terms. **Production reviewer authorization, vault/broker deployment and two-party LoanSet origination/signing are not implemented.** Legacy local approval is disabled in live mode and cannot disburse money.
4. Intended native origination uses broker/borrower co-signing; validated LoanSet creates the loan and disburses the vault asset. The app does not pretend an invoice submission does this.
5. Existing native loans connected to configured RLUSD vaults can be read. The borrower can prepare and sign LoanPay; confirmation requires validated success. Customer invoice collection and automatic repayment are not implemented.

Invoices are off-chain underwriting evidence. This integration does not create enforceable invoice collateral or automatically collect future receipts.

## Configuration and signing

`LENDING_NETWORK=devnet` is the explicit default. `testnet` and `lending-devnet` are opt-in profiles, never fallbacks. Standard Devnet ID 2 and Testnet ID 1 are pinned. The dedicated profile requires independently verified `LENDING_NETWORK_ID` and explorer configuration.

`LENDING_RLUSD_ISSUER` and `LENDING_RLUSD_ISSUER_SOURCE` are required for either Devnet profile. Operators must verify the issuer with an official source; providing a URL is not automated issuer certification. Testnet uses Ripple's documented issuer. Currency is `524C555344000000000000000000000000000000`; issuer and currency must both match.

`LENDING_VAULTS` maps product IDs to real ledger object IDs, for example `{"core":"<64-character Vault ID>"}`. No objects are provisioned automatically. Vault assets, loan borrower and loan broker/vault relationships are checked before preparing transactions.

GemWallet API 3.8.0 is vendored with its license. The extension's upstream XRPL codec may not support newer native lending transaction types. Real extension signing of these types has not been validated. Unsupported signing is reported and never replaced with a Payment transaction or a simulated result. Flask never receives wallet seeds/private keys.

## API and confirmation

All paths below start with `/api/lending`:

- `GET /status`, `/pools`, `/pools/<id>`: live network checks and validated pool data when configured.
- `POST /auth/challenge`, `/auth/verify`, `/auth/logout`: one-time signed challenge and session lifecycle.
- `GET /wallet`: validated balances, vault shares and relevant native loans for the authenticated wallet.
- `POST /intents`: prepare `trustline`, `deposit`, `withdraw` or `repay` with decimal-string amounts, ledger expiry and capped XRP fee.
- `POST /intents/<id>/submit`: accept a signed blob only if it matches the prepared transaction; persist its hash and submit.
- `GET /intents/<id>` and `/intents`: reconcile validated ledger results and show wallet-scoped history.

Submission engine results are diagnostic, not settlement. Only `validated=true`, matching transaction fields/hash and `meta.TransactionResult=tesSUCCESS` confirms an intent. Balances are read from the ledger, never credited in SQLite. Repeating submission uses the same blob/hash. A transaction not found can remain pending; automatic expiry/replacement is not implemented. Explorer links use the selected network's configured prefix; dedicated-network links remain absent until independently verified.

## Verification boundaries

133 offline tests passed, including 23 new integration test cases. RPC is mocked; signature verification uses real local cryptography. Coverage includes replay/expiry, wallet isolation, issuer/network/amendment gates, exact signed payload matching, decimal amounts, borrower validation and validated success versus pending/failure.

Headless Chromium checked actual Flask pool navigation, missing-wallet handling, workflow and a 390px mobile layout with no horizontal overflow. The invoice form check used an explicitly mocked authenticated wallet response. No browser wallet transaction was signed. Desktop/mobile screenshots are in `docs/screenshots/`.

The next live milestone requires an official RLUSD issuer on a native-lending-enabled network, real funded accounts and deployed RLUSD vault/broker objects, plus confirmed GemWallet codec support. Full origination additionally requires implementing the broker/borrower co-signing flow. Until then this is a guarded integration foundation, not a demonstrated end-to-end lending system.
