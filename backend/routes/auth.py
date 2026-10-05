"""
routes/auth.py – Authentication and User-Management endpoints (/auth/*).
"""
import subprocess
from typing import Any

from fastapi import APIRouter, Body, Depends, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from config import abort, logger, perform_self_update, run_frontend_precheck
from db.users import (
    hash_password,
    load_users,
    normalize_username,
    save_users,
    validate_password,
    verify_password,
)
from sanitize import sanitize_permissions_dict, sanitize_race_access_dict
from security import (
    CurrentUser,
    admin_required,
    get_client_ip,
    login_required,
    optional_user,
    permission_required,
    rate_limiter,
)

router = APIRouter(prefix='/auth', tags=['auth'])


# ---------------------------------------------------------------------------
# Request models
# ---------------------------------------------------------------------------

class LoginIn(BaseModel):
    username: str | None = None
    password: str | None = None


class ProfileIn(BaseModel):
    current_password: str | None = None
    old_password: str | None = None
    password: str | None = None
    new_password: str | None = None


class UserUpsertIn(BaseModel):
    username: str | None = None
    password: str | None = None
    permissions: dict[str, Any] = Field(default_factory=dict)
    race_access: dict[str, Any] = Field(default_factory=dict)


class UpdatePayload(BaseModel):
    frontend_path: str | None = None
    allow_nonstandard_manifest: bool = False


def _process_error_response(exc: subprocess.CalledProcessError) -> JSONResponse:
    message = (exc.stderr or '').strip() or (exc.stdout or '').strip() or str(exc)
    return JSONResponse({'status': 'error', 'message': message}, status_code=500)


# ---------------------------------------------------------------------------
# Login / Logout / Status / Profile
# ---------------------------------------------------------------------------

@router.post('/login')
def login(payload: LoginIn, request: Request):
    """Login to the application with brute force protection"""
    ip = get_client_ip(request)
    if not rate_limiter.is_allowed(f"login_ip:{ip}", max_requests=20, window_seconds=60):
        abort(429, 'Too many login attempts. Please wait a minute.')

    username = normalize_username(payload.username)
    password = payload.password

    lockout_key = f"{ip}:{username}"
    if rate_limiter.is_locked_out(lockout_key, max_failures=5, window_seconds=300):
        abort(429, 'Account temporarily locked due to too many failed attempts. Try again in 5 minutes.')

    users = load_users()

    if username in users and verify_password(users[username].get("password"), password):
        rate_limiter.reset_failures(lockout_key)
        request.session.clear()
        request.session['logged_in'] = True
        request.session['user'] = username

        logger.info(f"Login successful for user: {username}")
        return {
            'status': 'success',
            'message': 'Logged in successfully',
            'user': username,
            'permissions': users[username].get("permissions", {}),
            'race_access': users[username].get("race_access", {}),
        }

    rate_limiter.record_failure(lockout_key)
    logger.warning(f"Failed login attempt for user: {username} from IP: {ip}")
    return JSONResponse({'status': 'error', 'message': 'Invalid credentials'}, status_code=401)


@router.post('/logout')
def logout(request: Request):
    """Logout from the application"""
    request.session.clear()
    return {'status': 'success', 'message': 'Logged out successfully'}


@router.get('/status')
def auth_status(user: CurrentUser | None = Depends(optional_user)):
    """Check authentication status with fresh permissions"""
    if user:
        return {
            'logged_in': True,
            'user': user.username,
            'permissions': user.permissions,
            'race_access': user.race_access,
        }
    return {'logged_in': False}


