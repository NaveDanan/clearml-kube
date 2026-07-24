FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY scheduler.py ./

# Runs as an unprivileged user; no ports are exposed (outbound API calls only).
RUN useradd --create-home --uid 10001 scheduler
USER scheduler

ENTRYPOINT ["python", "-u", "scheduler.py"]
