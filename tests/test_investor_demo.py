from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from uuid import uuid4
import json

from lending_pool.db import get_db
from lending_pool.investor_demo import rate, metrics


def vault(client,pool='Safe'):
    return next(v for v in client.get('/api/investor-demo/vaults').json['vaults'] if v['pool']==pool)


def invest(client,amount='1000',pool='Safe',**extra):
    return client.post(f'/api/investor-demo/{pool}/deposits',json={'amount':amount,'request_key':str(uuid4()),**extra})


def submit(client,amount='25000',score=82):
    return client.post('/api/investor-demo/companies',json=dict(company_name='New company',money_requested=amount,debtor='Retail buyer',risk_factor=score,invoice_due=(date.today()+timedelta(days=30)).isoformat()))


def assert_balanced(v):
    assert v['capital_cents']+v['interest_reserve_cents']==v['balance_cents']+v['assets_on_loan_cents']
    assert v['allocated_principal_cents']+v['idle_principal_cents']==v['invested_cents']


def test_deposit_allocates_queue_and_increases_projection(client):
    before=vault(client)
    assert before['expected_interest_cents']==0
    first=invest(client)
    assert first.status_code==200
    v=vault(client)
    assert first.json['funded_company_ids']
    assert v['expected_interest_cents']>0
    assert v['invested_cents']==100000
    assert_balanced(v)
    invest(client,'2000')
    after=vault(client)
    assert after['expected_interest_cents']>v['expected_interest_cents']
    assert after['investor_count']==v['investor_count']
    assert_balanced(after)


def test_preview_is_read_only_and_matches_deposit(client):
    before=vault(client)
    preview=client.post('/api/investor-demo/Safe/preview',json={'amount':'4400'})
    assert preview.status_code==200
    assert vault(client)['balance_cents']==before['balance_cents']
    assert invest(client,'4400').status_code==200
    after=vault(client)
    for field in ['rate_bps','expected_interest_cents','invested_cents','balance_cents','assets_on_loan_cents']:
        assert preview.json['after'][field]==after[field]


def test_join_changes_count_rate_and_eventually_blocks_at_floor(client):
    invest(client)
    before=vault(client)
    result=invest(client,'10000',investor_id='other',investor_name='Other investor')
    assert result.status_code==200
    v=vault(client)
    assert v['investor_count']==before['investor_count']+1
    assert v['rate_bps']<before['rate_bps']
    blocked=False
    for n in range(30):
        prior=vault(client)
        response=invest(client,investor_id=f'new-{n}')
        if response.status_code==409:
            assert 'below' in response.json['error']['message']
            assert vault(client)['balance_cents']==prior['balance_cents']
            blocked=True;break
    assert blocked


def test_new_company_funds_and_changes_projection_and_certificate(client):
    invest(client)
    before=vault(client)
    response=submit(client)
    assert response.status_code==201
    c=response.json['company'];terms=c['terms']
    assert c['status']=='approved'
    assert c['pool']=='Safe'
    assert terms['terms_version']==3
    assert terms['principal_cents']==2500000
    assert terms['disbursed_cents']==2375000
    assert terms['fee_cents']==125000
    assert terms['repayment_cents']==2500000+terms['interest_cents']
    after=vault(client)
    assert after['company_count']==before['company_count']+1
    assert after['rate_bps']>before['rate_bps']
    assert after['expected_interest_cents']>before['expected_interest_cents']
    assert_balanced(after)
    page=client.get(f"/api/investor-demo/certificates/{c['id']}").text
    assert 'actual/365' in page and 'APR' in page


def test_repayment_balances_interest_and_allows_exit(client):
    invest(client)
    c=submit(client).json['company']
    before=vault(client)
    endpoint=f"/api/investor-demo/companies/{c['id']}"
    assert client.post(endpoint+'/exit',json={}).status_code==409
    result=client.post(endpoint+'/repay',json={})
    assert result.status_code==200
    after=vault(client)
    assert after['received_interest_cents']>0
    assert after['interest_reserve_cents']==c['terms']['interest_cents']
    assert after['balance_cents']==before['balance_cents']+c['terms']['repayment_cents']
    assert_balanced(after)
    client.post(endpoint+'/repay',json={})
    assert vault(client)['balance_cents']==after['balance_cents']
    assert client.post(endpoint+'/exit',json={}).status_code==200
    assert vault(client)['company_count']==after['company_count']-1


def test_request_idempotency_and_parallel_deposits(app,client):
    vault(client)
    key=str(uuid4())
    def deposit(_):
        with app.test_client() as c:return c.post('/api/investor-demo/Safe/deposits',json={'amount':'1000','request_key':key}).status_code
    with ThreadPoolExecutor(max_workers=2) as executor:assert list(executor.map(deposit,[1,2]))==[200,200]
    assert vault(client)['invested_cents']==100000
    assert invest(client,'2000',request_key=key).status_code==409
    assert_balanced(vault(client))


def test_withdrawals_cannot_spend_loaned_or_other_investor_money(client):
    invest(client,'1000')
    assert client.post('/api/investor-demo/Safe/withdrawals',json={'amount':'1001','request_key':str(uuid4())}).status_code==409
    before=vault(client)
    key=str(uuid4())
    response=client.post('/api/investor-demo/Safe/withdrawals',json={'amount':'100','request_key':key})
    assert response.status_code==200
    client.post('/api/investor-demo/Safe/withdrawals',json={'amount':'100','request_key':key})
    after=vault(client)
    assert after['balance_cents']==before['balance_cents']-10000
    assert after['invested_cents']==90000
    assert_balanced(after)


