"""Company persistence via Supabase REST, with SQLite for isolated local tests."""
import httpx
from flask import abort, current_app

from .db import get_db


def hosted():
    return bool(current_app.config.get('SUPABASE_URL'))


def remote(method, *, record_id=None, payload=None, resource='mock_companies', query=None):
    config = current_app.config
    if not config.get('SUPABASE_PUBLISHABLE_KEY') or not config.get('FLOW_SUPABASE_API_KEY'):
        abort(503, description='Supabase company database credentials are incomplete.')
    url = config['SUPABASE_URL'].rstrip('/') + '/rest/v1/' + resource
    params = {'select': '*', 'order': 'id.desc'}
    if resource != 'mock_companies':
        params.pop('order', None)
    if query:
        params.update(query)
    if record_id is not None:
        params['id'] = f'eq.{record_id}'
    try:
        response = httpx.request(method, url, params=params, json=payload, timeout=15,
            headers={'apikey': config['SUPABASE_PUBLISHABLE_KEY'],
                     'X-Flow-Api-Key': config['FLOW_SUPABASE_API_KEY'],
                     'Prefer': 'return=representation'})
        if response.status_code == 400 and 'Approved applications are immutable' in response.text:
            abort(409, description='Approved applications cannot be edited.')
        response.raise_for_status()
        rows = response.json()
        if not isinstance(rows, list):
            raise ValueError('Expected company rows')
        return rows
    except (httpx.HTTPError, ValueError):
        # Never fall back to SQLite after a hosted failure: that would split records.
        abort(503, description='The Supabase company database is unavailable. Please retry.')


def list_records():
    if hosted():
        return remote('GET')
    return [dict(row) for row in get_db().execute('SELECT * FROM mock_companies ORDER BY id DESC')]


def save_record(fields, record_id=None):
    if hosted():
        rows = remote('POST' if record_id is None else 'PATCH', record_id=record_id, payload=fields)
        if not rows:
            abort(404, description='Company not found.')
        return rows[0]
    db = get_db()
    with db:
        if record_id is not None:
            db.execute('BEGIN IMMEDIATE')
            existing = db.execute('SELECT status FROM mock_companies WHERE id=?', (record_id,)).fetchone()
            if existing and existing['status'] == 'approved':
                abort(409, description='Approved applications cannot be edited.')
        if record_id is None:
            names = ', '.join(fields)
            placeholders = ', '.join('?' for _ in fields)
            cursor = db.execute(f'INSERT INTO mock_companies ({names}) VALUES ({placeholders})', tuple(fields.values()))
            record_id = cursor.lastrowid
        else:
            assignments = ', '.join(f'{name} = ?' for name in fields)
            db.execute(f'UPDATE mock_companies SET {assignments} WHERE id = ?', (*fields.values(), record_id))
    row = db.execute('SELECT * FROM mock_companies WHERE id = ?', (record_id,)).fetchone()
    if row is None:
        abort(404, description='Company not found.')
    return dict(row)


def rpc(name, payload):
    config = current_app.config
    try:
        response = httpx.post(config['SUPABASE_URL'].rstrip('/') + '/rest/v1/rpc/' + name,
            json=payload, timeout=15, headers={'apikey': config['SUPABASE_PUBLISHABLE_KEY'],
                'X-Flow-Api-Key': config['FLOW_SUPABASE_API_KEY']})
        if response.status_code == 400:
            detail = response.json().get('message', '')
            allowed = ('Insufficient mock vault assets', 'Invoice is past due', 'Company is not eligible for approval',
                       'Company not found', 'Pool not found', 'Deposit reference already used', 'Invalid deposit')
            if detail in allowed:
                abort(409, description=detail)
        response.raise_for_status()
        return response.json()
    except (httpx.HTTPError, ValueError):
        abort(503, description='The Supabase vault database is unavailable. Please retry with the same request reference.')
