import base64
import json
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(__file__))
import app


class SecurityTestCase(unittest.TestCase):
    def setUp(self):
        app.app.config['TESTING'] = True
        self.client = app.app.test_client()

    def test_public_info(self):
        res = self.client.get('/public/info')
        self.assertEqual(res.status_code, 200)
        data = json.loads(res.data)
        self.assertIn('version', data)

    def test_magic_bytes_pdf_validation(self):
        app.save_data('test_race_sec', {
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

        path = app.get_race_path('test_race_sec')
        if os.path.exists(path):
            os.remove(path)

    def test_hidden_race_protection(self):
        app.save_data('secret_race', {'people': [], 'settings': {'displaytype': 'hidden'}})
        res = self.client.get('/public/race/secret_race')
        self.assertEqual(res.status_code, 404)
        path = app.get_race_path('secret_race')
        if os.path.exists(path):
            os.remove(path)

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
