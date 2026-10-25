# Native Devnet lending — current implementation

The browser-local RLUSD simulation has been removed. There is one app. All deposit, withdrawal, origination and repayment actions prepare native transactions and only confirm after validated `tesSUCCESS`. GemWallet owns user signatures. SQLite stores sessions, invoice records and transaction intents, not financial balances.

## Asset and protocol

- Standard XRPL Devnet, NetworkID 2, rippled 3.4.1.
- Live amendment check: SingleAssetVault, LendingProtocol and LendingProtocolV1_1 enabled.
- Test token: **MOCKRLUSD**, currency `4D4F434B524C5553440000000000000000000000`.
- Issuer: `rD3UJ4eRRbpU3HZKYxKwKAugRHE5QEXgdu`.
- This is not official Ripple RLUSD. Its issuance, trust lines and balances are nevertheless on-chain.
- Three real closed-ended Vaults, each with a native LoanBroker, initially funded with 1,000 test tokens by a newly generated investor test account.

The public IDs and transaction hashes are in [native-devnet-evidence.json](native-devnet-evidence.json). Network resets can invalidate them; never silently substitute local balances.

## Investor

Connect GemWallet on standard Devnet and sign the expiring ownership challenge. Your positions prepares TrustSet for the exact test issuer. After validation, refresh/reconnect and use the test-token faucet with a zero token balance; issuance is a real Payment. Select a pool and sign VaultDeposit during subscription. Native MPT shares represent the position. Withdraw through VaultWithdraw during subscription or redemption, subject to ledger rules and liquidity. XRP is used only for network fees/reserves.

## Borrower

Get funded prepares LoanSet with the borrower as Account and the test broker as Counterparty. Current test-credit policy is at most 1,000 MOCKRLUSD per loan, zero interest/fees, one repayment after five minutes, and a one-minute grace period. The cap is per loan, not a production credit limit. The native protocol also enforces available capital and vault dates.

GemWallet signs the borrower transaction. Flask verifies exact prepared fields, then invokes the locally configured Node test-broker signer for CounterpartySignature. Only a validated LoanSet disburses principal. Your positions reads native loans and prepares LoanPay. Regular repayment was validated; the early-full attempt returned tecKILLED and was recorded as failed. Use regular repayment for this tested policy; do not assume all payment variants have passed live testing.

Invoices and underwriting remain off-chain. The invoice submission route is available from Get funded for evidence, but it is not wired into production broker approval. Do not put private invoice documents on the public ledger. Test credit is not approved invoice-backed financing.

## Closed-ended vault timing

LendingProtocolV1_1 requires new loan brokers to use closed-ended vaults. Deposits are permitted in subscription. Loans originate in investment. Redemption opens later; dates are immutable. The UI shows subscription and redemption dates. The initial Core and Opportunity subscription windows are one/two days; Balanced was seeded and enters investment after 90 seconds. All have seven-day investment periods. This is a real lifecycle constraint, not a UI simulation.

## Deployment and keys

Install `npm ci --prefix scripts/native --ignore-scripts` with Node >=20.19. Run `node scripts/native/deploy.mjs` explicitly to create/fund new Devnet test accounts, configure issuer default ripple, issue test tokens, create Vault/LoanBroker objects and seed deposits. It is resumable from ignored instance files. It never uses Gabriel's private keys.

`services/api/instance/native-devnet-wallets.json` contains only the generated test-wallet secrets (file mode 0600). Do not publish it. `native-devnet.json` is the public manifest automatically loaded by Flask when running normally on Devnet. Unit test overrides skip this deployment. Set FLOW_NODE if `node` does not resolve to >=20.19. Restart Flask after deployment. Keep the app bound to localhost; the test broker/faucet are development conveniences, not production custody or lending services.

## Live verification, 24 October 2026 EDT

These operations used real Flask challenge/signature authentication, transaction preparation, signed submission and reconciliation against Devnet; RPC was not mocked. Signing used the generated SDK test wallets, not the GemWallet extension.

| Action | Result | Transaction |
| --- | --- | --- |
| VaultDeposit, 10 tokens | tesSUCCESS | 6440A46E8D66A86AE1233CDFB18394CE114C1360D8734BC63AA256B68A06AB6E |
| VaultWithdraw, 10 tokens | tesSUCCESS | 6D41F7C403EE842FFD52C9059AD345941CD2051979E0EECEB28EB115BACE62D0 |
| LoanSet, 100 tokens | tesSUCCESS | 6699F8D4A1EA0EEDA23517B81AA5245901704BF4B3AA414A469A9AE0699BD733 |
| Early-full LoanPay | tecKILLED | 5D5BFD29D20F250A1CB268455E610DCB17D21B01E0FD569555C76B5E074421E5 |
| Regular LoanPay, 100 tokens | tesSUCCESS | 7D26022BF2811678254D3F07F65C779E78A6688EF18017108B97D4851CB2FDD5 |

The [LoanSet explorer page](https://devnet.xrpl.org/transactions/6699F8D4A1EA0EEDA23517B81AA5245901704BF4B3AA414A469A9AE0699BD733) visibly showed success, principal 100 MOCKRLUSD, broker and five-minute terms. [Repayment](https://devnet.xrpl.org/transactions/7D26022BF2811678254D3F07F65C779E78A6688EF18017108B97D4851CB2FDD5).

135 offline tests cover the existing API plus explicit mock-asset Devnet restriction and rejection of automatic credit for official assets. GemWallet's native transaction codec remains an end-user compatibility check: unsupported signing must report failure, never substitute a Payment or local credit. Historical APY is unavailable and not fabricated.

Sources: [native lending](https://xrpl.org/docs/concepts/tokens/lending-protocol), [VaultCreate and lifecycle](https://xrpl.org/docs/references/protocol/transactions/types/vaultcreate), [official examples](https://github.com/XRPLF/xrpl-dev-portal/tree/master/_code-samples/lending-protocol).
