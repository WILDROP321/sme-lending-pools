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
