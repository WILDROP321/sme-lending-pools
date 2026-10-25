"""Non-custodial RLUSD integration. Only validated ledger data establishes value.

No private keys, synthetic balances, or automatic network fallbacks are used here.
"""
import hashlib
import json
import re
import secrets
import time
from decimal import Decimal, InvalidOperation
from urllib.parse import urlparse

import httpx
from flask import Blueprint, abort, current_app, jsonify, request, session
from xrpl.core import addresscodec, binarycodec, keypairs

from .db import get_db

lending = Blueprint('lending', __name__, url_prefix='/api/lending')
CURRENCY = '524C555344000000000000000000000000000000'
AMENDMENTS = '7DB0788C020F02780A673DC74757F23823FA3014C1866E72CC4CD8B226CD6EF4'
PROFILES = {
    'lending-devnet': dict(name='XRPL Lending Devnet', rpc='https://lend.devnet.rippletest.net:51234/',
        websocket='wss://lend.devnet.rippletest.net:51233/', issuer=None, network_id=None, explorer=None),
    'devnet': dict(name='XRPL Devnet', rpc='https://s.devnet.rippletest.net:51234/',
        websocket='wss://s.devnet.rippletest.net:51233/', issuer=None, network_id=2,
        explorer='https://devnet.xrpl.org/transactions/'),
    # Explicit optional profile. It is never a fallback for Lending Devnet.
    'testnet': dict(name='XRPL Testnet', rpc='https://s.altnet.rippletest.net:51234/',
        websocket='wss://s.altnet.rippletest.net:51233/', issuer='rQhWct2fv4Vc4KRjRgMrxa8xPN9Zx9iLKV',
        network_id=1, explorer='https://testnet.xrpl.org/transactions/'),
}
POOLS = [('core', 'Core Income', 'Lower risk'), ('balanced', 'Balanced Growth', 'Moderate risk'),
         ('opportunity', 'Opportunity', 'Higher risk')]


class LedgerError(Exception):
    def __init__(self, message, code='unavailable'):
        super().__init__(message)
        self.code = code


@lending.errorhandler(LedgerError)
def ledger_error(error):
    return jsonify(error={'code': error.code, 'message': str(error)}), 503


@lending.before_request
def same_origin():
    if request.method != 'GET':
        origin = request.headers.get('Origin')
        if request.headers.get('Sec-Fetch-Site') == 'cross-site' or (origin and origin != request.host_url.rstrip('/')):
            abort(403, description='Submit from this application’s origin.')


def config():
    name = current_app.config['LENDING_NETWORK']
    if name not in PROFILES:
        raise LedgerError('Choose lending-devnet, devnet or testnet explicitly; Mainnet is not supported.')
    profile = dict(PROFILES[name], key=name)
    if name in ('lending-devnet', 'devnet'):
        profile['issuer'] = current_app.config.get('LENDING_RLUSD_ISSUER') or None
        profile['network_id'] = current_app.config.get('LENDING_NETWORK_ID') or profile['network_id']
        profile['issuer_source'] = current_app.config.get('LENDING_RLUSD_ISSUER_SOURCE') or None
        # An operator must verify this explorer targets the same network. No invented URL.
        profile['explorer'] = current_app.config.get('LENDING_EXPLORER_TX_URL') or profile['explorer']
    else:
        profile['issuer_source'] = 'https://docs.ripple.com/products/stablecoin/developer-resources/rlusd-on-the-xrpl'
    return profile


def rpc(method, **params):
    profile = config()
    try:
        response = httpx.post(profile['rpc'], json={'method': method, 'params': [dict(api_version=2, **params)]}, timeout=10)
        response.raise_for_status()
        result = response.json()['result']
    except (httpx.HTTPError, ValueError, KeyError) as error:
        raise LedgerError(f'{profile["name"]} is unreachable. No fallback or simulated result was used.') from error
    if result.get('error') or result.get('status') == 'error':
        raise LedgerError(result.get('error_message') or result.get('error', 'Ledger request failed.'), result.get('error'))
    return result


def validated(method, **params):
    result = rpc(method, ledger_index='validated', **params)
    if result.get('validated') is not True:
        raise LedgerError('The server did not return validated ledger data.')
    return result


def asset():
    profile = config()
    if not profile['issuer'] or not addresscodec.is_valid_classic_address(profile['issuer']):
        raise LedgerError('No verified official RLUSD issuer is configured on this network.', 'rlusd_unavailable')
    if not profile.get('issuer_source'):
        raise LedgerError('The Lending Devnet RLUSD issuer needs an official source; self-issued lookalikes are not RLUSD.')
    return {'currency': CURRENCY, 'issuer': profile['issuer']}


