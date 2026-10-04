FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    RUNNING_IN_DOCKER=1

WORKDIR /app

# Create a non-privileged user and group
RUN groupadd -r app && useradd -r -g app -d /app -s /sbin/nologin app

# Copy requirements and install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code and assets
COPY app.py .
COPY update_frontend_check.py .

# Create data directories with appropriate permissions
RUN mkdir -p /app/data /app/var && \
    chown -R app:app /app

# Switch to non-root user
USER app

EXPOSE 5002

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD python3 -c "import urllib.request; urllib.request.urlopen('http://localhost:5002/public/info', timeout=3)" || exit 1

CMD ["gunicorn", "--bind", "0.0.0.0:5002", "--workers", "2", "--threads", "4", "--timeout", "60", "app:app"]
