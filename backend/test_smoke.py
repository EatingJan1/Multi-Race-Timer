"""
Smoke-Tests für die FastAPI-Migration.  Ausführen im Ordner backend/:

    pip install pytest httpx
    pytest tests -q

Die Tests laufen in einem temporären Arbeitsverzeichnis (eigene var/ und data/),
berühren also keine echten Daten. Sie nutzen deine db/users.py und db/races.py.
"""
import io
import os
import sys

import pytest

BACKEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
PDF = b'%PDF-1.4\n%fake\n'
ORIGIN = 'http://localhost'


@pytest.fixture(scope='module')
def env(tmp_path_factory):
    tmp = tmp_path_factory.mktemp('mrt')
    old_cwd = os.getcwd()
    os.chdir(tmp)
    os.environ.update({
        'SECRET_KEY': 'test-secret-key-0123456789abcdef0123456789abcdef',
        'MAX_CONTENT_LENGTH': '300000',
    })
    sys.path.insert(0, BACKEND_DIR)

    from fastapi.testclient import TestClient
    from db.users import hash_password, save_users
    import app as app_module
    from security import rate_limiter

    save_users({
        'admin': {'password': hash_password('adminpass1'), 'permissions': {'is_admin': True}, 'race_access': {}},
        'timer': {'password': hash_password('timerpass1'), 'permissions': {},
                  'race_access': {'R1': {'can_start': True}}},
        'manager': {'password': hash_password('managerpass1'),
                    'permissions': {'can_manage_users': True, 'can_see_all': True}, 'race_access': {}},
    })

    def login(user, password):
        rate_limiter._hits.clear()
        rate_limiter._failures.clear()
        c = TestClient(app_module.app)
        r = c.post('/auth/login', json={'username': user, 'password': password})
        assert r.status_code == 200, r.text
        return c

    yield {'app': app_module.app, 'TestClient': TestClient, 'login': login, 'limiter': rate_limiter}
    os.chdir(old_cwd)


@pytest.fixture(scope='module')
def admin(env):
    c = env['login']('admin', 'adminpass1')
    people = [{'id': '1', 'name': 'Anna', 'start_number': 1, 'tags': ['W']},
              {'id': '2', 'name': 'Ben', 'start_number': 2, 'tags': []}]
    r = c.put('/race/R1/full', json={'people': people, 'settings': {'displaytype': 'public'}})
    assert r.status_code == 201, r.text
    return c


# --------------------------------------------------------------------------- Auth

def test_requires_login_and_error_format(env):
    c = env['TestClient'](env['app'])
    r = c.get('/race/list')
    assert r.status_code == 401
    assert r.json() == {'message': 'Authentication required'}


def test_login_status_logout(env):
    env['limiter']._hits.clear()
    c = env['TestClient'](env['app'])
    assert c.post('/auth/login', json={'username': 'admin', 'password': 'nope'}).status_code == 401
    assert c.post('/auth/login', json={'username': 'admin', 'password': 'adminpass1'}).status_code == 200
    st = c.get('/auth/status').json()
    assert st['logged_in'] is True and st['user'] == 'admin' and st['permissions']['is_admin']
    c.post('/auth/logout')
    assert c.get('/auth/status').json() == {'logged_in': False}


def test_invalid_body_gives_400_message(env):
    env['limiter']._hits.clear()
    c = env['TestClient'](env['app'])
    r = c.post('/auth/login', content='[1]', headers={'Content-Type': 'application/json'})
    assert r.status_code == 400 and 'message' in r.json()


def test_login_rate_limit(env):
    env['limiter']._hits.clear()
    env['limiter']._failures.clear()
    c = env['TestClient'](env['app'])
    codes = [c.post('/auth/login', json={'username': f'u{i}', 'password': 'x'}).status_code for i in range(22)]
    assert codes[:20] == [401] * 20 and codes[20] == 429


def test_account_lockout(env):
    env['limiter']._hits.clear()
    env['limiter']._failures.clear()
    c = env['TestClient'](env['app'])
    codes = [c.post('/auth/login', json={'username': 'admin', 'password': 'bad'}).status_code for _ in range(6)]
    assert codes[:5] == [401] * 5 and codes[5] == 429


