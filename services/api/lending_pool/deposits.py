"""Reconcile a pending contribution intent against one independently verified,
validated XRPL Devnet transaction. See docs/LEDGER_DESIGN.md.

A claimed transaction hash is never trusted on its own: this module looks the
transaction up on Devnet itself and checks that it is validated, moved XRP
(not an issued currency), and that its sender/destination/amount match the
investor, pool, and intent on file before crediting anything.
"""

import sqlite3

from . import ledger
from .db import get_db


class DepositMismatch(ValueError):
    """The transaction exists but does not satisfy this intent."""


def confirm_deposit(client, intent_id, tx_hash):
    """Verify tx_hash on Devnet and, if it matches, mark the intent funded.

    Raises LookupError if the intent does not exist, DepositMismatch if the
    transaction does not satisfy it (including a repeat of an already-used
    hash or intent), or whatever ledger.fetch_validated_transaction raises on
    a lookup failure (network/RuntimeError/ValueError).
    """
    connection = get_db()
    with connection:
        connection.execute("BEGIN IMMEDIATE")
        intent = connection.execute(
            "SELECT * FROM contribution_intents WHERE id = ?", (intent_id,)
        ).fetchone()
        if intent is None:
            raise LookupError("Contribution intent not found.")
        if intent["status"] != "pending":
            raise DepositMismatch(f"Contribution intent is already {intent['status']}.")

        investor = connection.execute(
            "SELECT * FROM investors WHERE id = ?", (intent["investor_id"],)
        ).fetchone()
        pool = connection.execute(
            "SELECT * FROM pools WHERE id = ?", (intent["pool_id"],)
        ).fetchone()
        if not investor["xrpl_address"]:
            raise DepositMismatch("Investor has no registered XRPL address.")
        if not pool["xrpl_address"]:
            raise DepositMismatch("Pool has no registered XRPL address.")

        result = ledger.fetch_validated_transaction(client, tx_hash, intent_id)
        if not result.validated:
            raise DepositMismatch("Transaction is not validated yet.")
        if result.sender_address != investor["xrpl_address"]:
            raise DepositMismatch("Transaction sender does not match the investor's registered XRPL address.")
        if result.destination_address != pool["xrpl_address"]:
            raise DepositMismatch("Transaction destination does not match the pool's registered XRPL address.")
        if result.amount_drops != intent["amount_drops"]:
            raise DepositMismatch(
                f"Delivered amount {result.amount_drops} does not match "
                f"the intent amount {intent['amount_drops']}."
            )

        try:
            connection.execute(
                """INSERT INTO ledger_receipts
                   (contribution_intent_id, tx_hash, amount_drops, sender_address, destination_address)
                   VALUES (?, ?, ?, ?, ?)""",
                (intent_id, tx_hash, result.amount_drops, result.sender_address, result.destination_address),
            )
        except sqlite3.IntegrityError as error:
            # Either tx_hash or intent_id was already recorded: no double-crediting.
            raise DepositMismatch("This transaction has already been recorded for a contribution intent.") from error

        connection.execute("UPDATE contribution_intents SET status = 'funded' WHERE id = ?", (intent_id,))
        updated = dict(
            connection.execute("SELECT * FROM contribution_intents WHERE id = ?", (intent_id,)).fetchone()
        )
    return updated
