import datetime
import json
import os
from functools import wraps
from flask import Flask, request, send_file, session, abort
from flask_restx import Resource, Api, Namespace, fields
import io
import csv
import subprocess
import secrets
import sqlite3
import sys
import urllib.request
import urllib.error
from werkzeug.exceptions import HTTPException
from werkzeug.security import generate_password_hash, check_password_hash

app = Flask(__name__)

DEFAULT_ALLOWED_ORIGINS = {
    'http://localhost',
    'http://127.0.0.1',
    'http://localhost:80',
    'http://127.0.0.1:80',
    'http://localhost:8000',
    'http://127.0.0.1:8000',
}


def env_flag(name, default=False):
    return os.environ.get(name, str(default)).strip().lower() in {'1', 'true', 'yes', 'on'}


def load_allowed_origins():
    raw = os.environ.get('CORS_ALLOWED_ORIGINS', '')
    if not raw.strip():
        return DEFAULT_ALLOWED_ORIGINS
    return {origin.strip() for origin in raw.split(',') if origin.strip()}


def get_secret_key():
    configured = os.environ.get('SECRET_KEY')
    if configured:
        return configured

    generated = secrets.token_hex(32)
    print('WARNING: SECRET_KEY is not set. Using an ephemeral key for this process.')
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

# Global CORS handling for all responses including errors
@app.after_request
def add_cors_headers(response):
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

try:
    version = subprocess.check_output(['git', 'describe', '--tags', '--abbrev=0'], stderr=subprocess.DEVNULL).decode('utf-8').strip()
except Exception:
    version = 'v1.0.0'
api = Api(app, version=version, title='Multi-Race Timer API', description='API for tracking multiple race sessions')

ns = api.namespace('race', description='Race operations')
auth_ns = api.namespace('auth', description='Authentication')



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

for d in [DATA_DIR, SIGNED_DIR, os.path.dirname(USERS_DB)]:
    if not os.path.exists(d):
        os.makedirs(d)


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
        'start_time': person.get('start_time'),
        'end_time': person.get('end_time'),
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
    return settings


def safe_join_under(base_dir, *parts):
    base_dir = os.path.abspath(base_dir)
    candidate = os.path.abspath(os.path.join(base_dir, *parts))
    if os.path.commonpath([base_dir, candidate]) != base_dir:
        abort(400, 'Invalid path')
    return candidate


def is_docker_runtime():
    if env_flag('DISABLE_SELF_UPDATE', False):
        return True
    if os.path.exists('/.dockerenv'):
        return True
    return env_flag('RUNNING_IN_DOCKER', False)


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
        return str(tag).strip() if tag else None


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
    if not latest_tag:
        abort(502, 'Could not fetch latest release information.')

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
                print(f"Migrating users from {LEGACY_USERS_FILE} to SQLite.")
        except Exception as exc:
            print(f"Could not migrate legacy users file: {exc}")

    if not users_to_seed:
        admin_user = os.environ.get('ADMIN_USER', 'admin')
        admin_password = os.environ.get('ADMIN_PASS')
        if not admin_password:
            admin_password = secrets.token_urlsafe(16)
            print('Generated initial admin password because ADMIN_PASS was not set.')
            print(f'Initial admin password: {admin_password}')

        users_to_seed = {
            admin_user: {
                "password": hash_password(admin_password),
                "permissions": default_permissions_for(admin_user),
                "race_access": {},
            }
        }
        print("Creating default admin user: " + admin_user)

    users_normalized = {}
    for username, data in users_to_seed.items():
        user_data = dict(data)
        if "permissions" not in user_data or not isinstance(user_data.get("permissions"), dict):
            user_data["permissions"] = default_permissions_for(username)
        if "race_access" not in user_data or not isinstance(user_data.get("race_access"), dict):
            user_data["race_access"] = {}
        if ensure_password_hashed(user_data):
            pass
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
    except Exception:
        return {}
    finally:
        try:
            conn.close()
        except Exception:
            pass

