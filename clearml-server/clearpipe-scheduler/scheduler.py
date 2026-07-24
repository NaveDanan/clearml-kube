"""
ClearPipe scheduler — a standalone service that fires activated ClearPipe
pipelines according to their scheduler node.

It is deliberately decoupled from the apiserver: it talks to it over the public
API using a dedicated credentials pair, so it can be deployed and scaled as an
ordinary single-replica worker rather than living inside the stateless apiserver.

Loop, every POLL_SECONDS:
  1. clearpipe.get_all   -> list visible, non-archived definitions
  2. keep only definitions where `activated` is true and that contain an enabled
     `scheduled` flow node (decoded from the graph node metadata)
  3. clearpipe.latest_run -> the definition's last run start time (the "last fired"
     marker; stateless — survives scheduler restarts)
  4. if the schedule is due, clearpipe.start(trigger="schedule") with a fresh
     idempotency key. The apiserver re-checks activation and rejects the start if
     the definition was deactivated in the meantime.

Not-Activated definitions are never started here (step 2), and the apiserver
enforces the same rule on `trigger=schedule` as defense in depth.
"""
from __future__ import annotations

import base64
import json
import logging
import os
import time
import uuid
from datetime import datetime, timezone
from typing import Any, Mapping, Optional

import requests

try:
    from croniter import croniter
except ImportError:  # pragma: no cover - croniter is a hard runtime dependency
    croniter = None

LOG = logging.getLogger("clearpipe-scheduler")

FLOW_NODE_TAG = "# clearpipe-flow-node:"

UNIT_SECONDS = {
    "minutes": 60,
    "hours": 3600,
    "days": 86400,
    "weeks": 604800,
}

# A scheduled fire is never repeated faster than this, regardless of config, to
# guarantee that a just-started run's timestamp settles before the next poll.
MIN_INTERVAL_SECONDS = 60


class ApiError(RuntimeError):
    pass


class ApiClient:
    """Minimal authenticated ClearML apiserver client (token auth with retry)."""

    def __init__(self, host: str, access_key: str, secret_key: str):
        self.host = host.rstrip("/")
        self._access_key = access_key
        self._secret_key = secret_key
        self._token: Optional[str] = None
        self._session = requests.Session()

    def _login(self) -> None:
        basic = base64.b64encode(f"{self._access_key}:{self._secret_key}".encode()).decode()
        response = self._session.post(
            f"{self.host}/auth.login",
            headers={"Authorization": f"Basic {basic}"},
            timeout=30,
        )
        if response.status_code != 200:
            raise ApiError(f"auth.login failed: {response.status_code} {response.text[:200]}")
        self._token = response.json()["data"]["token"]

    def call(self, action: str, payload: Mapping[str, Any]) -> dict:
        if self._token is None:
            self._login()
        for attempt in range(2):
            response = self._session.post(
                f"{self.host}/{action}",
                headers={
                    "Authorization": f"Bearer {self._token}",
                    "Content-Type": "application/json",
                },
                data=json.dumps(payload),
                timeout=60,
            )
            if response.status_code == 401 and attempt == 0:
                self._login()
                continue
            body = response.json() if response.content else {}
            if response.status_code != 200:
                meta = body.get("meta", {}) if isinstance(body, dict) else {}
                raise ApiError(f"{action} failed: {response.status_code} {meta.get('result_msg', response.text[:200])}")
            return body.get("data", {}) if isinstance(body, dict) else {}
        raise ApiError(f"{action} failed after re-authentication")


def _parse_dt(value: Any) -> Optional[datetime]:
    if not isinstance(value, str) or not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def scheduled_nodes(graph: Mapping[str, Any]) -> list[dict]:
    """Decode enabled `scheduled` flow nodes from a v2 graph's node sources.

    The flow editor embeds each node's authoring metadata as a leading comment
    line `# clearpipe-flow-node:{json}` in the function source (see the web
    clearpipe-flow-codec). We decode that here rather than depend on the codec.
    """
    result: list[dict] = []
    for node in graph.get("nodes") or []:
        source = node.get("source") if isinstance(node, Mapping) else None
        if not isinstance(source, str):
            continue
        for line in source.splitlines():
            stripped = line.lstrip()
            if not stripped.startswith(FLOW_NODE_TAG):
                continue
            try:
                meta = json.loads(stripped[len(FLOW_NODE_TAG):])
            except json.JSONDecodeError:
                break
            config = meta.get("config") or {}
            if meta.get("type") == "scheduled" and config.get("enabled", True):
                result.append(config)
            break
    return result


