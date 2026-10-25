import json
from datetime import date, timedelta

import pytest

from lending_pool import create_app
from lending_pool import ledger


def funding_body(**overrides):
    return {
        "pool_id": 1,
        "business_name": "Demo Bakery",
        "amount_drops": 25_000_000,
        "expected_payment_date": (date.today() + timedelta(days=30)).isoformat(),
        **overrides,
    }


def test_home_and_health(client):
    assert client.get("/").status_code == 200
    assert client.get("/api/health").json["status"] == "ok"


def test_pool_persists_across_app_instances(app, client):
    response = client.post("/api/pools", json={"name": "Working Capital"})
    assert response.status_code == 201
    assert response.json["pool"]["status"] == "draft"
    second_app = create_app({"TESTING": True, "DATABASE": app.config["DATABASE"]})
    assert second_app.test_client().get("/api/pools/1").json["pool"]["name"] == "Working Capital"
    assert len(client.get("/api/pools").json["pools"]) == 1


@pytest.mark.parametrize("body", [[], None, {}, {"name": " "}, {"name": 22}, {"name": "x", "description": []}])
def test_invalid_pool_input(client, body):
    response = client.post("/api/pools", data=json.dumps(body), content_type="application/json")
    assert response.status_code == 400
    assert "error" in response.json


def test_funding_request_lifecycle_starts_submitted(client):
    client.post("/api/pools", json={"name": "Demo Pool"})
    response = client.post("/api/funding-requests", json=funding_body())
    assert response.status_code == 201
    record = response.json["funding_request"]
    assert record["status"] == "submitted"
    assert record["amount_drops"] == 25_000_000
    assert client.get("/api/funding-requests").json["funding_requests"] == [{**record, "tx_hash": None}]


@pytest.mark.parametrize("overrides", [
    {"amount_drops": 0}, {"amount_drops": -1}, {"amount_drops": 1.5},
    {"amount_drops": True}, {"amount_drops": 2**63}, {"pool_id": True}, {"pool_id": 2**63},
    {"business_name": ""}, {"expected_payment_date": "tomorrow"},
    {"expected_payment_date": date.today().isoformat()},
])
def test_invalid_funding_request(client, overrides):
    client.post("/api/pools", json={"name": "Demo Pool"})
    assert client.post("/api/funding-requests", json=funding_body(**overrides)).status_code == 400
    assert client.get("/api/funding-requests").json["funding_requests"] == []


def test_unknown_pool_is_json_404(client):
    assert client.get("/api/pools/999").status_code == 404
    assert client.get(f"/api/pools/{2**63}").status_code == 404
    assert client.post("/api/funding-requests", json=funding_body()).status_code == 404


def test_devnet_status(client, monkeypatch):
    def fake_server_info(url):
        assert url == "https://s.devnet.rippletest.net:51234/"
        return {"server_state": "full", "validated_ledger": 123}

    monkeypatch.setattr(ledger, "fetch_server_info", fake_server_info)
    response = client.get("/api/xrpl/status")
    assert response.status_code == 200
    assert response.json["read_only"] is True
    assert response.json["validated_ledger"] == 123


def test_devnet_unavailable_does_not_break_local_app(client, monkeypatch):
    def unavailable(_url):
        raise TimeoutError("do not leak connection details")

    monkeypatch.setattr(ledger, "fetch_server_info", unavailable)
    response = client.get("/api/xrpl/status")
    assert response.status_code == 503
    assert "do not leak" not in response.get_data(as_text=True)
    assert client.get("/api/health").status_code == 200


def test_seed_can_be_repeated_without_duplicates(app, client):
    runner = app.test_cli_runner()
    for _ in range(2):
        assert runner.invoke(args=["seed-demo"]).exit_code == 0
    assert len(client.get("/api/pools").json["pools"]) == 1
