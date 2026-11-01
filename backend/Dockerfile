FROM python:3.15-slim

# uv (schneller pip-Ersatz) aus dem offiziellen Image, Version gepinnt
COPY --from=ghcr.io/astral-sh/uv:0.12.23 /uv /uvx /bin/

# UV_COMPILE_BYTECODE: schnellerer Container-Start; UV_LINK_MODE=copy: nötig bei Cache-Mount
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy

WORKDIR /app

# Abhängigkeiten (Cache-Mount: wiederholte Builds laden nichts neu)
COPY requirements.txt .
RUN --mount=type=cache,target=/root/.cache/uv \
    uv pip install --system -r requirements.txt

# Anwendungscode
COPY app.py config.py sanitize.py security.py ./
COPY routes ./routes
COPY db ./db

# Persistente Daten (per Volume gemountet)
RUN mkdir -p /app/data /app/var

EXPOSE 5002

# Bewusst nur 1 Worker: Rate-Limiter liegt im Prozessspeicher, Daten in SQLite.
# Ohne Reverse-Proxy davor: --no-proxy-headers (X-Forwarded-For wird in security.py geregelt).
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "5002", "--no-proxy-headers"]