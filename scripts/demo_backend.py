"""Run the local investor/request demo against an already-running Flask server.

This creates demo records each time. It never submits a ledger transaction.
"""

import json
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

BASE_URL = "http://127.0.0.1:5001/api"


def api(path, body=None):
    payload = json.dumps(body).encode() if body is not None else None
    request = Request(BASE_URL + path, data=payload, headers={"Content-Type": "application/json"})
    with urlopen(request, timeout=10) as response:
        return json.load(response)


def main():
    investor = api("/investors", {"name": "Demo Investor"})["investor"]
    pool = api("/pools", {"name": "Backend Walkthrough", "description": "Local demo only"})["pool"]
    intent = api("/contribution-intents", {
        "investor_id": investor["id"], "pool_id": pool["id"], "amount_drops": 50_000_000,
    })["contribution_intent"]
    funding = api("/funding-requests", {
        "pool_id": pool["id"], "business_name": "Demo Bakery", "amount_drops": 25_000_000,
        "expected_payment_date": "2099-12-01",
    })["funding_request"]
    path = f"/funding-requests/{funding['id']}/review"
    api(path, {"status": "under_review", "note": "Reviewing synthetic invoice"})
    api(path, {"status": "approved", "note": "Local demo review only; no disbursement"})
    detail = api(f"/funding-requests/{funding['id']}")
    if intent["status"] != "pending" or detail["funding_request"]["status"] != "approved":
        raise RuntimeError("Unexpected demo state")
    if api(f"/pools/{pool['id']}")["pool"] != pool:
        raise RuntimeError("Creating an intent must not change the pool")
    print(json.dumps({
        "investor_id": investor["id"], "pool_id": pool["id"],
        "contribution_intent": intent, "funding_request": detail["funding_request"],
        "review_history": detail["reviews"],
        "note": "Intent is pending. No deposit was credited and no funds were sent.",
    }, indent=2))


if __name__ == "__main__":
    try:
        main()
    except HTTPError as error:
        raise SystemExit(f"API returned HTTP {error.code}: {error.read().decode()}") from error
    except URLError as error:
        raise SystemExit("Start Flask on port 5001 and run flask migrate-db before this demo.") from error
