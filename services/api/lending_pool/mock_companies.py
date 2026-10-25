"""Persistent fictional invoice applications, separate from ledger balances."""
from datetime import date, datetime
from zoneinfo import ZoneInfo
from decimal import Decimal, InvalidOperation
import secrets

from flask import Blueprint, abort, jsonify, request

from . import company_store
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


def amount_in_cents(value, field='money_requested'):
    try:
        amount = Decimal(str(value))
        if not amount.is_finite() or not Decimal('0.01') <= amount <= Decimal('100000000'):
            raise ValueError
        if amount != amount.quantize(Decimal('0.01')):
            raise ValueError
        return int(amount * 100)
    except (InvalidOperation, ValueError, TypeError):
        abort(400, description=f'{field} must be between 0.01 and 100,000,000 with at most two decimals.')


@mock_companies.get('')
def list_companies():
    from . import investor_demo
    if investor_demo.active():
        return investor_demo.companies()
    from .mock_vaults import transactions
    snapshots = {t['company_id']:t['certificate'] for t in transactions() if t['kind']=='disbursement'}
    rows = company_store.list_records()
    for row in rows:
        row['terms'] = snapshots.get(row['id'])
        row['account_balance_cents'] = row['terms']['disbursed_cents'] if row['terms'] else 0
    return jsonify(companies=rows, mode='mock', storage='supabase' if company_store.hosted() else 'sqlite')


@mock_companies.post('')
@mock_companies.patch('/<int:record_id>')
def create_company(record_id=None):
    from . import investor_demo
    if investor_demo.active():
        return investor_demo.create_company(record_id)
    body = json_body({'company_name', 'money_requested', 'debtor', 'invoice_due', 'risk_factor'})
    company = text_field(body, 'company_name', 160)
    debtor = text_field(body, 'debtor', 160)
    amount_cents = amount_in_cents(body.get('money_requested'))
    try:
        due = date.fromisoformat(body.get('invoice_due', ''))
        if due == date.max or due <= datetime.now(ZoneInfo('America/New_York')).date():
            raise ValueError
    except (TypeError, ValueError):
        abort(400, description='invoice_due must be a future date (YYYY-MM-DD).')
    score = body.get('risk_factor', 62 if company.casefold() == "amy's cookies" else 35 + secrets.randbelow(56))
    if isinstance(score, bool) or not isinstance(score, int) or not 0 <= score <= 100:
        abort(400, description='risk_factor must be an integer from 0 to 100.')
    pool = pool_for_score(score)
    fee = (amount_cents * 5 + 50) // 100
    decided = amount_cents - fee if score >= 20 else 0
    fields = dict(company_name=company, risk_factor=score, status='declined' if score < 20 else 'pending',
                  decided_disbursement_cents=decided, money_requested_cents=amount_cents,
                  debtor=debtor, invoice_due=due.isoformat())
    if record_id is None:
        fields.update(from_date=datetime.now(ZoneInfo('America/New_York')).date().isoformat(), source='application')
    if not company_store.hosted():
        fields['pool'] = pool
    row = company_store.save_record(fields, record_id)
    return jsonify(company=row, mode='mock', storage='supabase' if company_store.hosted() else 'sqlite'), 201 if record_id is None else 200