# --------------------------------------------------------------------------- Rennen

def test_people_marshalling_and_race_list(admin):
    assert admin.get('/race/list').json() == ['R1']
    people = admin.get('/race/R1/people').json()
    assert [p['name'] for p in people] == ['Anna', 'Ben']
    assert set(people[0]) == {'id', 'name', 'start_number', 'tags', 'start_time', 'end_time', 'duration'}


def test_start_stop_flow(admin):
    assert admin.post('/race/R1/stop/1', json={'timestamp': '2026-01-01T10:00:10Z'}).status_code == 400
    r = admin.post('/race/R1/start/1', json={'timestamp': '2026-01-01T10:00:00Z'})
    assert r.status_code == 200 and r.json()['status'] == 'started'
    r = admin.post('/race/R1/stop/1', json={'timestamp': '2026-01-01T10:00:12.5Z'})
    assert r.json()['duration'] == 12.5
    assert admin.post('/race/R1/start/99', json={}).status_code == 404
    assert admin.post('/race/R1/start/2', json={'timestamp': 'quatsch'}).status_code == 400
    # ohne Body -> Serverzeit
    assert admin.post('/race/R1/start/2').status_code == 200


def test_export_csv(admin):
    r = admin.get('/race/R1/export')
    assert r.status_code == 200 and r.headers['content-type'].startswith('text/csv')
    assert 'R1_ergebnisse.csv' in r.headers['content-disposition']
    assert 'Anna' in r.text


def test_genkey_201_then_200(admin):
    first = admin.get('/race/R1/genkey')
    second = admin.get('/race/R1/genkey')
    assert first.status_code == 201 and second.status_code == 200
    assert first.json()['key'] == second.json()['key']


def test_template_upload_multipart_and_json(admin, env):
    r = admin.post('/race/R1/template', files={'file': ('t.pdf', io.BytesIO(PDF), 'application/pdf')})
    assert r.status_code == 200, r.text
    pub = env['TestClient'](env['app']).get('/public/template/R1')
    assert pub.status_code == 200 and pub.content == PDF
    import base64
    r = admin.post('/race/R1/template', json={'pdf': base64.b64encode(PDF).decode()})
    assert r.status_code == 200
    assert admin.post('/race/R1/template', json={'pdf': '!!!kein-base64'}).status_code == 400
    r = admin.post('/race/R1/template', files={'file': ('t.pdf', io.BytesIO(b'GIF89a'), 'application/pdf')})
    assert r.status_code == 400


# --------------------------------------------------------------------------- Rechte

def test_race_specific_permissions(env, admin):
    c = env['login']('timer', 'timerpass1')
    assert c.post('/race/R1/start/1', json={}).status_code == 200
    assert c.post('/race/R1/stop/1', json={}).status_code == 403           # kein can_stop
    assert c.post('/race/R2/start/1', json={}).status_code == 403          # kein Zugriff auf R2
    assert c.get('/auth/users').status_code == 403
    assert c.post('/auth/update/apply').status_code == 403                 # nur Admin


def test_manager_cannot_escalate(env, admin):
    c = env['login']('manager', 'managerpass1')
    r = c.post('/auth/users', json={'username': 'x1', 'password': 'password123',
                                    'permissions': {'is_admin': True}})
    assert r.status_code == 403
    r = c.post('/auth/users', json={'username': 'x2', 'password': 'password123',
                                    'permissions': {'can_start': True}})
    assert r.status_code == 403   # Manager besitzt can_start selbst nicht
    r = c.post('/auth/users', json={'username': 'x3', 'password': 'password123',
                                    'permissions': {'can_see_all': True}})
    assert r.status_code == 200


def test_deleted_user_loses_session(env, admin):
    c = env['login']('manager', 'managerpass1')
    assert c.post('/auth/users', json={'username': 'tmpuser', 'password': 'password123'}).status_code == 200
    t = env['login']('tmpuser', 'password123')
    assert t.get('/auth/status').json()['logged_in'] is True
    assert admin.delete('/auth/users/tmpuser').status_code == 200
    assert t.get('/auth/status').json() == {'logged_in': False}