def save_users(users):
    init_user_store()
    _write_users_to_db(users)

def get_app_version():
    try:
        # Get the latest git tag
        version = api.version
        return version
    except Exception:
        return "v1.0.0"

def login_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if not session.get('logged_in'):
            return {'message': 'Authentication required'}, 401
        return f(*args, **kwargs)
    return decorated_function

def permission_required(perm):
    """
    Decorator to check if the current user has a specific permission.
    If the user has 'is_admin' permission, all checks pass.
    """
    def decorator(f):
        @wraps(f)
        def decorated_function(*args, **kwargs):
            if not session.get('logged_in'):
                return {'message': 'Authentication required'}, 401
            
            permissions = session.get('permissions', {})
            # Admin override
            if permissions.get('is_admin'):
                return f(*args, **kwargs)
            
            # Fresh lookup for race specific access
            username = session.get('user')
            users = load_users()
            user_data = users.get(username, {})
            race_access = user_data.get('race_access', {})
            
            race_name = kwargs.get('race_name')
            # Need race-specific context check
            if race_name:
                # If can_see_all is enabled, user has access to all races
                # Fallback path: race_access -> global default
                if permissions.get('can_see_all'):
                    # Check for explicit override first
                    if race_name in race_access:
                        race_perms = race_access[race_name]
                        if not race_perms.get(perm):
                            return {'message': f"Permission denied for race {race_name} (Override): {perm}"}, 403
                    else:
                        # No override, use global permission
                        if not permissions.get(perm):
                             return {'message': f"Global permission denied for race {race_name}: {perm}"}, 403
                else:
                    # Selective access: must be in race_access
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


def admin_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if not session.get('logged_in'):
            return {'message': 'Authentication required'}, 401
        permissions = session.get('permissions', {})
        if not permissions.get('is_admin'):
            return {'message': 'Admin permission required'}, 403
        return f(*args, **kwargs)
    return decorated_function

# Authentication Endpoints
@auth_ns.route('/login')
class Login(Resource):
    def post(self):
        """Login to the application"""
        data = get_json_body()
        username = normalize_username(data.get('username'))
        password = data.get('password')
        
        users = load_users()
        
        if username in users and verify_password(users[username].get("password"), password):
            session['logged_in'] = True
            session['user'] = username
            session['permissions'] = users[username].get("permissions", {})
            session['race_access'] = users[username].get("race_access", {})
            print("Login successful for user: " + username)

            session.permanent = True  # Make cookie persistent
            return {
                'status': 'success', 
                'message': 'Logged in successfully',
                'user': username,
                'permissions': users[username].get("permissions", {}),
                'race_access': users[username].get("race_access", {})
            }, 200
        
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
        """Create or update a user"""
        data = get_json_body()
        username = normalize_username(data.get('username'))
        password = data.get('password')
        permissions = data.get('permissions', {})
        race_access = data.get('race_access', {})
        
        if not username:
            abort(400, "Username required")
        
        users = load_users()
        current_username = session.get('user')
        current_user_is_admin = session.get('permissions', {}).get('is_admin')

        # MANAGER RESTRICTIONS
        if not current_user_is_admin:
            # 1. Cannot grant is_admin
            if permissions.get('is_admin'):
                return {'message': 'Nur System-Admins können Admin-Rechte vergeben.'}, 403
            
            # 2. Cannot edit existing admin accounts
            if username in users and users[username].get('permissions', {}).get('is_admin'):
                return {'message': 'System-Administratoren können nicht von Managern bearbeitet werden.'}, 403
            
            # 3. Cannot edit self (prevent privilege escalation/self lockout)
            if username == current_username:
                 return {'message': 'Sie können Ihren eigenen User nicht über die Benutzerverwaltung bearbeiten (nutzen Sie "Mein Profil").'}, 403

        # If user exists, optionally keep password if not provided
        if username in users:
            if not password:
                password = users[username]["password"]
            else:
                password = hash_password(validate_password(password))
        elif not password:
             abort(400, "Password required for new user")
        else:
            password = hash_password(validate_password(password))

        users[username] = {
            "password": password,
            "permissions": permissions,
            "race_access": race_access
        }
        save_users(users)
        return {'status': 'success'}, 200

