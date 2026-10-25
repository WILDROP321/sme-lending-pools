import sqlite3
from datetime import date, timedelta

import pytest

from lending_pool import ledger
from lending_pool.db import get_db

POOL_ADDRESS = "rha121AnWYSBKebkxjzVFgfgEpsFVZ4C8E"
BUSINESS_ADDRESS = "rp6DmgUgmNJKDSA3fvp7mcBrVPb7nf5Ukw"
INVESTOR_ADDRESS = "rEtYrjs5ZTDEjrxqixDWQVr95bXEdf4p1R"
OTHER_ADDRESS = "r9xXmWR5yyggPh6LTKCHd8i9GRRmnxE2Pk"
TX_HASH = "A" * 64


def fake_result(**overrides):
    fields = dict(
        tx_hash=TX_HASH, validated=True, amount_drops=5_000_000, reference_id=1,
        sender_address=POOL_ADDRESS, destination_address=BUSINESS_ADDRESS,
    )
    fields.update(overrides)
    return ledger.IntegrationResult(**fields)


def future_date():
    return (date.today() + timedelta(days=30)).isoformat()


@pytest.fixture
def approved_request(client):
    investor = client.post(
        "/api/investors", json={"name": "Demo Investor", "xrpl_address": INVESTOR_ADDRESS}
    ).json["investor"]
    pool = client.post("/api/pools", json={"name": "Demo Pool", "xrpl_address": POOL_ADDRESS}).json["pool"]
    # Fund the pool with a matching contribution so disbursement has balance to draw on.
    intent = client.post("/api/contribution-intents", json={
        "investor_id": investor["id"], "pool_id": pool["id"], "amount_drops": 5_000_000,
    }).json["contribution_intent"]

    def fake_deposit_lookup(*_a, **_k):
        return ledger.IntegrationResult(
            tx_hash="D" * 64, validated=True, amount_drops=5_000_000, reference_id=intent["id"],
            sender_address=INVESTOR_ADDRESS, destination_address=POOL_ADDRESS,
        )

    import lending_pool.deposits as deposits_module
    original = deposits_module.ledger.fetch_validated_transaction
    deposits_module.ledger.fetch_validated_transaction = fake_deposit_lookup
    try:
        assert client.post(
            f"/api/contribution-intents/{intent['id']}/deposit", json={"tx_hash": "D" * 64}
        ).status_code == 200
    finally:
        deposits_module.ledger.fetch_validated_transaction = original

    request = client.post("/api/funding-requests", json={
        "pool_id": pool["id"], "business_name": "Demo Bakery", "amount_drops": 5_000_000,
        "expected_payment_date": future_date(), "xrpl_address": BUSINESS_ADDRESS,
    }).json["funding_request"]
    client.post(f"/api/funding-requests/{request['id']}/review", json={"status": "under_review"})
    client.post(f"/api/funding-requests/{request['id']}/review", json={"status": "approved"})
    return {**request, "pool_id": pool["id"]}


def disburse(client, request_id, tx_hash=TX_HASH):
    return client.post(f"/api/funding-requests/{request_id}/disburse", json={"tx_hash": tx_hash})


def test_registers_optional_xrpl_address_on_funding_requests(client):
    client.post("/api/pools", json={"name": "Demo Pool"})
    request = client.post("/api/funding-requests", json={
        "pool_id": 1, "business_name": "Demo Bakery", "amount_drops": 1_000_000,
        "expected_payment_date": future_date(), "xrpl_address": BUSINESS_ADDRESS,
    }).json["funding_request"]
    assert request["xrpl_address"] == BUSINESS_ADDRESS


def test_invalid_xrpl_address_on_funding_request_is_rejected(client):
    client.post("/api/pools", json={"name": "Demo Pool"})
    response = client.post("/api/funding-requests", json={
        "pool_id": 1, "business_name": "Demo Bakery", "amount_drops": 1_000_000,
        "expected_payment_date": future_date(), "xrpl_address": "not-an-address",
    })
    assert response.status_code == 400


def test_disbursing_a_matching_approved_request_marks_it_funded(client, approved_request, monkeypatch):
    monkeypatch.setattr(ledger, "fetch_validated_transaction", lambda *a, **k: fake_result())
    response = disburse(client, approved_request["id"])
    assert response.status_code == 200
    assert response.json["funding_request"]["status"] == "funded"
    detail = client.get(f"/api/funding-requests/{approved_request['id']}").json
    assert detail["funding_request"]["status"] == "funded"
    assert detail["disbursement"]["tx_hash"] == TX_HASH


def test_cannot_disburse_a_request_that_is_not_approved(client, monkeypatch):
    client.post("/api/pools", json={"name": "Demo Pool", "xrpl_address": POOL_ADDRESS})
    request = client.post("/api/funding-requests", json={
        "pool_id": 1, "business_name": "Demo Bakery", "amount_drops": 1_000_000,
        "expected_payment_date": future_date(), "xrpl_address": BUSINESS_ADDRESS,
    }).json["funding_request"]
    monkeypatch.setattr(ledger, "fetch_validated_transaction", lambda *a, **k: fake_result())
    assert disburse(client, request["id"]).status_code == 409


