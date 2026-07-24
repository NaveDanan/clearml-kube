# ClearPipe scheduler

A standalone service that fires **activated** ClearPipe pipelines according to
their `scheduled` flow node. It is decoupled from the apiserver and talks to it
over the public API, so it deploys as an ordinary single-replica worker.

## Behavior

Every `CLEARPIPE_SCHEDULER_POLL_SECONDS` (default 30s):

1. `clearpipe.get_all` — list non-archived definitions.
2. Keep only those with `activated: true` **and** an enabled `scheduled` node.
3. `clearpipe.latest_run` — read the last run's start time (the stateless
   "last fired" marker; survives scheduler restarts).
4. If the schedule (interval or cron) is due, `clearpipe.start` with
   `trigger="schedule"` and a fresh idempotency key.

Not-Activated definitions are skipped, and the apiserver independently rejects
`trigger=schedule` starts for non-activated definitions (defense in depth).

## Configuration (environment)

| Variable | Default | Purpose |
| --- | --- | --- |
| `CLEARML_API_HOST` | `http://clearml-server-apiserver:8008` | apiserver base URL |
| `CLEARML_API_ACCESS_KEY` | _(required)_ | API credentials key |
| `CLEARML_API_SECRET_KEY` | _(required)_ | API credentials secret |
| `CLEARPIPE_SCHEDULER_POLL_SECONDS` | `30` | poll interval |
| `CLEARPIPE_SCHEDULER_LOG_LEVEL` | `INFO` | log level |

Generate the credentials once in the ClearML web UI (Settings → Workspace →
App Credentials) and provide them as a Kubernetes secret (see the Helm chart).

## Build

```bash
docker build -t clearpipe-scheduler:latest clearml-server/clearpipe-scheduler
```

## Local run

```bash
CLEARML_API_HOST=http://localhost:8008 \
CLEARML_API_ACCESS_KEY=... \
CLEARML_API_SECRET_KEY=... \
python scheduler.py
```