def inspect_network():
    profile = config()
    result = dict(network=profile, connected=False, amendments={}, ledger_index=None, blockers=[], asset=None)
    try:
        result['asset'] = asset()
    except LedgerError as error:
        result['blockers'].append(str(error))
    try:
        info = rpc('server_info')['info']
        result.update(connected=True, network_id=info.get('network_id'), build_version=info.get('build_version'),
                      ledger_index=info.get('validated_ledger', {}).get('seq'))
        expected = profile['network_id']
        if expected is None:
            result['blockers'].append('Lending Devnet NetworkID has not been independently verified and pinned.')
        elif info.get('network_id') != int(expected):
            result['blockers'].append('Server NetworkID does not match the configured network.')
        if info.get('server_state') not in ('full', 'validating', 'proposing') or info.get('validated_ledger', {}).get('age', 999) > 30:
            result['blockers'].append('The ledger server is not synchronized.')
        enabled = validated('ledger_entry', index=AMENDMENTS)['node']['Amendments']
        result['amendments'] = {name: hashlib.sha512(name.encode()).hexdigest()[:64].upper() in enabled
                                for name in ('SingleAssetVault', 'LendingProtocol', 'LendingProtocolV1_1')}
        if result['asset']:
            validated('account_info', account=result['asset']['issuer'])
    except (LedgerError, KeyError) as error:
        result['blockers'].append(str(error))
    result['ready'] = not result['blockers']
    result['native_lending_ready'] = result['ready'] and all(result['amendments'].get(name) for name in ('SingleAssetVault', 'LendingProtocol'))
    return result


def require_ready(amendment=None):
    status = inspect_network()
    if status['blockers']:
        raise LedgerError(' '.join(status['blockers']))
    if amendment and not status['amendments'].get(amendment):
        raise LedgerError(f'{amendment} is not enabled on the selected network.', 'unsupported')
    return status


def body():
    data = request.get_json()
    if not isinstance(data, dict):
        abort(400, description='Expected a JSON object.')
    return data


def wallet():
    if session.get('wallet_network') != config()['key'] or session.get('wallet_expires', 0) <= time.time():
        abort(401, description='Connect GemWallet and sign a fresh login challenge.')
    return session['wallet_address']


def positive_amount(value):
    # Decimal strings avoid silent IEEE-754 rounding and XRP-drop conversions.
    if not isinstance(value, str) or not re.fullmatch(r'(0|[1-9]\d{0,8})(\.\d{1,6})?', value):
        abort(400, description='Use a decimal RLUSD string with up to six decimal places.')
    number = Decimal(value)
    if number <= 0 or number > 100000000:
        abort(400, description='Amount must be above zero and at most 100,000,000 RLUSD.')
    return format(number.normalize(), 'f')


def ledger_id(value):
    if not isinstance(value, str) or not re.fullmatch('[A-Fa-f0-9]{64}', value):
        abort(400, description='Expected a 64-character ledger object ID.')
    return value.upper()


def pool_config(pool_id):
    if not isinstance(pool_id, str) or pool_id not in {p[0] for p in POOLS}:
        abort(404, description='Pool not found.')
    mapping = current_app.config['LENDING_VAULTS']
    return mapping.get(pool_id)


def read_vault(pool_id):
    index = pool_config(pool_id)
    if not index:
        raise LedgerError('No on-chain RLUSD vault is configured for this pool.', 'vault_unavailable')
    result = validated('ledger_entry', index=ledger_id(index))
    node = result['node']
    if node.get('LedgerEntryType') != 'Vault' or node.get('Asset') != asset():
        raise LedgerError('Configured vault does not hold the exact RLUSD currency and issuer.', 'wrong_asset')
    return node, result['ledger_index']


def paged(method, key, **params):
    rows, marker, ledger_hash = [], None, None
    for _ in range(50):
        arguments = dict(params, limit=400)
        if marker is not None:
            arguments['marker'] = marker
        if ledger_hash:
            result = rpc(method, ledger_hash=ledger_hash, **arguments)
            if result.get('validated') is not True:
                raise LedgerError('Unvalidated account data.')
        else:
            result = validated(method, **arguments)
            ledger_hash = result.get('ledger_hash')
        rows.extend(result.get(key, []))
        marker = result.get('marker')
        if marker is None:
            return rows
        if not ledger_hash:
            raise LedgerError('Cannot pin paginated account data to a single validated ledger.')
    raise LedgerError('Account data is too large to read completely; refusing a partial balance.')


