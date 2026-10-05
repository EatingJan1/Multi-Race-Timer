"""
routes/public.py – Public API endpoints (/public/*).
"""
import base64
import datetime
import io
import json
import os
import secrets

from flask import abort, request, send_file
from flask_restx import Namespace, Resource
from werkzeug.exceptions import HTTPException

from config import MAX_PDF_SIZE_BYTES, SIGNED_DIR, TEMPLATES_DIR, can_self_update, is_docker_runtime, logger
from db.races import (
    get_race_db_connection,
    init_race_store,
    load_data,
)
from sanitize import (
    get_json_body,
    safe_join_under,
    sanitize_pdf_filename,
    sanitize_race_name,
    sanitize_tags,
    MAX_JSON_NAME_LENGTH,
)
from security import get_client_ip, get_current_user, rate_limiter

public_ns = Namespace('public', description='Public operations')


def _get_app_version():
    try:
        from flask import current_app
        return current_app.config.get('_api_version', 'v1.0.0')
    except Exception:
        return 'v1.0.0'


# ---------------------------------------------------------------------------
# Info
# ---------------------------------------------------------------------------

@public_ns.route('/info')
class PublicInfo(Resource):
    def get(self):
        """Get public application information (version, storage, runtime)"""
        return {
            'version': _get_app_version(),
            'storage': 'sqlite',
            'copyright': 'Jan Reiner',
            'self_update_supported': can_self_update(),
            'runtime': 'docker' if is_docker_runtime() else 'host',
        }


# ---------------------------------------------------------------------------
# Race List / Detail / Settings
# ---------------------------------------------------------------------------

@public_ns.route('/races')
class PublicRaceList(Resource):
    def get(self):
        """List public races for landing page from SQLite (lite view)"""
        init_race_store()
        conn = get_race_db_connection()
        public_races = []
        try:
            rows = conn.execute("SELECT name, settings FROM races ORDER BY name DESC").fetchall()
            for row in rows:
                race_name = row["name"]
                try:
                    settings = json.loads(row["settings"])
                    if not isinstance(settings, dict):
                        settings = {}
                except Exception:
                    settings = {}

                display_type = settings.get('displaytype', 'hidden')
                if display_type not in ['hidden', 'kiosk']:
                    lite_settings = {k: v for k, v in settings.items() if k not in ['form_config', 'key']}
                    public_races.append({'name': race_name, 'settings': lite_settings})
        finally:
            conn.close()

        return sorted(public_races, key=lambda x: x['name'], reverse=True)


@public_ns.route('/race/<string:race_name>')
class PublicRaceDetail(Resource):
    def get(self, race_name):
        """Get details for a specific race publicly from SQLite (hidden races protected)"""
        data = load_data(race_name)
        settings = data.get('settings', {})
        display_type = settings.get('displaytype', 'hidden')

        if display_type == 'hidden':
            username, _ = get_current_user()
            if not username:
                abort(404, "Race not found or not publicly accessible")

        if display_type == 'kiosk':
            kiosk_key = request.args.get('key') or request.headers.get('X-Kiosk-Key')
            stored_key = settings.get('key', '')
            if not stored_key or not kiosk_key or not secrets.compare_digest(stored_key, kiosk_key):
                abort(403, "Kiosk key required")

        settings_copy = {k: v for k, v in settings.items() if k != 'key'}
        return {'people': data.get('people', []), 'settings': settings_copy}


@public_ns.route('/settings/<string:race_name>')
class PublicRaceSettings(Resource):
    def get(self, race_name):
        """Get only settings for a specific race publicly without exposing internal key"""
        data = load_data(race_name)
        settings = data.get('settings', {})
        display_type = settings.get('displaytype', 'hidden')

        if display_type == 'hidden':
            username, _ = get_current_user()
            if not username:
                abort(404, "Race not found or not publicly accessible")

        if display_type == 'kiosk':
            kiosk_key = request.args.get('key') or request.headers.get('X-Kiosk-Key')
            stored_key = settings.get('key', '')
            if not stored_key or not kiosk_key or not secrets.compare_digest(stored_key, kiosk_key):
                abort(403, "Kiosk key required")

        return {k: v for k, v in settings.items() if k != 'key'}


# ---------------------------------------------------------------------------
# Registration / Kiosk
# ---------------------------------------------------------------------------

