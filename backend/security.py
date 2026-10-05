"""
security.py – Auth-Dependencies, Rate-Limiter und Middlewares (FastAPI-Version).

HINWEIS: Diese Datei wurde aus dem Verhalten der alten Flask-Decorators
(login_required / admin_required / permission_required) nachgebaut, weil die
originale security.py nicht vorlag. Bitte die Rechte-Logik in
`permission_required` mit deiner Version abgleichen.
"""
import secrets
import threading
import time
from collections import defaultdict, deque
from dataclasses import dataclass

from fastapi import Depends, Request
from fastapi.responses import JSONResponse
from starlette.datastructures import MutableHeaders
from starlette.exceptions import HTTPException as StarletteHTTPException

from config import TRUST_PROXY_HEADERS, abort
from db.users import load_users


# ---------------------------------------------------------------------------
# Hilfsfunktionen
# ---------------------------------------------------------------------------

def constant_time_equals(a, b):
    """Zeitkonstanter String-Vergleich, der auch mit Nicht-ASCII-Zeichen funktioniert."""
    if not isinstance(a, str) or not isinstance(b, str):
        return False
    return secrets.compare_digest(a.encode('utf-8'), b.encode('utf-8'))


def get_client_ip(request: Request) -> str:
    """
    Client-IP. X-Forwarded-For wird nur beachtet, wenn TRUST_PROXY_HEADERS=true
    (genau ein vertrauenswürdiger Proxy davor). Dann zählt der LETZTE Eintrag,
    also der, den unser Proxy angehängt hat – vorherige Einträge sind fälschbar.
    """
    if TRUST_PROXY_HEADERS:
        forwarded = request.headers.get('x-forwarded-for')
        if forwarded:
            last = forwarded.split(',')[-1].strip()
            if last:
                return last
    return request.client.host if request.client else 'unknown'


# ---------------------------------------------------------------------------
# Rate Limiter (in-memory, pro Prozess)
# ---------------------------------------------------------------------------

class RateLimiter:
    _RETENTION_SECONDS = 3600
    _GC_EVERY = 500

    def __init__(self):
        self._lock = threading.Lock()
        self._hits = defaultdict(deque)
        self._failures = defaultdict(deque)
        self._calls = 0

    def _gc(self, now):
        cutoff = now - self._RETENTION_SECONDS
        for store in (self._hits, self._failures):
            for key in [k for k, q in store.items() if not q or q[-1] <= cutoff]:
                del store[key]

    def is_allowed(self, key, max_requests, window_seconds):
        now = time.monotonic()
        with self._lock:
            self._calls += 1
            if self._calls % self._GC_EVERY == 0:
                self._gc(now)
            q = self._hits[key]
            cutoff = now - window_seconds
            while q and q[0] <= cutoff:
                q.popleft()
            if len(q) >= max_requests:
                return False
            q.append(now)
            return True

    def record_failure(self, key):
        with self._lock:
            self._failures[key].append(time.monotonic())

    def is_locked_out(self, key, max_failures, window_seconds):
        now = time.monotonic()
        with self._lock:
            q = self._failures.get(key)
            if not q:
                return False
            cutoff = now - window_seconds
            while q and q[0] <= cutoff:
                q.popleft()
            return len(q) >= max_failures

    def reset_failures(self, key):
        with self._lock:
            self._failures.pop(key, None)


rate_limiter = RateLimiter()


# ---------------------------------------------------------------------------
# Aktueller Benutzer + Rechte-Dependencies
# ---------------------------------------------------------------------------

@dataclass
class CurrentUser:
    username: str
    data: dict

    @property
    def permissions(self) -> dict:
        return self.data.get('permissions', {}) or {}

    @property
    def race_access(self) -> dict:
        return self.data.get('race_access', {}) or {}

    @property
    def is_admin(self) -> bool:
        return bool(self.permissions.get('is_admin'))


def optional_user(request: Request):
    """Frischer Lookup des eingeloggten Benutzers (None, wenn nicht eingeloggt)."""
    if not request.session.get('logged_in'):
        return None
    username = request.session.get('user')
    if not username:
        return None
    user_data = load_users().get(username)
    if not user_data:
        # Benutzer wurde gelöscht -> Session ungültig machen
        request.session.clear()
        return None
    return CurrentUser(username=username, data=user_data)


def login_required(request: Request) -> CurrentUser:
    user = optional_user(request)
    if user is None:
        abort(401, 'Authentication required')
    return user


def admin_required(user: CurrentUser = Depends(login_required)) -> CurrentUser:
    if not user.is_admin:
        abort(403, 'Admin permission required')
    return user


def permission_required(perm: str):
    """
    Dependency-Factory. Admins dürfen alles. Mit `race_name` im Pfad wird
    rennspezifisch geprüft (race_access), sonst global.
    """
    def dependency(request: Request, user: CurrentUser = Depends(login_required)) -> CurrentUser:
        if user.is_admin:
            return user

        permissions = user.permissions
        race_access = user.race_access
        race_name = request.path_params.get('race_name')

        if race_name:
            if permissions.get('can_see_all'):
                if race_name in race_access:
                    if not race_access[race_name].get(perm):
                        abort(403, f"Permission denied for race {race_name} (Override): {perm}")
                elif not permissions.get(perm):
                    abort(403, f"Global permission denied for race {race_name}: {perm}")
            else:
                if race_name not in race_access:
                    abort(403, f"No access to race: {race_name}")
                if not race_access[race_name].get(perm):
                    abort(403, f"Permission denied for race {race_name}: {perm}")
        elif not permissions.get(perm):
            abort(403, f"Global permission denied: {perm}")

        return user

    return dependency


# ---------------------------------------------------------------------------
# Middlewares (reine ASGI-Middlewares)
# ---------------------------------------------------------------------------

class SecurityHeadersMiddleware:
    HEADERS = {
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'Referrer-Policy': 'strict-origin-when-cross-origin',
        'Cross-Origin-Opener-Policy': 'same-origin',
    }

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http':
            await self.app(scope, receive, send)
            return

        async def send_with_headers(message):
            if message['type'] == 'http.response.start':
                headers = MutableHeaders(scope=message)
                for name, value in self.HEADERS.items():
                    headers[name] = value
            await send(message)

        await self.app(scope, receive, send_with_headers)


class _BodyTooLarge(StarletteHTTPException):
    def __init__(self):
        super().__init__(status_code=413, detail='Request body too large')


class BodySizeLimitMiddleware:
    """Ersatz für Flasks MAX_CONTENT_LENGTH (prüft Content-Length und gestreamte Bodies)."""

    def __init__(self, app, max_bytes: int):
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http':
            await self.app(scope, receive, send)
            return

        content_length = dict(scope['headers']).get(b'content-length')
        if content_length is not None:
            try:
                too_large = int(content_length) > self.max_bytes
            except ValueError:
                response = JSONResponse({'message': 'Invalid Content-Length'}, status_code=400)
                await response(scope, receive, send)
                return
            if too_large:
                response = JSONResponse({'message': 'Request body too large'}, status_code=413)
                await response(scope, receive, send)
                return

        received = 0

        async def limited_receive():
            nonlocal received
            message = await receive()
            if message['type'] == 'http.request':
                received += len(message.get('body', b''))
                if received > self.max_bytes:
                    raise _BodyTooLarge()
            return message

        await self.app(scope, limited_receive, send)
