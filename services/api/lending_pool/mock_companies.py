"""Persistent fictional invoice applications, separate from ledger balances."""
from datetime import date, datetime
from zoneinfo import ZoneInfo
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
import secrets

from flask import Blueprint, abort, jsonify, request

from .db import get_db
from .routes import json_body, text_field

mock_companies = Blueprint('mock_companies', __name__, url_prefix='/api/mock-companies')


def pool_for_score(score):
    if score < 20:
        return 'Decline'
    if score < 50:
        return 'Risky'
    if score < 70:
        return 'Medium'
    return 'Safe'


@mock_companies.get('')
def list_companies():
    rows = get_db().execute('SELECT * FROM mock_companies ORDER BY id DESC').fetchall()
    return jsonify(companies=[dict(row) for row in rows], mode='mock')


@mock_companies.post('')
def create_company():
    body = json_body({'company_name', 'money_requested', 'debtor', 'invoice_due'})
    company = text_field(body, 'company_name', 160)
    debtor = text_field(body, 'debtor', 160)
    try:
        amount = Decimal(str(body.get('money_requested')))
        if not amount.is_finite() or not Decimal('0.01') <= amount <= Decimal('100000000'):
            raise ValueError
        if amount != amount.quantize(Decimal('0.01')):
            raise ValueError
        amount_cents = int(amount * 100)
    except (InvalidOperation, ValueError, TypeError):
        abort(400, description='money_requested must be between 0.01 and 100,000,000 with at most two decimals.')
    try:
        due = date.fromisoformat(body.get('invoice_due', ''))
        if due <= datetime.now(ZoneInfo('America/New_York')).date():
            raise ValueError
    except (TypeError, ValueError):
        abort(400, description='invoice_due must be a future date (YYYY-MM-DD).')
    score = 35 + secrets.randbelow(56)
    pool = pool_for_score(score)
    decided = int((Decimal(amount_cents) * score / 100).quantize(Decimal('1'), rounding=ROUND_HALF_UP))
    db = get_db()
    with db:
        cursor = db.execute('''INSERT INTO mock_companies
            (company_name, risk_factor, decided_disbursement_cents, money_requested_cents,
             debtor, from_date, invoice_due, pool, source)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'application')''',
            (company, score, decided, amount_cents, debtor, datetime.now(ZoneInfo('America/New_York')).date().isoformat(), due.isoformat(), pool))
    row = db.execute('SELECT * FROM mock_companies WHERE id = ?', (cursor.lastrowid,)).fetchone()
    return jsonify(company=dict(row), mode='mock'), 201
