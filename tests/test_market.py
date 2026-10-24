import io
import json
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from uuid import uuid4

import pytest

from lending_pool.db import get_db
from lending_pool.risk import assess, classify

PDF = b'%PDF-1.4\n% Synthetic invoice for local workflow testing\n%%EOF'
CHECKS = dict(invoice_authentic=True, debtor_confirmed=True, not_financed=True)


def register(client, email='alex@example.com', **override):
    return client.post('/api/market/investors', json=dict(name='Alex', email=email,
        password='test-password-123', preference='core', risk_acknowledged=True, **override))


def borrow(client, **override):
    fields = dict(company='Test Co', sector='Logistics', purpose='Payroll bridge',
        invoice_ref='INV-1', debtor='Buyer', due_date=(date.today()+timedelta(days=60)).isoformat(),
        invoice='100000', amount='70000', years_trading='6', late_payment_pct='5')
    fields.update(override)
    fields.setdefault('document', (io.BytesIO(PDF), 'invoice.pdf'))
    return client.post('/api/market/requests', data=fields, content_type='multipart/form-data')


def review(client, request_id, **override):
    data = dict(decision='approved', reviewer='Reviewer', note='Invoice and debtor evidence checked.', checks=CHECKS)
    data.update(override)
    return client.post(f'/api/market/requests/{request_id}/review', json=data)


def pool(client, key='core'):
    return next(p for p in client.get('/api/market').json['pools'] if p['id'] == key)


def deposit(client, amount='10000.25', key=None, **override):
    return client.post('/api/market/deposits', json=dict(pool='core', amount=amount,
        operation_key=key or str(uuid4()), **override))


def test_fixtures_use_same_model_and_balance(client):
    pools = client.get('/api/market').json['pools']
    assert len(pools) == 3
    assert [len(p['companies']) for p in pools] == [3, 3, 3]
    for p in pools:
        assert p['capital_cents'] == p['allocated_cents'] + p['reserve_cents']
        assert p['reserve_cents'] >= 0
        for company in p['companies']:
            assert company['assessment']['pool'] == p['id']
            assert company['assessment']['score'] == company['risk']
        interest = sum(c['amount_cents'] * c['assessment']['apr'] / 100 for c in p['companies'])
        assert p['apr'] == pytest.approx(interest/p['capital_cents']*100, abs=1e-6)
        assert p['stress_apr'] < p['apr']


def test_risk_is_monotonic_and_reaches_all_tiers():
    base = assess(50000, 100000, 30, 10, 0)
    assert base['pool'] == 'core'
    assert assess(70000, 100000, 60, 6, 5)['pool'] == 'balanced'
    assert assess(80000, 100000, 160, 1, 50)['pool'] == 'opportunity'
    for args in [(60000,100000,30,10,0), (50000,100000,90,10,0),
                 (50000,100000,30,2,0), (50000,100000,30,10,40)]:
        assert assess(*args)['score'] > base['score']
    assert classify(3) == 'core'
    assert classify(3.01) == 'balanced'
    assert classify(7) == 'balanced'
    assert classify(7.01) == 'opportunity'
    assert classify(16) is None
    assert base['interest_cents'] == round(50000 * base['apr']/100*30/365)
    assert base['repayment_cents'] == 50000 + base['interest_cents']


def test_account_auth_and_holdings_isolation(app, client):
    assert deposit(client).status_code == 401
    assert register(client).status_code == 201
    assert 'password' not in json.dumps(client.get('/api/market').json)
    assert deposit(client).status_code == 201
    first = pool(client)
    assert first['capital_cents'] == 121000025
    assert first['invested_cents'] == 1000025
    assert first['ownership_pct'] == pytest.approx(1000025/121000025*100)
    second = app.test_client()
    assert register(second, 'other@example.com').status_code == 201
    assert pool(second)['invested_cents'] == 0
    deposit(second, '20000')
    assert pool(second)['invested_cents'] == 2000000
    assert pool(client)['invested_cents'] == 1000025
    assert pool(client)['ownership_pct'] < first['ownership_pct']
    client.post('/api/market/logout', json={})
    assert pool(client)['invested_cents'] == 0
    assert client.post('/api/market/login', json={'email':'alex@example.com','password':'wrong'}).status_code == 401
    assert client.post('/api/market/login', json={'email':'alex@example.com','password':'test-password-123'}).status_code == 200
    assert pool(client)['invested_cents'] == 1000025
    assert register(second).status_code == 409


def test_deposit_idempotency(client):
    register(client)
    key = str(uuid4())
    assert deposit(client, key=key).status_code == 201
    assert deposit(client, key=key).status_code == 200
    assert pool(client)['invested_cents'] == 1000025
    assert deposit(client, amount='999', key=key).status_code == 409
    assert pool(client)['invested_cents'] == 1000025


@pytest.mark.parametrize('amount', ['NaN','-1','0','0.001','Infinity',True,{},'100000001'])
def test_invalid_deposits(client, amount):
    register(client)
    assert deposit(client,amount=amount).status_code == 400
    assert pool(client)['invested_cents'] == 0


