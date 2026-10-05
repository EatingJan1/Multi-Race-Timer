"""
routes/race.py – Admin race management endpoints (/race/*).
"""
import base64
import csv
import datetime
import io
import json
import os

from flask import abort, request, send_file
from flask_restx import Namespace, Resource, fields
from werkzeug.exceptions import HTTPException

from config import MAX_PDF_SIZE_BYTES, SIGNED_DIR, TEMPLATES_DIR, logger
from db.races import (
    delete_race_data,
    get_all_race_names,
    get_race_db_connection,
    init_race_store,
    load_data,
    save_data,
)
from sanitize import (
    sanitize_people,
    sanitize_pdf_filename,
    sanitize_race_name,
    sanitize_settings,
    sanitize_timestamp,
    safe_join_under,
    get_json_body,
)
from security import get_current_user, login_required, permission_required

import secrets

ns = Namespace('race', description='Race operations')

person_model = ns.model('Person', {
    'id': fields.String(required=True),
    'name': fields.String(required=True),
    'start_number': fields.Integer(required=True),
    'tags': fields.List(fields.String()),
    'start_time': fields.String(),
    'end_time': fields.String(),
    'duration': fields.Float(),
})


# ---------------------------------------------------------------------------
# Race List
# ---------------------------------------------------------------------------

@ns.route('/list')
class RaceList(Resource):
    @login_required
    def get(self):
        """List all available races from SQLite (filtered by permission)"""
        all_races = get_all_race_names()
        username, user_data = get_current_user()
        perms = user_data.get('permissions', {})
        race_access = user_data.get('race_access', {})

        if perms.get('is_admin') or perms.get('can_see_all'):
            return sorted(all_races, reverse=True)

        visible_races = [r for r in all_races if r in race_access]
        return sorted(visible_races, reverse=True)


# ---------------------------------------------------------------------------
# People
# ---------------------------------------------------------------------------

@ns.route('/<string:race_name>/people')
class PersonList(Resource):
    @ns.marshal_list_with(person_model)
    @permission_required('can_see_all')
    def get(self, race_name):
        """List all people in a specific race from SQLite"""
        data = load_data(race_name)
        return data['people']

    @permission_required('can_edit_participants')
    def put(self, race_name):
        """Import or update people in a specific race in SQLite"""
        people = sanitize_people(request.get_json(silent=True))
        data = load_data(race_name)
        data['people'] = people
        save_data(race_name, data)
        return data['people'], 201


