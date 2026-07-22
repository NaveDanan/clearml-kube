from jsonmodels import models
from jsonmodels.fields import BoolField, IntField, StringField

from apiserver.apimodels import DictField, ListField
from apiserver.apimodels.base import PagedRequest


class DefinitionRequest(models.Base):
    task = StringField(required=True)


class GetAllRequest(PagedRequest):
    search = StringField()
    project = ListField([str])
    tags = ListField([str])
    include_archived = BoolField(default=False)
    allow_public = BoolField(default=True)


class CreateRequest(models.Base):
    name = StringField(required=True)
    description = StringField(default="")
    graph = DictField(required=True)
    tags = ListField([str])
    public = BoolField(default=False)


class UpdateRequest(DefinitionRequest):
    revision = IntField(required=True)
    name = StringField()
    description = StringField()
    graph = DictField()
    tags = ListField([str])
    public = BoolField()


class ValidateRequest(models.Base):
    task = StringField()
    graph = DictField()


class StartRequest(DefinitionRequest):
    revision = IntField()
    queue = StringField()
    parameters = DictField()
    node_queues = DictField()
    verify_watched_queue = BoolField(default=True)


class ArchiveRequest(DefinitionRequest):
    revision = IntField()


class DeleteRequest(DefinitionRequest):
    revision = IntField()
    force = BoolField(default=False)


class ParseScriptRequest(models.Base):
    script = StringField(required=True)
    filename = StringField(default="script.py")

