"""Local RLUSD simulation: account holdings, invoice underwriting, and review."""
import hashlib
import io
import json
import math
import re
import sqlite3
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
from uuid import UUID

from flask import Blueprint, abort, current_app, jsonify, request, send_file, session
from werkzeug.security import check_password_hash, generate_password_hash
from werkzeug.utils import secure_filename

from .db import get_db
from .risk import TIERS, SAMPLES, assess, rounded_cents

market = Blueprint('market', __name__, url_prefix='/api/market')
POOL_IDS = {tier['id'] for tier in TIERS}
MAX_DOCUMENT = 5 * 1024 * 1024


@market.before_request
def same_origin_mutations():
    if not current_app.config['ENABLE_SIMULATION']:
        # Invoice collection is off-chain. Financial demo endpoints remain disabled.
        if request.path != '/api/market/requests' and not re.fullmatch(r'/api/market/requests/[0-9]+/document', request.path):
            abort(410, description='Simulation endpoint disabled. Financial state comes from /api/lending.')
        from .lending import wallet
        wallet()
    if request.method == 'POST':
        origin = request.headers.get('Origin')
        if request.headers.get('Sec-Fetch-Site') == 'cross-site' or (origin and origin != request.host_url.rstrip('/')):
            abort(403, description='Submit from this application’s origin.')


def body():
    data = request.get_json()
    if not isinstance(data, dict):
        abort(400, description='Expected a JSON object.')
    return data


def text(data, key, limit=500):
    value = data.get(key)
    if not isinstance(value, str) or not value.strip() or len(value) > limit:
        abort(400, description=f'{key.replace("_", " ")} is required (maximum {limit} characters).')
    return value.strip()


def cents(value):
    try:
        amount = Decimal(str(value))
        if not amount.is_finite() or amount <= 0 or amount > 100000000 or amount != amount.quantize(Decimal('.01')):
            raise ValueError()
        return int(amount * 100)
    except (InvalidOperation, ValueError):
        abort(400, description='Enter an amount above zero, at most 100,000,000 RLUSD, with up to two decimals.')


def number(data, key, maximum):
    try:
        if isinstance(data.get(key), bool):
            raise ValueError()
        value = float(data[key])
        if not math.isfinite(value) or not 0 <= value <= maximum:
            raise ValueError()
        return value
    except (KeyError, TypeError, ValueError):
        abort(400, description=f'{key.replace("_", " ")} must be between 0 and {maximum}.')


def due_days(value):
    try:
        parsed = date.fromisoformat(value)
        days = (parsed - date.today()).days
        if parsed.isoformat() != value or not 1 <= days <= 180:
            raise ValueError()
        return days
    except (TypeError, ValueError):
        abort(400, description='Invoice deadline must be a future date within 180 days (YYYY-MM-DD).')


def investor():
    investor_id = session.get('market_investor_id')
    row = get_db().execute('SELECT id,name,email,preference FROM market_investors WHERE id=?', (investor_id,)).fetchone()
    return dict(row) if row else None


def invoice_key(debtor, reference):
    canonical = ' '.join(debtor.casefold().split()) + '\0' + ' '.join(reference.casefold().split())
    return hashlib.sha256(canonical.encode()).hexdigest()


def requests_data():
    rows = get_db().execute('''SELECT id,company,sector,purpose,invoice_ref,debtor,due_date,
        invoice_cents,amount_cents,risk,pool,status,years_trading,late_payment_pct,assessment,
        document_name,created_at,approved_at FROM market_requests ORDER BY id DESC''').fetchall()
    result = []
    for row in rows:
        if not current_app.config['ENABLE_SIMULATION']:
            owner = get_db().execute('SELECT wallet_address FROM market_requests WHERE id=?', (row['id'],)).fetchone()[0]
            if owner != session.get('wallet_address'):
                continue
        record = dict(row)
        record['assessment'] = json.loads(record['assessment']) if record['assessment'] else None
        record['reviews'] = [dict(r) for r in get_db().execute('SELECT * FROM market_reviews WHERE request_id=? ORDER BY id', (row['id'],))]
        for review in record['reviews']:
            review['checks'] = json.loads(review['checks'])
        result.append(record)
    return result


