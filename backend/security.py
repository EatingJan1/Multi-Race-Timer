"""
security.py – Rate Limiter, CORS-Header, Decorators.
"""
import threading
import time
from collections import defaultdict, deque
from functools import wraps

from flask import abort, request, session

from config import ALLOWED_ORIGINS, logger


# ---------------------------------------------------------------------------
# Client IP
# ---------------------------------------------------------------------------

def get_client_ip():
    if request.headers.get('X-Forwarded-For'):
        return request.headers['X-Forwarded-For'].split(',')[0].strip()
    return request.remote_addr or 'unknown'


# ---------------------------------------------------------------------------
# CORS / Security Headers
# ---------------------------------------------------------------------------

def is_allowed_origin(origin):
    if not origin:
        return False
    return origin in ALLOWED_ORIGINS


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


# ---------------------------------------------------------------------------
# Rate Limiter
# ---------------------------------------------------------------------------

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


# ---------------------------------------------------------------------------
# Auth Decorators
# ---------------------------------------------------------------------------

def _get_current_user_impl():
    """Internal – avoids circular imports by importing db.users lazily."""
    if not session.get('logged_in'):
        return None, None
    username = session.get('user')
    if not username:
        session.clear()
        return None, None
    from db.users import load_users
    users = load_users()
    if username not in users:
        session.clear()
        return None, None
    return username, users[username]


def get_current_user():
    return _get_current_user_impl()


def login_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        username, _ = get_current_user()
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
    Decorator: checks specific permission.
    Admins always pass; race-contextual perms checked per race_name kwarg.
    """
    def decorator(f):
        @wraps(f)
        def decorated_function(*args, **kwargs):
            from sanitize import sanitize_race_name
            username, user_data = get_current_user()
            if not username:
                return {'message': 'Authentication required'}, 401

            permissions = user_data.get('permissions', {})
            if permissions.get('is_admin'):
                return f(*args, **kwargs)

            race_access = user_data.get('race_access', {})
            race_name = kwargs.get('race_name')

            if race_name:
                safe_rname = sanitize_race_name(race_name)
                if permissions.get('can_see_all'):
                    if safe_rname in race_access:
                        race_perms = race_access[safe_rname]
                        if not race_perms.get(perm):
                            return {'message': f"Permission denied for race {safe_rname} (Override): {perm}"}, 403
                    else:
                        if not permissions.get(perm):
                            return {'message': f"Global permission denied for race {safe_rname}: {perm}"}, 403
                else:
                    if safe_rname not in race_access:
                        return {'message': f"No access to race: {safe_rname}"}, 403
                    race_perms = race_access[safe_rname]
                    if not race_perms.get(perm):
                        return {'message': f"Permission denied for race {safe_rname}: {perm}"}, 403
            else:
                if not permissions.get(perm):
                    return {'message': f"Global permission denied: {perm}"}, 403

            return f(*args, **kwargs)
        return decorated_function
    return decorator