@auth_ns.route('/users/<string:username>')
class UserDetail(Resource):
    @permission_required('can_manage_users')
    def delete(self, username):
        """Delete a user"""
        users = load_users()
        current_username = session.get('user')
        current_user_is_admin = session.get('permissions', {}).get('is_admin')

        if username not in users:
            abort(404, "User not found")
        
        # MANAGER RESTRICTIONS
        if not current_user_is_admin:
             if users[username].get('permissions', {}).get('is_admin'):
                 return {'message': 'System-Administratoren können nicht gelöscht werden.'}, 403
             if username == current_username:
                 return {'message': 'Sie können sich nicht selbst löschen.'}, 403

        if len(users) <= 1:
            abort(400, "Cannot delete the last user")
        
        users.pop(username)
        save_users(users)
        return {'status': 'success'}, 200

@auth_ns.route('/logout')
class Logout(Resource):
    def post(self):
        """Logout from the application"""
        session.clear()
        return {'status': 'success', 'message': 'Logged out successfully'}, 200

@auth_ns.route('/profile')
class UserProfile(Resource):
    def post(self):
        """Allow user to change their own password"""
        if not session.get('logged_in'):
             return {'message': 'Authentication required'}, 401
        
        username = session.get('user')
        data = get_json_body()
        new_password = validate_password(data.get('password'))
        
        if not new_password:
             abort(400, "New password required")
             
        users = load_users()
        if username in users:
            users[username]["password"] = hash_password(new_password)
            save_users(users)
            return {'status': 'success'}, 200
        
        abort(404, "User not found")

@auth_ns.route('/status')
class AuthStatus(Resource):
    def get(self):
        """Check authentication status with fresh permissions"""
        if session.get('logged_in'):
            username = session.get('user')
            users = load_users()
            user_data = users.get(username, {})
            perms = user_data.get("permissions", {})
            race_access = user_data.get("race_access", {})
            
            # Also update session to be sure
            session['permissions'] = perms
            
            return {
                'logged_in': True, 
                'user': username,
                'permissions': perms,
                'race_access': race_access
            }
        return {'logged_in': False}, 200


def get_race_path(race_name):
    # Ensure safe filename
    safe_name = sanitize_race_name(race_name)
    if not safe_name.endswith('.json'):
        safe_name += '.json'
    return os.path.join(DATA_DIR, safe_name)

def sanitize_pdf_filename(start_number, name):
    # Trim and replace multiple spaces with single underscore
    clean_name = "_".join(name.strip().split())
    # Remove any non-alphanumeric (keep underscores and dashes)
    clean_name = "".join([c for c in clean_name if c.isalnum() or c in ('_', '-')])
    return f"{start_number}_{clean_name}.pdf"

def load_data(race_name):
    path = get_race_path(race_name)
    if os.path.exists(path):
        with open(path, 'r') as f:
            data = json.load(f)
            # Ensure modern structure
            if "people" not in data: data["people"] = []
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
    with open(path, 'w') as f:
        json.dump(data, f, indent=4)

person_model = api.model('Person', {
    'id': fields.String(required=True),
    'name': fields.String(required=True),
    'start_number': fields.Integer(required=True),
    'tags': fields.List(fields.String()), # New tags field
    'start_time': fields.String(),
    'end_time': fields.String(),
    'duration': fields.Float()
})

