from mongoengine import StringField, DateTimeField, ListField

from apiserver.database import Database, strict
from apiserver.database.model import DbModelMixin, AttributedDocument


class NotificationChannel:
    email = "email"


class NotificationEntityType:
    task = "task"
    pipeline = "pipeline"
    dataset = "dataset"
    report = "report"


# Task statuses that represent a finished/terminal run and can trigger a notification.
TERMINAL_TASK_STATUSES = frozenset(
    {"completed", "failed", "stopped", "closed", "published"}
)


class NotificationSubscription(DbModelMixin, AttributedDocument):
    """
    A user's request to be notified (currently by email) when a given entity
    reaches one of the subscribed events (e.g. a task/pipeline/dataset/report
    finishing). Stored per company + subscribing user.
    """

    meta = {
        "db_alias": Database.backend,
        "strict": strict,
        "indexes": [
            ("company", "entity_type", "entity_id"),
            ("company", "user"),
            {
                "fields": ("company", "user", "entity_type", "entity_id"),
                "unique": True,
            },
        ],
    }

    id = StringField(primary_key=True)
    entity_type = StringField(required=True)
    """ One of NotificationEntityType """

    entity_id = StringField(required=True)
    """ Id of the subscribed entity """

    events = ListField(StringField(), default=list)
    """ Events/statuses the user wants to be notified about (e.g. task statuses) """

    channel = StringField(default=NotificationChannel.email)
    created = DateTimeField()
