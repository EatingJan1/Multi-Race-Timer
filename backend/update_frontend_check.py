import argparse
import json
import os
from pathlib import Path


def resolve_frontend_path(repo_root: Path, frontend_path: str | None) -> Path:
    candidate = (frontend_path or "frontend").strip()
    base = Path(candidate)
    if not base.is_absolute():
        base = (repo_root / base).resolve()
    return base


def run_check(repo_root: Path, frontend_path: str | None) -> dict:
    target = resolve_frontend_path(repo_root, frontend_path)
    checks = {
        "directory_exists": target.is_dir(),
        "has_index_html": (target / "index.html").is_file(),
        "has_app_js": (target / "app.js").is_file(),
        "has_manifest_json": (target / "manifest.json").is_file(),
        "manifest_short_name_ok": False,
    }

    short_name = None
    manifest_error = None

    if checks["has_manifest_json"]:
        try:
            manifest_payload = json.loads((target / "manifest.json").read_text(encoding="utf-8"))
            short_name = manifest_payload.get("short_name")
            checks["manifest_short_name_ok"] = short_name == "RaceTimer"
        except Exception as exc:
            manifest_error = str(exc)

    fatal_ok = checks["directory_exists"] and checks["has_index_html"] and checks["has_app_js"]
    requires_confirmation = False
    warnings = []
    errors = []

    if not checks["directory_exists"]:
        errors.append("Frontend-Verzeichnis nicht gefunden.")
    if not checks["has_index_html"]:
        errors.append("index.html fehlt im Frontend-Verzeichnis.")
    if not checks["has_app_js"]:
        errors.append("app.js fehlt im Frontend-Verzeichnis.")

    if fatal_ok:
        if not checks["has_manifest_json"]:
            requires_confirmation = True
            warnings.append('manifest.json fehlt.')
        elif not checks["manifest_short_name_ok"]:
            requires_confirmation = True
            warnings.append(f'short_name ist "{short_name}" statt "RaceTimer".')
        if manifest_error:
            requires_confirmation = True
            warnings.append(f"manifest.json konnte nicht gelesen werden: {manifest_error}")

    return {
        "ok": fatal_ok,
        "requires_confirmation": requires_confirmation,
        "frontend_path": str(target),
        "checks": checks,
        "manifest_short_name": short_name,
        "warnings": warnings,
        "errors": errors,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Preflight check for frontend updater.")
    parser.add_argument("--repo-root", required=True, help="Absolute repository root path")
    parser.add_argument("--frontend-path", default="", help="Frontend path (absolute or relative to repo root)")
    args = parser.parse_args()

    repo_root = Path(args.repo_root).resolve()
    result = run_check(repo_root, args.frontend_path)
    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
