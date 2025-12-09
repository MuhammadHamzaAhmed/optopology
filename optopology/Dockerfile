FROM python:3.11-slim

# Set environment variables
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV TZ=Asia/Riyadh

# Install system dependencies for uWSGI and general build tools
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    gcc \
    libpcre3 \
    libpcre3-dev \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /usr/src/app

# Copy requirements and install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Create directories for uWSGI spooler and logs
RUN mkdir -p /usr/src/applogs /usr/src/app/spooler

# Copy application source code
COPY src/ .

# Expose port
EXPOSE 5017

# Run uWSGI
CMD ["uwsgi", "--ini", "uwsgi.ini"]
