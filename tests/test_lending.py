"""Offline integration tests: RPC and wallet UI are mocked; signatures are real.

These tests are NOT evidence that Lending Devnet accepted a transaction.
"""
import hashlib
import io
import json
import time
from datetime import date, timedelta

import pytest
from xrpl.core import binarycodec, keypairs
from xrpl.models.transactions import Transaction
from xrpl.transaction import sign
from xrpl.wallet import Wallet

from lending_pool import create_app
from lending_pool import lending as chain
from lending_pool.db import get_db, init_db

VAULT = 'A' * 64
LOAN = 'B' * 64
BROKER = 'C' * 64


@pytest.fixture
def live_app(tmp_path):
    app = create_app(dict(TESTING=True, DATABASE=str(tmp_path/'live.sqlite'), ENABLE_SIMULATION=False,
                          LENDING_NETWORK='testnet', LENDING_VAULTS={'core': VAULT}))
    with app.app_context():
        init_db()
    return app


@pytest.fixture
def live_client(live_app):
    return live_app.test_client()


def login(client, signer=None):
    signer = signer or Wallet.create()
    response = client.post('/api/lending/auth/challenge', json={'address': signer.classic_address})
    assert response.status_code == 200
    signature = keypairs.sign(response.json['message'].encode(), signer.private_key)
    verified = client.post('/api/lending/auth/verify', json={'signature': signature, 'public_key': signer.public_key})
    assert verified.status_code == 200
    return signer


@pytest.fixture
def ledger(monkeypatch):
    state = dict(validated=False, code='tesSUCCESS', submitted=[], wrong_tx=False, network_id=1,
                 amendments=True, wrong_asset=False)
    issuer = chain.PROFILES['testnet']['issuer']
    def rpc(method, **params):
        if method == 'server_info':
            return {'info': {'network_id': state['network_id'], 'server_state': 'full', 'validated_ledger': {'seq':100, 'age':1}}}
        if method == 'ledger_entry':
            index = params['index']
            if index == chain.AMENDMENTS:
                node = {'Amendments':[hashlib.sha512(name.encode()).hexdigest()[:64].upper() for name in ('SingleAssetVault','LendingProtocol')] if state['amendments'] else []}
            elif index == VAULT:
                node = {'LedgerEntryType':'Vault','Asset':{'currency':chain.CURRENCY,'issuer': issuer if not state['wrong_asset'] else Wallet.create().classic_address},
                        'AssetsTotal':'1000.00','AssetsAvailable':'750.00','ShareMPTID':'D'*48}
            elif index == LOAN:
                node = {'LedgerEntryType':'Loan','LoanBrokerID':BROKER,'Borrower':state.get('borrower')}
            elif index == BROKER:
                node = {'LedgerEntryType':'LoanBroker','VaultID':VAULT}
            else:
                raise chain.LedgerError('No object','entryNotFound')
            return {'node':node,'validated':True,'ledger_index':100}
        if method == 'account_info':
            return {'account_data':{'Balance':'100000000','Sequence':1},'validated':True,'ledger_index':100}
        if method == 'account_lines':
            return {'lines':[{'currency':chain.CURRENCY,'account':issuer,'balance':'123.456789'}], 'validated':True,'ledger_index':100}
        if method == 'account_objects':
            return {'account_objects':[], 'validated':True,'ledger_index':100}
        if method == 'fee':
            return {'drops':{'open_ledger_fee':'12'}}
        if method == 'submit':
            state['submitted'].append(params['tx_blob'])
            return {'engine_result':'tesSUCCESS'}
        if method == 'tx':
            blob = state['submitted'][-1]
            tx = binarycodec.decode(blob)
            if state['wrong_tx']:
                tx['Amount']['value']='999'
            return {'validated':state['validated'],'hash':params['transaction'],'tx_json':tx,
                    'meta':{'TransactionResult':state['code']},'ledger_index':101}
        raise AssertionError(method)
    monkeypatch.setattr(chain,'rpc',rpc)
    return state


def prepared(client, action='deposit', **fields):
    return client.post('/api/lending/intents',json=dict(action=action,pool='core',amount='25.000001',**fields))


def signed_blob(preparation, signer):
    tx = Transaction.from_xrpl(preparation.json['transaction'])
    return binarycodec.encode(sign(tx, signer).to_xrpl())


