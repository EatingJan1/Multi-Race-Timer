"""
routes/public.py – Public API endpoints (/public/*).
"""
import base64
import datetime
import json
import os
from typing import Any

from fastapi import APIRouter, Body, Depends, Header, Query, Request, Response
from fastapi.responses import FileResponse
from starlette.exceptions import HTTPException

from config import (
    MAX_PDF_SIZE_BYTES,
    SIGNED_DIR,
    TEMPLATES_DIR,
    abort,
    can_self_update,
    is_docker_runtime,
    logger,
)
from db.races import (
    get_race_db_connection,
    init_race_store,
    load_data,
)
from sanitize import (
    MAX_JSON_NAME_LENGTH,
    safe_join_under,
    sanitize_pdf_filename,
    sanitize_race_name,
    sanitize_tags,
)
from security import CurrentUser, constant_time_equals, get_client_ip, optional_user, rate_limiter

router = APIRouter(prefix='/public', tags=['public'])


def _check_kiosk_key(settings: dict, provided_key) -> None:
    stored_key = settings.get('key', '')
    if not stored_key or not provided_key or not constant_time_equals(stored_key, provided_key):
        abort(403, "Kiosk key required")


# ---------------------------------------------------------------------------
# Info
# ---------------------------------------------------------------------------

@router.get('/info')
def public_info(request: Request):
    """Get public application information (version, storage, runtime)"""
    return {
        'version': request.app.version or 'v1.0.0',
        'storage': 'sqlite',
        'copyright': 'Jan Reiner',
        'self_update_supported': can_self_update(),
        'runtime': 'docker' if is_docker_runtime() else 'host',
    }


# ---------------------------------------------------------------------------
# Race List / Detail / Settings
# ---------------------------------------------------------------------------

@router.get('/races')
def public_race_list():
    """List public races for landing page from SQLite (lite view)"""
    init_race_store()
    conn = get_race_db_connection()
    public_races = []
    try:
        rows = conn.execute("SELECT name, settings FROM races ORDER BY name DESC").fetchall()
        for row in rows:
            try:
                settings = json.loads(row["settings"])
                if not isinstance(settings, dict):
                    settings = {}
            except Exception:
                settings = {}

            display_type = settings.get('displaytype', 'hidden')
            if display_type not in ['hidden', 'kiosk']:
                lite_settings = {k: v for k, v in settings.items() if k not in ['form_config', 'key']}
                public_races.append({'name': row["name"], 'settings': lite_settings})
    finally:
        conn.close()

    return sorted(public_races, key=lambda x: x['name'], reverse=True)


def _authorize_public_view(settings: dict, user, key, x_kiosk_key) -> None:
    display_type = settings.get('displaytype', 'hidden')

    if display_type == 'hidden' and not user:
        abort(404, "Race not found or not publicly accessible")

    if display_type == 'kiosk':
        _check_kiosk_key(settings, key or x_kiosk_key)


@router.get('/race/{race_name}')
def public_race_detail(
    race_name: str,
    key: str | None = Query(default=None),
    x_kiosk_key: str | None = Header(default=None),
    user: CurrentUser | None = Depends(optional_user),
):
    """Get details for a specific race publicly from SQLite (hidden races protected)"""
    data = load_data(race_name)
    settings = data.get('settings', {})
    _authorize_public_view(settings, user, key, x_kiosk_key)

    settings_copy = {k: v for k, v in settings.items() if k != 'key'}
    return {'people': data.get('people', []), 'settings': settings_copy}


@router.get('/settings/{race_name}')
def public_race_settings(
    race_name: str,
    key: str | None = Query(default=None),
    x_kiosk_key: str | None = Header(default=None),
    user: CurrentUser | None = Depends(optional_user),
):
    """Get only settings for a specific race publicly without exposing internal key"""
    data = load_data(race_name)
    settings = data.get('settings', {})
    _authorize_public_view(settings, user, key, x_kiosk_key)

    return {k: v for k, v in settings.items() if k != 'key'}


# ---------------------------------------------------------------------------
# Registration / Kiosk
# ---------------------------------------------------------------------------

@router.post('/register/{race_name}', status_code=201)
def public_register(race_name: str, request: Request, registration_data: dict[str, Any] = Body(...)):
    """Register for a race with rate limiting, PDF verification, and SQLite persistence"""
    ip = get_client_ip(request)
    if not rate_limiter.is_allowed(f"reg_ip:{ip}", max_requests=10, window_seconds=60):
        abort(429, "Too many registrations. Please wait a minute.")

    safe_name = sanitize_race_name(race_name)
    init_race_store()
    data = load_data(safe_name)
    settings = data.get('settings', {})

    display_type = settings.get('displaytype', 'hidden')
    if display_type in ['registration_stop', 'finished', 'hidden']:
        abort(403, "Registration is closed or not allowed")

    if display_type == 'kiosk':
        kiosk_key = registration_data.get('key', '')
        stored_key = settings.get('key', '')
        if not stored_key or not constant_time_equals(stored_key, kiosk_key):
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
                os.makedirs(race_signed_dir, exist_ok=True)

                filename = sanitize_pdf_filename(start_num, name)
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
                (safe_name, start_num, str(start_num), name, tags_json, now_iso, now_iso),
            )
    finally:
        conn.close()

    return {'status': 'success', 'start_number': start_num}


@router.post('/kiosk/register/{race_name}')
def public_kiosk_register(race_name: str, data: dict[str, Any] = Body(...)):
    """Use Key to access Kiosk Mode data from SQLite"""
    sec_key = data.get("SECKEY", "")
    race_data = load_data(race_name)
    settings = race_data.get('settings', {})
    stored_key = settings.get('key', "")

    if not stored_key or not constant_time_equals(stored_key, sec_key):
        abort(403, "No access to this race")

    return {
        "Race": {
            'people': race_data.get('people', []),
            'settings': {k: v for k, v in settings.items() if k != 'key'},
        }
    }


# ---------------------------------------------------------------------------
# Results / Template
# ---------------------------------------------------------------------------

@router.get('/results/{race_name}')
def public_results(race_name: str):
    """Get public participant list/results for a race from SQLite (only when finished)"""
    data = load_data(race_name)
    if data.get('settings', {}).get('displaytype', 'hidden') != 'finished':
        abort(403, "Race results are not published yet")
    return data.get('people', [])


@router.get('/template/{race_name}')
def public_template(race_name: str):
    """Serve the configured PDF template for a race from SQLite or filesystem"""
    safe_name = sanitize_race_name(race_name)
    init_race_store()
    conn = get_race_db_connection()
    try:
        row = conn.execute("SELECT data FROM pdf_templates WHERE race_name = ?", (safe_name,)).fetchone()
        if row and row["data"]:
            return Response(content=bytes(row["data"]), media_type='application/pdf')
    finally:
        conn.close()

    # Fallback to templates directory file
    for t_ext in ['.pdf', '']:
        t_path = safe_join_under(TEMPLATES_DIR, f"{safe_name}{t_ext}")
        if os.path.isfile(t_path):
            return FileResponse(t_path, media_type='application/pdf')

    abort(404, 'PDF template not found')
