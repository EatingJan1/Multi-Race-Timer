import base64
import os
import sys
import unittest

from starlette.exceptions import HTTPException

sys.path.insert(0, os.path.dirname(__file__))

from db.races import (
    save_data,
    load_data,
    delete_race_data,
    get_race_db_connection,
    get_all_race_names,
)
from db.users import (
    init_user_store,
    save_users,
    load_users,
    hash_password,
    verify_password,
)
from sanitize import (
    sanitize_race_name,
    sanitize_settings,
    sanitize_people,
)
from security import RateLimiter


class SecurityTestCase(unittest.TestCase):
    def setUp(self):
        init_user_store()

    def test_sanitize_and_security(self):
        # Invalid / empty race name raises HTTPException(400)
        with self.assertRaises(HTTPException):
            sanitize_race_name("")

        with self.assertRaises(HTTPException):
            sanitize_race_name("   ")

        # Dangerous characters are stripped by sanitize_race_name
        safe = sanitize_race_name("My Race 2026! / Test")
        self.assertEqual(safe, "MyRace2026Test")

        # Sanitize settings
        settings = sanitize_settings({"displaytype": "invalid_type", "start_num_min": "100"})
        self.assertEqual(settings["displaytype"], "hidden")
        self.assertEqual(settings["start_num_min"], 100)

    def test_sqlite_race_crud_and_persistence(self):
        race_name = "test_race_sec"
        save_data(race_name, {
            "people": [
                {"start_number": 10, "name": "Runner A", "tags": ["U18"]},
                {"start_number": 11, "name": "Runner B", "tags": ["PRO"]},
            ],
            "settings": {"displaytype": "open", "start_num_min": 10, "start_num_max": 200}
        })

        loaded = load_data(race_name)
        self.assertEqual(len(loaded["people"]), 2)
        self.assertEqual(loaded["people"][0]["name"], "Runner A")
        self.assertIn(race_name, get_all_race_names())

        # Direct DB start time update
        t_start = "2026-10-05T10:00:00.000000+00:00"
        t_stop = "2026-10-05T10:00:15.500000+00:00"
        conn = get_race_db_connection()
        try:
            with conn:
                conn.execute(
                    "UPDATE participants SET start_time = ?, end_time = ?, duration = 15.5 WHERE race_name = ? AND start_number = ?",
                    (t_start, t_stop, race_name, 10)
                )
        finally:
            conn.close()

        updated = load_data(race_name)
        p10 = next(p for p in updated["people"] if p["start_number"] == 10)
        self.assertEqual(p10["duration"], 15.5)

        # Cleanup
        delete_race_data(race_name)
        self.assertNotIn(race_name, get_all_race_names())

    def test_users_password_hashing_and_verification(self):
        raw_pw = "SuperSecretPassword123!"
        hashed = hash_password(raw_pw)
        self.assertNotEqual(raw_pw, hashed)
        self.assertTrue(verify_password(hashed, raw_pw))
        self.assertFalse(verify_password(hashed, "WrongPassword"))

        # Save and reload
        save_users({
            "unit_admin": {
                "password": hashed,
                "permissions": {"is_admin": True},
                "race_access": {}
            }
        })
        users = load_users()
        self.assertIn("unit_admin", users)
        self.assertTrue(verify_password(users["unit_admin"]["password"], raw_pw))

    def test_login_brute_force_rate_limit(self):
        limiter = RateLimiter()
        key = "127.0.0.1:test_user"

        # Not locked out initially
        self.assertFalse(limiter.is_locked_out(key, max_failures=5, window_seconds=60))

        # Record 5 failures
        for _ in range(5):
            limiter.record_failure(key)

        # Now locked out
        self.assertTrue(limiter.is_locked_out(key, max_failures=5, window_seconds=60))


if __name__ == "__main__":
    unittest.main()
