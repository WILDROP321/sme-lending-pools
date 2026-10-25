import sqlite3

import pytest

from lending_pool import create_app
from lending_pool.db import get_db


@pytest.fixture
def selected_pool(client):
    investor = client.post("/api/investors", json={"name": "Demo Investor"}).json["investor"]
    pool = client.post("/api/pools", json={"name": "Selected Pool"}).json["pool"]
    return {"investor_id": investor["id"], "pool_id": pool["id"], "amount_drops": 5_000_000}


def test_investor_and_intent_persist_without_crediting_pool(app, client, selected_pool):
    before = client.get("/api/pools/1").json
    response = client.post("/api/contribution-intents", json=selected_pool)
    assert response.status_code == 201
    intent = response.json["contribution_intent"]
    assert intent["status"] == "pending"
    assert intent["amount_drops"] == 5_000_000
    assert client.get("/api/pools/1").json == before
    second = create_app({"TESTING": True, "ENABLE_SIMULATION": True, "DATABASE": app.config["DATABASE"]}).test_client()
    assert second.get("/api/investors/1").json["investor"]["name"] == "Demo Investor"
    assert second.get("/api/investors").json["investors"][0]["id"] == 1
    assert second.get("/api/contribution-intents/1").json["contribution_intent"] == intent


@pytest.mark.parametrize("body", [{}, {"name": " "}, {"name": 1}, {"name": "x" * 121},
                                       {"name": "Valid", "id": 1}, {"name": "Valid", "balance": 5}])
def test_invalid_investor_does_not_create_record(client, body):
    assert client.post("/api/investors", json=body).status_code == 400
    assert client.get("/api/investors").json == {"investors": []}


@pytest.mark.parametrize("overrides", [
    {"amount_drops": True}, {"amount_drops": 0}, {"amount_drops": -1},
    {"amount_drops": 1.1}, {"amount_drops": "100"}, {"amount_drops": 2**63},
    {"investor_id": None}, {"investor_id": True}, {"pool_id": []}, {"pool_id": 2**63},
    {"status": "confirmed"}, {"status": "pending"}, {"transaction_hash": "claimed-proof"},
])
def test_invalid_or_server_owned_intent_fields_are_rejected(client, selected_pool, overrides):
    assert client.post("/api/contribution-intents", json={**selected_pool, **overrides}).status_code == 400
    assert client.get("/api/contribution-intents").json == {"contribution_intents": []}


@pytest.mark.parametrize("missing", ["investor_id", "pool_id", "amount_drops"])
def test_required_intent_fields(client, selected_pool, missing):
    selected_pool.pop(missing)
    assert client.post("/api/contribution-intents", json=selected_pool).status_code == 400


@pytest.mark.parametrize("missing", ["investor_id", "pool_id"])
def test_unknown_intent_references(client, selected_pool, missing):
    assert client.post("/api/contribution-intents", json={**selected_pool, missing: 999}).status_code == 404
    assert client.get("/api/contribution-intents").json == {"contribution_intents": []}


def test_filter_intents_by_selected_investor_and_pool(client, selected_pool):
    client.post("/api/contribution-intents", json=selected_pool)
    client.post("/api/pools", json={"name": "Other Pool"})
    client.post("/api/investors", json={"name": "Other Investor"})
    client.post("/api/contribution-intents", json={**selected_pool, "pool_id": 2, "investor_id": 2})
    assert len(client.get("/api/contribution-intents").json["contribution_intents"]) == 2
    filtered = client.get("/api/contribution-intents?investor_id=1&pool_id=1").json["contribution_intents"]
    assert len(filtered) == 1
    assert filtered[0]["pool_id"] == filtered[0]["investor_id"] == 1
    assert client.get("/api/contribution-intents?pool_id=999").json["contribution_intents"] == []
    for value in ["-1", "0", "abc", "1.2", str(2**63)]:
        assert client.get(f"/api/contribution-intents?pool_id={value}").status_code == 400


def test_database_cannot_mark_an_intent_confirmed(app, client, selected_pool):
    client.post("/api/contribution-intents", json=selected_pool)
    with app.app_context():
        connection = get_db()
        with pytest.raises(sqlite3.IntegrityError), connection:
            connection.execute("UPDATE contribution_intents SET status = 'confirmed' WHERE id = 1")
    assert client.get("/api/contribution-intents/1").json["contribution_intent"]["status"] == "pending"


@pytest.mark.parametrize("path", ["investors", "contribution-intents"])
def test_missing_record_is_json_404(client, path):
    for record_id in [999, 2**63]:
        response = client.get(f"/api/{path}/{record_id}")
        assert response.status_code == 404
        assert response.json["error"]["code"] == 404
