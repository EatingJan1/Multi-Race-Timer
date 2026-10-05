"""
routes/auth.py – Authentication and User-Management endpoints.
"""
import os

from flask import abort, session
from flask_restx import Namespace, Resource

from config import logger
from db.users import (
    default_permissions_for,
    hash_password,
    load_users,
    normalize_username,
    save_users,
    validate_password,
    verify_password,
)
from sanitize import sanitize_permissions_dict, sanitize_race_access_dict, get_json_body
from security import (
    admin_required,
    get_client_ip,
    get_current_user,
    login_required,
    permission_required,
    rate_limiter,
)
from config import perform_self_update, run_frontend_precheck

import subprocess

auth_ns = Namespace('auth', description='Authentication')


# ---------------------------------------------------------------------------
# Login / Logout / Status / Profile
# ---------------------------------------------------------------------------

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
                'race_access': users[username].get("race_access", {}),
            }, 200

        rate_limiter.record_failure(lockout_key)
        logger.warning(f"Failed login attempt for user: {username} from IP: {ip}")
        return {'status': 'error', 'message': 'Invalid credentials'}, 401


@auth_ns.route('/logout')
class Logout(Resource):
    def post(self):
        """Logout from the application"""
        session.clear()
        return {'status': 'success', 'message': 'Logged out successfully'}, 200


@auth_ns.route('/status')
class AuthStatus(Resource):
    def get(self):
        """Check authentication status with fresh permissions"""
        username, user_data = get_current_user()
        if username and user_data:
            return {
                'logged_in': True,
                'user': username,
                'permissions': user_data.get("permissions", {}),
                'race_access': user_data.get("race_access", {}),
            }, 200
        return {'logged_in': False}, 200


@auth_ns.route('/profile')
class UserProfile(Resource):
    @login_required
    def post(self):
        """Allow user to change their own password"""
        ip = get_client_ip()
        if not rate_limiter.is_allowed(f"profile_ip:{ip}", max_requests=10, window_seconds=60):
            abort(429, 'Too many requests. Please wait.')

        username, _ = get_current_user()
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


# ---------------------------------------------------------------------------
# User Management
# ---------------------------------------------------------------------------

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
                "race_access": data.get("race_access", {}),
            })
        return result, 200

    @permission_required('can_manage_users')
    def post(self):
        """Create or update a user"""
        data = get_json_body()
        username = normalize_username(data.get('username'))
        password = data.get('password')
        raw_permissions = data.get('permissions', {})
        raw_race_access = data.get('race_access', {})

        current_username, current_user_data = get_current_user()
        current_perms = current_user_data.get('permissions', {})
        current_race_access = current_user_data.get('race_access', {})
        is_admin = bool(current_perms.get('is_admin'))

        permissions = sanitize_permissions_dict(raw_permissions, is_admin, current_perms)
        race_access = sanitize_race_access_dict(raw_race_access, is_admin, current_race_access, current_perms)

        users = load_users()

        if not is_admin:
            if username in users and users[username].get('permissions', {}).get('is_admin'):
                abort(403, 'System administrators cannot be modified by managers.')
            if username == current_username:
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


# ---------------------------------------------------------------------------
# Self-Update
# ---------------------------------------------------------------------------

@auth_ns.route('/update/precheck')
class UpdatePrecheck(Resource):
    @admin_required
    def post(self):
        """Validate frontend update location and manifest before update."""
        try:
            payload = __import__('flask').request.get_json(silent=True) or {}
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


@auth_ns.route('/update/apply')
class ApplyUpdate(Resource):
    @admin_required
    def post(self):
        """Apply latest GitHub release on non-Docker installs"""
        try:
            payload = __import__('flask').request.get_json(silent=True) or {}
            if not isinstance(payload, dict):
                abort(400, 'Invalid request body')
            frontend_path = payload.get('frontend_path')
            allow_nonstandard_manifest = bool(payload.get('allow_nonstandard_manifest'))

            # Get API version for fallback tag
            from flask_restx import Api as _Api
            from flask import current_app
            try:
                api_version = current_app.extensions.get('restx', {}).get('api', {}).version or 'v1.0.0'
            except Exception:
                api_version = 'v1.0.0'

            result = perform_self_update(
                api_version=api_version,
                frontend_path=frontend_path,
                allow_nonstandard_manifest=allow_nonstandard_manifest,
            )
            return result, 200
        except subprocess.CalledProcessError as exc:
            stderr = (exc.stderr or '').strip()
            stdout = (exc.stdout or '').strip()
            message = stderr or stdout or str(exc)
            return {'status': 'error', 'message': message}, 500
