"""Persistent investor simulation. One compare-and-swap document per pool.

Opening balances and historical receipts are imported once. Thereafter each pool
mutation commits its accounts, queue, receipts and membership together.
"""
from copy import deepcopy
from datetime import date, datetime, timedelta, timezone
import json
from uuid import uuid4, UUID
from zoneinfo import ZoneInfo
import secrets

from flask import Blueprint, abort, jsonify, render_template, request
from . import company_store
from .db import get_db
from .mock_companies import amount_in_cents, pool_for_score
from .routes import json_body, text_field

investor_demo = Blueprint('investor_demo', __name__, url_prefix='/api/investor-demo')
BANDS = {'Safe': (400, 800), 'Medium': (800, 1200), 'Risky': (1200, 1800)}


def now():
    return datetime.now(timezone.utc).isoformat()


def initial_state(row):
    from .mock_vaults import transactions
    companies = [c for c in company_store.list_records() if c['pool']==row['pool'] or (row['pool']=='Risky' and c['pool']=='Decline')]
    txs = [t for t in transactions() if t['pool']==row['pool']]
    invested = sum(t['amount_cents'] for t in txs if t['kind']=='deposit')
    investors = [{'id': f'opening-{i}', 'name':f'Founding investor {i+1}', 'principal_cents':row['opening_balance_cents']//10 + (row['opening_balance_cents']%10 if i==0 else 0), 'received_cents':0} for i in range(10)]
    if invested:
        investors.append({'id':'you', 'name':'You', 'principal_cents':invested, 'received_cents':0})
    for c in companies:
        tx = next((t for t in txs if t.get('company_id')==c['id']), None)
        c['terms'] = tx['certificate'] if tx else None
        c['membership'] = c['pool']!='Decline'
        c['account_balance_cents'] = tx['certificate']['disbursed_cents'] if tx else 0
        c['funded_principal_cents'] = tx['amount_cents'] if tx else 0
        c['status'] = 'approved' if tx else 'declined' if c['pool']=='Decline' else 'pending'
        c['verified'] = bool(tx) or c.get('source')=='seed'
    return {'pool':row['pool'], 'opening_balance_cents':row['opening_balance_cents'], 'cash_cents':row['balance_cents'],
            'investors':investors, 'companies':companies, 'transactions':txs, 'requests':{},
            'reference_companies':sum(c['membership'] for c in companies), 'reference_investors':len(investors),
            'created_at':now(), 'version':1}


def rows():
    if company_store.hosted():
        return company_store.remote('GET', resource='mock_vaults')
    return [dict(r) for r in get_db().execute('SELECT * FROM mock_vaults')]


def state_from(row):
    state = row.get('demo_state')
    return json.loads(state) if isinstance(state,str) else state


def commit(row, state):
    revision = row.get('demo_revision',0)
    if company_store.hosted():
        changed = company_store.remote('PATCH',resource='mock_vaults',query={'pool':f"eq.{row['pool']}",'demo_revision':f'eq.{revision}'},
            payload={'demo_state':state,'demo_revision':revision+1})
        return bool(changed)
    db = get_db()
    with db:
        result = db.execute('UPDATE mock_vaults SET demo_state=?,demo_revision=demo_revision+1 WHERE pool=? AND demo_revision=?',
            (json.dumps(state),row['pool'],revision))
    return result.rowcount==1


def active():
    return any(state_from(row) is not None for row in rows())


def all_states():
    for attempt in range(12):
        found=rows()
        if all(state_from(r) is not None for r in found):
            return [state_from(r) for r in found]
        for row in found:
            if state_from(row) is None:
                commit(row,initial_state(row))
    abort(409,description='Pool changed during initialization. Please retry.')


def mutate(pool, action):
    if pool not in BANDS:
        abort(404,description='Pool not found.')
    all_states()
    for attempt in range(12):
        row=next(r for r in rows() if r['pool']==pool)
        state=deepcopy(state_from(row))
        result=action(state)
        if commit(row,state):
            return result
    abort(409,description='Pool is busy. Retry with the same request reference.')


def counts(s):
    return sum(c['membership'] for c in s['companies']),sum(i['principal_cents']>0 for i in s['investors'])


def rate(s, companies=None, investors=None):
    c,i=counts(s)
    c=c if companies is None else companies
    i=i if investors is None else investors
    low,high=BANDS[s['pool']]
    # Anchor each existing pool at the midpoint; preserve this baseline forever.
    raw=((low+high)//2)*(c+1)*s['reference_investors']//((s['reference_companies']+1)*max(i,1))
    return {'raw_bps':raw,'rate_bps':max(low,min(high,raw)),'min_bps':low,'max_bps':high,'company_count':c,'investor_count':i}


def metrics(s, investor_id='you'):
    r=rate(s)
    capital=sum(i['principal_cents'] for i in s['investors'])
    loans=sum(c['funded_principal_cents'] for c in s['companies'] if c['status']=='approved')
    you=next((i for i in s['investors'] if i['id']==investor_id),None)
    invested=you['principal_cents'] if you else 0
    allocated=invested*loans//capital if capital else 0
    # Project forward from today's shares and quote; never relabel it accrued cash.
    annual=invested*loans*r['rate_bps']//(capital*10000) if capital else 0
    monthly=invested*loans*r['rate_bps']*30//(capital*10000*365) if capital else 0
    interest_reserve=sum(i['received_cents'] for i in s['investors'])
    return {**r,'pool':s['pool'],'balance_cents':s['cash_cents'],'total_assets_cents':s['cash_cents']+loans,
        'opening_balance_cents':s['opening_balance_cents'],'capital_cents':capital,'invested_cents':invested,
        'assets_on_loan_cents':loans,'allocated_principal_cents':allocated,'idle_principal_cents':invested-allocated,
        'expected_interest_cents':monthly,'annual_interest_cents':annual,'received_interest_cents':you['received_cents'] if you else 0,
        'utilization_bps':loans*10000//capital if capital else 0,'effective_rate_bps':loans*r['rate_bps']//capital if capital else 0,
        'interest_reserve_cents':interest_reserve,'queued_count':sum(c['status']=='pending' and c['verified'] and c['membership'] for c in s['companies']),
        'investors':s['investors'],'earnings_as_of':now()}


def event(s,kind,amount,**fields):
    tx={'id':str(uuid4()),'pool':s['pool'],'kind':kind,'amount_cents':amount,'balance_after_cents':s['cash_cents'],'created_at':now(),**fields}
    s['transactions'].insert(0,tx)
    return tx


def fund(s,c):
    principal=c['money_requested_cents']
    if c['invoice_due']<=datetime.now(ZoneInfo('America/New_York')).date().isoformat() or c['pool']=='Decline':
        return None
    if s['cash_cents']-metrics(s)['interest_reserve_cents']<principal:
        return None
    fee=(principal*5+50)//100
    term_days=(date.fromisoformat(c['invoice_due'])+timedelta(days=1)-datetime.now(ZoneInfo('America/New_York')).date()).days
    bps=rate(s)['rate_bps']
    # Amy's original agreement remains 8% fixed; new loans use APR actual/365.
    interest=(principal*bps*term_days+1825000)//3650000
    amy_fixed=c.get('source')=='walkthrough'
    if amy_fixed:
        bps=800
        interest=(principal*8+50)//100
    s['cash_cents']-=principal
    terms={k:c[k] for k in ('company_name','debtor','from_date','invoice_due','risk_factor','pool')}
    terms.update(terms_version=2 if amy_fixed else 3,principal_cents=principal,requested_cents=principal,fee_cents=fee,fee_rate_bps=500,
        disbursed_cents=principal-fee,interest_cents=interest,interest_rate_bps=bps,interest_basis='fixed_term' if amy_fixed else 'annual_actual_365',term_days=term_days,
        repayment_cents=principal+interest,maturity_date=(date.fromisoformat(c['invoice_due'])+timedelta(days=1)).isoformat(),
        verification='Business and invoice verified in the demo',currency='MOCKRLUSD',mode='mock')
    c.update(status='approved',terms=terms,account_balance_cents=principal-fee,funded_principal_cents=principal,decided_disbursement_cents=principal-fee)
    return event(s,'disbursement',principal,company_id=c['id'],certificate=terms)


def allocate(s):
    funded=[]
    # Oldest eligible request first, skipping requests too large for available cash.
    for c in sorted(s['companies'],key=lambda c:(c['from_date'],c['id'])):
        if c['status']=='pending' and c['membership'] and c['verified']:
            tx=fund(s,c)
            if tx:funded.append(c['id'])
    return funded


def deposit_action(s,amount,investor_id,key,name='Guest investor'):
    signature=[amount,investor_id,name]
    if key in s['requests']:
        saved=s['requests'][key]
        if saved['signature']!=signature:
            abort(409,description='Request reference already used with different details.')
        return saved['result']
    i=next((i for i in s['investors'] if i['id']==investor_id),None)
    new=not i or i['principal_cents']==0
    c,n=counts(s)
    proposed=rate(s,investors=n+int(new))
    if new and proposed['raw_bps']<proposed['min_bps']:
        abort(409,description=f"Investor join blocked: the rate would fall below {proposed['min_bps']/100:g}%. More companies must join first.")
    if not i:
        i={'id':investor_id,'name':'You' if investor_id=='you' else name,'principal_cents':0,'received_cents':0}
        s['investors'].append(i)
    i['principal_cents']+=amount
    s['cash_cents']+=amount
    tx=event(s,'deposit',amount,investor_id=investor_id,request_key=key)
    funded=allocate(s)
    result={'transaction':tx,'funded_company_ids':funded,'metrics':metrics(s,investor_id)}
    s['requests'][key]={'signature':signature,'result':result}
    return result


@investor_demo.get('/vaults')
def vaults():
    states=all_states()
    return jsonify(vaults=[metrics(s,request.args.get('investor_id','you')) for s in states],transactions=sorted([t for s in states for t in s['transactions']],key=lambda t:t['created_at'],reverse=True),mode='mock',investment_scope='demo_pool_shares')


@investor_demo.post('/<pool>/preview')
@investor_demo.post('/<pool>/deposits')
def deposit(pool):
    if pool not in BANDS:abort(404)
    body=json_body({'amount','request_key','investor_id','investor_name'})
    amount=amount_in_cents(body.get('amount'),'amount')
    investor_id=body.get('investor_id','you')
    if not isinstance(investor_id,str) or not 1<=len(investor_id)<=80:abort(400,description='Invalid demo investor.')
    name=body.get('investor_name','Guest investor')
    if not isinstance(name,str) or not 1<=len(name)<=80:abort(400,description='Invalid investor name.')
    if request.path.endswith('/preview'):
        s=deepcopy(next(s for s in all_states() if s['pool']==pool))
        before=metrics(s,investor_id)
        result=deposit_action(s,amount,investor_id,str(uuid4()),name)
        return jsonify(before=before,after=metrics(s,investor_id),funded_company_ids=result['funded_company_ids'])
    try:key=str(UUID(body.get('request_key','')))
    except (ValueError,AttributeError,TypeError):abort(400,description='A valid UUID request_key is required.')
    return jsonify(mutate(pool,lambda s:deposit_action(s,amount,investor_id,key,name)))


@investor_demo.post('/<pool>/withdrawals')
def withdraw(pool):
    body=json_body({'amount','request_key','investor_id'})
    investor_id=body.get('investor_id','you')
    if not isinstance(investor_id,str) or not 1<=len(investor_id)<=80:abort(400,description='Invalid demo investor.')
    amount=amount_in_cents(body.get('amount'),'amount')
    try:key=str(UUID(body.get('request_key','')))
    except (ValueError,AttributeError,TypeError):abort(400,description='A valid UUID request_key is required.')
    def action(s):
        if key in s['requests']:
            saved=s['requests'][key]
            if saved['signature']!=['withdraw',amount,investor_id]:abort(409,description='Request reference already used with different details.')
            return saved['result']
        i=next((i for i in s['investors'] if i['id']==investor_id),None)
        if not i or amount>i['principal_cents']:abort(409,description='Withdrawal exceeds your invested principal.')
        if amount>s['cash_cents']-metrics(s)['interest_reserve_cents']:abort(409,description='Capital is on loan. Wait for repayment before withdrawing this amount.')
        c,n=counts(s)
        proposed=rate(s,investors=n-int(amount==i['principal_cents']))
        if proposed['raw_bps']>proposed['max_bps']:abort(409,description='Investor exit would exceed the pool rate ceiling. Try a partial withdrawal.')
        i['principal_cents']-=amount;s['cash_cents']-=amount
        result={'transaction':event(s,'withdrawal',amount,investor_id=investor_id,request_key=key)}
        s['requests'][key]={'signature':['withdraw',amount,investor_id],'result':result}
        return result
    return jsonify(mutate(pool,action))


@investor_demo.get('/companies')
def companies():
    return jsonify(companies=[c for s in all_states() for c in s['companies']],storage='supabase' if company_store.hosted() else 'sqlite',mode='mock')


@investor_demo.post('/companies')
@investor_demo.patch('/companies/<int:company_id>')
def create_company(company_id=None):
    body=json_body({'company_name','money_requested','debtor','invoice_due','risk_factor','request_key'})
    name=text_field(body,'company_name',160);debtor=text_field(body,'debtor',160)
    principal=amount_in_cents(body.get('money_requested'))
    score=body.get('risk_factor',62)
    if type(score)!=int or not 0<=score<=100:abort(400,description='Risk score must be an integer from 0 to 100.')
    try:
        due=date.fromisoformat(body.get('invoice_due',''))
        if due<=datetime.now(ZoneInfo('America/New_York')).date() or due==date.max:raise ValueError
    except (TypeError,ValueError):abort(400,description='Invoice payment date must be in the future.')
    key=body.get('request_key')
    if key is not None:
        try:key=str(UUID(key))
        except (ValueError,TypeError,AttributeError):abort(400,description='A valid UUID request_key is required.')
    signature=['company',company_id,name,debtor,principal,score,due.isoformat()]
    pool=pool_for_score(score);storage_pool='Risky' if pool=='Decline' else pool
    if company_id:
        old_s,old=find_company(company_id)
        if old_s['pool']!=storage_pool:abort(409,description='Submit a new request to change risk pools; existing memberships cannot move.')
    def action(s):
        if key and key in s['requests']:
            saved=s['requests'][key]
            if saved['signature']!=signature:abort(409,description='Request reference already used with different details.')
            return saved['result']
        if company_id:
            c=next(c for c in s['companies'] if c['id']==company_id)
            if c['status']!='pending':abort(409,description='Funded or closed applications cannot be edited.')
        else:
            c={'id':secrets.randbelow(10**12)+10**12,'from_date':datetime.now(ZoneInfo('America/New_York')).date().isoformat(),'source':'application','account_balance_cents':0,'funded_principal_cents':0,'terms':None}
            s['companies'].append(c)
        c.update(company_name=name,debtor=debtor,money_requested_cents=principal,invoice_due=due.isoformat(),risk_factor=score,pool=pool,
            membership=pool!='Decline',verified=True,status='declined' if pool=='Decline' else 'pending',decided_disbursement_cents=principal-(principal*5+50)//100 if pool!='Decline' else 0)
        allocate(s)
        result={'company':c,'metrics':metrics(s)}
        if key:s['requests'][key]={'signature':signature,'result':result}
        return result
    return jsonify(mutate(storage_pool,action)),200 if company_id else 201


def find_company(company_id):
    for s in all_states():
        c=next((c for c in s['companies'] if c['id']==company_id),None)
        if c:return s,c
    abort(404,description='Company not found.')


@investor_demo.post('/approvals/<int:company_id>')
def approve(company_id):
    json_body(set());state,_=find_company(company_id)
    def action(s):
        c=next(c for c in s['companies'] if c['id']==company_id)
        if c['status']=='approved':return {'company':c}
        if c['status']!='pending' or not c['membership']:abort(409,description='Company is not eligible for approval.')
        c['verified']=True
        if not fund(s,c):abort(409,description='Not enough available pool cash, or the invoice is past due.')
        return {'company':c}
    return jsonify(mutate(state['pool'],action))


@investor_demo.post('/companies/<int:company_id>/repay')
def repay(company_id):
    json_body(set());state,_=find_company(company_id)
    def action(s):
        c=next(c for c in s['companies'] if c['id']==company_id)
        if c['status']=='repaid':return {'company':c}
        if c['status']!='approved':abort(409,description='There is no outstanding loan to repay.')
        principal=c['funded_principal_cents'];total=c['terms']['repayment_cents'];interest=total-principal
        capital=sum(i['principal_cents'] for i in s['investors'])
        shares=[(i,interest*i['principal_cents']//capital) for i in s['investors'] if i['principal_cents']]
        # Retain every cent: distribute the rounding remainder deterministically.
        remainder=interest-sum(value for _,value in shares)
        for n,(i,value) in enumerate(shares):i['received_cents']+=value+(1 if n<remainder else 0)
        s['cash_cents']+=total;c['status']='repaid'
        event(s,'repayment',total,company_id=c['id'],principal_cents=principal,interest_cents=interest,source='External borrower payment (simulated)')
        allocate(s)
        return {'company':c,'metrics':metrics(s)}
    return jsonify(mutate(state['pool'],action))


@investor_demo.post('/companies/<int:company_id>/exit')
def company_exit(company_id):
    json_body(set());state,_=find_company(company_id)
    def action(s):
        c=next(c for c in s['companies'] if c['id']==company_id)
        if not c['membership']:return {'company':c}
        n,i=counts(s);proposed=rate(s,companies=n-1)
        if proposed['raw_bps']<proposed['min_bps']:abort(409,description=f"Company exit blocked: rate would fall below {proposed['min_bps']/100:g}%. Add a company or reduce investor membership first.")
        if c['status']=='approved':abort(409,description='Repay the outstanding loan before leaving the pool. Repayment is always allowed.')
        c['membership']=False
        event(s,'company_exit',0,company_id=c['id'])
        return {'company':c,'metrics':metrics(s)}
    return jsonify(mutate(state['pool'],action))


@investor_demo.get('/certificates/<int:company_id>')
def certificate(company_id):
    s,c=find_company(company_id)
    tx=next((t for t in s['transactions'] if t.get('company_id')==company_id and t['kind']=='disbursement'),None)
    if not tx:abort(404,description='Certificate is available after funding.')
    return render_template('certificate.html',tx=tx,c=tx['certificate'])


@investor_demo.post('/walkthrough')
def walkthrough():
    """Create the fictional walkthrough request once, without issuing funds twice."""
    json_body(set())
    def action(s):
        c=next((c for c in s['companies'] if c['company_name']=="Amy's Cookies"),None)
        if not c:
            c={'id':900000000001,'company_name':"Amy's Cookies",'debtor':'Walmart','money_requested_cents':7000000,
                'from_date':'2026-10-25','invoice_due':'2026-11-19','risk_factor':62,'pool':'Medium',
                'membership':True,'verified':False,'status':'pending','source':'walkthrough','terms':None,
                'account_balance_cents':0,'funded_principal_cents':0,'decided_disbursement_cents':6650000}
            s['companies'].append(c)
        return {'company':c}
    return jsonify(mutate('Medium',action))
