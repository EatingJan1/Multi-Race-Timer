#!/bin/bash
set -e

# Cleanup child processes on exit
cleanup() {
    echo ""
    echo "🛑 Beende Multi-Race-Timer..."
    if [ -n "$BACKEND_PID" ]; then
        kill "$BACKEND_PID" 2>/dev/null || true
    fi
    if [ -n "$FRONTEND_PID" ]; then
        kill "$FRONTEND_PID" 2>/dev/null || true
    fi
    exit 0
}

trap cleanup INT TERM EXIT

echo "🔍 Prüfe belegte Ports (5002, 8000)..."
PIDS=$(lsof -ti :5002,8000 2>/dev/null || true)
if [ -n "$PIDS" ]; then
    echo "Beende bestehende Prozesse auf Ports 5002/8000: $PIDS"
    kill -15 $PIDS 2>/dev/null || true
    sleep 1
    # Fallback to SIGKILL if still hanging
    REMAINING=$(lsof -ti :5002,8000 2>/dev/null || true)
    if [ -n "$REMAINING" ]; then
        kill -9 $REMAINING 2>/dev/null || true
    fi
fi

# uv wird für venv und Abhängigkeiten benötigt
if ! command -v uv >/dev/null 2>&1; then
    echo "❌ 'uv' wurde nicht gefunden. Installation:"
    echo "   curl -LsSf https://astral.sh/uv/install.sh | sh   (oder: brew install uv)"
    exit 1
fi

# Python-Version, die das Projekt nutzt (passt zum Docker-Image python:3.14)
PYTHON_VERSION="3.14"

# Vorhandenes venv mit anderer Python-Version neu anlegen
if [ -d "venv" ]; then
    CURRENT_PY=$(venv/bin/python -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")' 2>/dev/null || echo "unbekannt")
    if [ "$CURRENT_PY" != "$PYTHON_VERSION" ]; then
        echo "♻️  venv nutzt Python $CURRENT_PY, benötigt wird $PYTHON_VERSION – erstelle venv neu..."
        rm -rf venv
    fi
fi

# Set up virtual environment (uv lädt Python $PYTHON_VERSION bei Bedarf automatisch herunter)
if [ ! -d "venv" ]; then
    echo "📦 Erstelle virtuelles Environment (venv, Python $PYTHON_VERSION)..."
    uv venv venv --python "$PYTHON_VERSION" --quiet
fi

echo "📦 Aktiviere venv und prüfe Abhängigkeiten..."
source venv/bin/activate
uv pip install -r backend/requirements.txt --quiet

# Development defaults
export ENV=development
export PORT=5002

echo "🚀 Starte Backend auf http://localhost:5002..."
# Arbeitsverzeichnis bleibt der Repo-Root, damit data/ und var/ am bisherigen Ort liegen.
uvicorn --app-dir backend app:app --host 0.0.0.0 --port "$PORT" \
    --reload --reload-dir backend --no-proxy-headers &
BACKEND_PID=$!

echo "🌐 Starte Frontend auf http://localhost:8000..."
python3 -m http.server 8000 --directory frontend &
FRONTEND_PID=$!

echo "✨ Multi-Race-Timer läuft!"
echo "   Frontend: http://localhost:8000"
echo "   Backend:  http://localhost:5002"
echo "   Drücke Strg+C zum Beenden."

wait