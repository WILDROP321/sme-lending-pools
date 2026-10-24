import sqlite3

import pytest

from lending_pool import ledger
from lending_pool.db import get_db

INVESTOR_ADDRESS = "rp6DmgUgmNJKDSA3fvp7mcBrVPb7nf5Ukw"
POOL_ADDRESS = "rha121AnWYSBKebkxjzVFgfgEpsFVZ4C8E"
OTHER_ADDRESS = "rEtYrjs5ZTDEjrxqixDWQVr95bXEdf4p1R"
TX_HASH = "A" * 64


def fake_result(**overrides):
    fields = dict(
        tx_hash=TX_HASH, validated=True, amount_drops=5_000_000, intent_id=1,
        sender_address=INVESTOR_ADDRESS, destination_address=POOL_ADDRESS,
    )
    fields.update(overrides)
    return ledger.IntegrationResult(**fields)


@pytest.fixture
def intent(client):
    investor = client.post(
        "/api/investors", json={"name": "Demo Investor", "xrpl_address": INVESTOR_ADDRESS}
    ).json["investor"]
    pool = client.post(
        "/api/pools", json={"name": "Demo Pool", "xrpl_address": POOL_ADDRESS}
    ).json["pool"]
    return client.post("/api/contribution-intents", json={
        "investor_id": investor["id"], "pool_id": pool["id"], "amount_drops": 5_000_000,
    }).json["contribution_intent"]


def deposit(client, intent_id, tx_hash=TX_HASH):
    return client.post(f"/api/contribution-intents/{intent_id}/deposit", json={"tx_hash": tx_hash})


def test_registers_optional_xrpl_address_on_investors_and_pools(client):
    investor = client.post(
        "/api/investors", json={"name": "Addressed", "xrpl_address": INVESTOR_ADDRESS}
    ).json["investor"]
    pool = client.post("/api/pools", json={"name": "Addressed Pool", "xrpl_address": POOL_ADDRESS}).json["pool"]
    assert investor["xrpl_address"] == INVESTOR_ADDRESS
    assert pool["xrpl_address"] == POOL_ADDRESS
    plain_investor = client.post("/api/investors", json={"name": "No Address"}).json["investor"]
    assert plain_investor["xrpl_address"] is None


@pytest.mark.parametrize("path, body", [
    ("/api/investors", {"name": "Bad", "xrpl_address": "not-an-address"}),
    ("/api/investors", {"name": "Bad", "xrpl_address": 123}),
    ("/api/pools", {"name": "Bad", "xrpl_address": "not-an-address"}),
])
def test_invalid_xrpl_address_is_rejected(client, path, body):
    assert client.post(path, json=body).status_code == 400


def test_confirming_a_matching_deposit_funds_the_intent(client, intent, monkeypatch):
    monkeypatch.setattr(ledger, "fetch_validated_transaction", lambda *a, **k: fake_result())
    response = deposit(client, intent["id"])
    assert response.status_code == 200
    assert response.json["contribution_intent"]["status"] == "funded"
    assert client.get(f"/api/contribution-intents/{intent['id']}").json["contribution_intent"]["status"] == "funded"


def test_repeat_confirmation_of_the_same_intent_is_rejected(client, intent, monkeypatch):
    monkeypatch.setattr(ledger, "fetch_validated_transaction", lambda *a, **k: fake_result())
    assert deposit(client, intent["id"]).status_code == 200
    assert deposit(client, intent["id"]).status_code == 409


def test_same_transaction_hash_cannot_fund_a_second_intent(client, intent, monkeypatch):
    other = client.post("/api/contribution-intents", json={
        "investor_id": intent["investor_id"], "pool_id": intent["pool_id"], "amount_drops": 5_000_000,
    }).json["contribution_intent"]
    monkeypatch.setattr(ledger, "fetch_validated_transaction", lambda *a, **k: fake_result())
    assert deposit(client, intent["id"]).status_code == 200
    assert deposit(client, other["id"]).status_code == 409
    assert client.get(f"/api/contribution-intents/{other['id']}").json["contribution_intent"]["status"] == "pending"


