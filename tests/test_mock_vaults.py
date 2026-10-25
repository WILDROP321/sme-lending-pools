from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4
from unittest.mock import patch

from lending_pool.db import get_db


def pending(client, amount='1000'):
    # Create a queued application with no liquidity, then restore balances for
    # explicit replay/concurrency tests of the underlying funding operation.
    with client.application.app_context():
        db=get_db()
        saved=[tuple(r) for r in db.execute('SELECT pool,balance_cents FROM mock_vaults')]
        db.execute('UPDATE mock_vaults SET balance_cents=0');db.commit()
    with patch('lending_pool.mock_companies.secrets.randbelow',return_value=45):
        response = client.post('/api/mock-companies', json=dict(company_name='Certificate Company', money_requested=amount, debtor='Invoice Debtor', invoice_due='2099-01-01'))
    with client.application.app_context():
        db=get_db()
        db.executemany('UPDATE mock_vaults SET balance_cents=? WHERE pool=?',[(amount,pool) for pool,amount in saved]);db.commit()
    assert response.status_code == 201
    return response.json['company']


def balances(client):
    return {v['pool']:v for v in client.get('/api/mock-vaults').json['vaults']}


def test_opening_balances_are_one_million_and_do_not_reseed(app, client):
    from lending_pool.db import init_db
    with app.app_context():
        assert all(v['opening_balance_cents']==100000000 for v in balances(client).values())
        before = balances(client)
        pending(client)
        init_db()
        after=balances(client)
        for pool in before:
            assert after[pool]['balance_cents']==before[pool]['balance_cents']


def test_mock_deposit_is_persistent_idempotent_and_rejects_reference_reuse(client):
    before = balances(client)['Safe']['balance_cents']
    body = dict(amount='200.00', request_key=str(uuid4()))
    a=client.post('/api/mock-vaults/Safe/deposits',json=body)
    assert a.status_code == 200
    b=client.post('/api/mock-vaults/Safe/deposits',json=body)
    assert b.json['transaction']['id'] == a.json['transaction']['id']
    assert balances(client)['Safe']['balance_cents'] == before+20000
    assert balances(client)['Safe']['deposited_cents'] == 20000
    assert client.post('/api/mock-vaults/Safe/deposits',json={**body,'amount':'201'}).status_code == 409
    assert balances(client)['Safe']['balance_cents'] == before+20000
    for amount in ['0','-1','1.001','NaN','Infinity']:
        assert client.post('/api/mock-vaults/Safe/deposits',json=dict(amount=amount,request_key=str(uuid4()))).status_code == 400
    assert client.post('/api/mock-vaults/Safe/deposits',json=dict(amount='200')).status_code == 400


def test_approval_deducts_once_snapshots_invoice_and_prevents_edits(client):
    c=pending(client)
    before=balances(client)[c['pool']]['balance_cents']
    assert client.get(f"/api/mock-vaults/certificates/{c['id']}").status_code == 404
    a=client.post(f"/api/mock-vaults/approvals/{c['id']}",json={})
    assert a.status_code == 200
    b=client.post(f"/api/mock-vaults/approvals/{c['id']}",json={})
    assert a.json['transaction']['id'] == b.json['transaction']['id']
    tx=a.json['transaction']
    assert tx['certificate']['disbursed_cents'] == c['decided_disbursement_cents']
    assert tx['certificate']['repayment_cents'] == c['money_requested_cents']
    assert tx['certificate']['invoice_due'] == c['invoice_due']
    assert tx['certificate']['debtor'] == c['debtor']
    assert balances(client)[c['pool']]['balance_cents'] == before-c['decided_disbursement_cents']
    certificate=client.get(a.json['certificate_url'])
    assert certificate.status_code == 200
    assert b'Simulation only' in certificate.data
    assert c['company_name'].encode() in certificate.data
    assert tx['id'].encode() in certificate.data
    edit=client.patch(f"/api/mock-companies/{c['id']}",json=dict(company_name='Changed',money_requested='100',debtor='Other',invoice_due='2099-01-01'))
    assert edit.status_code == 409


