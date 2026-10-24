"""XRPL boundary. Read-only Devnet status, and transaction verification used by
.deposits to reconcile a contribution intent, are wired into the Flask app.
submit_test_payment backs the opt-in Devnet proof scripts in scripts/ only.
See docs/LEDGER_DESIGN.md.
"""

from dataclasses import dataclass

from xrpl.clients import JsonRpcClient
from xrpl.models.requests import ServerInfo, Tx
from xrpl.models.transactions import Memo, Payment
from xrpl.transaction import submit_and_wait
from xrpl.utils import str_to_hex


def fetch_server_info(url):
    response = JsonRpcClient(url).request(ServerInfo())
    if not response.is_successful():
        raise RuntimeError("XRPL server returned an unsuccessful response")
    info = response.result.get("info", {})
    return {
        "server_state": info.get("server_state"),
        "validated_ledger": info.get("validated_ledger", {}).get("seq"),
    }


@dataclass(frozen=True)
class IntegrationResult:
    """What a reconciliation step needs to credit one contribution intent once."""

    tx_hash: str
    validated: bool
    amount_drops: int
    intent_id: str
    sender_address: str
    destination_address: str


def _integration_result_from_tx_result(result, intent_id):
    tx_json = result.get("tx_json") or {}
    if tx_json.get("TransactionType") != "Payment":
        raise ValueError(f"Expected a Payment transaction, got {tx_json.get('TransactionType')!r}.")
    # delivered_amount (not tx_json.Amount) is the XRPL-documented way to read
    # what actually arrived, since a partial payment can deliver less than requested.
    delivered = (result.get("meta") or {}).get("delivered_amount")
    if not isinstance(delivered, str) or not delivered.isdigit():
        raise ValueError(
            "Expected a drops-denominated XRP payment; delivered_amount is missing "
            "or this was an issued-currency payment."
        )
    return IntegrationResult(
        tx_hash=result["hash"],
        validated=bool(result.get("validated")),
        amount_drops=int(delivered),
        intent_id=intent_id,
        sender_address=tx_json.get("Account"),
        destination_address=tx_json.get("Destination"),
    )


def submit_test_payment(client, wallet, destination, amount_drops, intent_id):
    """Submit one Devnet Payment tagged with intent_id and wait for validation.

    Used by scripts/devnet_submit_test_payment.py; not called from the Flask app.
    """
    payment = Payment(
        account=wallet.classic_address,
        destination=destination,
        amount=str(amount_drops),
        memos=[Memo(memo_type=str_to_hex("intent_id"), memo_data=str_to_hex(intent_id))],
    )
    response = submit_and_wait(payment, client, wallet)
    return _integration_result_from_tx_result(response.result, intent_id)


def fetch_validated_transaction(client, tx_hash, intent_id):
    """Look up a transaction by hash and report whether it is validated."""
    response = client.request(Tx(transaction=tx_hash))
    if not response.is_successful():
        raise RuntimeError("XRPL server returned an unsuccessful response for this transaction hash")
    return _integration_result_from_tx_result(response.result, intent_id)


class ProcessedDeposits:
    """Idempotent record of which validated transactions have already been credited.

    The Flask app's persisted equivalent is the UNIQUE tx_hash column on
    ledger_receipts (migration 003); use this in-memory version for scripts or
    polling loops that check a transaction more than once before calling the API.
    """

    def __init__(self):
        self._credited_tx_hashes = set()

    def record_if_new(self, result: IntegrationResult) -> bool:
        """Return True the first time a validated tx_hash is seen, False otherwise."""
        if not result.validated or result.tx_hash in self._credited_tx_hashes:
            return False
        self._credited_tx_hashes.add(result.tx_hash)
        return True
