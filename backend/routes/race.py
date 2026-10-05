"""
routes/race.py – Admin race management endpoints (/race/*).
"""
import base64
import binascii
import csv
import datetime
import io
import json
import os
import secrets
from typing import Any
from urllib.parse import quote

from fastapi import APIRouter, Body, Depends, Request, Response
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse
from pydantic import BaseModel, ConfigDict, Field
from starlette.exceptions import HTTPException

from config import MAX_PDF_SIZE_BYTES, SIGNED_DIR, abort, logger
from db.races import (
    delete_race_data,
    get_all_race_names,
    get_race_db_connection,
    init_race_store,
    load_data,
    save_data,
)
from sanitize import (
    safe_join_under,
    sanitize_pdf_filename,
    sanitize_people,
    sanitize_race_name,
    sanitize_settings,
    sanitize_timestamp,
)
from security import CurrentUser, login_required, permission_required

router = APIRouter(prefix='/race', tags=['race'])


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------

class Person(BaseModel):
    model_config = ConfigDict(coerce_numbers_to_str=True)

    id: str
    name: str
    start_number: int
    tags: list[str] | None = Field(default_factory=list)
    start_time: str | None = None
    end_time: str | None = None
    duration: float | None = None


class TimestampPayload(BaseModel):
    timestamp: str | None = None


def _utc_now_iso() -> str:
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def _content_disposition(filename: str) -> str:
    ascii_fallback = filename.encode('ascii', 'ignore').decode('ascii') or 'download'
    return f'attachment; filename="{ascii_fallback}"; filename*=UTF-8\'\'{quote(filename)}'


# ---------------------------------------------------------------------------
# Race List
# ---------------------------------------------------------------------------

@router.get('/list')
def list_races(user: CurrentUser = Depends(login_required)):
    """List all available races from SQLite (filtered by permission)"""
    all_races = get_all_race_names()
    if user.is_admin or user.permissions.get('can_see_all'):
        return sorted(all_races, reverse=True)
    return sorted((r for r in all_races if r in user.race_access), reverse=True)


# ---------------------------------------------------------------------------
# People
# ---------------------------------------------------------------------------

@router.get('/{race_name}/people', response_model=list[Person])
def list_people(race_name: str, user: CurrentUser = Depends(permission_required('can_see_all'))):
    """List all people in a specific race from SQLite"""
    return load_data(race_name)['people']


@router.put('/{race_name}/people', status_code=201)
def replace_people(
    race_name: str,
    payload: Any = Body(...),
    user: CurrentUser = Depends(permission_required('can_edit_participants')),
):
    """Import or update people in a specific race in SQLite"""
    people = sanitize_people(payload)
    data = load_data(race_name)
    data['people'] = people
    save_data(race_name, data)
    return data['people']


@router.post('/{race_name}/people/append', status_code=201, response_model=list[Person])
def append_people(
    race_name: str,
    payload: Any = Body(...),
    user: CurrentUser = Depends(permission_required('can_add_participants')),
):
    """Append People to a specific race in SQLite"""
    people = sanitize_people(payload)
    safe_name = sanitize_race_name(race_name)
    init_race_store()
    now_iso = _utc_now_iso()

    conn = get_race_db_connection()
    try:
        with conn:
            existing = conn.execute("SELECT name FROM races WHERE name = ?", (safe_name,)).fetchone()
            if not existing:
                default_settings = json.dumps({"displaytype": "hidden", "form_config": []})
                conn.execute(
                    "INSERT INTO races (name, settings, created_at, updated_at) VALUES (?, ?, ?, ?)",
                    (safe_name, default_settings, now_iso, now_iso),
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
                        p.get("duration"), now_iso, now_iso,
                    ),
                )
    finally:
        conn.close()

    return load_data(safe_name)['people']


# ---------------------------------------------------------------------------
# Settings
# ---------------------------------------------------------------------------

@router.get('/{race_name}/settings')
def get_settings(race_name: str, user: CurrentUser = Depends(permission_required('can_see_all'))):
    """Get race settings from SQLite"""
    return load_data(race_name).get('settings', {})


