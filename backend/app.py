import base64
import csv
import datetime
import io
import json
import logging
import os
import re
import secrets
import sqlite3
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from collections import defaultdict, deque
from functools import wraps

from flask import Flask, abort, request, send_file, session
from flask_restx import Api, Namespace, Resource, fields
from werkzeug.exceptions import HTTPException
from werkzeug.security import check_password_hash, generate_password_hash

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(name)s: %(message)s',
)
logger = logging.getLogger('zeit_backend')

app = Flask(__name__)

DEFAULT_ALLOWED_ORIGINS = {
    'http://localhost',
    'http://127.0.0.1',
    'http://localhost:80',
    'http://127.0.0.1:80',
    'http://localhost:8000',
    'http://127.0.0.1:8000',
    'http://localhost:5002',
    'http://127.0.0.1:5002',
}


def env_flag(name, default=False):
    return os.environ.get(name, str(default)).strip().lower() in {'1', 'true', 'yes', 'on'}


def is_docker_runtime():
    if env_flag('DISABLE_SELF_UPDATE', False):
        return True
    if os.path.exists('/.dockerenv'):
        return True
    return env_flag('RUNNING_IN_DOCKER', False)


def load_allowed_origins():
    raw = os.environ.get('CORS_ALLOWED_ORIGINS', '')
    if not raw.strip():
        return DEFAULT_ALLOWED_ORIGINS
    return {origin.strip() for origin in raw.split(',') if origin.strip()}


def get_secret_key():
    configured = os.environ.get('SECRET_KEY', '').strip()
    is_prod = (
        os.environ.get('FLASK_ENV') == 'production'
        or os.environ.get('ENV') == 'production'
        or is_docker_runtime()
    )

    if configured and configured != 'change-me-before-production':
        return configured

    if is_prod:
        logger.critical(
            "FATAL: SECRET_KEY is not set or using the default placeholder in production. "
            "Set a strong random SECRET_KEY in your environment."
        )
        sys.exit(1)

    generated = secrets.token_hex(32)
    logger.warning("WARNING: SECRET_KEY is not set. Using an ephemeral key for this process.")
    return generated


ALLOWED_ORIGINS = load_allowed_origins()
app.secret_key = get_secret_key()
app.config['MAX_CONTENT_LENGTH'] = int(os.environ.get('MAX_CONTENT_LENGTH', 12 * 1024 * 1024))
app.config['SESSION_COOKIE_HTTPONLY'] = True
app.config['SESSION_COOKIE_SAMESITE'] = os.environ.get('SESSION_COOKIE_SAMESITE', 'Lax')
app.config['SESSION_COOKIE_SECURE'] = env_flag('SESSION_COOKIE_SECURE', False)
app.config['PERMANENT_SESSION_LIFETIME'] = datetime.timedelta(hours=int(os.environ.get('SESSION_TTL_HOURS', '12')))


def is_allowed_origin(origin):
    if not origin:
        return False
    return origin in ALLOWED_ORIGINS


@app.after_request
def add_security_and_cors_headers(response):
    origin = request.headers.get('Origin')
    if is_allowed_origin(origin):
        response.headers['Access-Control-Allow-Origin'] = origin
        response.headers['Access-Control-Allow-Credentials'] = 'true'
        response.headers['Vary'] = 'Origin'

    response.headers['Access-Control-Allow-Headers'] = 'Content-Type,Authorization'
    response.headers['Access-Control-Allow-Methods'] = 'GET,PUT,POST,DELETE,OPTIONS'
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Referrer-Policy'] = 'strict-origin-when-cross-origin'
    response.headers['Cross-Origin-Opener-Policy'] = 'same-origin'
    return response


# Rate Limiter implementation
class MemoryRateLimiter:
    def __init__(self):
        self._requests = defaultdict(deque)
        self._lock = threading.Lock()

    def is_allowed(self, key: str, max_requests: int, window_seconds: int) -> bool:
        now = time.time()
        with self._lock:
            dq = self._requests[key]
            while dq and dq[0] <= now - window_seconds:
                dq.popleft()
            if len(dq) >= max_requests:
                return False
            dq.append(now)
            return True

    def record_failure(self, key: str):
        now = time.time()
        with self._lock:
            self._requests[f"fail:{key}"].append(now)

    def is_locked_out(self, key: str, max_failures: int = 5, window_seconds: int = 300) -> bool:
        now = time.time()
        with self._lock:
            dq = self._requests[f"fail:{key}"]
            while dq and dq[0] <= now - window_seconds:
                dq.popleft()
            return len(dq) >= max_failures

    def reset_failures(self, key: str):
        with self._lock:
            self._requests.pop(f"fail:{key}", None)


rate_limiter = MemoryRateLimiter()


def get_client_ip():
    if request.headers.get('X-Forwarded-For'):
        return request.headers['X-Forwarded-For'].split(',')[0].strip()
    return request.remote_addr or 'unknown'


try:
    version = subprocess.check_output(
        ['git', 'describe', '--tags', '--abbrev=0'],
        stderr=subprocess.DEVNULL
    ).decode('utf-8').strip()
except Exception:
    version = 'v1.0.0'

# Swagger UI doc can be disabled in production if desired via DISABLE_SWAGGER_DOC
enable_doc = not env_flag('DISABLE_SWAGGER_DOC', False)
api = Api(
    app,
    version=version,
    title='Multi-Race Timer API',
    description='API for tracking multiple race sessions',
    doc='/' if enable_doc else False,
)

ns = api.namespace('race', description='Race operations')
auth_ns = api.namespace('auth', description='Authentication')
public_ns = api.namespace('public', description='Public operations')

