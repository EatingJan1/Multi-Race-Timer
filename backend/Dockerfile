FROM python:3.14-slim

WORKDIR /app

# Abhängigkeiten
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

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