@public_ns.route('/register/<string:race_name>')
class PublicRegister(Resource):
    def post(self, race_name):
        """Register for a race with rate limiting, PDF verification, and SQLite persistence"""
        ip = get_client_ip()
        if not rate_limiter.is_allowed(f"reg_ip:{ip}", max_requests=10, window_seconds=60):
            abort(429, "Too many registrations. Please wait a minute.")

        safe_name = sanitize_race_name(race_name)
        init_race_store()
        data = load_data(safe_name)
        settings = data.get('settings', {})
        registration_data = get_json_body()

        display_type = settings.get('displaytype', 'hidden')
        if display_type in ['registration_stop', 'finished', 'hidden']:
            abort(403, "Registration is closed or not allowed")

        if display_type == 'kiosk':
            kiosk_key = registration_data.get('key', '')
            stored_key = settings.get('key', '')
            if not stored_key or not secrets.compare_digest(stored_key, kiosk_key):
                abort(403, "No access to this race")

        signed_pdf_base64 = registration_data.get('signed_pdf')

        min_num = settings.get('start_num_min', 100)
        max_num = settings.get('start_num_max', 9999)

        conn = get_race_db_connection()
        try:
            rows = conn.execute(
                "SELECT start_number FROM participants WHERE race_name = ?", (safe_name,)
            ).fetchall()
            used_numbers = {r["start_number"] for r in rows}

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

            tags = sanitize_tags(registration_data.get('tags', []))
            tags_json = json.dumps(tags, ensure_ascii=False)
            now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()

            new_person = {
                'id': str(start_num), 'name': name, 'start_number': start_num,
                'tags': tags, 'start_time': None, 'end_time': None, 'duration': None,
            }

            # Save signed PDF if provided
            if signed_pdf_base64 and isinstance(signed_pdf_base64, str):
                try:
                    if ',' in signed_pdf_base64:
                        signed_pdf_base64 = signed_pdf_base64.split(',')[1]

                    pdf_data = base64.b64decode(signed_pdf_base64, validate=True)
                    if len(pdf_data) > MAX_PDF_SIZE_BYTES:
                        abort(400, 'Signed PDF is too large')

                    if not pdf_data.startswith(b'%PDF-'):
                        abort(400, 'Uploaded file is not a valid PDF document')

                    race_signed_dir = safe_join_under(SIGNED_DIR, safe_name)
                    if not os.path.exists(race_signed_dir):
                        os.makedirs(race_signed_dir, exist_ok=True)

                    filename = sanitize_pdf_filename(new_person['start_number'], new_person['name'])
                    save_path = safe_join_under(race_signed_dir, filename)
                    with open(save_path, 'wb') as f:
                        f.write(pdf_data)
                except HTTPException:
                    raise
                except Exception as e:
                    logger.error(f"Error saving signed PDF: {e}")
                    abort(400, 'Invalid PDF data format')

            with conn:
                conn.execute(
                    """
                    INSERT INTO participants
                    (race_name, start_number, id, name, tags, start_time, end_time, duration, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?)
                    """,
                    (safe_name, start_num, str(start_num), name, tags_json, now_iso, now_iso)
                )
        finally:
            conn.close()

        return {'status': 'success', 'start_number': start_num}, 201


@public_ns.route('/kiosk/register/<string:race_name>')
class PublicKioskRegister(Resource):
    def post(self, race_name):
        """Use Key to access Kiosk Mode data from SQLite"""
        data = get_json_body()
        sec_key = data.get("SECKEY", "")
        race_data = load_data(race_name)
        settings = race_data.get('settings', {})
        stored_key = settings.get('key', "")

        if not stored_key or not secrets.compare_digest(stored_key, sec_key):
            abort(403, "No access to this race")

        sanitized_data = {
            'people': race_data.get('people', []),
            'settings': {k: v for k, v in settings.items() if k != 'key'},
        }
        return {"Race": sanitized_data}, 200


# ---------------------------------------------------------------------------
# Results / Template
# ---------------------------------------------------------------------------

@public_ns.route('/results/<string:race_name>')
class PublicResults(Resource):
    def get(self, race_name):
        """Get public participant list/results for a race from SQLite (only when finished)"""
        data = load_data(race_name)
        if data.get('settings', {}).get('displaytype', 'hidden') != 'finished':
            abort(403, "Race results are not published yet")
        return data.get('people', []), 200


@public_ns.route('/template/<string:race_name>')
class PublicTemplate(Resource):
    def get(self, race_name):
        """Serve the configured PDF template for a race from SQLite or filesystem"""
        safe_name = sanitize_race_name(race_name)
        init_race_store()
        conn = get_race_db_connection()
        try:
            row = conn.execute("SELECT data FROM pdf_templates WHERE race_name = ?", (safe_name,)).fetchone()
            if row and row["data"]:
                output = io.BytesIO(row["data"])
                return send_file(output, mimetype='application/pdf')
        finally:
            conn.close()

        # Fallback to templates directory file
        for t_ext in ['.pdf', '']:
            t_path = safe_join_under(TEMPLATES_DIR, f"{safe_name}{t_ext}")
            if os.path.exists(t_path):
                return send_file(t_path, mimetype='application/pdf')

        abort(404, 'PDF template not found')