# --------------------------------------------------------------------------- Öffentlich

def test_public_register_and_visibility(env, admin):
    env['limiter']._hits.clear()
    anon = env['TestClient'](env['app'])
    r = anon.post('/public/register/R1', json={'name': 'Clara', 'tags': ['X']})
    assert r.status_code == 201 and r.json()['start_number'] >= 100
    assert any(x['name'] == 'R1' for x in anon.get('/public/races').json())
    assert anon.get('/public/results/R1').status_code == 403               # nicht 'finished'
    assert anon.post('/public/register/R1', json={'name': ''}).status_code == 400
    admin.post('/race/Hidden/settings', json={'displaytype': 'hidden'})
    assert anon.get('/public/race/Hidden').status_code == 404
    assert admin.get('/public/race/Hidden').status_code == 200             # eingeloggt sichtbar


def test_public_register_pdf_checks(env, admin):
    import base64
    env['limiter']._hits.clear()
    anon = env['TestClient'](env['app'])
    ok = anon.post('/public/register/R1', json={'name': 'Dora', 'signed_pdf': base64.b64encode(PDF).decode()})
    assert ok.status_code == 201
    assert any(f.endswith('.pdf') for f in admin.get('/race/R1/pdfs').json())
    bad = anon.post('/public/register/R1', json={'name': 'Eve', 'signed_pdf': base64.b64encode(b'MZ..').decode()})
    assert bad.status_code == 400


def test_kiosk_key_handling(env, admin):
    key = admin.get('/race/R1/genkey').json()['key']
    admin.post('/race/Kiosk/settings', json={'displaytype': 'kiosk', 'key': key})
    anon = env['TestClient'](env['app'])
    assert anon.get('/public/race/Kiosk').status_code == 403
    assert anon.get(f'/public/race/Kiosk?key={key}').status_code == 200
    assert anon.get('/public/race/Kiosk', headers={'X-Kiosk-Key': key}).status_code == 200
    assert 'key' not in anon.get(f'/public/race/Kiosk?key={key}').json()['settings']
    assert anon.post('/public/kiosk/register/Kiosk', json={'SECKEY': 'äöü-nicht-ascii'}).status_code == 403
    assert anon.post('/public/kiosk/register/Kiosk', json={'SECKEY': key}).status_code == 200


# --------------------------------------------------------------------------- Middleware

def test_body_size_limit(env, admin):
    big = {'people': [], 'settings': {'blob': 'x' * 400_000}}
    r = admin.put('/race/Big/full', json=big)
    assert r.status_code == 413 and r.json() == {'message': 'Request body too large'}


def test_cors_and_security_headers(env):
    c = env['TestClient'](env['app'])
    pre = c.options('/auth/login', headers={'Origin': ORIGIN, 'Access-Control-Request-Method': 'POST',
                                            'Access-Control-Request-Headers': 'content-type'})
    assert pre.status_code == 200
    assert pre.headers['access-control-allow-origin'] == ORIGIN
    assert pre.headers['access-control-allow-credentials'] == 'true'
    r = c.get('/public/info', headers={'Origin': 'http://evil.example'})
    assert 'access-control-allow-origin' not in r.headers
    assert r.headers['x-content-type-options'] == 'nosniff' and r.headers['x-frame-options'] == 'DENY'
    assert r.json()['storage'] == 'sqlite'


def test_session_cookie_flags(env):
    env['limiter']._hits.clear()
    c = env['TestClient'](env['app'])
    r = c.post('/auth/login', json={'username': 'admin', 'password': 'adminpass1'})
    cookie = r.headers['set-cookie'].lower()
    assert 'httponly' in cookie and 'samesite=lax' in cookie


def test_swagger_docs_at_root(env):
    c = env['TestClient'](env['app'])
    assert c.get('/').status_code == 200
    assert '/race/{race_name}/start/{start_number}' in c.get('/openapi.json').json()['paths']