def snapshot():
    if not current_app.config['ENABLE_SIMULATION']:
        return dict(requests=requests_data(), mode='offchain_underwriting', financial_effect=False)
    db = get_db()
    if db.in_transaction:
        return _snapshot()
    # Keep capital, individual holdings and allocations on one consistent read.
    with db:
        db.execute('BEGIN')
        return _snapshot()


def _snapshot():
    db = get_db()
    current = investor()
    totals = {r['pool']: r['amount'] for r in db.execute('SELECT pool,SUM(amount_cents) amount FROM market_deposits GROUP BY pool')}
    personal = {r['pool']: r['amount'] for r in db.execute('SELECT pool,SUM(amount_cents) amount FROM market_deposits WHERE investor_id=? GROUP BY pool', (current['id'] if current else None,))}
    companies = []
    for index, (company, sector, purpose, amount, invoice, days, years, late) in enumerate(SAMPLES):
        assessment = assess(amount*100, invoice*100, days, years, late)
        companies.append(dict(company=company, sector=sector, purpose=purpose, amount_cents=amount*100,
            invoice_cents=invoice*100, due_date=(date.today()+timedelta(days=days)).isoformat(),
            invoice_ref=f'DEMO-{1001+index}', risk=assessment['score'], pool=assessment['pool'],
            assessment=assessment, synthetic=True))
    requests = requests_data()
    companies.extend({**r, 'synthetic': False} for r in requests if r['status'] == 'approved')
    pools = []
    for tier in TIERS:
        key = tier['id']
        borrowers = [c for c in companies if c['pool'] == key]
        capital = tier['base_cents'] + totals.get(key, 0)
        allocated = sum(c['amount_cents'] for c in borrowers)
        annual_interest = sum(Decimal(c['amount_cents'])*Decimal(str(c['assessment']['apr']))/100 for c in borrowers)
        apr = float(annual_interest / capital * 100)
        holding = personal.get(key, 0)
        pools.append(dict(**tier, capital_cents=capital, invested_cents=holding, allocated_cents=allocated,
            reserve_cents=capital-allocated, companies=borrowers, apr=round(apr, 6),
            annual_interest_cents=rounded_cents(annual_interest),
            risk=round(sum(c['risk']*c['amount_cents'] for c in borrowers)/allocated, 2) if allocated else 0,
            ownership_pct=holding/capital*100,
            stress_apr=round(apr - allocated/capital*tier['loss_scenario'], 6)))
    return dict(pools=pools, requests=requests, investor=current)


@market.get('')
def overview():
    return jsonify(snapshot())


@market.post('/investors')
def register():
    data = body()
    name, email = text(data, 'name', 120), text(data, 'email', 254).casefold()
    password = text(data, 'password', 128)
    if not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+', email):
        abort(400, description='Enter a valid email address.')
    if len(password) < 10:
        abort(400, description='Use a password with at least 10 characters.')
    if not isinstance(data.get('preference'), str) or data['preference'] not in POOL_IDS or data.get('risk_acknowledged') is not True:
        abort(400, description='Choose a risk preference and acknowledge potential loss of capital.')
    db = get_db()
    try:
        with db:
            cursor = db.execute('INSERT INTO market_investors(name,email,password_hash,preference) VALUES (?,?,?,?)',
                (name, email, generate_password_hash(password), data['preference']))
    except sqlite3.IntegrityError:
        abort(409, description='An investor account already uses this email. Sign in instead.')
    session.clear()
    session['market_investor_id'] = cursor.lastrowid
    return jsonify(snapshot()), 201


@market.post('/login')
def login():
    data = body()
    row = get_db().execute('SELECT * FROM market_investors WHERE email=?', (text(data, 'email', 254).casefold(),)).fetchone()
    password = text(data, 'password', 128)
    if row is None or not check_password_hash(row['password_hash'], password):
        abort(401, description='Email or password is incorrect.')
    session.clear()
    session['market_investor_id'] = row['id']
    return jsonify(snapshot())


