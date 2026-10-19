"""
db/users.py – SQLite User Store (init, load, save).
"""
import json
import os
import secrets

import sqlite3

from config import USERS_DB, LEGACY_USERS_FILE, logger
from werkzeug.security import check_password_hash, generate_password_hash


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def normalize_username(username):
    from config import abort
    if not isinstance(username, str):
        abort(400, 'Username required')
    username = username.strip()
    if not username or len(username) > 64:
        abort(400, 'Username must be between 1 and 64 characters')
    if any(char.isspace() for char in username):
        abort(400, 'Username must not contain spaces')
    return username


def validate_password(password, min_len=8):
    from config import abort
    if not isinstance(password, str) or len(password) < min_len:
        abort(400, f'Password must be at least {min_len} characters long')
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


def default_permissions_for(username):
    admin_user = os.environ.get('ADMIN_USER', 'admin')
    if username == admin_user:
        return {
            "is_admin": True, "can_start": True, "can_stop": True,
            "can_edit_form": True, "can_edit_stats": True,
            "can_edit_participants": True, "can_add_participants": True,
            "can_edit_settings": True, "can_manage_users": True,
            "can_see_all": True, "hide_ranking": False, "hide_duration": False,
        }
    return {"can_see_all": True, "hide_ranking": False, "hide_duration": False}


# ---------------------------------------------------------------------------
# DB Connection
# ---------------------------------------------------------------------------

def get_db_connection():
    conn = sqlite3.connect(USERS_DB, timeout=20.0)
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


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

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
