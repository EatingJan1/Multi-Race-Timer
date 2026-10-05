"""
app.py – Slim entrypoint: creates Flask-RESTX API, registers namespaces, wires middleware.

All business logic lives in the sub-modules:
  config.py        – constants, env helpers, Flask app instance
  security.py      – CORS headers, rate limiter, auth decorators
  sanitize.py      – input validation / sanitization helpers
  db/users.py      – SQLite user store
  db/races.py      – SQLite race store
  routes/auth.py   – /auth/* endpoints
  routes/race.py   – /race/* endpoints
  routes/public.py – /public/* endpoints
"""

import subprocess

from config import app, env_flag, get_current_git_tag, logger
from security import add_security_and_cors_headers
from routes.auth import auth_ns
from routes.race import ns as race_ns
from routes.public import public_ns

from flask_restx import Api

# ---------------------------------------------------------------------------
# Determine version
# ---------------------------------------------------------------------------

try:
    _version = subprocess.check_output(
        ['git', 'describe', '--tags', '--abbrev=0'],
        stderr=subprocess.DEVNULL
    ).decode('utf-8').strip()
except Exception:
    _version = 'v1.0.0'

# ---------------------------------------------------------------------------
# API
# ---------------------------------------------------------------------------

enable_doc = not env_flag('DISABLE_SWAGGER_DOC', False)
api = Api(
    app,
    version=_version,
    title='Multi-Race Timer API',
    description='API for tracking multiple race sessions (SQLite Powered)',
    doc='/' if enable_doc else False,
)

# Store version in app config so routes can access it
app.config['_api_version'] = _version

api.add_namespace(race_ns)
api.add_namespace(auth_ns)
api.add_namespace(public_ns)

# ---------------------------------------------------------------------------
# Middleware
# ---------------------------------------------------------------------------

app.after_request(add_security_and_cors_headers)

# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == '__main__':
    import os
    port = int(os.environ.get('PORT', '5002'))
    debug = env_flag('FLASK_DEBUG', False)
    logger.info(f"Starting Multi-Race Timer server on port {port} (debug={debug})")
    app.run(debug=debug, host='0.0.0.0', port=port)
