"""Local prototype API. There is no authentication or movement of funds yet."""

from datetime import date

from flask import Blueprint, abort, current_app, jsonify, request

from . import ledger
from .db import get_db

api = Blueprint("api", __name__, url_prefix="/api")


def json_body():
    body = request.get_json()
    if not isinstance(body, dict):
        abort(400, description="Request body must be a JSON object.")
    return body


def text_field(body, name, max_length):
    value = body.get(name)
    if not isinstance(value, str) or not value.strip() or len(value) > max_length:
        abort(400, description=f"{name} must be non-empty text, up to {max_length} characters.")
    return value.strip()


@api.get("/health")
def health():
    return jsonify(status="ok", service="sme-lending-pools", mode="local-prototype")


@api.get("/pools")
def list_pools():
    rows = get_db().execute("SELECT * FROM pools ORDER BY id").fetchall()
    return jsonify(pools=[dict(row) for row in rows])


@api.post("/pools")
def create_pool():
    body = json_body()
    name = text_field(body, "name", 120)
    description = body.get("description", "")
    if not isinstance(description, str) or len(description) > 2000:
        abort(400, description="description must be text, up to 2000 characters.")
    connection = get_db()
    cursor = connection.execute(
        "INSERT INTO pools (name, description) VALUES (?, ?)", (name, description.strip())
    )
    connection.commit()
    row = connection.execute("SELECT * FROM pools WHERE id = ?", (cursor.lastrowid,)).fetchone()
    return jsonify(pool=dict(row)), 201


@api.get("/pools/<int:pool_id>")
def get_pool(pool_id):
    if pool_id > 9_223_372_036_854_775_807:
        abort(404, description="Pool not found.")
    row = get_db().execute("SELECT * FROM pools WHERE id = ?", (pool_id,)).fetchone()
    if row is None:
        abort(404, description="Pool not found.")
    return jsonify(pool=dict(row))


@api.get("/funding-requests")
def list_funding_requests():
    rows = get_db().execute("SELECT * FROM funding_requests ORDER BY id").fetchall()
    return jsonify(funding_requests=[dict(row) for row in rows])


@api.post("/funding-requests")
def create_funding_request():
    body = json_body()
    business_name = text_field(body, "business_name", 160)
    pool_id = body.get("pool_id")
    amount = body.get("amount_drops")
    if type(pool_id) is not int or not 0 < pool_id <= 9_223_372_036_854_775_807:
        abort(400, description="pool_id must be a positive 64-bit integer.")
    # Store integer drops, never floating-point XRP. Stay within SQLite's integer range.
    if type(amount) is not int or not 0 < amount <= 9_223_372_036_854_775_807:
        abort(400, description="amount_drops must be a positive 64-bit integer.")
    payment_date = text_field(body, "expected_payment_date", 10)
    try:
        parsed_date = date.fromisoformat(payment_date)
    except ValueError:
        abort(400, description="expected_payment_date must use YYYY-MM-DD.")
    if parsed_date.isoformat() != payment_date or parsed_date <= date.today():
        abort(400, description="expected_payment_date must be a future date in YYYY-MM-DD format.")
    connection = get_db()
    if connection.execute("SELECT id FROM pools WHERE id = ?", (pool_id,)).fetchone() is None:
        abort(404, description="Pool not found.")
    cursor = connection.execute(
        """INSERT INTO funding_requests
           (pool_id, business_name, amount_drops, expected_payment_date)
           VALUES (?, ?, ?, ?)""",
        (pool_id, business_name, amount, payment_date),
    )
    connection.commit()
    row = connection.execute(
        "SELECT * FROM funding_requests WHERE id = ?", (cursor.lastrowid,)
    ).fetchone()
    return jsonify(funding_request=dict(row)), 201


@api.get("/xrpl/status")
def xrpl_status():
    try:
        info = ledger.fetch_server_info(current_app.config["XRPL_JSON_RPC_URL"])
    except Exception:
        current_app.logger.warning("XRPL status lookup failed", exc_info=True)
        return jsonify(error={"code": 503, "message": "XRPL endpoint unavailable; retry later."}), 503
    return jsonify(network="devnet", read_only=True, **info)