def is_due(config: Mapping[str, Any], last: Optional[datetime], now: datetime) -> bool:
    if not config.get("enabled", True):
        return False

    start_at = _parse_dt(config.get("startTime"))
    end_at = _parse_dt(config.get("endTime"))
    if start_at and now < start_at:
        return False
    if end_at and now > end_at:
        return False

    # First run after activation fires immediately (once the start window opens).
    if last is None:
        return True

    mode = config.get("scheduleMode", "interval")
    if mode == "interval":
        value = config.get("intervalValue", 1)
        unit = config.get("intervalUnit", "hours")
        try:
            period = max(MIN_INTERVAL_SECONDS, float(value) * UNIT_SECONDS.get(unit, 3600))
        except (TypeError, ValueError):
            period = 3600
        return (now - last).total_seconds() >= period

    if mode == "cron":
        if croniter is None:
            LOG.warning("croniter unavailable; cannot evaluate cron schedule")
            return False
        expression = config.get("cron", "0 * * * *")
        try:
            next_fire = croniter(expression, last).get_next(datetime)
        except (ValueError, KeyError):
            LOG.warning("invalid cron expression: %s", expression)
            return False
        if next_fire.tzinfo is None:
            next_fire = next_fire.replace(tzinfo=timezone.utc)
        return next_fire <= now

    return False


class Scheduler:
    def __init__(self, client: ApiClient, poll_seconds: int):
        self.client = client
        self.poll_seconds = poll_seconds
        # In-memory guard so a just-fired definition is not re-fired before its
        # run's start timestamp is observable via latest_run.
        self._recent_fire: dict[str, float] = {}

    def _definitions(self) -> list[dict]:
        data = self.client.call(
            "clearpipe.get_all",
            {"page": 0, "page_size": 500, "include_archived": False, "allow_public": False},
        )
        return list(data.get("definitions") or [])

    def _last_fired(self, definition_id: str) -> Optional[datetime]:
        data = self.client.call("clearpipe.latest_run", {"task": definition_id})
        return _parse_dt(data.get("started_at"))

    def _fire(self, definition: Mapping[str, Any]) -> None:
        definition_id = definition["id"]
        LOG.info("firing scheduled pipeline %s (%s)", definition.get("name"), definition_id)
        self.client.call(
            "clearpipe.start",
            {
                "task": definition_id,
                "trigger": "schedule",
                "idempotency_key": str(uuid.uuid4()),
                "verify_watched_queue": False,
            },
        )
        self._recent_fire[definition_id] = time.monotonic()

    def tick(self) -> None:
        now = datetime.now(timezone.utc)
        for definition in self._definitions():
            definition_id = definition.get("id")
            if not definition_id or not definition.get("activated"):
                continue
            configs = scheduled_nodes(definition.get("graph") or {})
            if not configs:
                continue
            recent = self._recent_fire.get(definition_id)
            if recent is not None and (time.monotonic() - recent) < (2 * self.poll_seconds):
                continue
            try:
                last = self._last_fired(definition_id)
            except ApiError as error:
                LOG.warning("latest_run failed for %s: %s", definition_id, error)
                continue
            if any(is_due(config, last, now) for config in configs):
                try:
                    self._fire(definition)
                except ApiError as error:
                    LOG.warning("start failed for %s: %s", definition_id, error)

    def run_forever(self) -> None:
        LOG.info("clearpipe scheduler started (poll=%ss, host=%s)", self.poll_seconds, self.client.host)
        while True:
            try:
                self.tick()
            except ApiError as error:
                LOG.warning("scheduler tick failed: %s", error)
            except Exception:  # pragma: no cover - keep the loop alive
                LOG.exception("unexpected scheduler error")
            time.sleep(self.poll_seconds)


def build_scheduler() -> Scheduler:
    host = os.environ.get("CLEARML_API_HOST", "http://clearml-server-apiserver:8008").rstrip("/")
    access_key = os.environ.get("CLEARML_API_ACCESS_KEY", "")
    secret_key = os.environ.get("CLEARML_API_SECRET_KEY", "")
    poll_seconds = int(os.environ.get("CLEARPIPE_SCHEDULER_POLL_SECONDS", "30"))
    if not access_key or not secret_key:
        raise SystemExit("CLEARML_API_ACCESS_KEY and CLEARML_API_SECRET_KEY are required")
    return Scheduler(ApiClient(host, access_key, secret_key), poll_seconds)


def main() -> None:
    logging.basicConfig(
        level=os.environ.get("CLEARPIPE_SCHEDULER_LOG_LEVEL", "INFO"),
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    build_scheduler().run_forever()


if __name__ == "__main__":
    main()
