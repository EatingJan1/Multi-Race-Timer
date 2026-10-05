"""
db/races.py – SQLite Race Store (init, migrate, load, save, delete, helpers).
"""
import datetime
import json
import os
import shutil
import sqlite3
import threading

from config import DATA_DIR, RACES_DB, SIGNED_DIR, TEMPLATES_DIR, logger
from sanitize import (
    sanitize_race_name,
    sanitize_settings,
    sanitize_people,
    safe_join_under,
)


# ---------------------------------------------------------------------------
# Connection
# ---------------------------------------------------------------------------

def get_race_db_connection():
    conn = sqlite3.connect(RACES_DB, timeout=20.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    return conn


# ---------------------------------------------------------------------------
# Migration
# ---------------------------------------------------------------------------

_race_store_lock = threading.Lock()
_race_store_initialized = False


def _migrate_legacy_json_files(conn):
    if not os.path.exists(DATA_DIR):
        return

    now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
    for fname in os.listdir(DATA_DIR):
        if fname.endswith('.json') and not fname.endswith('.migrated'):
            race_name = fname[:-5]
            try:
                safe_name = sanitize_race_name(race_name)
            except Exception:
                continue

            json_path = os.path.join(DATA_DIR, fname)
            try:
                row = conn.execute("SELECT name FROM races WHERE name = ?", (safe_name,)).fetchone()
                if not row:
                    with open(json_path, 'r', encoding='utf-8') as f:
                        data = json.load(f)

                    if isinstance(data, dict):
                        raw_settings = data.get("settings", {})
                        settings = sanitize_settings(raw_settings) if isinstance(raw_settings, dict) else {
                            "displaytype": "hidden", "form_config": []
                        }
                        settings_json = json.dumps(settings, ensure_ascii=False)

                        raw_people = data.get("people", [])
                        people = sanitize_people(raw_people) if isinstance(raw_people, list) else []

                        with conn:
                            conn.execute(
                                "INSERT OR REPLACE INTO races (name, settings, created_at, updated_at) VALUES (?, ?, ?, ?)",
                                (safe_name, settings_json, now_iso, now_iso)
                            )
                            conn.execute("DELETE FROM participants WHERE race_name = ?", (safe_name,))
                            for p in people:
                                tags_json = json.dumps(p.get("tags", []), ensure_ascii=False)
                                conn.execute(
                                    """
                                    INSERT INTO participants
                                    (race_name, start_number, id, name, tags, start_time, end_time, duration, created_at, updated_at)
                                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                                    """,
                                    (
                                        safe_name, p["start_number"],
                                        str(p.get("id", p["start_number"])),
                                        p["name"], tags_json,
                                        p.get("start_time"), p.get("end_time"),
                                        p.get("duration"), now_iso, now_iso
                                    )
                                )
                        logger.info(f"Successfully migrated race '{safe_name}' from {fname} into SQLite.")
            except Exception as exc:
                logger.error(f"Could not migrate legacy race file '{fname}': {exc}")


# ---------------------------------------------------------------------------
# Init
# ---------------------------------------------------------------------------

def init_race_store():
    global _race_store_initialized
    if _race_store_initialized:
        return

    with _race_store_lock:
        if _race_store_initialized:
            return

        conn = get_race_db_connection()
        try:
            with conn:
                conn.execute(
                    """
                    CREATE TABLE IF NOT EXISTS races (
                        name TEXT PRIMARY KEY,
                        settings TEXT NOT NULL,
                        created_at TEXT NOT NULL,
                        updated_at TEXT NOT NULL
                    )
                    """
                )
                conn.execute(
                    """
                    CREATE TABLE IF NOT EXISTS participants (
                        race_name TEXT NOT NULL,
                        start_number INTEGER NOT NULL,
                        id TEXT,
                        name TEXT NOT NULL,
                        tags TEXT NOT NULL,
                        start_time TEXT,
                        end_time TEXT,
                        duration REAL,
                        created_at TEXT NOT NULL,
                        updated_at TEXT NOT NULL,
                        PRIMARY KEY (race_name, start_number),
                        FOREIGN KEY (race_name) REFERENCES races (name) ON DELETE CASCADE
                    )
                    """
                )
                conn.execute(
                    """
                    CREATE INDEX IF NOT EXISTS idx_participants_race_start
                    ON participants (race_name, start_number)
                    """
                )
                conn.execute(
                    """
                    CREATE INDEX IF NOT EXISTS idx_participants_race_duration
                    ON participants (race_name, duration)
                    """
                )
                conn.execute(
                    """
                    CREATE TABLE IF NOT EXISTS pdf_templates (
                        race_name TEXT PRIMARY KEY,
                        filename TEXT NOT NULL,
                        data BLOB NOT NULL,
                        updated_at TEXT NOT NULL,
                        FOREIGN KEY (race_name) REFERENCES races (name) ON DELETE CASCADE
                    )
                    """
                )
            _migrate_legacy_json_files(conn)
            _race_store_initialized = True
        finally:
            conn.close()


# ---------------------------------------------------------------------------
# CRUD
# ---------------------------------------------------------------------------

def load_data(race_name):
    init_race_store()
    safe_name = sanitize_race_name(race_name)
    conn = get_race_db_connection()
    try:
        race_row = conn.execute(
            "SELECT name, settings FROM races WHERE name = ?", (safe_name,)
        ).fetchone()

        if not race_row:
            return {"people": [], "settings": {"displaytype": "hidden", "form_config": []}}

        try:
            settings = json.loads(race_row["settings"])
            if not isinstance(settings, dict):
                settings = {"displaytype": "hidden", "form_config": []}
        except Exception:
            settings = {"displaytype": "hidden", "form_config": []}

        rows = conn.execute(
            """
            SELECT id, name, start_number, tags, start_time, end_time, duration
            FROM participants
            WHERE race_name = ?
            ORDER BY start_number ASC
            """,
            (safe_name,)
        ).fetchall()

        people = []
        for r in rows:
            try:
                tags = json.loads(r["tags"])
                if not isinstance(tags, list):
                    tags = []
            except Exception:
                tags = []

            dur = r["duration"]
            if dur is None and r["start_time"] and r["end_time"]:
                try:
                    t0 = datetime.datetime.fromisoformat(r["start_time"].replace('Z', '+00:00'))
                    t1 = datetime.datetime.fromisoformat(r["end_time"].replace('Z', '+00:00'))
                    dur = round(max(0.0, (t1 - t0).total_seconds()), 3)
                except Exception:
                    dur = None

            people.append({
                "id": r["id"] if r["id"] is not None else str(r["start_number"]),
                "name": r["name"],
                "start_number": r["start_number"],
                "tags": tags,
                "start_time": r["start_time"],
                "end_time": r["end_time"],
                "duration": dur,
            })

        return {"people": people, "settings": settings}
    finally:
        conn.close()


def save_data(race_name, data):
    init_race_store()
    safe_name = sanitize_race_name(race_name)
    now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()

    raw_settings = data.get("settings", {})
    settings = sanitize_settings(raw_settings) if isinstance(raw_settings, dict) else {
        "displaytype": "hidden", "form_config": []
    }
    settings_json = json.dumps(settings, ensure_ascii=False)

    raw_people = data.get("people", [])
    people = sanitize_people(raw_people) if isinstance(raw_people, list) else []

    conn = get_race_db_connection()
    try:
        with conn:
            existing = conn.execute("SELECT name FROM races WHERE name = ?", (safe_name,)).fetchone()
            if existing:
                conn.execute(
                    "UPDATE races SET settings = ?, updated_at = ? WHERE name = ?",
                    (settings_json, now_iso, safe_name)
                )
            else:
                conn.execute(
                    "INSERT INTO races (name, settings, created_at, updated_at) VALUES (?, ?, ?, ?)",
                    (safe_name, settings_json, now_iso, now_iso)
                )

            conn.execute("DELETE FROM participants WHERE race_name = ?", (safe_name,))
            for p in people:
                tags_json = json.dumps(p.get("tags", []), ensure_ascii=False)
                conn.execute(
                    """
                    INSERT INTO participants
                    (race_name, start_number, id, name, tags, start_time, end_time, duration, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        safe_name, p["start_number"],
                        str(p.get("id", p["start_number"])),
                        p["name"], tags_json,
                        p.get("start_time"), p.get("end_time"),
                        p.get("duration"), now_iso, now_iso
                    )
                )
    finally:
        conn.close()


def get_all_race_names():
    init_race_store()
    conn = get_race_db_connection()
    try:
        rows = conn.execute("SELECT name FROM races ORDER BY name DESC").fetchall()
        return [r["name"] for r in rows]
    finally:
        conn.close()


def delete_race_data(race_name):
    init_race_store()
    safe_name = sanitize_race_name(race_name)
    conn = get_race_db_connection()
    deleted = False
    try:
        with conn:
            cursor = conn.execute("DELETE FROM races WHERE name = ?", (safe_name,))
            if cursor.rowcount > 0:
                deleted = True
    finally:
        conn.close()

    race_signed_dir = safe_join_under(SIGNED_DIR, safe_name)
    if os.path.exists(race_signed_dir):
        try:
            shutil.rmtree(race_signed_dir)
        except Exception as e:
            logger.warning(f"Could not delete signed PDFs for {safe_name}: {e}")

    for t_ext in ['.pdf', '']:
        t_path = safe_join_under(TEMPLATES_DIR, f"{safe_name}{t_ext}")
        if os.path.exists(t_path):
            try:
                os.remove(t_path)
            except Exception:
                pass

    return deleted