def test_quote_uses_diluted_rate_and_personal_equity(client):
    register(client)
    deposit(client, '1000')
    p = pool(client)
    response = client.post('/api/market/quote',json=dict(pool='core',amount='10000',months=12))
    quote = response.json['quote']
    assert quote['ownership_pct'] == pytest.approx(1100000/(p['capital_cents']+1000000)*100)
    assert quote['apr'] < p['apr']
    assert quote['earnings_cents'] == round(1000000*quote['apr']/100)
    assert quote['stress_earnings_cents'] < quote['earnings_cents']
    assert client.post('/api/market/quote',json=dict(pool='core',amount='1',months=1.5)).status_code == 400


def test_borrow_verify_allocate_audit(client):
    before = pool(client,'balanced')
    response = borrow(client)
    assert response.status_code == 201
    record = response.json['requests'][0]
    request_id = record['id']
    assert record['status'] == 'pending_verification'
    assert record['pool'] == 'balanced'
    assert pool(client,'balanced')['allocated_cents'] == before['allocated_cents']
    document = client.get(f'/api/market/requests/{request_id}/document')
    assert document.data == PDF
    assert document.headers['Content-Disposition'].startswith('attachment;')
    assert 'document_data' not in record
    assert review(client,request_id,checks={}).status_code == 400
    result = review(client,request_id)
    assert result.status_code == 200
    approved = result.json['requests'][0]
    assert approved['status'] == 'approved'
    assert approved['reviews'][0]['checks'] == CHECKS
    assert approved['reviews'][0]['reviewer'] == 'Reviewer'
    after = pool(client,'balanced')
    assert after['allocated_cents'] == before['allocated_cents'] + 7000000
    assert after['reserve_cents'] == before['reserve_cents'] - 7000000
    assert after['capital_cents'] == before['capital_cents']
    assert any(c['company'] == 'Test Co' for c in after['companies'])
    assert after['apr'] > before['apr']
    assert review(client,request_id).status_code == 409
    assert pool(client,'balanced')['allocated_cents'] == after['allocated_cents']


@pytest.mark.parametrize('override', [
    dict(due_date=date.today().isoformat()),dict(due_date=(date.today()+timedelta(days=181)).isoformat()),
    dict(amount='85000.01'),dict(invoice_ref=''),dict(debtor=''),dict(late_payment_pct='NaN'),
    dict(late_payment_pct='101'),dict(years_trading='-1'),dict(document=None),
])
def test_borrow_eligibility(client, override):
    assert borrow(client,**override).status_code == 400
    assert client.get('/api/market').json['requests'] == []


def test_document_validation(client):
    assert borrow(client,document=(io.BytesIO(b'<html>not an invoice</html>'),'invoice.pdf')).status_code == 400
    oversized = io.BytesIO(b'%PDF-' + b'x'*(5*1024*1024))
    assert borrow(client,document=(oversized,'large.pdf')).status_code == 413


def test_duplicate_normalization_and_rejection(client):
    result = borrow(client)
    assert borrow(client,debtor=' BUYER ',invoice_ref=' inv-1 ').status_code == 409
    request_id = result.json['requests'][0]['id']
    before = pool(client,'balanced')['allocated_cents']
    response = review(client,request_id,decision='rejected',checks={},note='Could not corroborate debtor.')
    assert response.status_code == 200
    assert response.json['requests'][0]['status'] == 'rejected'
    assert pool(client,'balanced')['allocated_cents'] == before
    assert review(client,request_id).status_code == 409


def test_expired_invoice_cannot_be_approved(app, client):
    request_id = borrow(client).json['requests'][0]['id']
    with app.app_context():
        db = get_db()
        db.execute('UPDATE market_requests SET due_date=? WHERE id=?',(date.today().isoformat(),request_id))
        db.commit()
    assert review(client,request_id).status_code == 400
    assert client.get('/api/market').json['requests'][0]['status'] == 'pending_verification'


def test_concurrent_approvals_cannot_overdraw(app, client):
    request_ids = [borrow(client,invoice_ref=f'INV-{i}',amount='400000',invoice='800000',
                  years_trading='10',late_payment_pct='0',due_date=(date.today()+timedelta(days=30)).isoformat()).json['requests'][0]['id'] for i in range(2)]
    def approve(request_id):
        with app.test_client() as worker:
            return review(worker,request_id).status_code
    with ThreadPoolExecutor(max_workers=2) as executor:
        statuses = list(executor.map(approve, request_ids))
    assert sorted(statuses) == [200,409]
    assert pool(client)['reserve_cents'] == 27000000
    assert sum(r['status']=='approved' for r in client.get('/api/market').json['requests']) == 1


def test_legacy_deposits_are_not_claimed_by_new_investors(app, client):
    with app.app_context():
        db = get_db()
        db.execute("INSERT INTO market_deposits(pool,amount_cents) VALUES ('core',10000)")
        db.commit()
    register(client)
    assert pool(client)['capital_cents'] == 120010000
    assert pool(client)['invested_cents'] == 0


def test_cross_origin_mutation_rejected(client):
    assert client.post('/api/market/logout', json={},headers={'Origin':'https://unrelated.example'}).status_code == 403