# Apply login_required to all race operations
@ns.route('/list')
class RaceList(Resource):
    @login_required
    def get(self):
        """List all available race files (filtered by permission)"""
        all_files = [f.replace('.json', '') for f in os.listdir(DATA_DIR) if f.endswith('.json')]
        
        username = session.get('user')
        users = load_users()
        user_data = users.get(username, {})
        perms = user_data.get('permissions', {})
        race_access = user_data.get('race_access', {})
        
        # Admins and users with 'can_see_all' see all races
        if perms.get('is_admin') or perms.get('can_see_all'):
            return sorted(all_files, reverse=True)
            
        # Others only see assigned races
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


public_ns = api.namespace('public', description='Public operations')

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
            
            # Lite view: Remove heavy form_config and sensitive key
            lite_settings = {k: v for k, v in settings.items() if k not in ['form_config', 'key']}
            
            display_type = lite_settings.get('displaytype', 'hidden')
            if display_type not in ['hidden', 'kiosk']:
                public_races.append({
                    'name': race_name,
                    'settings': lite_settings
                })
        return sorted(public_races, key=lambda x: x['name'], reverse=True)

@public_ns.route('/race/<string:race_name>')
class PublicRaceDetail(Resource):
    def get(self, race_name):
        """Get full details for a specific race publicly"""
        data = load_data(race_name)
        settings = data.get('settings', {})
        # Remove private key if any
        if 'key' in settings:
            settings_copy = settings.copy()
            settings_copy.pop('key')
            data['settings'] = settings_copy
            
        return data

@public_ns.route('/settings/<string:race_name>')
class PublicRaceSettings(Resource):
    def get(self, race_name):
        """Get only settings for a specific race publicly (includes form_config)"""
        data = load_data(race_name)
        settings = data.get('settings', {})
        if 'key' in settings:
            settings.pop('key')
        return settings

@public_ns.route('/register/<string:race_name>')
class PublicRegister(Resource):
    def post(self, race_name):
        """Register for a race"""
        data = load_data(race_name)
        settings = data.get('settings', {})
        registration_data = get_json_body()
        
        if settings.get('displaytype', 'hidden') == 'registration_stop' or settings.get('displaytype', 'hidden') == 'finished':
            abort(403, "Registration is closed or not allowed")

        if settings.get('displaytype', 'hidden') == 'kiosk' and settings.get('key', '') != registration_data.get('key'):
            abort(403, "No access to this race")
            
        signed_pdf_base64 = registration_data.get('signed_pdf') # Base64 of final PDF
        
        # Add person to race
        min_num = settings.get('start_num_min', 100)
        max_num = settings.get('start_num_max', 9999)
        
        used_numbers = [p['start_number'] for p in data['people']]
        
        # Find first available number in range
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

        data['people'].append(new_person)
        save_data(race_name, data)
        
        # Save signed PDF if provided
        if signed_pdf_base64:
            import base64
            try:
                # Remove header if present
                if ',' in signed_pdf_base64:
                    signed_pdf_base64 = signed_pdf_base64.split(',')[1]
                
                pdf_data = base64.b64decode(signed_pdf_base64)
                if len(pdf_data) > MAX_PDF_SIZE_BYTES:
                    abort(400, 'Signed PDF is too large')
                
                # Race-specific subdirectory
                race_signed_dir = safe_join_under(SIGNED_DIR, sanitize_race_name(race_name))
                if not os.path.exists(race_signed_dir):
                    os.makedirs(race_signed_dir)
                    
                filename = sanitize_pdf_filename(new_person['start_number'], new_person['name'])
                save_path = os.path.join(race_signed_dir, filename)
                with open(save_path, 'wb') as f:
                    f.write(pdf_data)
            except HTTPException:
                raise
            except Exception as e:
                print(f"Error saving signed PDF: {e}")
                
        return {'status': 'success', 'start_number': new_person['start_number']}, 201

@public_ns.route('/kiosk/register/<string:race_name>')
class PublicParticipants(Resource):
    def post(self, race_name):
        """Use Key acsses Kiosk Mode"""
        data = get_json_body()
        SECKEY = data.get("SECKEY", "")
        data = load_data(race_name)
        settings = data.get('settings', {})
        key = settings.get('key', "") 

        if key != SECKEY:
            abort(403, "No access to this race")
        
        return {"Race" : load_data(race_name)}


