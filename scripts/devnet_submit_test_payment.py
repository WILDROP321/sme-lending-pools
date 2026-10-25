"""Opt-in: submit one Devnet Payment from the investor test account to the pool
test account, tagged with a contribution-intent id, and print the validated
IntegrationResult. Not part of CI; this talks to the live Devnet.

Run after devnet_create_test_accounts.py:

    python scripts/devnet_submit_test_payment.py [intent_id] [amount_drops]

Reproduce / inspect the result on a Devnet explorer:

    https://devnet.xrpl.org/transactions/<tx_hash>
"""

import json
import os
import sys
from dataclasses import asdict
from pathlib import Path

from xrpl.clients import JsonRpcClient
from xrpl.wallet import Wallet

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "services" / "api"))
from lending_pool import ledger  # noqa: E402

ACCOUNTS_PATH = REPO_ROOT / "services" / "api" / "instance" / "devnet_accounts.json"
PROOF_PATH = REPO_ROOT / "services" / "api" / "instance" / "devnet_proof.json"


def main():
    intent_id = sys.argv[1] if len(sys.argv) > 1 else "demo-intent-1"
    amount_drops = int(sys.argv[2]) if len(sys.argv) > 2 else 1_000_000

    if not ACCOUNTS_PATH.exists():
        print(f"Missing {ACCOUNTS_PATH}. Run scripts/devnet_create_test_accounts.py first.")
        return 1

    accounts = json.loads(ACCOUNTS_PATH.read_text())
    url = accounts.get("network", os.getenv("XRPL_JSON_RPC_URL", "https://s.devnet.rippletest.net:51234/"))
    client = JsonRpcClient(url)
    investor_wallet = Wallet.from_seed(accounts["investor"]["seed"])
    pool_address = accounts["pool"]["address"]

    result = ledger.submit_test_payment(client, investor_wallet, pool_address, amount_drops, intent_id)

    print(f"tx_hash: {result.tx_hash}")
    print(f"validated: {result.validated}")
    print(f"amount_drops: {result.amount_drops}")
    print(f"reference_id: {result.reference_id}")
    print(f"Inspect: https://devnet.xrpl.org/transactions/{result.tx_hash}")

    PROOF_PATH.write_text(json.dumps(asdict(result), indent=2))
    print(f"Saved integration result to {PROOF_PATH}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
