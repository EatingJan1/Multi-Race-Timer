"""
sanitize.py – Input-Validierung und -Bereinigung.
"""
import datetime
import json

from flask import abort, request

from config import (
    MAX_JSON_NAME_LENGTH,
    MAX_TAG_LENGTH,
    MAX_TAGS_PER_PERSON,
    ALLOWED_PERMISSION_KEYS,
)


# ---------------------------------------------------------------------------
# Primitives
# ---------------------------------------------------------------------------

def get_json_body():
    data = request.get_json(silent=True)
    if data is None:
        abort(400, 'Expected JSON body')
    if not isinstance(data, dict):
        abort(400, 'JSON body must be an object')
    return data


def sanitize_race_name(race_name):
    if not isinstance(race_name, str):
        abort(400, 'Invalid race name')
    safe_name = ''.join(c for c in race_name.strip() if c.isalnum() or c in ('_', '-', '.')).rstrip('.')
    if not safe_name:
        abort(400, 'Invalid race name')
    if len(safe_name) > MAX_JSON_NAME_LENGTH:
        abort(400, 'Race name too long')
    return safe_name


def sanitize_tags(tags):
    if tags is None:
        return []
    if not isinstance(tags, list):
        abort(400, 'Tags must be a list')
    sanitized = []
    for tag in tags[:MAX_TAGS_PER_PERSON]:
        if not isinstance(tag, str):
            continue
        clean_tag = tag.strip()[:MAX_TAG_LENGTH]
        if clean_tag:
            sanitized.append(clean_tag)
    return sanitized


def sanitize_timestamp(ts):
    if not ts:
        return None
    if not isinstance(ts, str):
        abort(400, 'Timestamp must be an ISO format string')
    clean_ts = ts.strip()
    if not clean_ts:
        return None
    try:
        datetime.datetime.fromisoformat(clean_ts.replace('Z', '+00:00'))
        return clean_ts
    except (ValueError, TypeError):
        abort(400, 'Invalid ISO timestamp format')


# ---------------------------------------------------------------------------
# Person / Settings
# ---------------------------------------------------------------------------

def sanitize_person(person):
    if not isinstance(person, dict):
        abort(400, 'Participant payload must contain objects')

    try:
        start_number = int(person.get('start_number'))
    except (TypeError, ValueError):
        abort(400, 'Invalid start number')

    raw_name = person.get('name')
    name = str(raw_name).strip() if raw_name is not None else ''
    if not name:
        name = f"Teilnehmer #{start_number}"
    if len(name) > MAX_JSON_NAME_LENGTH:
        name = name[:MAX_JSON_NAME_LENGTH]

    start_time = sanitize_timestamp(person.get('start_time'))
    end_time = sanitize_timestamp(person.get('end_time'))

    clean_person = {
        'id': str(person.get('id', start_number))[:64],
        'name': name,
        'start_number': start_number,
        'tags': sanitize_tags(person.get('tags', [])),
        'start_time': start_time,
        'end_time': end_time,
    }

    duration = person.get('duration')
    if duration not in (None, ''):
        try:
            clean_person['duration'] = round(float(duration), 3)
        except (TypeError, ValueError):
            abort(400, 'Invalid duration')
    elif start_time and end_time:
        try:
            t0 = datetime.datetime.fromisoformat(start_time.replace('Z', '+00:00'))
            t1 = datetime.datetime.fromisoformat(end_time.replace('Z', '+00:00'))
            clean_person['duration'] = round(max(0.0, (t1 - t0).total_seconds()), 3)
        except Exception:
            clean_person['duration'] = None
    else:
        clean_person['duration'] = None

    return clean_person


def sanitize_people(people):
    if not isinstance(people, list):
        abort(400, 'Expected a list of participants')
    return [sanitize_person(person) for person in people]


def sanitize_settings(settings):
    if not isinstance(settings, dict):
        abort(400, 'Settings payload must be an object')
    try:
        raw_len = len(json.dumps(settings))
        if raw_len > 10 * 1024 * 1024:
            abort(400, 'Settings payload too large (max 10MB)')
    except Exception:
        abort(400, 'Invalid settings format')

    if 'displaytype' in settings:
        allowed_displaytypes = {'open', 'public', 'preparation', 'hidden', 'kiosk', 'registration_stop', 'finished'}
        if settings['displaytype'] not in allowed_displaytypes:
            settings['displaytype'] = 'hidden'

    if 'start_num_min' in settings:
        try:
            settings['start_num_min'] = int(settings['start_num_min'])
        except (ValueError, TypeError):
            settings['start_num_min'] = 100

    if 'start_num_max' in settings:
        try:
            settings['start_num_max'] = int(settings['start_num_max'])
        except (ValueError, TypeError):
            settings['start_num_max'] = 9999

    return settings


# ---------------------------------------------------------------------------
# User / Permission sanitization
# ---------------------------------------------------------------------------

def sanitize_permissions_dict(raw_perms, is_admin_caller, current_user_perms):
    if not isinstance(raw_perms, dict):
        abort(400, 'Permissions must be a dictionary')
    cleaned = {}
    for k, v in raw_perms.items():
        if k not in ALLOWED_PERMISSION_KEYS:
            continue
        bool_val = bool(v)
        if not is_admin_caller:
            if k == 'is_admin' and bool_val:
                abort(403, 'Only administrators can grant admin status.')
            if bool_val and not current_user_perms.get(k):
                abort(403, f"Cannot grant permission '{k}' which you do not possess.")
        cleaned[k] = bool_val
    return cleaned


def sanitize_race_access_dict(raw_race_access, is_admin_caller, current_user_race_access, current_user_perms):
    if not isinstance(raw_race_access, dict):
        abort(400, 'race_access must be a dictionary')
    cleaned = {}
    for race_name, perms in raw_race_access.items():
        safe_rname = sanitize_race_name(race_name)
        if not isinstance(perms, dict):
            continue
        if not is_admin_caller and not current_user_perms.get('can_see_all'):
            if safe_rname not in current_user_race_access:
                abort(403, f"Cannot assign access to race '{safe_rname}' that you cannot access.")
        cleaned[safe_rname] = {
            k: bool(v) for k, v in perms.items() if k in ALLOWED_PERMISSION_KEYS
        }
    return cleaned


# ---------------------------------------------------------------------------
# PDF filename helper
# ---------------------------------------------------------------------------

def sanitize_pdf_filename(start_number, name):
    clean_name = "_".join(name.strip().split())
    clean_name = "".join([c for c in clean_name if c.isalnum() or c in ('_', '-')])
    return f"{start_number}_{clean_name}.pdf"


# ---------------------------------------------------------------------------
# Path traversal guard
# ---------------------------------------------------------------------------

import os

def safe_join_under(base_dir, *parts):
    base_dir = os.path.abspath(base_dir)
    candidate = os.path.abspath(os.path.join(base_dir, *parts))
    if os.path.commonpath([base_dir, candidate]) != base_dir:
        abort(400, 'Invalid path')
    return candidate