def test_simulation_and_legacy_xrp_disabled(live_client):
    for endpoint in ('/api/pools','/api/contribution-intents','/api/market/deposits','/api/market/requests/1/review'):
        assert live_client.post(endpoint,json={}).status_code == 410
    assert live_client.get('/api/market').status_code == 410


def test_default_is_requested_network_without_fake_rlusd(live_app, live_client, monkeypatch):
    live_app.config['LENDING_NETWORK']='lending-devnet'
    def unavailable(*args, **kwargs):
        raise chain.LedgerError('DNS unavailable')
    monkeypatch.setattr(chain,'rpc',unavailable)
    result=live_client.get('/api/lending/status').json
    assert result['network']['rpc']=='https://lend.devnet.rippletest.net:51234/'
    assert result['asset'] is None and not result['ready']
    assert not result['connected'] and 'DNS unavailable' in result['blockers']
    assert result['network']['explorer'] is None


def test_signature_replay_and_wrong_key(live_client):
    signer=Wallet.create();other=Wallet.create()
    challenge=live_client.post('/api/lending/auth/challenge',json={'address':signer.classic_address}).json
    wrong=dict(public_key=other.public_key,signature=keypairs.sign(challenge['message'].encode(),other.private_key))
    assert live_client.post('/api/lending/auth/verify',json=wrong).status_code==401
    proof=dict(public_key=signer.public_key,signature=keypairs.sign(challenge['message'].encode(),signer.private_key))
    assert live_client.post('/api/lending/auth/verify',json=proof).status_code==200
    assert live_client.post('/api/lending/auth/verify',json=proof).status_code==401


def test_expired_challenge_and_cross_origin(live_app,live_client):
    w=Wallet.create()
    challenge=live_client.post('/api/lending/auth/challenge',json={'address':w.classic_address}).json
    with live_app.app_context():
        get_db().execute('UPDATE wallet_challenges SET expires_at=0');get_db().commit()
    assert live_client.post('/api/lending/auth/verify',json={'public_key':w.public_key,'signature':keypairs.sign(challenge['message'].encode(),w.private_key)}).status_code==401
    assert live_client.post('/api/lending/auth/challenge',json={'address':w.classic_address},headers={'Origin':'https://elsewhere.example'}).status_code==403


def test_wallet_balances_are_exact_issued_asset_strings(live_client,ledger):
    login(live_client)
    result=live_client.get('/api/lending/wallet').json
    assert result['rlusd_balance']=='123.456789'
    assert result['xrp_fee_balance']=='100'


def test_vault_reads_no_fixture_capital(live_client,ledger):
    result=live_client.get('/api/lending/pools/core').json
    assert result['total_assets']=='1000.00' and result['assets_on_loan']=='250.00'
    assert result['source']=='validated_ledger' and result['rate_history']==[]
    assert result['deposit_apy'] is None
    missing=live_client.get('/api/lending/pools/balanced').json
    assert missing['total_assets'] is None and missing['source']=='unavailable'
    ledger['wrong_asset']=True
    assert live_client.get('/api/lending/pools/core').json['total_assets'] is None


@pytest.mark.parametrize('amount',[1,True,'0','-1','1e3','NaN','0.0000001','100000001'])
def test_amount_validation(live_client,ledger,amount):
    login(live_client)
    assert live_client.post('/api/lending/intents',json={'action':'deposit','pool':'core','amount':amount}).status_code==400


def test_native_deposit_and_validation_before_confirmation(live_client,live_app,ledger):
    signer=login(live_client)
    prep=prepared(live_client)
    assert prep.status_code==201
    tx=prep.json['transaction']
    assert tx['TransactionType']=='VaultDeposit'
    assert tx['Amount']==dict(currency=chain.CURRENCY,issuer=chain.PROFILES['testnet']['issuer'],value='25.000001')
    blob=signed_blob(prep,signer)
    path='/api/lending/intents/'+prep.json['id']
    submitted=live_client.post(path+'/submit',json={'signed_blob':blob})
    assert submitted.status_code==202 and submitted.json['status']=='submitted'
    ledger['validated']=True
    confirmed=live_client.get(path).json
    assert confirmed['status']=='confirmed' and confirmed['ledger_index']==101
    assert confirmed['explorer_url'].startswith('https://testnet.xrpl.org/transactions/')
    assert live_client.post(path+'/submit',json={'signed_blob':blob}).json['status']=='confirmed'
    assert len(ledger['submitted'])==1
    with live_app.app_context():
        assert get_db().execute('SELECT COUNT(*) FROM market_deposits').fetchone()[0]==0
        assert get_db().execute('SELECT COUNT(*) FROM ledger_intents').fetchone()[0]==1