def transaction_link(tx_hash):
    base = config()['explorer']
    return base + tx_hash if base and base.startswith('https://') else None


@lending.get('/status')
def status():
    return jsonify(inspect_network())


@lending.get('/pools')
def pools():
    # Pool names are product metadata, never claims of deployed capital.
    return jsonify(pools=[dict(id=key, name=name, risk_label=risk, currency='RLUSD',
        vault_id=pool_config(key), state='configured' if pool_config(key) else 'not_deployed') for key, name, risk in POOLS])


@lending.get('/pools/<pool_id>')
def pool_detail(pool_id):
    pool_config(pool_id)
    result = dict(id=pool_id, vault_id=pool_config(pool_id), source='unavailable', currency='RLUSD',
                  total_assets=None, available_assets=None, assets_on_loan=None, utilization=None,
                  deposit_apy=None, borrow_apr=None, rate_history=[], blockers=[])
    try:
        node, index = read_vault(pool_id)
        total, available = Decimal(node['AssetsTotal']), Decimal(node['AssetsAvailable'])
        result.update(source='validated_ledger', ledger_index=index, total_assets=str(total), available_assets=str(available),
                      assets_on_loan=str(total-available), utilization=str((total-available)/total*100) if total else '0',
                      vault=node)
    except (LedgerError, KeyError, InvalidOperation) as error:
        result['blockers'].append(str(error))
    return jsonify(result)


@lending.post('/auth/challenge')
def challenge():
    address = body().get('address')
    if not isinstance(address, str) or not addresscodec.is_valid_classic_address(address):
        abort(400, description='Invalid XRPL classic address.')
    nonce = secrets.token_hex(32)
    expires = int(time.time()) + 300
    message = f'Flow wallet login\nOrigin: {request.host_url.rstrip("/")}\nNetwork: {config()["key"]}\nAddress: {address}\nNonce: {nonce}\nExpires: {expires}\nThis authenticates your wallet only. It does not authorize a transaction.'
    db = get_db()
    with db:
        db.execute('DELETE FROM wallet_challenges WHERE expires_at < ?', (int(time.time()),))
        db.execute('INSERT INTO wallet_challenges(nonce,address,message,expires_at) VALUES (?,?,?,?)', (nonce, address, message, expires))
    session['wallet_nonce'] = nonce
    return jsonify(message=message, expires_at=expires)


@lending.post('/auth/verify')
def verify():
    data = body()
    db = get_db()
    row = db.execute('SELECT * FROM wallet_challenges WHERE nonce=?', (session.get('wallet_nonce'),)).fetchone()
    if not row or row['used'] or row['expires_at'] <= time.time():
        abort(401, description='Wallet challenge expired or already used.')
    public_key, signature = data.get('public_key', ''), data.get('signature', '')
    try:
        valid = (isinstance(public_key, str) and len(public_key) == 66 and isinstance(signature, str)
                 and len(signature) <= 160 and keypairs.derive_classic_address(public_key) == row['address']
                 and keypairs.is_valid_message(row['message'].encode(), bytes.fromhex(signature), public_key))
    except (ValueError, TypeError, AssertionError):
        valid = False
    if not valid:
        abort(401, description='Signature does not prove ownership of this address.')
    with db:
        used = db.execute('UPDATE wallet_challenges SET used=1 WHERE nonce=? AND used=0 AND expires_at>?', (row['nonce'], int(time.time())))
        if used.rowcount != 1:
            abort(401, description='Wallet challenge expired or already used.')
    session.clear()
    session.update(wallet_address=row['address'], wallet_network=config()['key'], wallet_expires=int(time.time()) + 3600)
    return jsonify(address=row['address'], network=config()['key'])


@lending.post('/auth/logout')
def logout():
    session.clear()
    return jsonify(disconnected=True)


