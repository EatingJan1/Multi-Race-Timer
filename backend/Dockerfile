FROM python:3.11-slim

WORKDIR /app

# Copy requirements and install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY app.py .

# Create data directory for persistent storage
RUN mkdir -p /app/data

# Expose port
EXPOSE 5002

# Run the application
CMD ["python", "app.py"]