@market.post('/logout')
def logout():
    session.clear()
    return jsonify(snapshot())


@market.post('/deposits')
def deposit():
    current = investor()
    if current is None:
        abort(401, description='Create an investor account or sign in before investing.')
    data = body()
    if not isinstance(data.get('pool'), str) or data['pool'] not in POOL_IDS:
        abort(400, description='Choose a valid pool.')
    amount = cents(data.get('amount'))
    try:
        key = str(UUID(data.get('operation_key', '')))
    except (ValueError, TypeError, AttributeError):
        abort(400, description='A valid deposit operation key is required.')
    db = get_db()
    with db:
        db.execute('BEGIN IMMEDIATE')
        previous = db.execute('SELECT * FROM market_deposits WHERE operation_key=?', (key,)).fetchone()
        if previous:
            if (previous['investor_id'], previous['pool'], previous['amount_cents']) != (current['id'], data['pool'], amount):
                abort(409, description='This operation key belongs to a different deposit.')
        else:
            db.execute('INSERT INTO market_deposits(pool,amount_cents,investor_id,operation_key) VALUES (?,?,?,?)',
                (data['pool'], amount, current['id'], key))
    return jsonify(snapshot()), 200 if previous else 201


@market.post('/quote')
def quote():
    data = body()
    amount = cents(data.get('amount'))
    months = data.get('months')
    if type(months) is not int or not 1 <= months <= 60:
        abort(400, description='Choose 1–60 whole months.')
    pool = next((p for p in snapshot()['pools'] if p['id'] == data.get('pool')), None)
    if pool is None:
        abort(400, description='Choose a valid pool.')
    # New deposits initially remain idle: no promised deployment or compounding.
    capital = pool['capital_cents'] + amount
    effective_apr = pool['apr'] * pool['capital_cents'] / capital
    stressed_apr = pool['stress_apr'] * pool['capital_cents'] / capital
    return jsonify(quote=dict(earnings_cents=rounded_cents(amount * effective_apr / 100 * months / 12),
        stress_earnings_cents=rounded_cents(amount * stressed_apr / 100 * months / 12),
        ownership_pct=(pool['invested_cents']+amount)/capital*100, apr=effective_apr))


@market.get('/requests')
def applications():
    return jsonify(snapshot())


@market.post('/requests')
def borrow():
    data = request.form
    fields = {key: text(data, key) for key in ('company', 'sector', 'purpose', 'invoice_ref', 'debtor', 'due_date')}
    days = due_days(fields['due_date'])
    amount, invoice = cents(data.get('amount')), cents(data.get('invoice'))
    years, late = number(data, 'years_trading', 100), number(data, 'late_payment_pct', 100)
    try:
        assessment = assess(amount, invoice, days, years, late)
    except ValueError as error:
        abort(400, description=str(error))
    upload = request.files.get('document')
    if not upload or not upload.filename:
        abort(400, description='Attach the future invoice as a PDF, PNG, or JPEG (up to 5 MB).')
    content = upload.read(MAX_DOCUMENT + 1)
    if len(content) > MAX_DOCUMENT:
        abort(413, description='Invoice document must be at most 5 MB.')
    mime = ('application/pdf' if content.startswith(b'%PDF-') else 'image/png' if content.startswith(b'\x89PNG\r\n\x1a\n') else 'image/jpeg' if content.startswith(b'\xff\xd8\xff') else None)
    if not mime:
        abort(400, description='The invoice must be a PDF, PNG, or JPEG document.')
    key = invoice_key(fields['debtor'], fields['invoice_ref'])
    db = get_db()
    with db:
        db.execute('BEGIN IMMEDIATE')
        existing = db.execute('SELECT debtor,invoice_ref FROM market_requests').fetchall()
        if any(invoice_key(row['debtor'], row['invoice_ref']) == key for row in existing):
            abort(409, description='This debtor and invoice reference already have a borrow request.')
        db.execute('''INSERT INTO market_requests(company,sector,purpose,invoice_ref,debtor,due_date,
            invoice_cents,amount_cents,risk,pool,years_trading,late_payment_pct,assessment,invoice_key,
            document_name,document_type,document_data,created_at,wallet_address) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)''',
            (*fields.values(), invoice, amount, assessment['score'], assessment['pool'], years, late,
             json.dumps(assessment), key, secure_filename(upload.filename) or 'invoice', mime, content,
             datetime.now(timezone.utc).isoformat(), session.get('wallet_address')))
    return jsonify(snapshot()), 201


