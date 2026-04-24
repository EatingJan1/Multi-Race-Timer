FROM python:3.14-slim
#Ich habe 3.11 genutzt

WORKDIR /app

# Copy requirements and install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY app.py .

# Create data directories for persistent storage
RUN mkdir -p /app/data /app/var

# Expose port
EXPOSE 5002

# Run the application
CMD ["python", "app.py"]