@lending.get('/wallet')
def wallet_state():
    account = wallet()
    result = dict(address=account, network=config()['key'], rlusd_balance=None, xrp_fee_balance=None,
                  trustline=None, shares=[], loans=[], blockers=[])
    try:
        info = validated('account_info', account=account)
        result['xrp_fee_balance'] = str(Decimal(info['account_data']['Balance']) / 1000000)
        result['ledger_index'] = info['ledger_index']
        issue = asset()
        lines = paged('account_lines', 'lines', account=account, peer=issue['issuer'])
        line = next((line for line in lines if line['currency'] == CURRENCY and line['account'] == issue['issuer']), None)
        result.update(rlusd_balance=line['balance'] if line else '0', trustline=line)
        objects = paged('account_objects', 'account_objects', account=account)
        result['shares'] = [node for node in objects if node.get('LedgerEntryType') == 'MPToken']
        # Only configured RLUSD vault loans are shown, never arbitrary-asset loans.
        for node in objects:
            if node.get('LedgerEntryType') != 'Loan':
                continue
            broker = validated('ledger_entry', index=node['LoanBrokerID'])['node']
            if broker.get('VaultID') not in current_app.config['LENDING_VAULTS'].values():
                continue
            vault_node = validated('ledger_entry', index=broker['VaultID'])['node']
            if vault_node.get('Asset') == issue:
                result['loans'].append(node)
    except LedgerError as error:
        result['blockers'].append(str(error))
    return jsonify(result)


def public_intent(row):
    return {**{key: row[key] for key in ('id', 'network', 'account', 'pool', 'action', 'tx_hash', 'status', 'result_code', 'ledger_index', 'created_at')},
            'transaction': json.loads(row['transaction_json']), 'explorer_url': transaction_link(row['tx_hash']) if row['tx_hash'] else None}


@lending.post('/intents')
def prepare():
    account, data = wallet(), body()
    action = data.get('action')
    if action not in ('trustline', 'deposit', 'withdraw', 'repay'):
        abort(400, description='Supported actions: trustline, deposit, withdraw, repay. Loan origination needs a broker/counterparty signing flow.')
    status = require_ready(None if action == 'trustline' else 'LendingProtocol' if action == 'repay' else 'SingleAssetVault')
    amount = positive_amount(data.get('amount'))
    issue = asset()
    pool_id = data.get('pool')
    transaction = dict(Account=account, Flags=0)
    if action == 'trustline':
        transaction.update(TransactionType='TrustSet', LimitAmount=dict(issue, value=amount))
    elif action in ('deposit', 'withdraw'):
        node, _ = read_vault(pool_id)
        transaction.update(TransactionType='VaultDeposit' if action == 'deposit' else 'VaultWithdraw',
                           VaultID=pool_config(pool_id), Amount=dict(issue, value=amount))
        if action == 'withdraw':
            transaction['Destination'] = account
    else:
        loan_id = ledger_id(data.get('loan_id'))
        loan = validated('ledger_entry', index=loan_id)['node']
        if loan.get('LedgerEntryType') != 'Loan' or loan.get('Borrower') != account:
            abort(403, description='Only the borrower can repay this loan.')
        broker = validated('ledger_entry', index=loan['LoanBrokerID'])['node']
        if broker.get('VaultID') != pool_config(pool_id):
            abort(400, description='Loan does not belong to this pool.')
        read_vault(pool_id)
        flags = {'regular': 0, 'full': 131072, 'late': 262144, 'overpayment': 65536}
        if data.get('payment_type', 'regular') not in flags:
            abort(400, description='Invalid repayment type.')
        transaction.update(TransactionType='LoanPay', LoanID=loan_id, Amount=dict(issue, value=amount), Flags=flags[data.get('payment_type', 'regular')])
    info = validated('account_info', account=account)['account_data']
    fee = int(rpc('fee')['drops']['open_ledger_fee'])
    if fee <= 0 or fee > 1000:
        raise LedgerError('Network fee exceeds the 0.001 XRP test-transaction cap.')
    transaction.update(Sequence=info['Sequence'], Fee=str(fee), LastLedgerSequence=status['ledger_index']+20)
    if status['network_id'] > 1024:
        transaction['NetworkID'] = status['network_id']
    intent_id = secrets.token_hex(16)
    transaction['Memos'] = [{'Memo': {'MemoType': 'flow_intent'.encode().hex().upper(), 'MemoData': intent_id.encode().hex().upper()}}]
    # Verify this installed codec can serialize the new transaction before asking a wallet.
    try:
        binarycodec.encode(transaction)
    except Exception as error:
        raise LedgerError('Installed XRPL codec cannot encode this transaction type; no transaction was submitted.', 'unsupported') from error
    db = get_db()
    with db:
        db.execute('INSERT INTO ledger_intents(id,network,account,pool,action,transaction_json) VALUES (?,?,?,?,?,?)',
                   (intent_id, config()['key'], account, pool_id, action, json.dumps(transaction)))
    return jsonify(id=intent_id, transaction=transaction, status='prepared'), 201