@router.post('/profile')
def change_password(payload: ProfileIn, request: Request, user: CurrentUser = Depends(login_required)):
    """Allow user to change their own password"""
    ip = get_client_ip(request)
    if not rate_limiter.is_allowed(f"profile_ip:{ip}", max_requests=10, window_seconds=60):
        abort(429, 'Too many requests. Please wait.')

    current_password = payload.current_password or payload.old_password
    new_password = validate_password(payload.password or payload.new_password)

    users = load_users()
    if user.username not in users:
        request.session.clear()
        abort(404, "User not found")

    stored_password = users[user.username].get("password")
    # TODO(security): Das aktuelle Passwort ist optional (Verhalten aus der Flask-Version
    # übernommen). Empfehlung: immer verlangen.
    if current_password:
        if not verify_password(stored_password, current_password):
            abort(403, "Current password is incorrect")

    users[user.username]["password"] = hash_password(new_password)
    save_users(users)
    logger.info(f"Password changed for user: {user.username}")
    return {'status': 'success', 'message': 'Password updated successfully'}


# ---------------------------------------------------------------------------
# User Management
# ---------------------------------------------------------------------------

@router.get('/users')
def list_users(user: CurrentUser = Depends(permission_required('can_manage_users'))):
    """List all users (with permissions)"""
    return [
        {
            "username": username,
            "permissions": data.get("permissions", {}),
            "race_access": data.get("race_access", {}),
        }
        for username, data in load_users().items()
    ]


@router.post('/users')
def save_user(payload: UserUpsertIn, user: CurrentUser = Depends(permission_required('can_manage_users'))):
    """Create or update a user"""
    username = normalize_username(payload.username)
    password = payload.password

    is_admin = user.is_admin
    permissions = sanitize_permissions_dict(payload.permissions, is_admin, user.permissions)
    race_access = sanitize_race_access_dict(payload.race_access, is_admin, user.race_access, user.permissions)

    users = load_users()

    if not is_admin:
        if username in users and users[username].get('permissions', {}).get('is_admin'):
            abort(403, 'System administrators cannot be modified by managers.')
        if username == user.username:
            abort(403, 'You cannot edit your own user account via user management. Use Profile instead.')

    if username in users:
        final_password = users[username]["password"] if not password else hash_password(validate_password(password))
    elif not password:
        abort(400, "Password required for new user")
    else:
        final_password = hash_password(validate_password(password))

    users[username] = {
        "password": final_password,
        "permissions": permissions,
        "race_access": race_access,
    }
    save_users(users)
    logger.info(f"User '{username}' saved by '{user.username}'")
    return {'status': 'success'}


@router.delete('/users/{username}')
def delete_user(username: str, user: CurrentUser = Depends(permission_required('can_manage_users'))):
    """Delete a user"""
    username = normalize_username(username)
    users = load_users()

    if username not in users:
        abort(404, "User not found")

    if not user.is_admin:
        if users[username].get('permissions', {}).get('is_admin'):
            abort(403, 'System administrators cannot be deleted by managers.')
        if username == user.username:
            abort(403, 'You cannot delete yourself.')

    if len(users) <= 1:
        abort(400, "Cannot delete the last user")

    users.pop(username)
    save_users(users)
    logger.info(f"User '{username}' deleted by '{user.username}'")
    return {'status': 'success'}


# ---------------------------------------------------------------------------
# Self-Update
# ---------------------------------------------------------------------------

@router.post('/update/precheck')
def update_precheck(payload: UpdatePayload | None = Body(default=None), user: CurrentUser = Depends(admin_required)):
    """Validate frontend update location and manifest before update."""
    payload = payload or UpdatePayload()
    try:
        return run_frontend_precheck(payload.frontend_path)
    except subprocess.CalledProcessError as exc:
        return _process_error_response(exc)


@router.post('/update/apply')
def update_apply(
    request: Request,
    payload: UpdatePayload | None = Body(default=None),
    user: CurrentUser = Depends(admin_required),
):
    """Apply latest GitHub release on non-Docker installs"""
    payload = payload or UpdatePayload()
    try:
        return perform_self_update(
            api_version=request.app.version or 'v1.0.0',
            frontend_path=payload.frontend_path,
            allow_nonstandard_manifest=payload.allow_nonstandard_manifest,
        )
    except subprocess.CalledProcessError as exc:
        return _process_error_response(exc)
