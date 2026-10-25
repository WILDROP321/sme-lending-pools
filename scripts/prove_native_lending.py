"""Opt-in real Devnet proof using deployment test wallets, never the user's keys."""
import json
import os
import sys
import time
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'services/api'))
from lending_pool import create_app
from lending_pool.db import init_db
from xrpl.wallet import Wallet
from xrpl.core import keypairs, binarycodec
from xrpl.models.transactions import Transaction
from xrpl.transaction import sign

app=create_app()
app.config['DATABASE']=str(Path(app.instance_path)/'native-proof.sqlite')
with app.app_context(): init_db()
keys=json.loads((Path(app.instance_path)/'native-devnet-wallets.json').read_text())
client=app.test_client()
proof=[]
def call(method,path,data=None):
 r=getattr(client,method)('/api/lending'+path,json=data)
 if r.status_code>=400: raise RuntimeError(f'{path}: {r.status_code} {r.get_json()}')
 return r.get_json()
def login(name):
 w=Wallet.from_seed(keys[name]['seed']);challenge=call('post','/auth/challenge',{'address':w.classic_address})
 call('post','/auth/verify',{'public_key':w.public_key,'signature':keypairs.sign(challenge['message'].encode(),w.private_key)})
 return w
def transact(w,**payload):
 intent=call('post','/intents',payload)
 blob=binarycodec.encode(sign(Transaction.from_xrpl(intent['transaction']),w).to_xrpl())
 result=call('post',f"/intents/{intent['id']}/submit",{'signed_blob':blob})
 for _ in range(30):
  if result['status'] in ('confirmed','failed'):break
  time.sleep(2);result=call('get',f"/intents/{intent['id']}")
 if result['status']!='confirmed':raise RuntimeError(str(result))
 proof.append(result);print(payload['action'],result['tx_hash'],flush=True)
 Path('/tmp/flow-native-proof.json').write_text(json.dumps(proof,indent=2))
 return result
if '--borrow-only' not in sys.argv and '--repay-only' not in sys.argv:
 w=login('investor');transact(w,action='deposit',pool='core',amount='10');transact(w,action='withdraw',pool='core',amount='10')
w=login('borrower')
if '--repay-only' not in sys.argv:loan=transact(w,action='borrow',pool='balanced',amount='100')
state=call('get','/wallet')
if not state['loans']:raise RuntimeError('No on-chain loan returned to borrower')
loan_id=state['loans'][0].get('index') or state['loans'][0].get('LedgerIndex')
transact(w,action='repay',pool='balanced',loan_id=loan_id,amount='100',payment_type='regular')
print('PASS: selected real Flask actions confirmed: '+', '.join(item['action'] for item in proof)+'. No mocked RPC.')