def test_mutated_signed_payload_rejected(live_client,ledger):
    w=login(live_client);prep=prepared(live_client)
    tx=dict(prep.json['transaction']);tx['Amount']=dict(tx['Amount'],value='100')
    blob=binarycodec.encode(sign(Transaction.from_xrpl(tx),w).to_xrpl())
    assert live_client.post('/api/lending/intents/'+prep.json['id']+'/submit',json={'signed_blob':blob}).status_code==400
    assert ledger['submitted']==[]


def test_validated_failure_does_not_credit(live_client,ledger):
    w=login(live_client);prep=prepared(live_client);ledger.update(validated=True,code='tecINSUFFICIENT_FUNDS')
    result=live_client.post('/api/lending/intents/'+prep.json['id']+'/submit',json={'signed_blob':signed_blob(prep,w)})
    assert result.json['status']=='failed'


def test_wrong_validated_transaction_rejected(live_client,ledger):
    w=login(live_client);prep=prepared(live_client);ledger.update(validated=True,wrong_tx=True)
    response=live_client.post('/api/lending/intents/'+prep.json['id']+'/submit',json={'signed_blob':signed_blob(prep,w)})
    assert response.status_code==503


def test_network_and_amendment_gates(live_client,ledger):
    login(live_client);ledger['network_id']=0
    assert prepared(live_client).status_code==503
    ledger.update(network_id=1,amendments=False)
    assert prepared(live_client).status_code==503
    assert ledger['submitted']==[]


def test_withdraw_to_self_and_native_repay(live_client,ledger):
    signer=login(live_client)
    withdraw=prepared(live_client,action='withdraw')
    assert withdraw.json['transaction']['Destination']==signer.classic_address
    ledger['borrower']=Wallet.create().classic_address
    assert prepared(live_client,action='repay',loan_id=LOAN).status_code==403
    ledger['borrower']=signer.classic_address
    repay=prepared(live_client,action='repay',loan_id=LOAN,payment_type='full')
    assert repay.json['transaction']['TransactionType']=='LoanPay'
    assert repay.json['transaction']['Flags']==131072
    assert repay.json['transaction']['Amount']['currency']==chain.CURRENCY


def test_private_intents_and_applications(live_app,live_client,ledger):
    w=login(live_client);prep=prepared(live_client)
    data=dict(company='Synthetic SME',sector='Logistics',purpose='Payroll',invoice_ref='TEST-1',debtor='Synthetic Buyer',
              due_date=(date.today()+timedelta(days=30)).isoformat(),invoice='1000',amount='500',years_trading='5',late_payment_pct='0',
              document=(io.BytesIO(b'%PDF-1.4\nSynthetic test invoice'), 'test.pdf'))
    response=live_client.post('/api/market/requests',data=data)
    assert response.status_code==201
    assert response.json['financial_effect'] is False
    rid=response.json['requests'][0]['id']
    other=live_app.test_client();login(other)
    assert other.get('/api/lending/intents/'+prep.json['id']).status_code==404
    assert other.get('/api/market/requests').json['requests']==[]
    assert other.get(f'/api/market/requests/{rid}/document').status_code==404
    with live_app.app_context():
        assert get_db().execute('SELECT wallet_address FROM market_requests').fetchone()[0]==w.classic_address


def test_missing_signature_and_no_wallet(live_client,ledger):
    assert prepared(live_client).status_code==401
    assert live_client.get('/api/lending/wallet').status_code==401


def test_real_rpc_transport_error_does_not_fallback(live_app,monkeypatch):
    import httpx
    calls=[]
    def offline(url,**kwargs):
        calls.append(url);raise httpx.ConnectError('DNS failure')
    monkeypatch.setattr(httpx,'post',offline)
    live_app.config['LENDING_NETWORK']='lending-devnet'
    with live_app.app_context():
        status=chain.inspect_network()
    assert calls==['https://lend.devnet.rippletest.net:51234/']
    assert not status['connected']
