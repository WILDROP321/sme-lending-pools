"""Opt-in: create and fund two Devnet test accounts (pool custodian + investor).

Not part of the test suite or CI; this talks to the live Devnet faucet. Run manually:

    python scripts/devnet_create_test_accounts.py

Writes addresses and seeds to services/api/instance/devnet_accounts.json, which
is covered by the repository's existing `instance/` ignore rule. Never commit
that file or paste its contents anywhere.
"""

import json
import os
import sys
from pathlib import Path

from xrpl.clients import JsonRpcClient
from xrpl.wallet import generate_faucet_wallet

REPO_ROOT = Path(__file__).resolve().parent.parent
OUTPUT_PATH = REPO_ROOT / "services" / "api" / "instance" / "devnet_accounts.json"


def main():
    url = os.getenv("XRPL_JSON_RPC_URL", "https://s.devnet.rippletest.net:51234/")
    client = JsonRpcClient(url)

    print(f"Requesting Devnet faucet funds from {url} ...")
    pool_wallet = generate_faucet_wallet(client, debug=True)
    investor_wallet = generate_faucet_wallet(client, debug=True)

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(
        json.dumps(
            {
                "network": url,
                "pool": {"address": pool_wallet.classic_address, "seed": pool_wallet.seed},
                "investor": {"address": investor_wallet.classic_address, "seed": investor_wallet.seed},
            },
            indent=2,
        )
    )
    print(f"Pool address: {pool_wallet.classic_address}")
    print(f"Investor address: {investor_wallet.classic_address}")
    print(f"Seeds written to {OUTPUT_PATH} (git-ignored; do not commit this file).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
