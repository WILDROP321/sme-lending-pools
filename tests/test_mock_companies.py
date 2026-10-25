from unittest.mock import patch

import pytest

from lending_pool.db import get_db, init_db
from lending_pool.mock_companies import pool_for_score


@pytest.mark.parametrize('score,pool', [(0,'Decline'),(19,'Decline'),(20,'Risky'),(49,'Risky'),(50,'Medium'),(69,'Medium'),(70,'Safe'),(100,'Safe')])
def test_boundaries(score, pool):
    assert pool_for_score(score) == pool


def test_seed_is_persistent_and_not_duplicated(app, client):
    rows = client.get('/api/mock-companies').json['companies']
    assert len(rows) == 50
    assert len({r['company_name'] for r in rows}) == 50
    assert {r['pool'] for r in rows} == {'Decline','Risky','Medium','Safe'}
    assert all(r['pool'] == pool_for_score(r['risk_factor']) for r in rows)
    with app.app_context():
        init_db()
        assert get_db().execute('SELECT COUNT(*) FROM mock_companies').fetchone()[0] == 50


@pytest.mark.parametrize('random_value,score,pool', [(0,35,'Risky'),(55,90,'Safe')])
def test_submission_is_saved_without_wallet(app, client, random_value, score, pool):
    with patch('lending_pool.mock_companies.secrets.randbelow', return_value=random_value):
        response = client.post('/api/mock-companies', json=dict(company_name='New Company', money_requested='1000.01', debtor='Debtor Inc', invoice_due='2099-01-01'))
    assert response.status_code == 201
    row = response.json['company']
    assert row['risk_factor'] == score
    assert row['pool'] == pool
    assert row['money_requested_cents'] == 100001
    assert row['decided_disbursement_cents'] == (100001*score+50)//100
    assert row['source'] == 'application'
    assert client.get('/api/mock-companies').json['companies'][0] == row


@pytest.mark.parametrize('changes', [dict(money_requested='NaN'),dict(money_requested='Infinity'),dict(money_requested='0'),dict(money_requested='1.001'),dict(company_name=' '),dict(debtor=''),dict(invoice_due='yesterday'),dict(invoice_due='2000-01-01'),dict(risk_factor=99)])
def test_invalid_submission_does_not_insert(client, changes):
    payload=dict(company_name='New Company',money_requested='100',debtor='Debtor Inc',invoice_due='2099-01-01')
    payload.update(changes)
    assert client.post('/api/mock-companies', json=payload).status_code == 400
    assert len(client.get('/api/mock-companies').json['companies']) == 50


def test_update_reassesses_and_persists(client):
    existing = client.get('/api/mock-companies').json['companies'][0]
    with patch('lending_pool.mock_companies.secrets.randbelow', return_value=55):
        response = client.patch(f"/api/mock-companies/{existing['id']}", json=dict(
            company_name='Updated company', money_requested='20000', debtor='Updated debtor', invoice_due='2099-01-01'))
    assert response.status_code == 200
    row = response.json['company']
    assert row['id'] == existing['id']
    assert row['from_date'] == existing['from_date']
    assert row['pool'] == 'Safe'
    assert row['decided_disbursement_cents'] == 1800000
    assert len(client.get('/api/mock-companies').json['companies']) == 50


def test_hosted_store_is_used_and_outage_does_not_split_records(app, client):
    import httpx
    app.config.update(SUPABASE_URL='https://example.supabase.co', SUPABASE_PUBLISHABLE_KEY='public-test-key', FLOW_SUPABASE_API_KEY='backend-test-key')
    response = httpx.Response(200, json=[{'id': 123, 'company_name': 'Hosted company'}], request=httpx.Request('GET', 'https://example.supabase.co'))
    with patch('lending_pool.company_store.httpx.request', return_value=response) as call:
        result = client.get('/api/mock-companies')
        assert result.json['storage'] == 'supabase'
        assert result.json['companies'][0]['id'] == 123
        assert call.call_args.kwargs['headers']['X-Flow-Api-Key'] == 'backend-test-key'
    with patch('lending_pool.company_store.httpx.request', side_effect=httpx.ConnectError('offline')):
        assert client.get('/api/mock-companies').status_code == 503
    with app.app_context():
        assert get_db().execute('SELECT COUNT(*) FROM mock_companies').fetchone()[0] == 50


def test_hosted_insert_omits_generated_pool_and_updates_with_patch(app, client):
    import httpx
    app.config.update(SUPABASE_URL='https://example.supabase.co', SUPABASE_PUBLISHABLE_KEY='public-test-key', FLOW_SUPABASE_API_KEY='backend-test-key')
    response = httpx.Response(200, json=[{'id': 51}], request=httpx.Request('POST', 'https://example.supabase.co'))
    payload=dict(company_name='Hosted company',money_requested='100',debtor='Mock debtor',invoice_due='2099-01-01')
    with patch('lending_pool.company_store.httpx.request', return_value=response) as call:
        assert client.post('/api/mock-companies', json=payload).status_code == 201
        assert call.call_args_list[0].args[0] == 'POST'
        assert 'pool' not in call.call_args_list[0].kwargs['json']
        assert client.patch('/api/mock-companies/51', json=payload).status_code == 200
        assert call.call_args_list[2].args[0] == 'PATCH'
        assert call.call_args.kwargs['params']['id'] == 'eq.51'
