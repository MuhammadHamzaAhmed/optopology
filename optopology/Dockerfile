FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV TZ=Asia/Riyadh

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    gcc \
    libpcre2-dev \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src/app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

RUN mkdir -p /usr/src/applogs /usr/src/app/spooler

COPY src/ .

EXPOSE 5017

CMD ["uwsgi", "--ini", "uwsgi.ini"]