@router.post('/{race_name}/settings')
def update_settings(
    race_name: str,
    payload: Any = Body(...),
    user: CurrentUser = Depends(permission_required('can_edit_settings')),
):
    """Update race settings in SQLite"""
    settings = sanitize_settings(payload)
    data = load_data(race_name)
    data['settings'] = settings
    save_data(race_name, data)
    return data['settings']


# ---------------------------------------------------------------------------
# Full data
# ---------------------------------------------------------------------------

@router.get('/{race_name}/full')
def get_full_data(race_name: str, user: CurrentUser = Depends(permission_required('can_see_all'))):
    """Get full race data as JSON from SQLite"""
    return load_data(race_name)


@router.put('/{race_name}/full', status_code=201)
def put_full_data(
    race_name: str,
    data: dict[str, Any] = Body(...),
    user: CurrentUser = Depends(permission_required('can_edit_settings')),
):
    """Upload full race data as JSON into SQLite"""
    people = sanitize_people(data.get('people', []))
    settings = sanitize_settings(data.get('settings', {}))
    payload = {'people': people, 'settings': settings}
    save_data(race_name, payload)
    return payload


# ---------------------------------------------------------------------------
# Start / Stop
# ---------------------------------------------------------------------------

@router.post('/{race_name}/start/{start_number}')
def start_person(
    race_name: str,
    start_number: int,
    payload: TimestampPayload | None = Body(default=None),
    user: CurrentUser = Depends(permission_required('can_start')),
):
    """Record start time for a participant directly in SQLite"""
    safe_name = sanitize_race_name(race_name)
    init_race_store()
    raw_ts = payload.timestamp if payload else None
    timestamp = sanitize_timestamp(raw_ts) if raw_ts else _utc_now_iso()
    now_iso = _utc_now_iso()

    conn = get_race_db_connection()
    try:
        with conn:
            cursor = conn.execute(
                """
                UPDATE participants
                SET start_time = ?, end_time = NULL, duration = NULL, updated_at = ?
                WHERE race_name = ? AND start_number = ?
                """,
                (timestamp, now_iso, safe_name, start_number),
            )
            if cursor.rowcount == 0:
                abort(404, "Start number not found")
    finally:
        conn.close()

    return {'status': 'started', 'timestamp': timestamp}


@router.post('/{race_name}/stop/{start_number}')
def stop_person(
    race_name: str,
    start_number: int,
    payload: TimestampPayload | None = Body(default=None),
    user: CurrentUser = Depends(permission_required('can_stop')),
):
    """Record stop time and duration for a participant directly in SQLite"""
    safe_name = sanitize_race_name(race_name)
    init_race_store()
    raw_ts = payload.timestamp if payload else None
    timestamp = sanitize_timestamp(raw_ts) if raw_ts else _utc_now_iso()
    now_iso = _utc_now_iso()

    conn = get_race_db_connection()
    duration = None
    try:
        with conn:
            row = conn.execute(
                "SELECT start_time FROM participants WHERE race_name = ? AND start_number = ?",
                (safe_name, start_number),
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
                (timestamp, duration, now_iso, safe_name, start_number),
            )
    finally:
        conn.close()

    return {'status': 'stopped', 'timestamp': timestamp, 'duration': duration}


# ---------------------------------------------------------------------------
# Delete / Export / GenKey
# ---------------------------------------------------------------------------

@router.delete('/{race_name}/delete')
def delete_race(race_name: str, user: CurrentUser = Depends(permission_required('can_edit_settings'))):
    """Delete a race and all its participants from SQLite"""
    if delete_race_data(race_name):
        return {'status': 'deleted'}
    abort(404, 'Race not found')


@router.get('/{race_name}/export')
def export_race(race_name: str, user: CurrentUser = Depends(permission_required('can_see_all'))):
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

    filename = f"{sanitize_race_name(race_name)}_ergebnisse.csv"
    return Response(
        content=si.getvalue().encode('utf-8'),
        media_type='text/csv',
        headers={'Content-Disposition': _content_disposition(filename)},
    )


