"""Atomic mock deposits, approvals and permanent certificate snapshots."""
from datetime import datetime
import json
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo

from flask import Blueprint, abort, jsonify, render_template, request

from . import company_store
from .db import get_db
from .routes import json_body
from .mock_companies import amount_in_cents

mock_vaults = Blueprint('mock_vaults', __name__, url_prefix='/api/mock-vaults')
POOLS = {'Safe', 'Medium', 'Risky'}


def transactions(company_id=None):
    if company_store.hosted():
        query = {'order': 'created_at.desc'}
        if company_id is not None:
            query['company_id'] = f'eq.{company_id}'
        return company_store.remote('GET', resource='mock_vault_transactions', query=query)
    query = 'SELECT * FROM mock_vault_transactions'
    args = ()
    if company_id is not None:
        query += ' WHERE company_id=?'
        args = (company_id,)
    rows = [dict(r) for r in get_db().execute(query+' ORDER BY created_at DESC', args)]
    for row in rows:
        row['certificate'] = json.loads(row['certificate']) if row['certificate'] else None
    return rows


@mock_vaults.get('')
def vaults():
    rows = company_store.remote('GET', resource='mock_vaults') if company_store.hosted() else [dict(r) for r in get_db().execute('SELECT * FROM mock_vaults')]
    history = transactions()
    for row in rows:
        row['deposited_cents'] = sum(t['amount_cents'] for t in history if t['pool']==row['pool'] and t['kind']=='deposit')
        row['assets_on_loan_cents'] = sum(t['amount_cents'] for t in history if t['pool']==row['pool'] and t['kind']=='disbursement')
        row['available_withdrawal_cents'] = row['balance_cents']
        row['total_assets_cents'] = row['balance_cents']
        row['disbursed_cents'] = sum(t['amount_cents'] for t in history if t['pool']==row['pool'] and t['kind']=='disbursement')
    return jsonify(vaults=rows, transactions=history, mode='mock')


@mock_vaults.post('/<pool>/deposits')
def deposit(pool):
    if pool not in POOLS:
        abort(404, description='Pool not found.')
    body = json_body({'amount', 'request_key'})
    amount = amount_in_cents(body.get('amount'), 'amount')
    try:
        key = str(UUID(body.get('request_key', '')))
    except (ValueError, TypeError, AttributeError):
        abort(400, description='A valid UUID request_key is required.')
    if company_store.hosted():
        tx = company_store.rpc('mock_deposit', dict(p_pool=pool, p_amount=amount, p_request_key=key))
    else:
        db = get_db()
        with db:
            db.execute('BEGIN IMMEDIATE')
            previous = db.execute('SELECT * FROM mock_vault_transactions WHERE request_key=?', (key,)).fetchone()
            if previous:
                if previous['pool'] != pool or previous['amount_cents'] != amount:
                    abort(409, description='Deposit reference already used')
                tx = dict(previous)
            else:
                db.execute('UPDATE mock_vaults SET balance_cents=balance_cents+? WHERE pool=?', (amount,pool))
                balance = db.execute('SELECT balance_cents FROM mock_vaults WHERE pool=?', (pool,)).fetchone()[0]
                tx_id = str(uuid4())
                db.execute('INSERT INTO mock_vault_transactions(id,pool,kind,amount_cents,balance_after_cents,request_key) VALUES (?,?,\'deposit\',?,?,?)', (tx_id,pool,amount,balance,key))
                tx = dict(db.execute('SELECT * FROM mock_vault_transactions WHERE id=?',(tx_id,)).fetchone())
    return jsonify(transaction=tx, mode='mock')


@mock_vaults.post('/approvals/<int:company_id>')
def approve(company_id):
    json_body(set())
    if company_store.hosted():
        tx = company_store.rpc('mock_approve', dict(p_company_id=company_id))
    else:
        db = get_db()
        with db:
            db.execute('BEGIN IMMEDIATE')
            tx = local_approve(company_id, db)
    return jsonify(transaction=tx, certificate_url=f'/api/mock-vaults/certificates/{company_id}', mode='mock')


def local_approve(company_id, db):
    c = db.execute('SELECT * FROM mock_companies WHERE id=?', (company_id,)).fetchone()
    if c is None:
        abort(404, description='Company not found.')
    previous = transactions(company_id)
    if previous:
        return previous[0]
    if c['status'] != 'pending' or c['pool'] == 'Decline' or c['decided_disbursement_cents'] <= 0:
        abort(409, description='Company is not eligible for approval')
    if c['invoice_due'] <= datetime.now(ZoneInfo('America/New_York')).date().isoformat():
        abort(409, description='Invoice is past due')
    amount = c['decided_disbursement_cents']
    updated = db.execute('UPDATE mock_vaults SET balance_cents=balance_cents-? WHERE pool=? AND balance_cents>=?', (amount,c['pool'],amount))
    if updated.rowcount != 1:
        abort(409, description='Insufficient mock vault assets')
    balance = db.execute('SELECT balance_cents FROM mock_vaults WHERE pool=?',(c['pool'],)).fetchone()[0]
    snapshot = {k:c[k] for k in ('company_name','debtor','from_date','invoice_due','risk_factor','pool')}
    snapshot.update(requested_cents=c['money_requested_cents'], repayment_cents=c['money_requested_cents'], disbursed_cents=amount,currency='MOCKRLUSD',mode='mock')
    tx_id = str(uuid4())
    db.execute('INSERT INTO mock_vault_transactions(id,pool,kind,amount_cents,balance_after_cents,company_id,certificate) VALUES (?,?,\'disbursement\',?,?,?,?)', (tx_id,c['pool'],amount,balance,company_id,json.dumps(snapshot)))
    db.execute("UPDATE mock_companies SET status='approved' WHERE id=?",(company_id,))
    tx = transactions(company_id)[0]
    return tx


@mock_vaults.get('/certificates/<int:company_id>')
def certificate(company_id):
    rows = transactions(company_id)
    if not rows or rows[0]['kind'] != 'disbursement':
        abort(404, description='A certificate is available only after successful mock funding approval.')
    tx = rows[0]
    return render_template('certificate.html', tx=tx, c=tx['certificate'])
