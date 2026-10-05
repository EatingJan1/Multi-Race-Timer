import base64
import json
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(__file__))
import app
from db.races import save_data, load_data, delete_race_data, get_race_db_connection


class SecurityTestCase(unittest.TestCase):
    def setUp(self):
        app.app.config['TESTING'] = True
        self.client = app.app.test_client()

    def test_public_info(self):
        res = self.client.get('/public/info')
        self.assertEqual(res.status_code, 200)
        data = json.loads(res.data)
        self.assertIn('version', data)
        self.assertEqual(data.get('storage'), 'sqlite')

    def test_magic_bytes_pdf_validation_and_sqlite_persistence(self):
        save_data('test_race_sec', {
            'people': [],
            'settings': {'displaytype': 'open', 'start_num_min': 100, 'start_num_max': 200}
        })
        # Invalid PDF content
        fake_pdf = base64.b64encode(b'NOT_A_PDF_FILE').decode('utf-8')
        res = self.client.post('/public/register/test_race_sec', json={
            'name': 'Test Runner',
            'signed_pdf': fake_pdf
        })
        self.assertEqual(res.status_code, 400)

        # Valid PDF header
        valid_pdf = base64.b64encode(b'%PDF-1.4\nTest content').decode('utf-8')
        res = self.client.post('/public/register/test_race_sec', json={
            'name': 'Test Runner',
            'signed_pdf': valid_pdf
        })
        self.assertEqual(res.status_code, 201)

        # Verify saved in SQLite
        data = load_data('test_race_sec')
        self.assertEqual(len(data['people']), 1)
        self.assertEqual(data['people'][0]['name'], 'Test Runner')
        self.assertEqual(data['people'][0]['start_number'], 100)

        # Cleanup
        delete_race_data('test_race_sec')

    def test_hidden_race_protection(self):
        save_data('secret_race', {'people': [], 'settings': {'displaytype': 'hidden'}})
        res = self.client.get('/public/race/secret_race')
        self.assertEqual(res.status_code, 404)
        delete_race_data('secret_race')

    def test_sqlite_race_crud_and_start_stop(self):
        # 1. Create race in SQLite
        save_data('sqlite_race_test', {
            'people': [
                {'start_number': 10, 'name': 'Runner A', 'tags': ['U18']},
                {'start_number': 11, 'name': 'Runner B', 'tags': ['PRO']},
            ],
            'settings': {'displaytype': 'open'}
        })

        loaded = load_data('sqlite_race_test')
        self.assertEqual(len(loaded['people']), 2)
        self.assertEqual(loaded['people'][0]['name'], 'Runner A')
        self.assertEqual(loaded['people'][1]['name'], 'Runner B')

        # 2. Start Runner A
        t_start = "2026-10-05T10:00:00.000000+00:00"
        conn = get_race_db_connection()
        try:
            with conn:
                conn.execute(
                    "UPDATE participants SET start_time = ? WHERE race_name = ? AND start_number = ?",
                    (t_start, 'sqlite_race_test', 10)
                )
        finally:
            conn.close()

        # 3. Stop Runner A with Stop endpoint
        t_stop = "2026-10-05T10:00:15.500000+00:00"
        # Simulate admin login
        with self.client.session_transaction() as sess:
            sess['logged_in'] = True
            sess['user'] = 'admin'

        res = self.client.post('/race/sqlite_race_test/stop/10', json={'timestamp': t_stop})
        self.assertEqual(res.status_code, 200)
        stop_data = json.loads(res.data)
        self.assertEqual(stop_data.get('duration'), 15.5)

        # 4. Check loaded duration from SQLite
        updated = load_data('sqlite_race_test')
        p10 = next(p for p in updated['people'] if p['start_number'] == 10)
        self.assertEqual(p10['duration'], 15.5)

        # Cleanup
        delete_race_data('sqlite_race_test')

    def test_login_brute_force_rate_limit(self):
        # Trigger multiple failed logins
        for _ in range(6):
            res = self.client.post('/auth/login', json={
                'username': 'admin',
                'password': 'WrongPassword123!'
            })
        # Should be locked out with 429
        self.assertEqual(res.status_code, 429)


if __name__ == '__main__':
    unittest.main()