def own_intent(intent_id):
    row = get_db().execute('SELECT * FROM ledger_intents WHERE id=? AND account=? AND network=?',
                           (intent_id, wallet(), config()['key'])).fetchone()
    if not row:
        abort(404, description='Transaction intent not found for this wallet and network.')
    return row


def reconcile(row):
    if not row['tx_hash'] or row['status'] in ('confirmed', 'failed', 'expired'):
        return row
    try:
        result = rpc('tx', transaction=row['tx_hash'], binary=False)
    except LedgerError as error:
        if error.code != 'txnNotFound':
            raise
        last = json.loads(row['transaction_json'])['LastLedgerSequence']
        if rpc('server_info')['info']['validated_ledger']['seq'] <= last:
            return row
        # Only definitive not-found in a complete ledger range proves expiration.
        return row
    if result.get('validated') is not True:
        return row
    tx = result.get('tx_json', result)
    expected = json.loads(row['transaction_json'])
    if any(tx.get(key) != value for key, value in expected.items()):
        raise LedgerError('Validated transaction does not match its original intent.', 'mismatch')
    if result.get('hash', tx.get('hash')) != row['tx_hash']:
        raise LedgerError('Ledger returned the wrong transaction hash.', 'mismatch')
    code = result.get('meta', {}).get('TransactionResult')
    if not code:
        raise LedgerError('Validated transaction metadata is missing.')
    db = get_db()
    with db:
        db.execute('UPDATE ledger_intents SET status=?,result_code=?,ledger_index=? WHERE id=?',
                   ('confirmed' if code == 'tesSUCCESS' else 'failed', code, result['ledger_index'], row['id']))
    # No local balance is incremented. A fresh ledger query is the source of holdings.
    return own_intent(row['id'])


@lending.post('/intents/<intent_id>/submit')
def submit(intent_id):
    row, data = own_intent(intent_id), body()
    blob = data.get('signed_blob')
    if not isinstance(blob, str) or not re.fullmatch('[A-Fa-f0-9]{2,32768}', blob) or len(blob) % 2:
        abort(400, description='GemWallet must return a hexadecimal signed transaction blob.')
    try:
        decoded = binarycodec.decode(blob)
    except Exception:
        abort(400, description='Invalid signed transaction blob.')
    expected = json.loads(row['transaction_json'])
    unsigned = {key: value for key, value in decoded.items() if key not in ('SigningPubKey', 'TxnSignature')}
    if unsigned != expected or not decoded.get('TxnSignature') or not decoded.get('SigningPubKey'):
        abort(400, description='Signed transaction differs from the prepared transaction.')
    tx_hash = hashlib.sha512(b'TXN\0' + bytes.fromhex(blob)).hexdigest()[:64].upper()
    if row['tx_hash'] and row['tx_hash'] != tx_hash:
        abort(409, description='This intent already has a different signed transaction.')
    if row['status'] in ('confirmed', 'failed'):
        return jsonify(public_intent(row))
    require_ready()
    db = get_db()
    with db:
        db.execute('BEGIN IMMEDIATE')
        fresh = own_intent(intent_id)
        if fresh['tx_hash'] and fresh['tx_hash'] != tx_hash:
            abort(409, description='A different signed transaction already uses this intent.')
        db.execute("UPDATE ledger_intents SET tx_hash=?,signed_blob=?,status='submitted' WHERE id=? AND status='prepared'",
                   (tx_hash, blob, intent_id))
    # Retrying this same signed blob cannot create a second transaction.
    submitted = rpc('submit', tx_blob=blob, fail_hard=False)
    # An engine result is diagnostic, not proof of validation or balance movement.
    with db:
        db.execute('UPDATE ledger_intents SET result_code=? WHERE id=? AND status=?',
                   (submitted.get('engine_result'), intent_id, 'submitted'))
    return jsonify(public_intent(reconcile(own_intent(intent_id)))), 202


@lending.get('/intents/<intent_id>')
def intent_status(intent_id):
    return jsonify(public_intent(reconcile(own_intent(intent_id))))


@lending.get('/intents')
def intents():
    rows = get_db().execute('SELECT * FROM ledger_intents WHERE account=? AND network=? ORDER BY created_at DESC', (wallet(), config()['key']))
    return jsonify(intents=[public_intent(row) for row in rows])
