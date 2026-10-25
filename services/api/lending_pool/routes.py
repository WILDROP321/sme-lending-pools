"""Local prototype API. There is no authentication or movement of funds yet."""

from datetime import date

from flask import Blueprint, abort, current_app, jsonify, request

from . import ledger
from .db import get_db
from .reviews import InvalidTransition, REVIEW_TARGETS, review_request

api = Blueprint("api", __name__, url_prefix="/api")


@api.before_request
def legacy_api_boundary():
    if not current_app.config['ENABLE_SIMULATION'] and request.path not in ('/api/health',):
        abort(410, description='Legacy XRP/demo API is disabled. Use /api/lending for RLUSD ledger operations.')


def json_body(allowed_fields=None):
    body = request.get_json()
    if not isinstance(body, dict):
        abort(400, description="Request body must be a JSON object.")
    if allowed_fields is not None and set(body) - allowed_fields:
        abort(400, description="Unknown or server-owned fields: " + ", ".join(sorted(set(body) - allowed_fields)))
    return body


def text_field(body, name, max_length):
    value = body.get(name)
    if not isinstance(value, str) or not value.strip() or len(value) > max_length:
        abort(400, description=f"{name} must be non-empty text, up to {max_length} characters.")
    return value.strip()


def positive_integer(body, name):
    value = body.get(name)
    if type(value) is not int or not 0 < value <= 9_223_372_036_854_775_807:
        abort(400, description=f"{name} must be a positive 64-bit integer.")
    return value


def record_or_404(table, record_id, label):
    # Table names come only from the fixed strings at our call sites.
    if record_id > 9_223_372_036_854_775_807:
        abort(404, description=f"{label} not found.")
    row = get_db().execute(f"SELECT * FROM {table} WHERE id = ?", (record_id,)).fetchone()
    if row is None:
        abort(404, description=f"{label} not found.")
    return dict(row)


@api.get("/health")
def health():
    return jsonify(status="ok", service="sme-lending-pools", mode="simulation" if current_app.config["ENABLE_SIMULATION"] else "ledger")


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
    return jsonify(pool=record_or_404("pools", pool_id, "Pool"))


@api.get("/investors")
def list_investors():
    rows = get_db().execute("SELECT * FROM investors ORDER BY id").fetchall()
    return jsonify(investors=[dict(row) for row in rows])


@api.post("/investors")
def create_investor():
    body = json_body({"name"})
    name = text_field(body, "name", 120)
    connection = get_db()
    cursor = connection.execute("INSERT INTO investors (name) VALUES (?)", (name,))
    connection.commit()
    return jsonify(investor=record_or_404("investors", cursor.lastrowid, "Investor")), 201


@api.get("/investors/<int:investor_id>")
def get_investor(investor_id):
    return jsonify(investor=record_or_404("investors", investor_id, "Investor"))


@api.get("/contribution-intents")
def list_contribution_intents():
    clauses, parameters = [], []
    for name in ("pool_id", "investor_id"):
        if name not in request.args:
            continue
        try:
            value = int(request.args[name])
        except ValueError:
            abort(400, description=f"{name} must be a positive 64-bit integer.")
        positive_integer({name: value}, name)
        clauses.append(f"{name} = ?")
        parameters.append(value)
    where = " WHERE " + " AND ".join(clauses) if clauses else ""
    rows = get_db().execute(
        "SELECT * FROM contribution_intents" + where + " ORDER BY id", parameters
    ).fetchall()
    return jsonify(contribution_intents=[dict(row) for row in rows])


@api.post("/contribution-intents")
def create_contribution_intent():
    body = json_body({"investor_id", "pool_id", "amount_drops"})
    investor_id = positive_integer(body, "investor_id")
    pool_id = positive_integer(body, "pool_id")
    amount = positive_integer(body, "amount_drops")
    record_or_404("investors", investor_id, "Investor")
    record_or_404("pools", pool_id, "Pool")
    connection = get_db()
    cursor = connection.execute(
        "INSERT INTO contribution_intents (investor_id, pool_id, amount_drops) VALUES (?, ?, ?)",
        (investor_id, pool_id, amount),
    )
    connection.commit()
    return jsonify(contribution_intent=record_or_404(
        "contribution_intents", cursor.lastrowid, "Contribution intent"
    )), 201


@api.get("/contribution-intents/<int:intent_id>")
def get_contribution_intent(intent_id):
    return jsonify(contribution_intent=record_or_404(
        "contribution_intents", intent_id, "Contribution intent"
    ))


@api.get("/funding-requests")
def list_funding_requests():
    rows = get_db().execute("SELECT * FROM funding_requests ORDER BY id").fetchall()
    return jsonify(funding_requests=[dict(row) for row in rows])


@api.post("/funding-requests")
def create_funding_request():
    body = json_body()
    business_name = text_field(body, "business_name", 160)
    pool_id = positive_integer(body, "pool_id")
    # Store integer drops, never floating-point XRP. Stay within SQLite's integer range.
    amount = positive_integer(body, "amount_drops")
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


@api.get("/funding-requests/<int:request_id>")
def get_funding_request(request_id):
    record = record_or_404("funding_requests", request_id, "Funding request")
    rows = get_db().execute(
        "SELECT * FROM funding_request_reviews WHERE funding_request_id = ? ORDER BY id", (request_id,)
    ).fetchall()
    return jsonify(funding_request=record, reviews=[dict(row) for row in rows])


@api.post("/funding-requests/<int:request_id>/review")
def review_funding_request(request_id):
    body = json_body({"status", "note"})
    target = body.get("status")
    if not isinstance(target, str) or target not in REVIEW_TARGETS:
        abort(400, description="status must be under_review, approved, rejected, or cancelled.")
    note = body.get("note", "")
    if not isinstance(note, str) or len(note) > 2000:
        abort(400, description="note must be text, up to 2000 characters.")
    if request_id > 9_223_372_036_854_775_807:
        abort(404, description="Funding request not found.")
    try:
        record = review_request(request_id, target, note.strip())
    except LookupError:
        abort(404, description="Funding request not found.")
    except InvalidTransition as error:
        abort(409, description=str(error))
    return jsonify(funding_request=record)


@api.get("/xrpl/status")
def xrpl_status():
    try:
        info = ledger.fetch_server_info(current_app.config["XRPL_JSON_RPC_URL"])
    except Exception:
        current_app.logger.warning("XRPL status lookup failed", exc_info=True)
        return jsonify(error={"code": 503, "message": "XRPL endpoint unavailable; retry later."}), 503
    return jsonify(network="devnet", read_only=True, **info)