def test_insufficient_funds_declined_and_expired_do_not_transfer(app,client):
    c=pending(client)
    with app.app_context():
        db=get_db()
        db.execute('UPDATE mock_vaults SET balance_cents=0 WHERE pool=?',(c['pool'],))
        db.commit()
    assert client.post(f"/api/mock-vaults/approvals/{c['id']}",json={}).status_code == 409
    assert client.get(f"/api/mock-vaults/certificates/{c['id']}").status_code == 404
    declined=next(c for c in client.get('/api/mock-companies').json['companies'] if c['pool']=='Decline')
    assert client.post(f"/api/mock-vaults/approvals/{declined['id']}",json={}).status_code == 409
    with app.app_context():
        db=get_db();db.execute("UPDATE mock_companies SET invoice_due='2000-01-01' WHERE id=?",(c['id'],));db.commit()
    assert client.post(f"/api/mock-vaults/approvals/{c['id']}",json={}).status_code == 409
    assert client.get('/api/mock-vaults').json['transactions'] == []


def test_concurrent_approvals_cannot_overdraw(app,client):
    a=pending(client);b=pending(client)
    with app.app_context():
        db=get_db()
        db.execute("UPDATE mock_companies SET risk_factor=80,pool='Safe',decided_disbursement_cents=75000 WHERE id IN (?,?)",(a['id'],b['id']))
        db.execute("UPDATE mock_vaults SET balance_cents=100000 WHERE pool='Safe'");db.commit()
    def approve(company_id):
        with app.test_client() as parallel_client:
            return parallel_client.post(f'/api/mock-vaults/approvals/{company_id}',json={}).status_code
    with ThreadPoolExecutor(max_workers=2) as executor:
        codes=list(executor.map(approve,[a['id'],b['id']]))
    assert sorted(codes) == [200,409]
    assert balances(client)['Safe']['balance_cents'] == 25000
    assert len(client.get('/api/mock-vaults').json['transactions']) == 1


def test_submission_automatically_funds_and_returns_certificate(client):
    before=balances(client)['Safe']['balance_cents']
    with patch('lending_pool.mock_companies.secrets.randbelow',return_value=45):
        response=client.post('/api/mock-companies',json=dict(company_name='Automatic Company',money_requested='1000',debtor='Invoice Debtor',invoice_due='2099-01-01'))
    assert response.status_code == 201
    c=response.json['company']
    assert c['status'] == 'approved'
    v=balances(client)['Safe']
    assert v['total_assets_cents'] == before-80000
    assert v['assets_on_loan_cents'] == 0
    assert v['available_withdrawal_cents'] == 0
    assert client.get(f"/api/mock-vaults/certificates/{c['id']}").status_code == 200


def test_deposits_are_invested_principal_and_earnings_follow_pool_rates(app,client):
    from datetime import datetime,timezone,timedelta
    from lending_pool.mock_vaults import investment_earnings
    now=datetime.now(timezone.utc)
    for pool,bps in [('Safe',500),('Medium',1000),('Risky',2000)]:
        tx=client.post(f'/api/mock-vaults/{pool}/deposits',json=dict(amount='200',request_key=str(uuid4()))).json['transaction']
        v=balances(client)[pool]
        assert v['assets_on_loan_cents']==20000
        assert v['annual_rate_bps']==bps
        assert v['available_withdrawal_cents']==0
        old={**tx,'created_at':(now-timedelta(days=365)).isoformat()}
        assert investment_earnings([old],bps,now)==20000*bps//10000
        assert investment_earnings([{**tx,'created_at':(now+timedelta(days=1)).isoformat()}],bps,now)==0
    with app.app_context():
        db=get_db()
        db.execute("UPDATE mock_vault_transactions SET created_at=? WHERE pool='Safe'",((now-timedelta(days=365)).isoformat(),))
        db.execute("UPDATE mock_vaults SET balance_cents=500 WHERE pool='Safe'");db.commit()
    v=balances(client)['Safe']
    assert v['earned_cents']>=1000
    assert v['available_withdrawal_cents']==500