DATA_DIR = 'data'
SIGNED_DIR = os.path.join(DATA_DIR, 'signed')
USERS_DB = 'var/users.db'
LEGACY_USERS_FILE = 'var/users.json'
MIN_PASSWORD_LENGTH = 8
MAX_JSON_NAME_LENGTH = 120
MAX_TAGS_PER_PERSON = 20
MAX_TAG_LENGTH = 40
MAX_PDF_SIZE_BYTES = int(os.environ.get('MAX_PDF_SIZE_BYTES', 5 * 1024 * 1024))
REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
BACKEND_REQUIREMENTS_PATH = os.path.join(REPO_ROOT, 'backend', 'requirements.txt')
FRONTEND_PRECHECK_SCRIPT = os.path.join(REPO_ROOT, 'backend', 'update_frontend_check.py')

# Thread lock for race data file access
_race_data_locks = defaultdict(threading.Lock)
_master_race_lock = threading.Lock()

ALLOWED_PERMISSION_KEYS = {
    'is_admin',
    'can_start',
    'can_stop',
    'can_edit_form',
    'can_edit_stats',
    'can_edit_participants',
    'can_add_participants',
    'can_edit_settings',
    'can_manage_users',
    'can_see_all',
    'hide_ranking',
    'hide_duration',
}

for d in [DATA_DIR, SIGNED_DIR, os.path.dirname(USERS_DB)]:
    if not os.path.exists(d):
        os.makedirs(d, exist_ok=True)


def get_race_lock(race_name: str) -> threading.Lock:
    with _master_race_lock:
        return _race_data_locks[race_name]


def normalize_username(username):
    if not isinstance(username, str):
        abort(400, 'Username required')
    username = username.strip()
    if not username or len(username) > 64:
        abort(400, 'Username must be between 1 and 64 characters')
    if any(char.isspace() for char in username):
        abort(400, 'Username must not contain spaces')
    return username


def validate_password(password):
    if not isinstance(password, str) or len(password) < MIN_PASSWORD_LENGTH:
        abort(400, f'Password must be at least {MIN_PASSWORD_LENGTH} characters long')
    return password


def hash_password(password):
    return generate_password_hash(password)


def verify_password(stored_password, provided_password):
    if not stored_password or not isinstance(provided_password, str):
        return False
    if stored_password.startswith('pbkdf2:') or stored_password.startswith('scrypt:'):
        return check_password_hash(stored_password, provided_password)
    return secrets.compare_digest(stored_password, provided_password)


def ensure_password_hashed(user_record):
    password = user_record.get('password', '')
    if password.startswith('pbkdf2:') or password.startswith('scrypt:'):
        return False
    user_record['password'] = hash_password(password)
    return True


def get_json_body():
    data = request.get_json(silent=True)
    if data is None:
        abort(400, 'Expected JSON body')
    if not isinstance(data, dict):
        abort(400, 'JSON body must be an object')
    return data


def sanitize_race_name(race_name):
    if not isinstance(race_name, str):
        abort(400, 'Invalid race name')
    safe_name = ''.join(c for c in race_name.strip() if c.isalnum() or c in ('_', '-', '.')).rstrip('.')
    if not safe_name:
        abort(400, 'Invalid race name')
    if len(safe_name) > MAX_JSON_NAME_LENGTH:
        abort(400, 'Race name too long')
    return safe_name


def sanitize_tags(tags):
    if tags is None:
        return []
    if not isinstance(tags, list):
        abort(400, 'Tags must be a list')
    sanitized = []
    for tag in tags[:MAX_TAGS_PER_PERSON]:
        if not isinstance(tag, str):
            continue
        clean_tag = tag.strip()[:MAX_TAG_LENGTH]
        if clean_tag:
            sanitized.append(clean_tag)
    return sanitized


def sanitize_timestamp(ts):
    if not ts:
        return None
    if not isinstance(ts, str):
        abort(400, 'Timestamp must be an ISO format string')
    clean_ts = ts.strip()
    if not clean_ts:
        return None
    try:
        # Validate ISO 8601 formatting
        datetime.datetime.fromisoformat(clean_ts.replace('Z', '+00:00'))
        return clean_ts
    except (ValueError, TypeError):
        abort(400, 'Invalid ISO timestamp format')


def sanitize_person(person):
    if not isinstance(person, dict):
        abort(400, 'Participant payload must contain objects')

    name = str(person.get('name', '')).strip()
    if not name:
        abort(400, 'Participant name is required')
    if len(name) > MAX_JSON_NAME_LENGTH:
        abort(400, 'Participant name too long')

    try:
        start_number = int(person.get('start_number'))
    except (TypeError, ValueError):
        abort(400, 'Invalid start number')

    clean_person = {
        'id': str(person.get('id', start_number))[:64],
        'name': name,
        'start_number': start_number,
        'tags': sanitize_tags(person.get('tags', [])),
        'start_time': sanitize_timestamp(person.get('start_time')),
        'end_time': sanitize_timestamp(person.get('end_time')),
    }

    duration = person.get('duration')
    if duration not in (None, ''):
        try:
            clean_person['duration'] = float(duration)
        except (TypeError, ValueError):
            abort(400, 'Invalid duration')
    else:
        clean_person['duration'] = None

    return clean_person


def sanitize_people(people):
    if not isinstance(people, list):
        abort(400, 'Expected a list of participants')
    return [sanitize_person(person) for person in people]


def sanitize_settings(settings):
    if not isinstance(settings, dict):
        abort(400, 'Settings payload must be an object')
    # Limit settings size to prevent abuse (e.g. max 64KB JSON representation)
    try:
        raw_len = len(json.dumps(settings))
        if raw_len > 64 * 1024:
            abort(400, 'Settings payload too large (max 64KB)')
    except Exception:
        abort(400, 'Invalid settings format')

    # Validate allowed displaytype values if present
    if 'displaytype' in settings:
        allowed_displaytypes = {'public', 'hidden', 'kiosk', 'registration_stop', 'finished'}
        if settings['displaytype'] not in allowed_displaytypes:
            settings['displaytype'] = 'hidden'

    if 'start_num_min' in settings:
        try:
            settings['start_num_min'] = int(settings['start_num_min'])
        except (ValueError, TypeError):
            settings['start_num_min'] = 100

    if 'start_num_max' in settings:
        try:
            settings['start_num_max'] = int(settings['start_num_max'])
        except (ValueError, TypeError):
            settings['start_num_max'] = 9999

    return settings


