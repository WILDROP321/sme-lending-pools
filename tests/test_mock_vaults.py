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
    assert tx['certificate']['repayment_cents'] == c['money_requested_cents'] * 108 // 100
    assert tx['certificate']['invoice_due'] == c['invoice_due']
    assert tx['certificate']['debtor'] == c['debtor']
    assert balances(client)[c['pool']]['balance_cents'] == before-c['money_requested_cents']
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
    assert balances(client)['Safe']['balance_cents'] == 0
    assert len(client.get('/api/mock-vaults').json['transactions']) == 1


def test_submission_waits_for_approval(client):
    before=balances(client)['Safe']['balance_cents']
    response=client.post('/api/mock-companies',json=dict(company_name='Reviewed Company',money_requested='1000',debtor='Invoice Debtor',invoice_due='2099-01-01',risk_factor=80))
    assert response.status_code == 201
    c=response.json['company']
    assert c['status'] == 'pending'
    assert balances(client)['Safe']['balance_cents'] == before
    assert client.get(f"/api/mock-vaults/certificates/{c['id']}").status_code == 404
    assert client.post(f"/api/mock-vaults/approvals/{c['id']}",json={}).status_code == 200
    v=balances(client)['Safe']
    assert v['balance_cents'] == before-100000
    assert v['assets_on_loan_cents'] == 100000
    assert v['invested_cents'] == 0
    assert v['available_withdrawal_cents'] == 0


def test_deposits_do_not_earn_interest_until_capital_is_allocated(client):
    client.post('/api/mock-vaults/Safe/deposits',json=dict(amount='100000',request_key=str(uuid4())))
    before=balances(client)['Safe']
    assert before['invested_cents'] == 10000000
    assert before['assets_on_loan_cents'] == 0
    assert before['expected_interest_cents'] == before['earned_cents'] == 0
    c=pending(client, '70000')
    tx=client.post(f"/api/mock-vaults/approvals/{c['id']}",json={}).json['transaction']
    v=balances(client)['Safe']
    assert v['invested_cents'] == 10000000
    assert v['allocated_principal_cents'] == 7000000*10000000//110000000
    assert v['expected_interest_cents'] == 560000*10000000//110000000
    assert v['earned_cents'] == v['available_withdrawal_cents'] == 0
    client.post('/api/mock-vaults/Safe/deposits',json=dict(amount='50000',request_key=str(uuid4())))
    assert balances(client)['Safe']['expected_interest_cents'] == v['expected_interest_cents']
    assert tx['certificate']['investor_interest_cents'] == v['expected_interest_cents']


def test_existing_company_reconciliation_preserves_deposits_and_cannot_double_charge(app, client):
    from lending_pool.mock_vaults import local_approve
    client.post('/api/mock-vaults/Medium/deposits', json=dict(amount='4000', request_key=str(uuid4())))
    with app.app_context():
        db = get_db()
        companies = [dict(r) for r in db.execute("SELECT * FROM mock_companies WHERE pool != 'Decline' ORDER BY id")]
        with db:
            for company in companies:
                local_approve(company['id'], db)
        first = balances(client)
        for pool, vault in first.items():
            disbursed = sum(c['money_requested_cents'] for c in companies if c['pool'] == pool)
            deposited = 400000 if pool == 'Medium' else 0
            assert vault['total_assets_cents'] == 100000000 + deposited - disbursed
            assert vault['disbursed_cents'] == disbursed
            assert vault['invested_cents'] == deposited
            assert vault['assets_on_loan_cents'] == disbursed
            assert vault['available_withdrawal_cents'] == 0
        with db:
            for company in companies:
                local_approve(company['id'], db)
        assert {p:v['balance_cents'] for p,v in balances(client).items()} == {p:v['balance_cents'] for p,v in first.items()}
        assert all(client.get(f"/api/mock-vaults/certificates/{c['id']}").status_code == 200 for c in companies)


def test_amy_demo_is_idempotent_and_propagates_exact_terms(client):
    before=balances(client)['Medium']['balance_cents']
    first=client.post('/api/mock-vaults/demo',json={}).json['company']
    second=client.post('/api/mock-vaults/demo',json={}).json['company']
    assert first['id']==second['id']
    assert first['risk_factor']==62 and first['pool']=='Medium'
    assert balances(client)['Medium']['balance_cents']==before+10000000
    approved=client.post(f"/api/mock-vaults/approvals/{first['id']}",json={})
    assert approved.status_code==200
    c=approved.json['transaction']['certificate']
    assert (c['principal_cents'],c['fee_cents'],c['disbursed_cents'],c['interest_cents'],c['repayment_cents'])==(7000000,350000,6650000,560000,7560000)
    assert c['invoice_due']=='2026-11-19' and c['maturity_date']=='2026-11-20'
    assert balances(client)['Medium']['balance_cents']==before+10000000-7000000
    company=next(c for c in client.get('/api/mock-companies').json['companies'] if c['id']==first['id'])
    assert company['account_balance_cents']==6650000
    assert company['terms']==c
    page=client.get(approved.json['certificate_url']).text
    assert all(value in page for value in ['75,600.00','66,500.00','3,500.00','5,600.00','2026-11-20'])
    assert client.post('/api/mock-vaults/demo',json={}).json['company']['status']=='approved'
    assert balances(client)['Medium']['balance_cents']==before+3000000


def test_full_principal_required_and_rejection_moves_nothing(app,client):
    c=pending(client,'100000')
    with app.app_context():
        db=get_db();db.execute('UPDATE mock_vaults SET balance_cents=9500000 WHERE pool=?',(c['pool'],));db.commit()
    assert client.post(f"/api/mock-vaults/approvals/{c['id']}",json={}).status_code==409
    rejected=client.post('/api/mock-companies',json=dict(company_name='Too risky',money_requested='70000',debtor='Buyer',invoice_due='2099-01-01',risk_factor=19)).json['company']
    assert rejected['status']=='declined' and rejected['decided_disbursement_cents']==0
    assert client.post(f"/api/mock-vaults/approvals/{rejected['id']}",json={}).status_code==409
    assert client.get('/api/mock-vaults').json['transactions']==[]


def test_maturity_crosses_year_and_money_rounds_in_cents(client):
    c=client.post('/api/mock-companies',json=dict(company_name='Rounding',money_requested='1000.10',debtor='Buyer',invoice_due='2099-12-31',risk_factor=50)).json['company']
    tx=client.post(f"/api/mock-vaults/approvals/{c['id']}",json={}).json['transaction']
    terms=tx['certificate']
    assert terms['maturity_date']=='2100-01-01'
    assert terms['fee_cents']==5001 and terms['interest_cents']==8001
    assert terms['disbursed_cents']+terms['fee_cents']==tx['amount_cents']==100010
    assert terms['repayment_cents']==108011