def test_cannot_disburse_beyond_available_pool_balance(client, monkeypatch):
    client.post("/api/pools", json={"name": "Thin Pool", "xrpl_address": POOL_ADDRESS})
    request = client.post("/api/funding-requests", json={
        "pool_id": 1, "business_name": "Demo Bakery", "amount_drops": 5_000_000,
        "expected_payment_date": future_date(), "xrpl_address": BUSINESS_ADDRESS,
    }).json["funding_request"]
    client.post(f"/api/funding-requests/{request['id']}/review", json={"status": "under_review"})
    client.post(f"/api/funding-requests/{request['id']}/review", json={"status": "approved"})
    # No funded contribution intents were ever recorded for this pool: available balance is 0.
    monkeypatch.setattr(ledger, "fetch_validated_transaction", lambda *a, **k: fake_result())
    response = disburse(client, request["id"])
    assert response.status_code == 409
    assert "insufficient" in response.json["error"]["message"].lower()


def test_sender_mismatch_does_not_disburse(client, approved_request, monkeypatch):
    monkeypatch.setattr(ledger, "fetch_validated_transaction", lambda *a, **k: fake_result(sender_address=OTHER_ADDRESS))
    assert disburse(client, approved_request["id"]).status_code == 409
    assert client.get(f"/api/funding-requests/{approved_request['id']}").json["funding_request"]["status"] == "approved"


def test_destination_mismatch_does_not_disburse(client, approved_request, monkeypatch):
    monkeypatch.setattr(
        ledger, "fetch_validated_transaction", lambda *a, **k: fake_result(destination_address=OTHER_ADDRESS)
    )
    assert disburse(client, approved_request["id"]).status_code == 409


def test_amount_mismatch_does_not_disburse(client, approved_request, monkeypatch):
    monkeypatch.setattr(ledger, "fetch_validated_transaction", lambda *a, **k: fake_result(amount_drops=1))
    assert disburse(client, approved_request["id"]).status_code == 409


def test_unvalidated_transaction_does_not_disburse(client, approved_request, monkeypatch):
    monkeypatch.setattr(ledger, "fetch_validated_transaction", lambda *a, **k: fake_result(validated=False))
    assert disburse(client, approved_request["id"]).status_code == 409


def test_repeat_disbursement_of_the_same_request_is_rejected(client, approved_request, monkeypatch):
    monkeypatch.setattr(ledger, "fetch_validated_transaction", lambda *a, **k: fake_result())
    assert disburse(client, approved_request["id"]).status_code == 200
    assert disburse(client, approved_request["id"]).status_code == 409


def test_unknown_request_is_json_404(client):
    for request_id in [999, 2**63]:
        assert disburse(client, request_id).status_code == 404


@pytest.mark.parametrize("tx_hash", ["short", "G" * 64, "a" * 63])
def test_malformed_tx_hash_is_rejected_before_any_lookup(client, approved_request, monkeypatch, tx_hash):
    def fail_if_called(*_a, **_k):
        raise AssertionError("should not look up an invalid hash")
    monkeypatch.setattr(ledger, "fetch_validated_transaction", fail_if_called)
    assert disburse(client, approved_request["id"], tx_hash=tx_hash).status_code == 400


def test_ledger_lookup_failure_returns_503_without_disbursing(client, approved_request, monkeypatch):
    def unavailable(*_a, **_k):
        raise TimeoutError("do not leak connection details")
    monkeypatch.setattr(ledger, "fetch_validated_transaction", unavailable)
    response = disburse(client, approved_request["id"])
    assert response.status_code == 503
    assert "do not leak" not in response.get_data(as_text=True)
    assert client.get(f"/api/funding-requests/{approved_request['id']}").json["funding_request"]["status"] == "approved"


def test_database_rejects_a_second_disbursement_row_for_the_same_request(app, approved_request):
    with app.app_context():
        connection = get_db()
        connection.execute(
            """INSERT INTO disbursements
               (funding_request_id, tx_hash, amount_drops, sender_address, destination_address)
               VALUES (?, ?, ?, ?, ?)""",
            (approved_request["id"], TX_HASH, 5_000_000, POOL_ADDRESS, BUSINESS_ADDRESS),
        )
        connection.commit()
        with pytest.raises(sqlite3.IntegrityError):
            connection.execute(
                """INSERT INTO disbursements
                   (funding_request_id, tx_hash, amount_drops, sender_address, destination_address)
                   VALUES (?, ?, ?, ?, ?)""",
                (approved_request["id"], "B" * 64, 5_000_000, POOL_ADDRESS, BUSINESS_ADDRESS),
            )
