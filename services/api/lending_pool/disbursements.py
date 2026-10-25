"""Reconcile an approved funding request against one independently verified,
validated XRPL Devnet transaction (pool -> business). See docs/LEDGER_DESIGN.md.

Mirrors .deposits for the opposite direction, plus a pool-balance check: a
request can only be disbursed up to what its pool has actually raised
(funded contribution intents) minus what it has already disbursed.
"""

import sqlite3

from . import ledger
from .db import get_db


class DisbursementMismatch(ValueError):
    """The transaction exists but does not satisfy this funding request."""


def _available_pool_balance(connection, pool_id):
    raised = connection.execute(
        "SELECT COALESCE(SUM(amount_drops), 0) FROM contribution_intents WHERE pool_id = ? AND status = 'funded'",
        (pool_id,),
    ).fetchone()[0]
    disbursed = connection.execute(
        """SELECT COALESCE(SUM(disbursements.amount_drops), 0)
           FROM disbursements
           JOIN funding_requests ON funding_requests.id = disbursements.funding_request_id
           WHERE funding_requests.pool_id = ?""",
        (pool_id,),
    ).fetchone()[0]
    return raised - disbursed


def confirm_disbursement(client, request_id, tx_hash):
    """Verify tx_hash on Devnet and, if it matches, mark the request funded.

    Raises LookupError if the request does not exist, DisbursementMismatch if
    the transaction or pool balance does not satisfy it (including a repeat
    of an already-used hash or request), or whatever
    ledger.fetch_validated_transaction raises on a lookup failure.
    """
    connection = get_db()
    with connection:
        connection.execute("BEGIN IMMEDIATE")
        request = connection.execute(
            "SELECT * FROM funding_requests WHERE id = ?", (request_id,)
        ).fetchone()
        if request is None:
            raise LookupError("Funding request not found.")
        if request["status"] != "approved":
            raise DisbursementMismatch(f"Funding request is {request['status']}, not approved.")
        if not request["xrpl_address"]:
            raise DisbursementMismatch("Funding request has no registered XRPL address.")

        pool = connection.execute(
            "SELECT * FROM pools WHERE id = ?", (request["pool_id"],)
        ).fetchone()
        if not pool["xrpl_address"]:
            raise DisbursementMismatch("Pool has no registered XRPL address.")

        available = _available_pool_balance(connection, pool["id"])
        if available < request["amount_drops"]:
            raise DisbursementMismatch(
                f"Pool has insufficient available balance: {available} drops available, "
                f"{request['amount_drops']} requested."
            )

        result = ledger.fetch_validated_transaction(client, tx_hash, request_id)
        if not result.validated:
            raise DisbursementMismatch("Transaction is not validated yet.")
        if result.sender_address != pool["xrpl_address"]:
            raise DisbursementMismatch("Transaction sender does not match the pool's registered XRPL address.")
        if result.destination_address != request["xrpl_address"]:
            raise DisbursementMismatch(
                "Transaction destination does not match the funding request's registered XRPL address."
            )
        if result.amount_drops != request["amount_drops"]:
            raise DisbursementMismatch(
                f"Delivered amount {result.amount_drops} does not match "
                f"the funding request amount {request['amount_drops']}."
            )

        try:
            connection.execute(
                """INSERT INTO disbursements
                   (funding_request_id, tx_hash, amount_drops, sender_address, destination_address)
                   VALUES (?, ?, ?, ?, ?)""",
                (request_id, tx_hash, result.amount_drops, result.sender_address, result.destination_address),
            )
        except sqlite3.IntegrityError as error:
            # Either tx_hash or request_id was already recorded: no double-disbursing.
            raise DisbursementMismatch("This transaction has already been recorded for a funding request.") from error

        connection.execute("UPDATE funding_requests SET status = 'funded' WHERE id = ?", (request_id,))
        updated = dict(
            connection.execute("SELECT * FROM funding_requests WHERE id = ?", (request_id,)).fetchone()
        )
    return updated