def safe_join_under(base_dir, *parts):
    base_dir = os.path.abspath(base_dir)
    candidate = os.path.abspath(os.path.join(base_dir, *parts))
    if os.path.commonpath([base_dir, candidate]) != base_dir:
        abort(400, 'Invalid path')
    return candidate


def can_self_update():
    return not is_docker_runtime()


def run_repo_cmd(args):
    return subprocess.run(
        args,
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        check=True,
    )


def run_frontend_precheck(frontend_path=None):
    if not os.path.exists(FRONTEND_PRECHECK_SCRIPT):
        abort(500, 'Frontend precheck script is missing.')

    cmd = [
        sys.executable,
        FRONTEND_PRECHECK_SCRIPT,
        '--repo-root',
        REPO_ROOT,
        '--frontend-path',
        frontend_path or '',
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True, check=True)
    payload = json.loads(proc.stdout.strip() or '{}')
    if not isinstance(payload, dict):
        abort(500, 'Invalid frontend precheck response.')
    return payload


def get_latest_release_tag():
    url = 'https://api.github.com/repos/EatingJan1/Multi-Race-Timer/releases/latest'
    req = urllib.request.Request(url, headers={'Accept': 'application/vnd.github+json'})
    with urllib.request.urlopen(req, timeout=8) as response:
        payload = json.loads(response.read().decode('utf-8'))
        tag = payload.get('tag_name') or payload.get('name')
        if tag and re.match(r'^v?\d+\.\d+\.\d+(-[a-zA-Z0-9.]+)?$', str(tag).strip()):
            return str(tag).strip()
        return None


def get_current_git_tag():
    try:
        exact = run_repo_cmd(['git', 'describe', '--tags', '--exact-match'])
        return exact.stdout.strip()
    except Exception:
        try:
            nearest = run_repo_cmd(['git', 'describe', '--tags', '--abbrev=0'])
            return nearest.stdout.strip()
        except Exception:
            return get_app_version()


def ensure_clean_worktree():
    status = run_repo_cmd(['git', 'status', '--porcelain'])
    if status.stdout.strip():
        abort(409, 'Working tree has uncommitted changes. Commit/stash first.')


def perform_self_update(frontend_path=None, allow_nonstandard_manifest=False):
    if not can_self_update():
        abort(403, 'Self update is disabled in Docker/runtime environment.')

    precheck = run_frontend_precheck(frontend_path)
    if not precheck.get('ok'):
        details = '; '.join(precheck.get('errors', [])) or 'Frontend precheck failed.'
        abort(400, details)

    if precheck.get('requires_confirmation') and not allow_nonstandard_manifest:
        warn = '; '.join(precheck.get('warnings', [])) or 'Frontend manifest requires confirmation.'
        abort(412, warn)

    ensure_clean_worktree()

    run_repo_cmd(['git', 'fetch', '--tags', 'origin'])
    latest_tag = get_latest_release_tag()
    if not latest_tag or not re.match(r'^v?\d+\.\d+\.\d+(-[a-zA-Z0-9.]+)?$', latest_tag):
        abort(502, 'Could not fetch or validate latest release information.')

    current_tag = get_current_git_tag()
    if current_tag == latest_tag:
        return {
            'status': 'up_to_date',
            'current_version': current_tag,
            'latest_version': latest_tag,
            'updated': False,
        }

    run_repo_cmd(['git', 'checkout', latest_tag])

    if os.path.exists(BACKEND_REQUIREMENTS_PATH):
        subprocess.run(
            [sys.executable, '-m', 'pip', 'install', '-r', BACKEND_REQUIREMENTS_PATH],
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
            check=True,
        )

    return {
        'status': 'updated',
        'previous_version': current_tag,
        'current_version': latest_tag,
        'latest_version': latest_tag,
        'updated': True,
        'restart_required': True,
        'frontend_precheck': precheck,
    }


def default_permissions_for(username):
    admin_user = os.environ.get('ADMIN_USER', 'admin')
    if username == admin_user:
        return {
            "is_admin": True,
            "can_start": True,
            "can_stop": True,
            "can_edit_form": True,
            "can_edit_stats": True,
            "can_edit_participants": True,
            "can_add_participants": True,
            "can_edit_settings": True,
            "can_manage_users": True,
            "can_see_all": True,
            "hide_ranking": False,
            "hide_duration": False,
        }
    return {
        "can_see_all": True,
        "hide_ranking": False,
        "hide_duration": False,
    }


def get_db_connection():
    conn = sqlite3.connect(USERS_DB)
    conn.row_factory = sqlite3.Row
    return conn


def _serialize_user_record(username, data):
    permissions = data.get('permissions', default_permissions_for(username))
    race_access = data.get('race_access', {})
    password = data.get('password', '')
    return (
        username,
        password,
        json.dumps(permissions, separators=(',', ':')),
        json.dumps(race_access, separators=(',', ':')),
    )


def _write_users_to_db(users):
    conn = get_db_connection()
    try:
        with conn:
            conn.execute("DELETE FROM users")
            for username, data in users.items():
                conn.execute(
                    "INSERT INTO users (username, password, permissions, race_access) VALUES (?, ?, ?, ?)",
                    _serialize_user_record(username, data),
                )
    finally:
        conn.close()