def test_unvalidated_transaction_does_not_fund_the_intent(client, intent, monkeypatch):
    monkeypatch.setattr(ledger, "fetch_validated_transaction", lambda *a, **k: fake_result(validated=False))
    assert deposit(client, intent["id"]).status_code == 409
    assert client.get(f"/api/contribution-intents/{intent['id']}").json["contribution_intent"]["status"] == "pending"


def test_sender_mismatch_does_not_fund_the_intent(client, intent, monkeypatch):
    monkeypatch.setattr(ledger, "fetch_validated_transaction", lambda *a, **k: fake_result(sender_address=OTHER_ADDRESS))
    assert deposit(client, intent["id"]).status_code == 409
    assert client.get(f"/api/contribution-intents/{intent['id']}").json["contribution_intent"]["status"] == "pending"


def test_destination_mismatch_does_not_fund_the_intent(client, intent, monkeypatch):
    monkeypatch.setattr(ledger, "fetch_validated_transaction", lambda *a, **k: fake_result(destination_address=OTHER_ADDRESS))
    assert deposit(client, intent["id"]).status_code == 409


def test_amount_mismatch_does_not_fund_the_intent(client, intent, monkeypatch):
    monkeypatch.setattr(ledger, "fetch_validated_transaction", lambda *a, **k: fake_result(amount_drops=1))
    assert deposit(client, intent["id"]).status_code == 409


def test_missing_registered_address_blocks_confirmation(client, monkeypatch):
    investor = client.post("/api/investors", json={"name": "No Address"}).json["investor"]
    pool = client.post("/api/pools", json={"name": "No Address Pool"}).json["pool"]
    intent_without_addresses = client.post("/api/contribution-intents", json={
        "investor_id": investor["id"], "pool_id": pool["id"], "amount_drops": 5_000_000,
    }).json["contribution_intent"]
    monkeypatch.setattr(ledger, "fetch_validated_transaction", lambda *a, **k: fake_result())
    assert deposit(client, intent_without_addresses["id"]).status_code == 409


def test_unknown_intent_is_json_404(client):
    for intent_id in [999, 2**63]:
        assert client.post(
            f"/api/contribution-intents/{intent_id}/deposit", json={"tx_hash": TX_HASH}
        ).status_code == 404


@pytest.mark.parametrize("tx_hash", ["short", "G" * 64, 12345, None, "a" * 63])
def test_malformed_tx_hash_is_rejected_before_any_lookup(client, intent, monkeypatch, tx_hash):
    def fail_if_called(*_args, **_kwargs):
        raise AssertionError("should not look up an invalid hash")
    monkeypatch.setattr(ledger, "fetch_validated_transaction", fail_if_called)
    assert deposit(client, intent["id"], tx_hash=tx_hash).status_code == 400


def test_ledger_lookup_failure_returns_503_without_crediting(client, intent, monkeypatch):
    def unavailable(*_args, **_kwargs):
        raise TimeoutError("do not leak connection details")
    monkeypatch.setattr(ledger, "fetch_validated_transaction", unavailable)
    response = deposit(client, intent["id"])
    assert response.status_code == 503
    assert "do not leak" not in response.get_data(as_text=True)
    assert client.get(f"/api/contribution-intents/{intent['id']}").json["contribution_intent"]["status"] == "pending"


def test_database_rejects_a_second_receipt_for_the_same_intent_outside_the_api(app, intent):
    with app.app_context():
        connection = get_db()
        connection.execute(
            """INSERT INTO ledger_receipts
               (contribution_intent_id, tx_hash, amount_drops, sender_address, destination_address)
               VALUES (?, ?, ?, ?, ?)""",
            (intent["id"], TX_HASH, 5_000_000, INVESTOR_ADDRESS, POOL_ADDRESS),
        )
        connection.commit()
        with pytest.raises(sqlite3.IntegrityError):
            connection.execute(
                """INSERT INTO ledger_receipts
                   (contribution_intent_id, tx_hash, amount_drops, sender_address, destination_address)
                   VALUES (?, ?, ?, ?, ?)""",
                (intent["id"], "B" * 64, 5_000_000, INVESTOR_ADDRESS, POOL_ADDRESS),
            )