def test_amy_walkthrough_replay_never_duplicates_and_legacy_api_follows(client):
    a=client.post('/api/investor-demo/walkthrough',json={}).json['company']
    b=client.post('/api/investor-demo/walkthrough',json={}).json['company']
    assert a['id']==b['id']
    first=client.post(f"/api/investor-demo/approvals/{a['id']}",json={})
    assert first.status_code==200
    terms=first.json['company']['terms']
    assert terms['repayment_cents']==7560000 and terms['terms_version']==2
    before=vault(client,'Medium')
    client.post(f"/api/mock-vaults/approvals/{a['id']}",json={})
    assert vault(client,'Medium')['balance_cents']==before['balance_cents']
    assert client.get(f"/api/mock-vaults/certificates/{a['id']}").status_code==200
    assert any(c['id']==a['id'] for c in client.get('/api/mock-companies').json['companies'])


def test_company_exit_floor_guard_and_entry_ceiling(client,app):
    vault(client)
    with app.app_context():
        db=get_db();row=db.execute("SELECT demo_state FROM mock_vaults WHERE pool='Safe'").fetchone()
        s=json.loads(row[0]);s['reference_companies']=0;s['reference_investors']=1
        for c in s['companies']:c['membership']=False
        c=next(c for c in s['companies'] if c['pool']=='Safe');c['membership']=True
        s['investors']=s['investors'][:3]
        # Formula at 4%; exiting this company would fall to 2%.
        db.execute("UPDATE mock_vaults SET demo_state=? WHERE pool='Safe'",(json.dumps(s),));db.commit()
    response=client.post(f"/api/investor-demo/companies/{c['id']}/exit",json={})
    assert response.status_code==409 and 'below 4%' in response.json['error']['message']
    for _ in range(4):assert submit(client,'100').status_code==201
    assert vault(client)['rate_bps']==800


def test_insufficient_cash_queues_and_later_deposit_funds_once(client):
    invest(client)
    before=vault(client)
    amount=(before['balance_cents']+200000)/100
    c=submit(client,str(amount)).json['company']
    assert c['status']=='pending' and c['terms'] is None
    assert vault(client)['balance_cents']==before['balance_cents']
    result=invest(client,'3000')
    assert result.status_code==200 and c['id'] in result.json['funded_company_ids']
    companies=client.get('/api/investor-demo/companies').json['companies']
    funded=next(x for x in companies if x['id']==c['id'])
    assert funded['status']=='approved'
    assert_balanced(vault(client))
    client.post(f"/api/investor-demo/approvals/{c['id']}",json={})
    txs=client.get('/api/investor-demo/vaults').json['transactions']
    assert len([t for t in txs if t.get('company_id')==c['id'] and t['kind']=='disbursement'])==1


def test_rate_and_interest_rounding_are_deterministic(client):
    invest(client,'4400')
    v=vault(client)
    assert v['expected_interest_cents']==v['invested_cents']*v['assets_on_loan_cents']*v['rate_bps']*30//(v['capital_cents']*10000*365)
    response=submit(client,'1000.10',score=50)
    c=response.json['company'];t=c['terms']
    assert t['fee_cents']==5001
    assert t['interest_cents']==(100010*t['interest_rate_bps']*t['term_days']+1825000)//3650000
    assert c['account_balance_cents']+t['fee_cents']==100010


def test_invalid_investments_and_rejected_company_do_not_change_cash(client):
    before=vault(client)
    for amount in ['0','NaN','1.001','-1']:
        assert invest(client,amount).status_code==400
    c=submit(client,score=19).json['company']
    assert c['status']=='declined' and not c['membership']
    assert c['account_balance_cents']==0 and c['terms'] is None
    assert vault(client)['balance_cents']==before['balance_cents']


def test_profile_views_and_withdrawals_use_selected_investor(client):
    invest(client,'1000')
    invest(client,'2000',investor_id='taylor',investor_name='Taylor')
    data=client.get('/api/investor-demo/vaults?investor_id=taylor').json
    v=next(v for v in data['vaults'] if v['pool']=='Safe')
    assert v['invested_cents']==200000 and v['expected_interest_cents']>0
    assert client.post('/api/investor-demo/Safe/withdrawals',json={'amount':'100','request_key':str(uuid4()),'investor_id':'taylor'}).status_code==200
    assert vault(client)['invested_cents']==100000
    data=client.get('/api/investor-demo/vaults?investor_id=taylor').json
    assert next(v for v in data['vaults'] if v['pool']=='Safe')['invested_cents']==190000


def test_replayed_company_submission_is_not_duplicated(client):
    payload=dict(company_name='Repeated request',money_requested='1000',debtor='Retail buyer',risk_factor=82,invoice_due=(date.today()+timedelta(days=30)).isoformat(),request_key=str(uuid4()))
    first=client.post('/api/investor-demo/companies',json=payload)
    second=client.post('/api/investor-demo/companies',json=payload)
    assert first.status_code==second.status_code==201
    assert first.json['company']['id']==second.json['company']['id']
    assert client.post('/api/investor-demo/companies',json={**payload,'money_requested':'2000'}).status_code==409
