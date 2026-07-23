from datetime import datetime, timezone
from typing import Optional, Sequence

from apiserver.config_repo import config
from apiserver.database.model.auth import User as AuthUser
from apiserver.database.model.notifications import (
    NotificationChannel,
    NotificationEntityType,
    NotificationSubscription,
    TERMINAL_TASK_STATUSES,
)
from apiserver.database.utils import id as db_id
from .email import EmailSender

log = config.logger(__file__)


class NotificationBLL:
    @staticmethod
    def subscribe(
        company: str,
        user: str,
        entity_type: str,
        entity_id: str,
        events: Sequence[str] = None,
        channel: str = NotificationChannel.email,
    ) -> str:
        """Create or update a subscription for the given user+entity."""
        events = list(events) if events else sorted(TERMINAL_TASK_STATUSES)
        existing: NotificationSubscription = NotificationSubscription.objects(
            company=company,
            user=user,
            entity_type=entity_type,
            entity_id=entity_id,
        ).first()
        if existing:
            existing.update(events=events, channel=channel)
            return existing.id

        sub = NotificationSubscription(
            id=db_id(),
            company=company,
            user=user,
            entity_type=entity_type,
            entity_id=entity_id,
            events=events,
            channel=channel,
            created=datetime.now(timezone.utc),
        )
        sub.save()
        return sub.id

    @staticmethod
    def unsubscribe(
        company: str, user: str, entity_type: str, entity_id: str
    ) -> int:
        return NotificationSubscription.objects(
            company=company,
            user=user,
            entity_type=entity_type,
            entity_id=entity_id,
        ).delete()

    @staticmethod
    def get_subscriptions(
        company: str,
        user: str,
        entity_type: Optional[str] = None,
        entity_id: Optional[str] = None,
    ) -> Sequence[dict]:
        query = dict(company=company, user=user)
        if entity_type:
            query["entity_type"] = entity_type
        if entity_id:
            query["entity_id"] = entity_id
        return [
            {
                "id": s.id,
                "entity_type": s.entity_type,
                "entity": s.entity_id,
                "events": s.events,
                "channel": s.channel,
            }
            for s in NotificationSubscription.objects(**query)
        ]

    @classmethod
    def _emails_for_subscribers(
        cls, company: str, entity_type: str, entity_id: str, event: str
    ) -> Sequence[str]:
        subs = NotificationSubscription.objects(
            company=company,
            entity_type=entity_type,
            entity_id=entity_id,
            events=event,
            channel=NotificationChannel.email,
        ).only("user")
        user_ids = {s.user for s in subs if s.user}
        if not user_ids:
            return []
        users = AuthUser.objects(id__in=list(user_ids)).only("email")
        return [u.email for u in users if u.email]

    @classmethod
    def notify_entity_event(
        cls,
        company: str,
        entity_type: str,
        entity_id: str,
        event: str,
        entity_name: str = None,
        extra_lines: Sequence[str] = None,
    ) -> None:
        """Look up email subscribers for (entity, event) and dispatch email."""
        if not EmailSender.enabled():
            return
        try:
            recipients = cls._emails_for_subscribers(
                company, entity_type, entity_id, event
            )
            if not recipients:
                return

            label = entity_type.capitalize()
            name = entity_name or entity_id
            subject = f"[ClearML] {label} '{name}' {event}"
            lines = [
                f"Your subscribed {entity_type} has reached status '{event}'.",
                "",
                f"{label}: {name}",
                f"Id: {entity_id}",
                f"Status: {event}",
            ]
            if extra_lines:
                lines.extend(["", *extra_lines])
            body_text = "\n".join(lines)
            EmailSender.send_async(recipients, subject, body_text)
        except Exception as ex:
            # Notifications must never break the originating operation.
            log.error(f"Failed dispatching notification for {entity_type} {entity_id}: {ex}")

    @classmethod
    def notify_task_status_changed(cls, task, new_status: str) -> None:
        """Entry point used by the task status-change path."""
        if new_status not in TERMINAL_TASK_STATUSES:
            return
        cls.notify_entity_event(
            company=getattr(task, "company", None),
            entity_type=NotificationEntityType.task,
            entity_id=getattr(task, "id", None),
            event=new_status,
            entity_name=getattr(task, "name", None),
        )
