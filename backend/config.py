"""
config.py – Zentrale Konfiguration und Flask-App-Initialisierung.
"""
import datetime
import logging
import os
import re
import secrets
import subprocess
import sys
import urllib.error
import urllib.request
from functools import wraps

from flask import Flask, abort
from flask_restx import Api

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(name)s: %(message)s',
)
logger = logging.getLogger('zeit_backend')

# ---------------------------------------------------------------------------
# Env helpers
# ---------------------------------------------------------------------------

def env_flag(name, default=False):
    return os.environ.get(name, str(default)).strip().lower() in {'1', 'true', 'yes', 'on'}


def is_docker_runtime():
    if env_flag('DISABLE_SELF_UPDATE', False):
        return True
    if os.path.exists('/.dockerenv'):
        return True
    return env_flag('RUNNING_IN_DOCKER', False)


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


# ---------------------------------------------------------------------------
# Flask App
# ---------------------------------------------------------------------------

app = Flask(__name__)

ALLOWED_ORIGINS = load_allowed_origins()
app.secret_key = get_secret_key()
app.config['MAX_CONTENT_LENGTH'] = int(os.environ.get('MAX_CONTENT_LENGTH', 12 * 1024 * 1024))
app.config['SESSION_COOKIE_HTTPONLY'] = True
app.config['SESSION_COOKIE_SAMESITE'] = os.environ.get('SESSION_COOKIE_SAMESITE', 'Lax')
app.config['SESSION_COOKIE_SECURE'] = env_flag('SESSION_COOKIE_SECURE', False)
app.config['PERMANENT_SESSION_LIFETIME'] = datetime.timedelta(
    hours=int(os.environ.get('SESSION_TTL_HOURS', '12'))
)

# ---------------------------------------------------------------------------
# Path & limit constants
# ---------------------------------------------------------------------------

DATA_DIR = 'data'
SIGNED_DIR = os.path.join(DATA_DIR, 'signed')
TEMPLATES_DIR = os.path.join(DATA_DIR, 'templates')
USERS_DB = 'var/users.db'
RACES_DB = 'var/races.db'
LEGACY_USERS_FILE = 'var/users.json'
MIN_PASSWORD_LENGTH = 8
MAX_JSON_NAME_LENGTH = 120
MAX_TAGS_PER_PERSON = 20
MAX_TAG_LENGTH = 40
MAX_PDF_SIZE_BYTES = int(os.environ.get('MAX_PDF_SIZE_BYTES', 5 * 1024 * 1024))
REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
BACKEND_REQUIREMENTS_PATH = os.path.join(REPO_ROOT, 'backend', 'requirements.txt')
FRONTEND_PRECHECK_SCRIPT = os.path.join(REPO_ROOT, 'backend', 'update_frontend_check.py')

ALLOWED_PERMISSION_KEYS = {
    'is_admin', 'can_start', 'can_stop', 'can_edit_form', 'can_edit_stats',
    'can_edit_participants', 'can_add_participants', 'can_edit_settings',
    'can_manage_users', 'can_see_all', 'hide_ranking', 'hide_duration',
}

# Ensure required directories exist
for _d in [DATA_DIR, SIGNED_DIR, TEMPLATES_DIR, os.path.dirname(USERS_DB), os.path.dirname(RACES_DB)]:
    if not os.path.exists(_d):
        os.makedirs(_d, exist_ok=True)


# ---------------------------------------------------------------------------
# Helpers: self-update & versioning
# ---------------------------------------------------------------------------

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
    import json
    proc = subprocess.run(cmd, capture_output=True, text=True, check=True)
    payload = json.loads(proc.stdout.strip() or '{}')
    if not isinstance(payload, dict):
        abort(500, 'Invalid frontend precheck response.')
    return payload


def get_latest_release_tag():
    url = 'https://api.github.com/repos/EatingJan1/Multi-Race-Timer/releases/latest'
    req = urllib.request.Request(url, headers={'Accept': 'application/vnd.github+json'})
    with urllib.request.urlopen(req, timeout=8) as response:
        import json
        payload = json.loads(response.read().decode('utf-8'))
        tag = payload.get('tag_name') or payload.get('name')
        if tag and re.match(r'^v?\d+\.\d+\.\d+(-[a-zA-Z0-9.]+)?$', str(tag).strip()):
            return str(tag).strip()
        return None


def get_current_git_tag(api_version_fallback='v1.0.0'):
    try:
        exact = run_repo_cmd(['git', 'describe', '--tags', '--exact-match'])
        return exact.stdout.strip()
    except Exception:
        try:
            nearest = run_repo_cmd(['git', 'describe', '--tags', '--abbrev=0'])
            return nearest.stdout.strip()
        except Exception:
            return api_version_fallback


def ensure_clean_worktree():
    status = run_repo_cmd(['git', 'status', '--porcelain'])
    if status.stdout.strip():
        abort(409, 'Working tree has uncommitted changes. Commit/stash first.')


def perform_self_update(api_version, frontend_path=None, allow_nonstandard_manifest=False):
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

    current_tag = get_current_git_tag(api_version)
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
