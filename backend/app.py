"""
app.py – FastAPI entrypoint: erzeugt die App, registriert Router und Middlewares.

Module:
  config.py        – Konstanten, Env-Helper, abort()
  security.py      – Auth-Dependencies, Rate-Limiter, Middlewares
  sanitize.py      – Input-Validierung / Bereinigung
  db/users.py      – SQLite-Userstore
  db/races.py      – SQLite-Racestore
  routes/auth.py   – /auth/*
  routes/race.py   – /race/*
  routes/public.py – /public/*

Start (Entwicklung):  python app.py
Start (Produktion):   uvicorn app:app --host 0.0.0.0 --port 5002 --no-proxy-headers
"""
import os
import subprocess

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.middleware.sessions import SessionMiddleware

from config import (
    ALLOWED_ORIGINS,
    MAX_CONTENT_LENGTH,
    SECRET_KEY,
    SESSION_COOKIE_SAMESITE,
    SESSION_COOKIE_SECURE,
    SESSION_TTL_SECONDS,
    env_flag,
    logger,
)
from routes.auth import router as auth_router
from routes.public import router as public_router
from routes.race import router as race_router
from security import BodySizeLimitMiddleware, SecurityHeadersMiddleware

# ---------------------------------------------------------------------------
# Version
# ---------------------------------------------------------------------------

try:
    _version = subprocess.check_output(
        ['git', 'describe', '--tags', '--abbrev=0'],
        stderr=subprocess.DEVNULL,
    ).decode('utf-8').strip()
except Exception:
    _version = 'v1.0.0'

# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------

enable_doc = not env_flag('DISABLE_SWAGGER_DOC', False)
app = FastAPI(
    title='Multi-Race Timer API',
    description='API for tracking multiple race sessions (SQLite Powered)',
    version=_version,
    docs_url='/' if enable_doc else None,       # Swagger-UI liegt wie vorher auf '/'
    redoc_url=None,
    openapi_url='/openapi.json' if enable_doc else None,
)

app.include_router(race_router)
app.include_router(auth_router)
app.include_router(public_router)

# ---------------------------------------------------------------------------
# Fehlerformat: {"message": "..."} wie bei Flask-RESTX (das Frontend liest .message)
# ---------------------------------------------------------------------------

@app.exception_handler(StarletteHTTPException)
async def http_exception_handler(request: Request, exc: StarletteHTTPException):
    return JSONResponse(
        {'message': exc.detail},
        status_code=exc.status_code,
        headers=getattr(exc, 'headers', None),
    )


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    first = exc.errors()[0] if exc.errors() else {}
    location = '.'.join(str(part) for part in first.get('loc', ()) if part != 'body')
    detail = f"{location}: {first.get('msg')}" if location else first.get('msg', 'Invalid request')
    return JSONResponse({'message': f'Invalid request payload ({detail})'}, status_code=400)

# ---------------------------------------------------------------------------
# Middleware (zuletzt hinzugefügt = äußerste Schicht)
#   SecurityHeaders -> CORS -> BodySizeLimit -> Session -> Routen
# ---------------------------------------------------------------------------

app.add_middleware(
    SessionMiddleware,
    secret_key=SECRET_KEY,
    session_cookie='session',
    max_age=SESSION_TTL_SECONDS,
    same_site=SESSION_COOKIE_SAMESITE,
    https_only=SESSION_COOKIE_SECURE,
)
app.add_middleware(BodySizeLimitMiddleware, max_bytes=MAX_CONTENT_LENGTH)
app.add_middleware(
    CORSMiddleware,
    allow_origins=sorted(ALLOWED_ORIGINS),
    allow_credentials=True,
    allow_methods=['GET', 'PUT', 'POST', 'DELETE', 'OPTIONS'],
    allow_headers=['Content-Type', 'Authorization', 'X-Kiosk-Key'],
)
app.add_middleware(SecurityHeadersMiddleware)

# ---------------------------------------------------------------------------
# Entry point (Entwicklung)
# ---------------------------------------------------------------------------

if __name__ == '__main__':
    import uvicorn

    port = int(os.environ.get('PORT', '5002'))
    debug = env_flag('DEBUG', env_flag('FLASK_DEBUG', False))
    logger.info(f"Starting Multi-Race Timer server on port {port} (debug={debug})")
    uvicorn.run('app:app', host='0.0.0.0', port=port, reload=debug, proxy_headers=False)