@router.get('/{race_name}/genkey')
def generate_kiosk_key(
    race_name: str,
    response: Response,
    user: CurrentUser = Depends(permission_required('can_edit_settings')),
):
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
        response.status_code = 201
        return {"key": token}

    return {"status": "success", "key": key}


# ---------------------------------------------------------------------------
# Template Upload
# ---------------------------------------------------------------------------

def _store_template(safe_name: str, filename: str, pdf_bytes: bytes) -> None:
    init_race_store()
    conn = get_race_db_connection()
    try:
        with conn:
            conn.execute(
                """
                INSERT OR REPLACE INTO pdf_templates (race_name, filename, data, updated_at)
                VALUES (?, ?, ?, ?)
                """,
                (safe_name, filename, pdf_bytes, _utc_now_iso()),
            )
    finally:
        conn.close()


@router.post('/{race_name}/template')
async def upload_template(
    race_name: str,
    request: Request,
    user: CurrentUser = Depends(permission_required('can_edit_settings')),
):
    """Upload a PDF form template for a race (multipart 'file' oder JSON mit base64)"""
    safe_name = sanitize_race_name(race_name)
    pdf_bytes = None
    filename = f"{safe_name}_template.pdf"
    content_type = request.headers.get('content-type', '')

    if content_type.startswith('multipart/form-data'):
        form = await request.form()
        uploaded = form.get('file')
        if uploaded is not None and hasattr(uploaded, 'read'):
            pdf_bytes = await uploaded.read()
            if getattr(uploaded, 'filename', None):
                filename = os.path.basename(uploaded.filename)
    elif content_type.startswith('application/json'):
        try:
            data = await request.json()
        except ValueError:
            data = {}
        if isinstance(data, dict):
            raw_b64 = data.get('template_pdf') or data.get('pdf')
            if raw_b64 and isinstance(raw_b64, str):
                if ',' in raw_b64:
                    raw_b64 = raw_b64.split(',')[1]
                try:
                    pdf_bytes = base64.b64decode(raw_b64)
                except (binascii.Error, ValueError):
                    abort(400, 'Invalid base64 data')

    if not pdf_bytes or len(pdf_bytes) > MAX_PDF_SIZE_BYTES:
        abort(400, 'Invalid PDF template data or file too large')

    if not pdf_bytes.startswith(b'%PDF-'):
        abort(400, 'Uploaded file is not a valid PDF document')

    await run_in_threadpool(_store_template, safe_name, filename, pdf_bytes)
    return {'status': 'success', 'message': 'PDF template saved in database'}


# ---------------------------------------------------------------------------
# Signed PDFs
# ---------------------------------------------------------------------------

@router.get('/{race_name}/pdfs')
def list_signed_pdfs(race_name: str, user: CurrentUser = Depends(permission_required('can_see_all'))):
    """List all signed PDFs for a race safely"""
    race_signed_dir = safe_join_under(SIGNED_DIR, sanitize_race_name(race_name))
    if not os.path.exists(race_signed_dir):
        return []
    return sorted(f for f in os.listdir(race_signed_dir) if f.lower().endswith('.pdf'))


@router.get('/{race_name}/pdf/{filename}')
def download_signed_pdf(
    race_name: str,
    filename: str,
    user: CurrentUser = Depends(permission_required('can_see_all')),
):
    """Download a specific signed PDF"""
    try:
        race_signed_dir = safe_join_under(SIGNED_DIR, sanitize_race_name(race_name))
        safe_filename = os.path.basename(filename)
        if safe_filename != filename or not safe_filename.lower().endswith('.pdf'):
            abort(400, 'Invalid PDF filename')
        file_path = safe_join_under(race_signed_dir, safe_filename)

        if not os.path.exists(file_path):
            abort(404, f"PDF file {filename} not found")

        return FileResponse(file_path, media_type='application/pdf')
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error serving PDF: {e}")
        abort(500, 'Internal server error')