@market.get('/requests/<int:request_id>/document')
def document(request_id):
    if request_id > 9_223_372_036_854_775_807:
        abort(404)
    row = get_db().execute('SELECT document_data,document_name,document_type FROM market_requests WHERE id=?', (request_id,)).fetchone()
    if row is None or row['document_data'] is None:
        abort(404, description='No invoice document is available for this request.')
    if not current_app.config['ENABLE_SIMULATION']:
        owner = get_db().execute('SELECT wallet_address FROM market_requests WHERE id=?', (request_id,)).fetchone()[0]
        if owner != session.get('wallet_address'):
            abort(404)
    response = send_file(io.BytesIO(row['document_data']), mimetype=row['document_type'],
                         as_attachment=True, download_name=row['document_name'], max_age=0)
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['Cache-Control'] = 'no-store'
    return response


@market.post('/requests/<int:request_id>/review')
def review(request_id):
    data = body()
    reviewer, note = text(data, 'reviewer', 120), text(data, 'note', 2000)
    decision = data.get('decision')
    if decision not in ('approved', 'rejected'):
        abort(400, description='Choose approved or rejected.')
    checks = data.get('checks', {})
    if not isinstance(checks, dict):
        abort(400, description='Verification checks must be an object.')
    if request_id > 9_223_372_036_854_775_807:
        abort(404)
    db = get_db()
    with db:
        # Review and reserve allocation share one write lock; concurrent approval
        # cannot overdraw a pool or fund an invoice twice.
        db.execute('BEGIN IMMEDIATE')
        row = db.execute('SELECT * FROM market_requests WHERE id=?', (request_id,)).fetchone()
        if row is None:
            abort(404, description='Borrow request not found.')
        if row['status'] != 'pending_verification':
            abort(409, description='This request has already been reviewed.')
        if decision == 'approved':
            if any(checks.get(key) is not True for key in ('invoice_authentic', 'debtor_confirmed', 'not_financed')):
                abort(400, description='Complete all three invoice verification checks before approval.')
            if not row['document_data'] or row['years_trading'] is None or row['late_payment_pct'] is None:
                abort(400, description='This legacy request lacks an invoice document or underwriting data; reject and resubmit it.')
            days = due_days(row['due_date'])
            assessment = assess(row['amount_cents'], row['invoice_cents'], days, row['years_trading'], row['late_payment_pct'])
            pool = next(p for p in snapshot()['pools'] if p['id'] == assessment['pool'])
            if row['amount_cents'] > pool['reserve_cents']:
                abort(409, description='The assigned pool has insufficient available RLUSD. Add capital before approval.')
            # Also ensure the maturity repayment is covered by the invoice face value.
            if assessment['repayment_cents'] > row['invoice_cents']:
                abort(400, description='The invoice does not cover the projected repayment.')
            db.execute('UPDATE market_requests SET risk=?,pool=?,assessment=?,approved_at=? WHERE id=?',
                (assessment['score'], assessment['pool'], json.dumps(assessment), datetime.now(timezone.utc).isoformat(), request_id))
        db.execute('UPDATE market_requests SET status=? WHERE id=?', (decision, request_id))
        db.execute('INSERT INTO market_reviews(request_id,decision,reviewer,note,checks) VALUES (?,?,?,?,?)',
                   (request_id, decision, reviewer, note, json.dumps(checks)))
    return jsonify(snapshot())