@ns.route('/<string:race_name>/people/append')
class PersonAppend(Resource):
    @ns.marshal_list_with(person_model)
    @permission_required('can_add_participants')
    def post(self, race_name):
        """Append People to a specific race in SQLite"""
        people = sanitize_people(request.get_json(silent=True))
        safe_name = sanitize_race_name(race_name)
        init_race_store()
        now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()

        conn = get_race_db_connection()
        try:
            with conn:
                existing = conn.execute("SELECT name FROM races WHERE name = ?", (safe_name,)).fetchone()
                if not existing:
                    default_settings = json.dumps({"displaytype": "hidden", "form_config": []})
                    conn.execute(
                        "INSERT INTO races (name, settings, created_at, updated_at) VALUES (?, ?, ?, ?)",
                        (safe_name, default_settings, now_iso, now_iso)
                    )

                for p in people:
                    tags_json = json.dumps(p.get("tags", []), ensure_ascii=False)
                    conn.execute(
                        """
                        INSERT OR REPLACE INTO participants
                        (race_name, start_number, id, name, tags, start_time, end_time, duration, created_at, updated_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            safe_name, p["start_number"],
                            str(p.get("id", p["start_number"])),
                            p["name"],
                            tags_json,
                            p.get("start_time"), p.get("end_time"),
                            p.get("duration"), now_iso, now_iso
                        )
                    )
        finally:
            conn.close()

        data = load_data(safe_name)
        return data['people'], 201


# ---------------------------------------------------------------------------
# Settings
# ---------------------------------------------------------------------------

@ns.route('/<string:race_name>/settings')
class RaceSettings(Resource):
    @permission_required('can_see_all')
    def get(self, race_name):
        """Get race settings from SQLite"""
        data = load_data(race_name)
        return data.get('settings', {})

    @permission_required('can_edit_settings')
    def post(self, race_name):
        """Update race settings in SQLite"""
        settings = sanitize_settings(request.get_json(silent=True))
        data = load_data(race_name)
        data['settings'] = settings
        save_data(race_name, data)
        return data['settings'], 200


# ---------------------------------------------------------------------------
# Full data
# ---------------------------------------------------------------------------

@ns.route('/<string:race_name>/full')
class FullData(Resource):
    @permission_required('can_see_all')
    def get(self, race_name):
        """Get full race data as JSON from SQLite"""
        return load_data(race_name)

    @permission_required('can_edit_settings')
    def put(self, race_name):
        """Upload full race data as JSON into SQLite"""
        data = get_json_body()
        people = sanitize_people(data.get('people', []))
        settings = sanitize_settings(data.get('settings', {}))
        payload = {'people': people, 'settings': settings}
        save_data(race_name, payload)
        return payload, 201


# ---------------------------------------------------------------------------
# Start / Stop
# ---------------------------------------------------------------------------

@ns.route('/<string:race_name>/start/<int:start_number>')
class StartPerson(Resource):
    @permission_required('can_start')
    def post(self, race_name, start_number):
        """Record start time for a participant directly in SQLite"""
        safe_name = sanitize_race_name(race_name)
        init_race_store()
        raw_ts = request.json.get('timestamp') if request.is_json and isinstance(request.json, dict) else None
        timestamp = sanitize_timestamp(raw_ts) if raw_ts else datetime.datetime.now(datetime.timezone.utc).isoformat()
        now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()

        conn = get_race_db_connection()
        try:
            with conn:
                cursor = conn.execute(
                    """
                    UPDATE participants
                    SET start_time = ?, end_time = NULL, duration = NULL, updated_at = ?
                    WHERE race_name = ? AND start_number = ?
                    """,
                    (timestamp, now_iso, safe_name, start_number)
                )
                if cursor.rowcount == 0:
                    abort(404, "Start number not found")
        finally:
            conn.close()

        return {'status': 'started', 'timestamp': timestamp}


@ns.route('/<string:race_name>/stop/<int:start_number>')
class StopPerson(Resource):
    @permission_required('can_stop')
    def post(self, race_name, start_number):
        """Record stop time and duration for a participant directly in SQLite"""
        safe_name = sanitize_race_name(race_name)
        init_race_store()
        raw_ts = request.json.get('timestamp') if request.is_json and isinstance(request.json, dict) else None
        timestamp = sanitize_timestamp(raw_ts) if raw_ts else datetime.datetime.now(datetime.timezone.utc).isoformat()
        now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()

        conn = get_race_db_connection()
        duration = None
        try:
            with conn:
                row = conn.execute(
                    "SELECT start_time FROM participants WHERE race_name = ? AND start_number = ?",
                    (safe_name, start_number)
                ).fetchone()

                if not row:
                    abort(404, "Start number not found")

                start_time = row["start_time"]
                if not start_time:
                    abort(400, "Participant has not started yet")

                try:
                    t0 = datetime.datetime.fromisoformat(start_time.replace('Z', '+00:00'))
                    t1 = datetime.datetime.fromisoformat(timestamp.replace('Z', '+00:00'))
                    duration = round(max(0.0, (t1 - t0).total_seconds()), 3)
                except Exception as e:
                    logger.warning(f"Could not calculate duration for #{start_number}: {e}")
                    duration = None

                conn.execute(
                    """
                    UPDATE participants
                    SET end_time = ?, duration = ?, updated_at = ?
                    WHERE race_name = ? AND start_number = ?
                    """,
                    (timestamp, duration, now_iso, safe_name, start_number)
                )
        finally:
            conn.close()

        return {'status': 'stopped', 'timestamp': timestamp, 'duration': duration}


# ---------------------------------------------------------------------------
# Delete / Export / GenKey
# ---------------------------------------------------------------------------

@ns.route('/<string:race_name>/delete')
class DeleteRace(Resource):
    @permission_required('can_edit_settings')
    def delete(self, race_name):
        """Delete a race and all its participants from SQLite"""
        deleted = delete_race_data(race_name)
        if deleted:
            return {'status': 'deleted'}, 200
        abort(404, 'Race not found')


@ns.route('/<string:race_name>/export')
class ExportRace(Resource):
    @permission_required('can_see_all')
    def get(self, race_name):
        """Export race data as CSV directly from SQLite"""
        data = load_data(race_name)
        si = io.StringIO()
        cw = csv.writer(si)
        cw.writerow(['Name', 'Startnummer', 'Tags', 'Startzeit', 'Endzeit', 'Dauer (s)'])
        for p in data['people']:
            tags_str = ",".join(p.get('tags', []))
            cw.writerow([
                p['name'], p['start_number'], tags_str,
                p.get('start_time') or '', p.get('end_time') or '', p.get('duration') or '',
            ])

        output = io.BytesIO()
        output.write(si.getvalue().encode('utf-8'))
        output.seek(0)
        return send_file(
            output, mimetype='text/csv', as_attachment=True,
            download_name=f"{sanitize_race_name(race_name)}_ergebnisse.csv"
        )


@ns.route('/<string:race_name>/genkey')
class RaceGenKey(Resource):
    @permission_required('can_edit_settings')
    def get(self, race_name):
        """Generate or retrieve Kiosk access key for a race in SQLite"""
        safe_name = sanitize_race_name(race_name)
        data = load_data(safe_name)
        settings = data.get("settings", {})
        key = settings.get("key", "")

        if not key:
            token = secrets.token_urlsafe(24)
            settings['key'] = token
            data['settings'] = settings
            save_data(safe_name, data)
            return {"key": token}, 201

        return {"status": "success", "key": key}, 200


# ---------------------------------------------------------------------------
# Template Upload
# ---------------------------------------------------------------------------

@ns.route('/<string:race_name>/template')
class RaceTemplate(Resource):
    @permission_required('can_edit_settings')
    def post(self, race_name):
        """Upload a PDF form template for a race into SQLite"""
        safe_name = sanitize_race_name(race_name)
        init_race_store()
        now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()

        pdf_bytes = None
        filename = f"{safe_name}_template.pdf"

        if 'file' in request.files:
            uploaded_file = request.files['file']
            pdf_bytes = uploaded_file.read()
            if uploaded_file.filename:
                filename = os.path.basename(uploaded_file.filename)
        elif request.is_json:
            data = request.get_json(silent=True) or {}
            raw_b64 = data.get('template_pdf') or data.get('pdf')
            if raw_b64 and isinstance(raw_b64, str):
                if ',' in raw_b64:
                    raw_b64 = raw_b64.split(',')[1]
                pdf_bytes = base64.b64decode(raw_b64)

        if not pdf_bytes or len(pdf_bytes) > MAX_PDF_SIZE_BYTES:
            abort(400, 'Invalid PDF template data or file too large')

        if not pdf_bytes.startswith(b'%PDF-'):
            abort(400, 'Uploaded file is not a valid PDF document')

        conn = get_race_db_connection()
        try:
            with conn:
                conn.execute(
                    """
                    INSERT OR REPLACE INTO pdf_templates (race_name, filename, data, updated_at)
                    VALUES (?, ?, ?, ?)
                    """,
                    (safe_name, filename, pdf_bytes, now_iso)
                )
        finally:
            conn.close()

        return {'status': 'success', 'message': 'PDF template saved in database'}, 200


# ---------------------------------------------------------------------------
# Signed PDFs
# ---------------------------------------------------------------------------

@ns.route('/<string:race_name>/pdfs')
class SignedPdfList(Resource):
    @permission_required('can_see_all')
    def get(self, race_name):
        """List all signed PDFs for a race safely"""
        race_signed_dir = safe_join_under(SIGNED_DIR, sanitize_race_name(race_name))
        if not os.path.exists(race_signed_dir):
            return []

        pdfs = [f for f in os.listdir(race_signed_dir) if f.lower().endswith('.pdf')]
        return sorted(pdfs)


@ns.route('/<string:race_name>/pdf/<string:filename>')
class DownloadSignedPdf(Resource):
    @permission_required('can_see_all')
    def get(self, race_name, filename):
        """Download a specific signed PDF"""
        try:
            race_signed_dir = safe_join_under(SIGNED_DIR, sanitize_race_name(race_name))
            safe_filename = os.path.basename(filename)
            if safe_filename != filename or not safe_filename.lower().endswith('.pdf'):
                abort(400, 'Invalid PDF filename')
            file_path = safe_join_under(race_signed_dir, safe_filename)

            if not os.path.exists(file_path):
                abort(404, f"PDF file {filename} not found")

            return send_file(file_path, mimetype='application/pdf')
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Error serving PDF: {e}")
            abort(500, 'Internal server error')
