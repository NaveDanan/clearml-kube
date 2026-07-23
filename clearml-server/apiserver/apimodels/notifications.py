from jsonmodels.fields import StringField, ListField, IntField
from jsonmodels.models import Base


class SubscribeRequest(Base):
    entity_type = StringField(required=True)
    entity = StringField(required=True)
    events = ListField(items_types=[str])


class SubscribeResponse(Base):
    id = StringField()


class UnsubscribeRequest(Base):
    entity_type = StringField(required=True)
    entity = StringField(required=True)


class UnsubscribeResponse(Base):
    deleted = IntField()


class GetSubscriptionsRequest(Base):
    entity_type = StringField()
    entity = StringField()
