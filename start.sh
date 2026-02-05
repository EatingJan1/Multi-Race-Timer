#!/bin/bash

# Kill background processes on exit
trap "exit" INT TERM
trap "kill 0" EXIT

# Kill previous instances
echo "🛑 Beende alte Prozesse..."
PIDS=$(lsof -ti :5002,8000)
if [ -n "$PIDS" ]; then
    kill -9 $PIDS 2>/dev/null
fi

# Set up virtual environment
if [ ! -d "venv" ]; then
    echo "Creating virtual environment..."
    python3 -m venv venv
fi

echo "📦 Aktiviere venv und installiere Abhängigkeiten..."
source venv/bin/activate
pip install -r backend/requirements.txt

echo "🚀 Starte Backend auf http://localhost:5002..."
python3 backend/app.py &

echo "🌐 Starte Frontend auf http://localhost:8000..."
python3 -m http.server 8000 --directory frontend &

wait
