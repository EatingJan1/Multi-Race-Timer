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

# Set up virtual environment
if [ ! -d "venv" ]; then
    echo "📦 Erstelle virtuelles Environment (venv)..."
    python3 -m venv venv
fi

echo "📦 Aktiviere venv und prüfe Abhängigkeiten..."
source venv/bin/activate
pip install -r backend/requirements.txt --quiet

# Development defaults
export FLASK_ENV=development
export FLASK_DEBUG=1
export PORT=5002

echo "🚀 Starte Backend auf http://localhost:5002..."
python3 backend/app.py &
BACKEND_PID=$!

echo "🌐 Starte Frontend auf http://localhost:8000..."
python3 -m http.server 8000 --directory frontend &
FRONTEND_PID=$!

echo "✨ Multi-Race-Timer läuft!"
echo "   Frontend: http://localhost:8000"
echo "   Backend:  http://localhost:5002"
echo "   Drücke Strg+C zum Beenden."

wait
