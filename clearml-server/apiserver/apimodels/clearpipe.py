from jsonmodels import models
from jsonmodels.fields import BoolField, IntField, StringField

from apiserver.apimodels import DictField, ListField
from apiserver.apimodels.base import PagedRequest


class ClearPipeGraphV2(DictField):
    """Transport envelope for CP-06's GraphV2; its contents and migrations are opaque here."""


class ClearPipeDiagnostics(ListField):
    """Opaque diagnostic item; CP-11 owns codes, target paths, and severities."""

    def __init__(self, *args, **kwargs):
        super().__init__([dict], *args, **kwargs)


class ClearPipeCompilerOutput(DictField):
    """Opaque derived compiler output; CP-06/CP-12 own its shape."""


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
    graph = ClearPipeGraphV2(required=True)
    tags = ListField([str])
    public = BoolField(default=False)


class UpdateRequest(DefinitionRequest):
    revision = IntField(required=True)
    name = StringField()
    description = StringField()
    graph = ClearPipeGraphV2()
    tags = ListField([str])
    public = BoolField()


class ValidateRequest(models.Base):
    task = StringField()
    graph = ClearPipeGraphV2()


class StartRequest(DefinitionRequest):
    revision = IntField()
    queue = StringField()
    parameters = DictField()
    node_queues = DictField()
    verify_watched_queue = BoolField(default=True)
    idempotency_key = StringField()
    # "manual" (default) or "schedule". Scheduled triggers are only honored for
    # activated definitions; manual triggers are gated by the caller's own UI.
    trigger = StringField(default="manual")


class SetActivationRequest(DefinitionRequest):
    """Toggle whether a ClearPipe definition is available to run (its scheduler
    fires). Activation is authoring metadata, not a graph change, so it does not
    bump the definition revision."""

    activated = BoolField(required=True)


class LatestRunRequest(DefinitionRequest):
    """Look up the most recent run started from a ClearPipe definition so the
    editor can restore live run state after a refresh."""


class ArchiveRequest(DefinitionRequest):
    revision = IntField()


class DeleteRequest(DefinitionRequest):
    revision = IntField()
    force = BoolField(default=False)


class ParseScriptRequest(models.Base):
    script = StringField(required=True)
    filename = StringField(default="script.py")


class TaskDescriptorRequest(models.Base):
    """Request a safe, stable base-task port descriptor."""

    task = StringField(required=True)
    known_updated_at = StringField()


class TaskInventoryRequest(PagedRequest):
    cursor = StringField()


class TaskReportOutputsRequest(models.Base):
    """Request names-only telemetry descriptors from a base task for Report mapping."""

    task = StringField(required=True)


class ExecutionSnapshotRequest(models.Base):
    """Request a safe live snapshot for one submitted ClearPipe v2 run."""

    run = StringField(required=True)
    definition_revision = IntField()
    graph_digest = StringField()
    node_offset = IntField()
    node_limit = IntField()


class DefinitionResponse(models.Base):
    """Normalized definition envelope; graph internals remain CP-06-owned."""

    definition = DictField(required=True)


class CreateResponse(DefinitionResponse):
    id = StringField(required=True)
    revision = IntField(required=True)


class GetAllResponse(models.Base):
    definitions = ListField([dict], required=True)
    total = IntField(required=True)


class UpdateResponse(DefinitionResponse):
    updated = IntField(required=True)
    revision = IntField(required=True)


class ValidationResponse(models.Base):
    valid = BoolField(required=True)
    issues = ClearPipeDiagnostics(default=[])
    pipeline = ClearPipeCompilerOutput()


class StartResponse(models.Base):
    task = StringField(required=True)
    enqueued = BoolField(required=True)
    queue_watched = BoolField()


class SetActivationResponse(models.Base):
    task = StringField(required=True)
    activated = BoolField(required=True)


class LatestRunResponse(models.Base):
    """`run` is null when the definition has never been started. `running`
    reflects whether the controller task is in a non-terminal state."""

    run = StringField()
    status = StringField()
    running = BoolField(default=False)
    started_at = StringField()
    revision = IntField()


class ArchiveResponse(models.Base):
    updated = IntField(required=True)
    revision = IntField(required=True)


class DeleteResponse(models.Base):
    deleted = BoolField(required=True)


class ParseScriptResponse(models.Base):
    valid = BoolField(required=True)
    parameters = ListField([dict], default=[])
    environment = ListField([str], default=[])
    imports = ListField([str], default=[])
    line_count = IntField(required=True)


class TaskDescriptorResponse(models.Base):
    """
    `descriptor` is present only for a visible task. Parameter values and
    defaults are never descriptor metadata; unavailable access is non-enumerating.
    """

    status = StringField(required=True)
    descriptor = DictField()


class TaskInventoryResponse(models.Base):
    tasks = ListField([dict], required=True)
    total = IntField(required=True)
    next_cursor = StringField()


class TaskReportOutputsResponse(models.Base):
    """
    Names-only telemetry descriptors for a base task. Metric/variant names and
    artifact keys only; no values, URIs, image data, hyperparameters, or secrets.
    """

    status = StringField(required=True)
    outputs = DictField()


class ExecutionSnapshotResponse(models.Base):
    """
    `snapshot` is present only when the run is visible and has a valid,
    server-signed ClearPipeRuntime provenance record.
    """

    status = StringField(required=True)
    snapshot = DictField()