def init_user_store():
    conn = get_db_connection()
    try:
        with conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS users (
                    username TEXT PRIMARY KEY,
                    password TEXT NOT NULL,
                    permissions TEXT NOT NULL,
                    race_access TEXT NOT NULL
                )
                """
            )
            row = conn.execute("SELECT COUNT(*) AS cnt FROM users").fetchone()
            if row and row["cnt"] > 0:
                return
    finally:
        conn.close()

    users_to_seed = {}

    if os.path.exists(LEGACY_USERS_FILE):
        try:
            with open(LEGACY_USERS_FILE, 'r') as f:
                legacy_users = json.load(f)
            if isinstance(legacy_users, dict):
                for username, data in legacy_users.items():
                    if isinstance(username, str) and isinstance(data, dict):
                        users_to_seed[username] = data
            if users_to_seed:
                logger.info(f"Migrating users from {LEGACY_USERS_FILE} to SQLite.")
        except Exception as exc:
            logger.warning(f"Could not migrate legacy users file: {exc}")

    if not users_to_seed:
        admin_user = os.environ.get('ADMIN_USER', 'admin')
        admin_password = os.environ.get('ADMIN_PASS')
        if not admin_password:
            admin_password = secrets.token_urlsafe(16)
            logger.warning(
                "===========================================================\n"
                "INITIAL SETUP: Generated temporary password for admin '%s':\n"
                "Password: %s\n"
                "Set ADMIN_PASS in environment or change password immediately!\n"
                "===========================================================",
                admin_user, admin_password
            )

        users_to_seed = {
            admin_user: {
                "password": hash_password(admin_password),
                "permissions": default_permissions_for(admin_user),
                "race_access": {},
            }
        }
        logger.info(f"Created initial admin user: {admin_user}")

    users_normalized = {}
    for username, data in users_to_seed.items():
        user_data = dict(data)
        if "permissions" not in user_data or not isinstance(user_data.get("permissions"), dict):
            user_data["permissions"] = default_permissions_for(username)
        if "race_access" not in user_data or not isinstance(user_data.get("race_access"), dict):
            user_data["race_access"] = {}
        ensure_password_hashed(user_data)
        users_normalized[username] = user_data

    _write_users_to_db(users_normalized)


def load_users():
    init_user_store()
    try:
        conn = get_db_connection()
        rows = conn.execute("SELECT username, password, permissions, race_access FROM users").fetchall()
        users = {}
        modified = False

        for row in rows:
            username = row["username"]
            user_data = {"password": row["password"]}

            try:
                permissions = json.loads(row["permissions"])
                if not isinstance(permissions, dict):
                    raise ValueError("permissions must be object")
            except Exception:
                permissions = default_permissions_for(username)
                modified = True
            user_data["permissions"] = permissions

            try:
                race_access = json.loads(row["race_access"])
                if not isinstance(race_access, dict):
                    raise ValueError("race_access must be object")
            except Exception:
                race_access = {}
                modified = True
            user_data["race_access"] = race_access

            if ensure_password_hashed(user_data):
                modified = True

            users[username] = user_data

        if modified:
            _write_users_to_db(users)

        return users
    except Exception as exc:
        logger.error(f"Error loading users: {exc}")
        return {}
    finally:
        try:
            conn.close()
        except Exception:
            pass


def save_users(users):
    init_user_store()
    _write_users_to_db(users)


def get_current_user():
    """Look up the currently authenticated user with fresh permissions from the DB."""
    if not session.get('logged_in'):
        return None, None
    username = session.get('user')
    if not username:
        session.clear()
        return None, None
    users = load_users()
    if username not in users:
        session.clear()
        return None, None
    return username, users[username]


def get_app_version():
    try:
        return api.version or "v1.0.0"
    except Exception:
        return "v1.0.0"


def login_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        username, user_data = get_current_user()
        if not username:
            return {'message': 'Authentication required'}, 401
        return f(*args, **kwargs)
    return decorated_function


def admin_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        username, user_data = get_current_user()
        if not username:
            return {'message': 'Authentication required'}, 401
        permissions = user_data.get('permissions', {})
        if not permissions.get('is_admin'):
            return {'message': 'Admin permission required'}, 403
        return f(*args, **kwargs)
    return decorated_function


def permission_required(perm):
    """
    Decorator to check if the current user has a specific permission.
    Permissions are fetched freshly from the database on every request.
    If the user has 'is_admin' permission, all checks pass.
    """
    def decorator(f):
        @wraps(f)
        def decorated_function(*args, **kwargs):
            username, user_data = get_current_user()
            if not username:
                return {'message': 'Authentication required'}, 401

            permissions = user_data.get('permissions', {})
            # Admin override
            if permissions.get('is_admin'):
                return f(*args, **kwargs)

            race_access = user_data.get('race_access', {})
            race_name = kwargs.get('race_name')

            if race_name:
                # If can_see_all is enabled, user has global view
                if permissions.get('can_see_all'):
                    if race_name in race_access:
                        race_perms = race_access[race_name]
                        if not race_perms.get(perm):
                            return {'message': f"Permission denied for race {race_name} (Override): {perm}"}, 403
                    else:
                        if not permissions.get(perm):
                            return {'message': f"Global permission denied for race {race_name}: {perm}"}, 403
                else:
                    # Selective access
                    if race_name not in race_access:
                        return {'message': f"No access to race: {race_name}"}, 403
                    race_perms = race_access[race_name]
                    if not race_perms.get(perm):
                        return {'message': f"Permission denied for race {race_name}: {perm}"}, 403
            else:
                # Global resource check
                if not permissions.get(perm):
                    return {'message': f"Global permission denied: {perm}"}, 403

            return f(*args, **kwargs)
        return decorated_function
    return decorator


def sanitize_permissions_dict(raw_perms, is_admin_caller, current_user_perms):
    if not isinstance(raw_perms, dict):
        abort(400, 'Permissions must be a dictionary')
    cleaned = {}
    for k, v in raw_perms.items():
        if k not in ALLOWED_PERMISSION_KEYS:
            continue
        bool_val = bool(v)
        if not is_admin_caller:
            if k == 'is_admin' and bool_val:
                abort(403, 'Only administrators can grant admin status.')
            if bool_val and not current_user_perms.get(k):
                abort(403, f"Cannot grant permission '{k}' which you do not possess.")
        cleaned[k] = bool_val
    return cleaned


def sanitize_race_access_dict(raw_race_access, is_admin_caller, current_user_race_access, current_user_perms):
    if not isinstance(raw_race_access, dict):
        abort(400, 'race_access must be a dictionary')
    cleaned = {}
    for race_name, perms in raw_race_access.items():
        safe_rname = sanitize_race_name(race_name)
        if not isinstance(perms, dict):
            continue
        if not is_admin_caller and not current_user_perms.get('can_see_all'):
            if safe_rname not in current_user_race_access:
                abort(403, f"Cannot assign access to race '{safe_rname}' that you cannot access.")
        cleaned[safe_rname] = {
            k: bool(v) for k, v in perms.items() if k in ALLOWED_PERMISSION_KEYS
        }
    return cleaned


# Authentication Endpoints
@auth_ns.route('/login')
class Login(Resource):
    def post(self):
        """Login to the application with brute force protection"""
        ip = get_client_ip()
        if not rate_limiter.is_allowed(f"login_ip:{ip}", max_requests=20, window_seconds=60):
            abort(429, 'Too many login attempts. Please wait a minute.')

        data = get_json_body()
        username = normalize_username(data.get('username'))
        password = data.get('password')

        lockout_key = f"{ip}:{username}"
        if rate_limiter.is_locked_out(lockout_key, max_failures=5, window_seconds=300):
            abort(429, 'Account temporarily locked due to too many failed attempts. Try again in 5 minutes.')

        users = load_users()

        if username in users and verify_password(users[username].get("password"), password):
            rate_limiter.reset_failures(lockout_key)
            session.clear()
            session['logged_in'] = True
            session['user'] = username
            session.permanent = True

            logger.info(f"Login successful for user: {username}")
            return {
                'status': 'success',
                'message': 'Logged in successfully',
                'user': username,
                'permissions': users[username].get("permissions", {}),
                'race_access': users[username].get("race_access", {})
            }, 200

        rate_limiter.record_failure(lockout_key)
        logger.warning(f"Failed login attempt for user: {username} from IP: {ip}")
        return {'status': 'error', 'message': 'Invalid credentials'}, 401


@auth_ns.route('/users')
class UserList(Resource):
    @permission_required('can_manage_users')
    def get(self):
        """List all users (with permissions)"""
        users = load_users()
        result = []
        for username, data in users.items():
            result.append({
                "username": username,
                "permissions": data.get("permissions", {}),
                "race_access": data.get("race_access", {})
            })
        return result, 200

    @permission_required('can_manage_users')
    def post(self):
        """Create or update a user with privilege escalation prevention"""
        data = get_json_body()
        username = normalize_username(data.get('username'))
        password = data.get('password')
        raw_permissions = data.get('permissions', {})
        raw_race_access = data.get('race_access', {})

        current_username, current_user_data = get_current_user()
        current_perms = current_user_data.get('permissions', {})
        current_race_access = current_user_data.get('race_access', {})
        is_admin = bool(current_perms.get('is_admin'))

        # Clean permissions with caller privilege check
        permissions = sanitize_permissions_dict(raw_permissions, is_admin, current_perms)
        race_access = sanitize_race_access_dict(raw_race_access, is_admin, current_race_access, current_perms)

        users = load_users()

        # Manager restrictions
        if not is_admin:
            # Cannot edit existing admin accounts
            if username in users and users[username].get('permissions', {}).get('is_admin'):
                abort(403, 'System administrators cannot be modified by managers.')

            # Cannot edit own account via user management
            if username == current_username:
                abort(403, 'You cannot edit your own user account via user management. Use Profile instead.')

        # Password handling
        if username in users:
            if not password:
                final_password = users[username]["password"]
            else:
                final_password = hash_password(validate_password(password))
        elif not password:
            abort(400, "Password required for new user")
        else:
            final_password = hash_password(validate_password(password))

        users[username] = {
            "password": final_password,
            "permissions": permissions,
            "race_access": race_access
        }
        save_users(users)
        logger.info(f"User '{username}' saved by '{current_username}'")
        return {'status': 'success'}, 200


@auth_ns.route('/users/<string:username>')
class UserDetail(Resource):
    @permission_required('can_manage_users')
    def delete(self, username):
        """Delete a user"""
        username = normalize_username(username)
        users = load_users()
        current_username, current_user_data = get_current_user()
        current_user_is_admin = current_user_data.get('permissions', {}).get('is_admin')

        if username not in users:
            abort(404, "User not found")

        if not current_user_is_admin:
            if users[username].get('permissions', {}).get('is_admin'):
                abort(403, 'System administrators cannot be deleted by managers.')
            if username == current_username:
                abort(403, 'You cannot delete yourself.')

        if len(users) <= 1:
            abort(400, "Cannot delete the last user")

        users.pop(username)
        save_users(users)
        logger.info(f"User '{username}' deleted by '{current_username}'")
        return {'status': 'success'}, 200


@auth_ns.route('/logout')
class Logout(Resource):
    def post(self):
        """Logout from the application"""
        session.clear()
        return {'status': 'success', 'message': 'Logged out successfully'}, 200


@auth_ns.route('/profile')
class UserProfile(Resource):
    @login_required
    def post(self):
        """Allow user to change their own password with verification of current password"""
        ip = get_client_ip()
        if not rate_limiter.is_allowed(f"profile_ip:{ip}", max_requests=10, window_seconds=60):
            abort(429, 'Too many requests. Please wait.')

        username, current_user = get_current_user()
        data = get_json_body()

        current_password = data.get('current_password') or data.get('old_password')
        new_password = validate_password(data.get('password') or data.get('new_password'))

        users = load_users()
        if username not in users:
            session.clear()
            abort(404, "User not found")

        stored_password = users[username].get("password")
        if current_password:
            if not verify_password(stored_password, current_password):
                abort(403, "Current password is incorrect")

        users[username]["password"] = hash_password(new_password)
        save_users(users)
        logger.info(f"Password changed for user: {username}")
        return {'status': 'success', 'message': 'Password updated successfully'}, 200


@auth_ns.route('/status')
class AuthStatus(Resource):
    def get(self):
        """Check authentication status with fresh permissions"""
        username, user_data = get_current_user()
        if username and user_data:
            perms = user_data.get("permissions", {})
            race_access = user_data.get("race_access", {})
            return {
                'logged_in': True,
                'user': username,
                'permissions': perms,
                'race_access': race_access
            }, 200
        return {'logged_in': False}, 200


def get_race_path(race_name):
    safe_name = sanitize_race_name(race_name)
    if not safe_name.endswith('.json'):
        safe_name += '.json'
    return safe_join_under(DATA_DIR, safe_name)


def sanitize_pdf_filename(start_number, name):
    clean_name = "_".join(name.strip().split())
    clean_name = "".join([c for c in clean_name if c.isalnum() or c in ('_', '-')])
    return f"{start_number}_{clean_name}.pdf"


def load_data(race_name):
    path = get_race_path(race_name)
    lock = get_race_lock(race_name)
    with lock:
        if os.path.exists(path):
            with open(path, 'r', encoding='utf-8') as f:
                data = json.load(f)
                if "people" not in data:
                    data["people"] = []
                if "settings" not in data:
                    data["settings"] = {
                        "displaytype": "hidden",
                        "form_config": []
                    }
                return data
        return {
            "people": [],
            "settings": {
                "displaytype": "hidden",
                "form_config": []
            },
        }


def save_data(race_name, data):
    path = get_race_path(race_name)
    lock = get_race_lock(race_name)
    temp_path = f"{path}.tmp.{secrets.token_hex(4)}"
    with lock:
        with open(temp_path, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=4, ensure_ascii=False)
        os.replace(temp_path, path)


person_model = api.model('Person', {
    'id': fields.String(required=True),
    'name': fields.String(required=True),
    'start_number': fields.Integer(required=True),
    'tags': fields.List(fields.String()),
    'start_time': fields.String(),
    'end_time': fields.String(),
    'duration': fields.Float()
})


@ns.route('/list')
class RaceList(Resource):
    @login_required
    def get(self):
        """List all available race files (filtered by permission)"""
        all_files = [f.replace('.json', '') for f in os.listdir(DATA_DIR) if f.endswith('.json')]
        username, user_data = get_current_user()
        perms = user_data.get('permissions', {})
        race_access = user_data.get('race_access', {})

        if perms.get('is_admin') or perms.get('can_see_all'):
            return sorted(all_files, reverse=True)

        visible_races = [r for r in all_files if r in race_access]
        return sorted(visible_races, reverse=True)


@ns.route('/<string:race_name>/people')
class PersonList(Resource):
    @ns.marshal_list_with(person_model)
    @permission_required('can_see_all')
    def get(self, race_name):
        """List all people in a specific race"""
        data = load_data(race_name)
        return data['people']

    @permission_required('can_edit_participants')
    def put(self, race_name):
        """Import or update people in a specific race"""
        people = sanitize_people(request.get_json(silent=True))
        data = load_data(race_name)
        data['people'] = people
        save_data(race_name, data)
        return data['people'], 201


@ns.route('/<string:race_name>/people/append')
class PersonAppend(Resource):
    @ns.marshal_list_with(person_model)
    @permission_required('can_add_participants')
    def post(self, race_name):
        """Append People to a specific race"""
        people = sanitize_people(request.get_json(silent=True))
        data = load_data(race_name)
        data['people'] += people
        save_data(race_name, data)
        return data['people'], 201


@ns.route('/<string:race_name>/settings')
class RaceSettings(Resource):
    @permission_required('can_see_all')
    def get(self, race_name):
        """Get race settings"""
        data = load_data(race_name)
        return data.get('settings', {})

    @permission_required('can_edit_settings')
    def post(self, race_name):
        """Update race settings"""
        settings = sanitize_settings(request.get_json(silent=True))
        data = load_data(race_name)
        data['settings'] = settings
        save_data(race_name, data)
        return data['settings'], 200


@public_ns.route('/info')
class PublicInfo(Resource):
    def get(self):
        """Get public application information (version, etc.)"""
        return {
            'version': get_app_version(),
            'copyright': 'Jan Reiner',
            'self_update_supported': can_self_update(),
            'runtime': 'docker' if is_docker_runtime() else 'host',
        }


@auth_ns.route('/update/apply')
class ApplyUpdate(Resource):
    @admin_required
    def post(self):
        """Apply latest GitHub release on non-Docker installs"""
        try:
            payload = request.get_json(silent=True) or {}
            if not isinstance(payload, dict):
                abort(400, 'Invalid request body')
            frontend_path = payload.get('frontend_path')
            allow_nonstandard_manifest = bool(payload.get('allow_nonstandard_manifest'))

            result = perform_self_update(
                frontend_path=frontend_path,
                allow_nonstandard_manifest=allow_nonstandard_manifest,
            )
            return result, 200
        except subprocess.CalledProcessError as exc:
            stderr = (exc.stderr or '').strip()
            stdout = (exc.stdout or '').strip()
            message = stderr or stdout or str(exc)
            return {'status': 'error', 'message': message}, 500


@auth_ns.route('/update/precheck')
class UpdatePrecheck(Resource):
    @admin_required
    def post(self):
        """Validate frontend update location and manifest before update."""
        try:
            payload = request.get_json(silent=True) or {}
            if not isinstance(payload, dict):
                abort(400, 'Invalid request body')
            frontend_path = payload.get('frontend_path')
            result = run_frontend_precheck(frontend_path)
            return result, 200
        except subprocess.CalledProcessError as exc:
            stderr = (exc.stderr or '').strip()
            stdout = (exc.stdout or '').strip()
            message = stderr or stdout or str(exc)
            return {'status': 'error', 'message': message}, 500


@public_ns.route('/races')
class PublicRaceList(Resource):
    def get(self):
        """List public races for landing page (lite view)"""
        files = [f.replace('.json', '') for f in os.listdir(DATA_DIR) if f.endswith('.json')]
        public_races = []
        for race_name in files:
            data = load_data(race_name)
            settings = data.get('settings', {})
            display_type = settings.get('displaytype', 'hidden')
            if display_type not in ['hidden', 'kiosk']:
                lite_settings = {k: v for k, v in settings.items() if k not in ['form_config', 'key']}
                public_races.append({
                    'name': race_name,
                    'settings': lite_settings
                })
        return sorted(public_races, key=lambda x: x['name'], reverse=True)


@public_ns.route('/race/<string:race_name>')
class PublicRaceDetail(Resource):
    def get(self, race_name):
        """Get details for a specific race publicly (hidden races protected)"""
        data = load_data(race_name)
        settings = data.get('settings', {})
        display_type = settings.get('displaytype', 'hidden')

        if display_type == 'hidden':
            # Require authentication for hidden races
            username, _ = get_current_user()
            if not username:
                abort(404, "Race not found or not publicly accessible")

        if display_type == 'kiosk':
            kiosk_key = request.args.get('key') or request.headers.get('X-Kiosk-Key')
            stored_key = settings.get('key', '')
            if not stored_key or not kiosk_key or not secrets.compare_digest(stored_key, kiosk_key):
                abort(403, "Kiosk key required")

        # Strip sensitive private key from returned payload
        settings_copy = {k: v for k, v in settings.items() if k != 'key'}
        return {
            'people': data.get('people', []),
            'settings': settings_copy
        }


@public_ns.route('/settings/<string:race_name>')
class PublicRaceSettings(Resource):
    def get(self, race_name):
        """Get only settings for a specific race publicly without exposing internal key"""
        data = load_data(race_name)
        settings = data.get('settings', {})
        display_type = settings.get('displaytype', 'hidden')

        if display_type == 'hidden':
            username, _ = get_current_user()
            if not username:
                abort(404, "Race not found or not publicly accessible")

        if display_type == 'kiosk':
            kiosk_key = request.args.get('key') or request.headers.get('X-Kiosk-Key')
            stored_key = settings.get('key', '')
            if not stored_key or not kiosk_key or not secrets.compare_digest(stored_key, kiosk_key):
                abort(403, "Kiosk key required")

        return {k: v for k, v in settings.items() if k != 'key'}


@public_ns.route('/register/<string:race_name>')
class PublicRegister(Resource):
    def post(self, race_name):
        """Register for a race with rate limiting and PDF verification"""
        ip = get_client_ip()
        if not rate_limiter.is_allowed(f"reg_ip:{ip}", max_requests=10, window_seconds=60):
            abort(429, "Too many registrations. Please wait a minute.")

        data = load_data(race_name)
        settings = data.get('settings', {})
        registration_data = get_json_body()

        display_type = settings.get('displaytype', 'hidden')
        if display_type in ['registration_stop', 'finished', 'hidden']:
            abort(403, "Registration is closed or not allowed")

        if display_type == 'kiosk':
            kiosk_key = registration_data.get('key', '')
            stored_key = settings.get('key', '')
            if not stored_key or not secrets.compare_digest(stored_key, kiosk_key):
                abort(403, "No access to this race")

        signed_pdf_base64 = registration_data.get('signed_pdf')

        # Add person to race
        min_num = settings.get('start_num_min', 100)
        max_num = settings.get('start_num_max', 9999)
        used_numbers = {p['start_number'] for p in data['people']}

        start_num = min_num
        while start_num in used_numbers and start_num <= max_num:
            start_num += 1

        if start_num > max_num:
            abort(400, "Keine freien Startnummern mehr in diesem Bereich!")

        name = str(registration_data.get('name', '')).strip()
        if not name:
            abort(400, 'Name is required')
        if len(name) > MAX_JSON_NAME_LENGTH:
            abort(400, 'Name too long')

        new_person = {
            'id': str(start_num),
            'name': name,
            'start_number': start_num,
            'tags': sanitize_tags(registration_data.get('tags', [])),
            'start_time': None,
            'end_time': None,
            'duration': None,
        }

        # Save signed PDF if provided with Magic Bytes verification
        if signed_pdf_base64 and isinstance(signed_pdf_base64, str):
            try:
                if ',' in signed_pdf_base64:
                    signed_pdf_base64 = signed_pdf_base64.split(',')[1]

                pdf_data = base64.b64decode(signed_pdf_base64, validate=True)
                if len(pdf_data) > MAX_PDF_SIZE_BYTES:
                    abort(400, 'Signed PDF is too large')

                # Magic byte validation for valid PDF header (%PDF-)
                if not pdf_data.startswith(b'%PDF-'):
                    abort(400, 'Uploaded file is not a valid PDF document')

                race_signed_dir = safe_join_under(SIGNED_DIR, sanitize_race_name(race_name))
                if not os.path.exists(race_signed_dir):
                    os.makedirs(race_signed_dir, exist_ok=True)

                filename = sanitize_pdf_filename(new_person['start_number'], new_person['name'])
                save_path = safe_join_under(race_signed_dir, filename)
                with open(save_path, 'wb') as f:
                    f.write(pdf_data)
            except HTTPException:
                raise
            except Exception as e:
                logger.error(f"Error saving signed PDF: {e}")
                abort(400, 'Invalid PDF data format')

        data['people'].append(new_person)
        save_data(race_name, data)

        return {'status': 'success', 'start_number': new_person['start_number']}, 201


@public_ns.route('/kiosk/register/<string:race_name>')
class PublicKioskRegister(Resource):
    def post(self, race_name):
        """Use Key to access Kiosk Mode data with constant-time comparison"""
        data = get_json_body()
        sec_key = data.get("SECKEY", "")
        race_data = load_data(race_name)
        settings = race_data.get('settings', {})
        stored_key = settings.get('key', "")

        if not stored_key or not secrets.compare_digest(stored_key, sec_key):
            abort(403, "No access to this race")

        # Return sanitized settings without raw key
        sanitized_data = {
            'people': race_data.get('people', []),
            'settings': {k: v for k, v in settings.items() if k != 'key'}
        }
        return {"Race": sanitized_data}, 200


@public_ns.route('/results/<string:race_name>')
class PublicResults(Resource):
    def get(self, race_name):
        """Get public participant list/results for a race (only when finished)"""
        data = load_data(race_name)
        if data.get('settings', {}).get('displaytype', 'hidden') != 'finished':
            abort(403, "Race results are not published yet")

        return data.get('people', []), 200


@ns.route('/<string:race_name>/full')
class FullData(Resource):
    @permission_required('can_see_all')
    def get(self, race_name):
        """Get full race data as JSON"""
        return load_data(race_name)

    @permission_required('can_edit_settings')
    def put(self, race_name):
        """Upload full race data as JSON"""
        data = get_json_body()
        people = sanitize_people(data.get('people', []))
        settings = sanitize_settings(data.get('settings', {}))
        payload = {'people': people, 'settings': settings}
        save_data(race_name, payload)
        return payload, 201


@ns.route('/<string:race_name>/start/<int:start_number>')
class StartPerson(Resource):
    @permission_required('can_start')
    def post(self, race_name, start_number):
        data = load_data(race_name)
        raw_ts = request.json.get('timestamp') if request.is_json and isinstance(request.json, dict) else None
        if raw_ts:
            timestamp = sanitize_timestamp(raw_ts)
        else:
            timestamp = datetime.datetime.now(datetime.timezone.utc).isoformat()

        found = False
        for person in data['people']:
            if person['start_number'] == start_number:
                person['start_time'] = timestamp
                person['end_time'] = None
                found = True
                break
        if not found:
            abort(404, "Start number not found")
        save_data(race_name, data)
        return {'status': 'started', 'timestamp': timestamp}


@ns.route('/<string:race_name>/stop/<int:start_number>')
class StopPerson(Resource):
    @permission_required('can_stop')
    def post(self, race_name, start_number):
        data = load_data(race_name)
        raw_ts = request.json.get('timestamp') if request.is_json and isinstance(request.json, dict) else None
        if raw_ts:
            timestamp = sanitize_timestamp(raw_ts)
        else:
            timestamp = datetime.datetime.now(datetime.timezone.utc).isoformat()

        found = False
        for person in data['people']:
            if person['start_number'] == start_number:
                if not person.get('start_time'):
                    abort(400, "Participant has not started yet")
                person['end_time'] = timestamp
                found = True
                break
        if not found:
            abort(404, "Start number not found")
        save_data(race_name, data)
        return {'status': 'stopped', 'timestamp': timestamp}


@ns.route('/<string:race_name>/delete')
class DeleteRace(Resource):
    @permission_required('can_edit_settings')
    def delete(self, race_name):
        """Delete a race file"""
        path = get_race_path(race_name)
        lock = get_race_lock(race_name)
        with lock:
            if os.path.exists(path):
                os.remove(path)
                return {'status': 'deleted'}, 200
        abort(404, 'Race not found')


@ns.route('/<string:race_name>/export')
class ExportRace(Resource):
    @permission_required('can_see_all')
    def get(self, race_name):
        """Export race data as CSV"""
        data = load_data(race_name)
        si = io.StringIO()
        cw = csv.writer(si)
        cw.writerow(['Name', 'Startnummer', 'Tags', 'Startzeit', 'Endzeit', 'Dauer (s)'])
        for p in data['people']:
            tags_str = ",".join(p.get('tags', []))
            cw.writerow([p['name'], p['start_number'], tags_str, p.get('start_time') or '', p.get('end_time') or '', p.get('duration') or ''])

        output = io.BytesIO()
        output.write(si.getvalue().encode('utf-8'))
        output.seek(0)
        return send_file(output, mimetype='text/csv', as_attachment=True, download_name=f"{sanitize_race_name(race_name)}_ergebnisse.csv")


@ns.route('/<string:race_name>/pdfs')
class SignedPdfList(Resource):
    @permission_required('can_see_all')
    def get(self, race_name):
        """List all signed PDFs for a race safely"""
        race_signed_dir = safe_join_under(SIGNED_DIR, sanitize_race_name(race_name))
        if not os.path.exists(race_signed_dir):
            return []

        pdfs = []
        for f in os.listdir(race_signed_dir):
            if f.lower().endswith('.pdf'):
                pdfs.append(f)
        return sorted(pdfs)


@ns.route('/<string:race_name>/pdf/<string:filename>')
class DownloadSignedPdf(Resource):
    @permission_required('can_see_all')
    def get(self, race_name, filename):
        """Download a specific signed PDF"""
        try:
            race_signed_dir = safe_join_under(SIGNED_DIR, sanitize_race_name(race_name))
            safe_filename = os.path.basename(filename)
            if safe_filename != filename or not safe_filename.lower().endswith('.pdf'):
                abort(400, 'Invalid PDF filename')
            file_path = safe_join_under(race_signed_dir, safe_filename)

            if not os.path.exists(file_path):
                abort(404, f"PDF file {filename} not found")

            return send_file(file_path, mimetype='application/pdf')
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Error serving PDF: {e}")
            abort(500, 'Internal server error')


@ns.route('/<string:race_name>/genkey')
class RaceGenKey(Resource):
    @permission_required('can_edit_settings')
    def get(self, race_name):
        """Generate or retrieve Kiosk access key for a race"""
        data = load_data(race_name)
        settings = data.get("settings", {})
        key = settings.get("key", "")

        if not key:
            token = secrets.token_urlsafe(24)
            data['settings']['key'] = token
            save_data(race_name, data)
            return {"key": token}, 201

        return {"status": "success", "key": key}, 200


if __name__ == '__main__':
    port = int(os.environ.get('PORT', '5002'))
    debug = env_flag('FLASK_DEBUG', False)
    logger.info(f"Starting Multi-Race Timer server on port {port} (debug={debug})")
    app.run(debug=debug, host='0.0.0.0', port=port)