@public_ns.route('/results/<string:race_name>')
class PublicParticipants(Resource):
    def get(self, race_name):
        """Get public participant list/results for a race"""
        data = load_data(race_name)
        # Return only people, sanitized if necessary (though current person object is public-friendly)
        if data.get('settings', {}).get('displaytype', 'hidden') != 'finished':
            abort(403, "Race is not closed")
        
        return data.get('people', [])

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
        # Use client timestamp if provided, else server time
        timestamp = request.json.get('timestamp') if request.is_json else None
        if not timestamp:
            timestamp = datetime.datetime.now().isoformat()
            
        found = False
        for person in data['people']:
            if person['start_number'] == start_number:
                person['start_time'] = timestamp
                person['end_time'] = None
                found = True
                break
        if not found: abort(404, "Start number not found")
        save_data(race_name, data)
        return {'status': 'started', 'timestamp': timestamp}

@ns.route('/<string:race_name>/stop/<int:start_number>')
class StopPerson(Resource):
    @permission_required('can_stop')
    def post(self, race_name, start_number):
        data = load_data(race_name)
        # Use client timestamp if provided, else server time
        timestamp = request.json.get('timestamp') if request.is_json else None
        if not timestamp:
            timestamp = datetime.datetime.now().isoformat()
            
        found = False
        for person in data['people']:
            if person['start_number'] == start_number:
                if 'start_time' not in person or not person['start_time']:
                    abort(400, "Not started")
                person['end_time'] = timestamp
                #start_dt = datetime.datetime.fromisoformat(person['start_time'])
                #end_dt = datetime.datetime.fromisoformat(timestamp)
                #person['duration'] = (end_dt - start_dt).total_seconds()
                found = True
                break
        if not found: abort(404, "Start number not found")
        save_data(race_name, data)
        return {'status': 'stopped', 'timestamp': timestamp}

@ns.route('/<string:race_name>/delete')
class DeleteRace(Resource):
    @permission_required('can_edit_settings')
    def delete(self, race_name):
        """Delete a race file"""
        path = get_race_path(race_name)
        if os.path.exists(path):
            os.remove(path)
            return {'status': 'deleted'}
        abort(404)

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
            cw.writerow([p['name'], p['start_number'], tags_str, p['start_time'] or '', p['end_time'] or '', p['duration'] or ''])
        
        output = io.BytesIO()
        output.write(si.getvalue().encode('utf-8'))
        output.seek(0)
        return send_file(output, mimetype='text/csv', as_attachment=True, download_name=f"{race_name}_ergebnisse.csv")

@ns.route('/<string:race_name>/pdfs')
class SignedPdfList(Resource):
    @permission_required('can_see_all')
    def get(self, race_name):
        """List all signed PDFs for a race"""
        race_signed_dir = os.path.join(SIGNED_DIR, race_name)
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
                print(f"PDF not found: {file_path}")
                return abort(404, f"PDF file {filename} not found")
            
            return send_file(file_path, mimetype='application/pdf')
            
        except Exception as e:
            print(f"Error serving PDF: {e}")
            return abort(500, str(e))
        

@ns.route('/<string:race_name>/genkey')
class FullData(Resource):

    @permission_required('can_edit_settings')
    def get(self, race_name):
        """Upload full race data as JSON"""
        
        data = load_data(race_name)
        settings = data.get("settings", {})
        key = settings.get("key", "")

        if key == "":
            token = secrets.token_urlsafe()
            data['settings']['key'] = token
            save_data(race_name, data)
            return {"key" : token}, 201 

        return {"status": "success", "key" : key}, 200
    

if __name__ == '__main__':
    app.run(debug=env_flag('FLASK_DEBUG', False), host='0.0.0.0', port=int(os.environ.get('PORT', '5002')))
