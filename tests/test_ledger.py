"""Offline tests for the ledger integration helpers. No network access."""

import pytest

from lending_pool import ledger


def tx_result(*, validated=True, delivered_amount="1000000", tx_hash="ABC123"):
    return {
        "hash": tx_hash,
        "validated": validated,
        "meta": {"delivered_amount": delivered_amount},
    }


def test_integration_result_reads_delivered_amount_not_requested_amount():
    result = ledger._integration_result_from_tx_result(
        tx_result(delivered_amount="500000"), intent_id="intent-1"
    )
    assert result == ledger.IntegrationResult(
        tx_hash="ABC123", validated=True, amount_drops=500000, intent_id="intent-1"
    )


def test_integration_result_rejects_issued_currency_amount():
    issued_currency_delivery = tx_result(delivered_amount="500000")
    issued_currency_delivery["meta"]["delivered_amount"] = {"currency": "USD", "value": "5"}
    with pytest.raises(ValueError):
        ledger._integration_result_from_tx_result(issued_currency_delivery, intent_id="intent-1")


def test_integration_result_rejects_missing_delivered_amount():
    unknown_delivery = tx_result()
    del unknown_delivery["meta"]["delivered_amount"]
    with pytest.raises(ValueError):
        ledger._integration_result_from_tx_result(unknown_delivery, intent_id="intent-1")


class FakeClient:
    def __init__(self, response):
        self._response = response

    def request(self, _request):
        return self._response


class FakeResponse:
    def __init__(self, *, successful, result=None):
        self._successful = successful
        self.result = result

    def is_successful(self):
        return self._successful


def test_fetch_validated_transaction_raises_on_unsuccessful_response():
    client = FakeClient(FakeResponse(successful=False))
    with pytest.raises(RuntimeError):
        ledger.fetch_validated_transaction(client, "deadbeef", intent_id="intent-1")


def test_fetch_validated_transaction_returns_integration_result():
    client = FakeClient(FakeResponse(successful=True, result=tx_result(tx_hash="DEADBEEF")))
    result = ledger.fetch_validated_transaction(client, "DEADBEEF", intent_id="intent-1")
    assert result == ledger.IntegrationResult(
        tx_hash="DEADBEEF", validated=True, amount_drops=1_000_000, intent_id="intent-1"
    )


def test_processed_deposits_is_idempotent_on_repeat_observation():
    seen = ledger.ProcessedDeposits()
    result = ledger.IntegrationResult(
        tx_hash="ABC", validated=True, amount_drops=1_000_000, intent_id="intent-1"
    )
    assert seen.record_if_new(result) is True
    # Observing the exact same validated transaction again must not credit twice.
    assert seen.record_if_new(result) is False


def test_processed_deposits_never_credits_an_unvalidated_result():
    seen = ledger.ProcessedDeposits()
    unvalidated = ledger.IntegrationResult(
        tx_hash="XYZ", validated=False, amount_drops=1_000_000, intent_id="intent-2"
    )
    assert seen.record_if_new(unvalidated) is False
    # Still not credited even if observed again, e.g. after later becoming validated
    # under the same hash would be a different IntegrationResult instance.
    assert seen.record_if_new(unvalidated) is False


def test_processed_deposits_tracks_distinct_hashes_independently():
    seen = ledger.ProcessedDeposits()
    first = ledger.IntegrationResult(tx_hash="A", validated=True, amount_drops=1, intent_id="i1")
    second = ledger.IntegrationResult(tx_hash="B", validated=True, amount_drops=2, intent_id="i2")
    assert seen.record_if_new(first) is True
    assert seen.record_if_new(second) is True
    assert seen.record_if_new(first) is False
