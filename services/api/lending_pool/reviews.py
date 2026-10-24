"""Review rules. Money-related transitions remain reserved for ledger integration."""

from .db import get_db

TRANSITIONS = {
    "submitted": frozenset({"under_review", "cancelled"}),
    "under_review": frozenset({"approved", "rejected", "cancelled"}),
    "approved": frozenset({"funded", "cancelled"}),
    "funded": frozenset({"repaid", "defaulted"}),
    "rejected": frozenset(),
    "cancelled": frozenset(),
    "repaid": frozenset(),
    "defaulted": frozenset(),
}
REVIEW_TARGETS = frozenset({"under_review", "approved", "rejected", "cancelled"})


class InvalidTransition(ValueError):
    pass


def review_request(request_id, target, note):
    """Serialize review decisions and their audit records in one transaction."""
    connection = get_db()
    with connection:
        connection.execute("BEGIN IMMEDIATE")
        row = connection.execute(
            "SELECT * FROM funding_requests WHERE id = ?", (request_id,)
        ).fetchone()
        if row is None:
            raise LookupError("Funding request not found.")
        source = row["status"]
        if target not in REVIEW_TARGETS or target not in TRANSITIONS[source]:
            raise InvalidTransition(f"Cannot transition funding request from {source} to {target}.")
        connection.execute(
            "UPDATE funding_requests SET status = ? WHERE id = ?", (target, request_id)
        )
        connection.execute(
            """INSERT INTO funding_request_reviews
               (funding_request_id, from_status, to_status, note) VALUES (?, ?, ?, ?)""",
            (request_id, source, target, note),
        )
        result = dict(connection.execute(
            "SELECT * FROM funding_requests WHERE id = ?", (request_id,)
        ).fetchone())
    return result
