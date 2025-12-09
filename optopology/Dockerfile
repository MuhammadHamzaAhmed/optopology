# Use client-required base image
FROM cisco/python_custom:v1.0

WORKDIR /usr/src/app

# Copy and install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Application code is mounted via volume in docker-compose
