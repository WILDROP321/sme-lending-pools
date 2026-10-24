import sqlite3
from concurrent.futures import ThreadPoolExecutor

import pytest

from lending_pool.db import get_db
from lending_pool.reviews import review_request

from test_api import funding_body


@pytest.fixture
def funding_request(client):
    client.post("/api/pools", json={"name": "Review Pool"})
    return client.post("/api/funding-requests", json=funding_body()).json["funding_request"]


def review(client, status, **fields):
    return client.post("/api/funding-requests/1/review", json={"status": status, **fields})


def test_review_requires_ordered_steps_and_records_history(client, funding_request):
    assert review(client, "approved").status_code == 409
    assert client.get("/api/funding-requests/1").json["reviews"] == []
    assert review(client, "under_review", note=" Checking invoice ").status_code == 200
    result = review(client, "approved", note="Demo eligibility reviewed")
    assert result.status_code == 200
    assert result.json["funding_request"]["status"] == "approved"
    detail = client.get("/api/funding-requests/1").json
    assert [(row["from_status"], row["to_status"]) for row in detail["reviews"]] == [
        ("submitted", "under_review"), ("under_review", "approved")
    ]
    assert detail["reviews"][0]["note"] == "Checking invoice"
    assert detail["funding_request"]["amount_drops"] == funding_request["amount_drops"]


def test_repeated_decision_returns_conflict_without_duplicate_audit(client, funding_request):
    assert review(client, "under_review").status_code == 200
    assert review(client, "under_review").status_code == 409
    assert len(client.get("/api/funding-requests/1").json["reviews"]) == 1


def test_rejected_request_cannot_be_reopened(client, funding_request):
    review(client, "under_review")
    assert review(client, "rejected").status_code == 200
    assert review(client, "under_review").status_code == 409
    assert review(client, "approved").status_code == 409
    assert client.get("/api/funding-requests/1").json["funding_request"]["status"] == "rejected"


@pytest.mark.parametrize("prior_states", [[], ["under_review"], ["under_review", "approved"]])
def test_can_cancel_before_funding_but_not_reopen(client, funding_request, prior_states):
    for status in prior_states:
        review(client, status)
    assert review(client, "cancelled").status_code == 200
    assert review(client, "under_review").status_code == 409


@pytest.mark.parametrize("target", ["funded", "repaid", "defaulted", "submitted", "invalid", None, []])
def test_review_api_cannot_apply_ledger_transitions(client, funding_request, target):
    assert review(client, target).status_code == 400
    assert client.get("/api/funding-requests/1").json["funding_request"]["status"] == "submitted"
    assert client.get("/api/funding-requests/1").json["reviews"] == []


def test_invalid_review_metadata_and_missing_requests(client, funding_request):
    assert review(client, "under_review", note=[]).status_code == 400
    assert review(client, "under_review", note="x" * 2001).status_code == 400
    assert review(client, "under_review", transaction_hash="not-evidence").status_code == 400
    assert client.get("/api/funding-requests/999").status_code == 404
    for request_id in [999, 2**63]:
        assert client.post(f"/api/funding-requests/{request_id}/review", json={"status": "under_review"}).status_code == 404


def test_creation_cannot_claim_funded_status(client):
    client.post("/api/pools", json={"name": "Demo Pool"})
    response = client.post("/api/funding-requests", json=funding_body(status="funded"))
    assert response.status_code == 201
    assert response.json["funding_request"]["status"] == "submitted"


def test_concurrent_review_only_records_one_transition(app, client, funding_request):
    def submit_review(_index):
        with app.test_client() as separate_client:
            return review(separate_client, "under_review").status_code

    with ThreadPoolExecutor(max_workers=2) as executor:
        outcomes = list(executor.map(submit_review, range(2)))
    assert sorted(outcomes) == [200, 409]
    assert len(client.get("/api/funding-requests/1").json["reviews"]) == 1


def test_audit_insert_failure_rolls_back_status_change(app, client, funding_request):
    with app.app_context():
        connection = get_db()
        connection.execute("""CREATE TRIGGER reject_audit BEFORE INSERT ON funding_request_reviews
            BEGIN SELECT RAISE(ABORT, 'simulated storage failure'); END""")
        connection.commit()
        with pytest.raises(sqlite3.IntegrityError):
            review_request(1, "under_review", "Demo")
    detail = client.get("/api/funding-requests/1").json
    assert detail["funding_request"]["status"] == "submitted"
    assert detail["reviews"] == []


def test_review_cannot_cancel_a_funded_request(app, client, funding_request):
    # Stand in for a future ledger integration's persisted result.
    with app.app_context():
        connection = get_db()
        connection.execute("UPDATE funding_requests SET status = 'funded' WHERE id = 1")
        connection.commit()
    assert review(client, "cancelled").status_code == 409
    assert client.get("/api/funding-requests/1").json["funding_request"]["status"] == "funded"
