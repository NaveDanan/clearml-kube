import hmac
import json
import re
import uuid
from hashlib import sha256
from copy import deepcopy
from datetime import datetime, timezone
from typing import Mapping, Optional, Tuple

from mongoengine import Q
from mongoengine.errors import NotUniqueError

from apiserver.apierrors import APIError, errors
from apiserver.apierrors.base import BaseError
from apiserver.apimodels.clearpipe import (
    ArchiveRequest,
    ArchiveResponse,
    CreateRequest,
    CreateResponse,
    DeleteResponse,
    DefinitionRequest,
    DefinitionResponse,
    DeleteRequest,
    ExecutionSnapshotRequest,
    ExecutionSnapshotResponse,
    GetAllRequest,
    GetAllResponse,
    ParseScriptRequest,
    ParseScriptResponse,
    StartRequest,
    StartResponse,
    TaskDescriptorRequest,
    TaskDescriptorResponse,
    TaskInventoryRequest,
    TaskInventoryResponse,
    UpdateRequest,
    UpdateResponse,
    ValidateRequest,
    ValidationResponse,
)
from apiserver.bll.clearpipe import (
    GraphValidator,
    can_read_definition,
    can_write_definition,
    compile_definition,
    parse_python_script,
)
from apiserver.bll.clearpipe.graph_v2 import (
    _is_secret_key,
    _is_sensitive_url,
    read_graph_v2,
    serialize_graph_v2,
)
from apiserver.bll.clearpipe.generation.compiler import GenerationError, compile_graph
from apiserver.bll.clearpipe.generation.contracts import ClearPipeRuntimeConfiguration, GeneratedDefinition
from apiserver.bll.clearpipe.generation.function import lower_function_node
from apiserver.bll.clearpipe.validation import (
    DiagnosticTarget,
    ValidationIssue,
    ValidationResult,
)
from apiserver.bll.project import ProjectBLL
from apiserver.bll.queue import QueueBLL
from apiserver.bll.task import TaskBLL
from apiserver.bll.task.task_operations import enqueue_task
from apiserver.bll.util import update_project_time
from apiserver.config_repo import config
from apiserver.database.errors import translate_errors_context
from apiserver.database.model import EntityVisibility
from apiserver.database.model.model import Model
from apiserver.database.model.project import Project
from apiserver.database.model.settings import Settings
from apiserver.database.model.task.task import (
    ConfigurationItem,
    ParamsItem,
    Task,
    TaskStatus,
    TaskType,
)
from apiserver.database.utils import id as create_id
from apiserver.service_repo import APICall, endpoint
from apiserver.sync import distributed_lock
from apiserver.utilities.dicts import nested_get
from apiserver.utilities.parameter_key_escaper import ParameterKeyEscaper


CLEARPIPE_TAG = "clearpipe"
PIPELINE_TAG = "pipeline"
MAX_PAGE_SIZE = 500
CLEARPIPE_RUNTIME_CONFIGURATION = "ClearPipeRuntime"
CLEARPIPE_RUNTIME_SCHEMA_VERSION = 1
CLEARPIPE_RUNTIME_PROVENANCE = "clearpipe_runtime_provenance"
CLEARPIPE_IDEMPOTENCY = "clearpipe_idempotency"
CLEARPIPE_IDEMPOTENCY_SETTING_PREFIX = "clearpipe.idempotency"
CLEARPIPE_IDEMPOTENCY_SCHEMA_VERSION = 2
CLEARPIPE_RUNTIME_PROVENANCE_VERSION = 2
CLEARPIPE_LEGACY_PROVENANCE_VERSION = 1
CLEARPIPE_LEGACY_PROVENANCE_KEY_ID = "legacy-auth-token-v1"
MAX_RUNTIME_SNAPSHOT_PAGE_SIZE = 100
MAX_RUNTIME_SNAPSHOT_MODELS = 500
MAX_RUNTIME_ARTIFACTS_PER_NODE = 5
MAX_TASK_INVENTORY_PAGE_SIZE = 100
DESCRIPTOR_TASK_FIELDS = (
    "id",
    "name",
    "type",
    "status",
    "project",
    "last_update",
    "parent",
    "runtime",
)
SNAPSHOT_RUN_FIELDS = (
    "id",
    "type",
    "status",
    "started",
    "completed",
    "last_update",
    "runtime",
    "configuration.ClearPipeRuntime",
    "configuration.Pipeline",
)
_SECRET_PARAMETER_VALUE = re.compile(
    r"(?i)(?:(?:^|[^a-z0-9])(?:password|passwd|secret|token|api[_-]?key|"
    r"access[_-]?key|private[_-]?key|credential)s?(?:$|[^a-z0-9])|"
    r"-----BEGIN(?: [A-Z]+)? PRIVATE KEY-----|"
    r"(?:^|[\s=:])(?:bearer|basic)\s+[A-Za-z0-9._~+/=-]+|"
    r"^(?:eyJ[A-Za-z0-9_-]+\.){2}[A-Za-z0-9_-]+$|"
    r"^(?:AKIA|ASIA)[A-Z0-9]{16}$|^AIza[A-Za-z0-9_-]{35}$|"
    r"^sk-[A-Za-z0-9_-]{16,}$|^gh[pousr]_[A-Za-z0-9_]+$|"
    r"^glpat-[A-Za-z0-9_-]+$|^xox[baprs]-[A-Za-z0-9-]+$)"
)


class RevisionConflict(BaseError):
    _default_code = 409
    _default_subcode = 1
    _default_msg = "ClearPipe definition revision conflict"


task_bll = TaskBLL()
queue_bll = QueueBLL()


def _visible_query(company_id: str, allow_public: bool = True) -> Q:
    return Q(company=company_id) | Q(company="") if allow_public else Q(company=company_id)


def _owned_query(company_id: str) -> Q:
    return Q(company=company_id) | Q(company="", company_origin=company_id)


def _definition_query() -> Q:
    return Q(system_tags__all=[PIPELINE_TAG, CLEARPIPE_TAG], type=TaskType.controller)


def _get_task(company_id: str, task_id: str, allow_public: bool = True, owned: bool = False) -> Task:
    access = _owned_query(company_id) if owned else _visible_query(company_id, allow_public)
    task = Task.objects(Q(id=task_id) & access & _definition_query()).all_fields().first()
    allowed = task and (
        can_write_definition(task.company, task.company_origin, company_id)
        if owned
        else can_read_definition(task.company, task.company_origin, company_id, allow_public)
    )
    if not allowed:
        raise errors.bad_request.InvalidTaskId(id=task_id)
    return task


def _configuration_value(task: Task, name: str):
    item = (task.configuration or {}).get(name)
    if not item:
        return None
    try:
        return json.loads(item.value)
    except (TypeError, ValueError, json.JSONDecodeError) as ex:
        raise errors.bad_request.ValidationError(
            f"ClearPipe definition has malformed {name} configuration", task=task.id
        ) from ex


def _graph(task: Task) -> dict:
    graph = _configuration_value(task, "ClearPipe")
    if not isinstance(graph, dict):
        raise errors.bad_request.ValidationError(
            "Task does not contain a ClearPipe definition", task=task.id
        )
    return graph


def _revision(task: Task) -> int:
    runtime_revision = (task.runtime or {}).get("clearpipe_revision")
    graph = _graph(task)
    graph_revision = graph.get("revision")
    if _is_v2_graph(graph):
        if isinstance(runtime_revision, int):
            return runtime_revision
    elif isinstance(runtime_revision, int) and runtime_revision == graph_revision:
        return runtime_revision
    raise errors.bad_request.ValidationError(
        "ClearPipe definition revision metadata is inconsistent", task=task.id
    )


def _is_v2_graph(graph: Mapping) -> bool:
    return isinstance(graph, Mapping) and graph.get("schema_version") == 2


def _compiler_issue(diagnostic) -> ValidationIssue:
    node_id = diagnostic.graph_element_id
    return ValidationIssue.create(
        code=diagnostic.code,
        target=DiagnosticTarget(
            kind="node" if node_id else "graph" if diagnostic.path == "graph" else "field",
            path=diagnostic.path,
            node_id=node_id,
        ),
        message=diagnostic.message,
        correction="Correct the indicated graph field or use a supported ClearPipe lowering.",
    )


def _compile_v2(graph: Mapping) -> GeneratedDefinition:
    parsed = read_graph_v2(graph)
    if not parsed.is_supported:
        raise ValueError("ClearPipe graph v2 could not be compiled")
    return compile_graph(parsed.graph, lowerers={"function": lower_function_node})


def _v2_validation_result(
    graph: Mapping,
    resource_checker=None,
    queue_checker=None,
) -> ValidationResult:
    parsed = read_graph_v2(graph)
    if parsed.status == "unsupported":
        issue = ValidationIssue.create(
            code="CPSTR002",
            target=DiagnosticTarget(
                kind="graph",
                path=parsed.unsupported.path if parsed.unsupported else "graph",
            ),
            message="ClearPipe graph v2 uses an unsupported feature",
            correction="Inspect the original graph without converting or dropping graph data.",
        )
        return ValidationResult([issue])
    if not parsed.is_supported:
        code = "CPSEM010" if parsed.errors and parsed.errors[0].code == "secret_not_allowed" else "CPSTR001"
        return ValidationResult(
            [
                ValidationIssue.create(
                    code=code,
                    target=DiagnosticTarget(kind="graph", path=issue.path),
                    message=(
                        "Secret or credential material is not allowed in a ClearPipe graph."
                        if code == "CPSEM010"
                        else "The document is not a valid canonical ClearPipe v2 graph."
                    ),
                    correction=(
                        "Use an approved opaque runtime reference; never store the secret value in the graph."
                        if code == "CPSEM010"
                        else "Correct the indicated graph field without dropping unrelated graph data."
                    ),
                )
                for issue in parsed.errors
            ]
        )
    result = GraphValidator(
        resource_checker=resource_checker,
        queue_checker=queue_checker,
    ).validate(graph)
    if not result.valid:
        return result
    try:
        _compile_v2(graph)
    except GenerationError as error:
        return ValidationResult(result.issues + tuple(_compiler_issue(item) for item in error.diagnostics))
    except (TypeError, ValueError, MemoryError):
        return ValidationResult(
            result.issues
            + (
                ValidationIssue.create(
                    code="CPGEN002",
                    target=DiagnosticTarget(kind="graph", path="graph"),
                    message="ClearPipe graph could not be compiled safely.",
                    correction="Correct the graph or use a supported ClearPipe lowering.",
                ),
            )
        )
    return result


def _canonical_v2_configuration(graph: Mapping) -> dict:
    parsed = read_graph_v2(graph)
    if not parsed.is_supported:
        _assert_valid(_v2_validation_result(graph))
        raise errors.bad_request.ValidationError("ClearPipe graph v2 could not be persisted")
    return {
        "ClearPipe": ConfigurationItem(
            name="ClearPipe",
            value=serialize_graph_v2(parsed.graph),
            type="json",
            description="Canonical ClearPipe graph v2 definition",
        )
    }


def _runtime_configuration(generated: GeneratedDefinition, revision: int) -> ClearPipeRuntimeConfiguration:
    return ClearPipeRuntimeConfiguration(
        schema_version=CLEARPIPE_RUNTIME_SCHEMA_VERSION,
        definition_revision=revision,
        graph_schema_version=generated.manifest.graph_schema_version,
        graph_digest=generated.manifest.graph_digest,
        runtime_steps=generated.manifest.runtime_steps,
        source_map=generated.source_map,
    )


def _stored_runtime_configuration(task: Task) -> Optional[ClearPipeRuntimeConfiguration]:
    value = _configuration_value(task, CLEARPIPE_RUNTIME_CONFIGURATION)
    if value is None:
        return None
    try:
        return ClearPipeRuntimeConfiguration.from_dict(value)
    except (TypeError, ValueError) as ex:
        raise errors.bad_request.ValidationError(
            "ClearPipe definition has malformed compiled runtime metadata",
            task=task.id,
        ) from ex


def _safe_stored_runtime_configuration(
    task: Task,
) -> Optional[ClearPipeRuntimeConfiguration]:
    """Return no runtime map rather than exposing malformed controller metadata."""

    try:
        return _stored_runtime_configuration(task)
    except errors.bad_request.ValidationError:
        return None


def _runtime_configuration_digest(task: Task) -> Optional[str]:
    item = (task.configuration or {}).get(CLEARPIPE_RUNTIME_CONFIGURATION)
    value = getattr(item, "value", None)
    return (
        sha256(value.encode("utf-8")).hexdigest()
        if isinstance(value, str)
        else None
    )


def _runtime_provenance_key_ring() -> tuple:
    """
    Return the configured signing key plus explicitly active verification keys.
    New v2 runs require a dedicated current ClearPipe key. The legacy auth
    secret participates only when migration explicitly opts it into transition
    verification.
    """

    configured = config.get("secure.clearpipe.provenance_keys", None)
    legacy_secret = config.get("secure.auth.token_secret", None)
    if not isinstance(configured, Mapping):
        return None, None, {}
    current_key_id = configured.get("current_key_id")
    keys = configured.get("keys")
    transition_key_ids = configured.get("transition_key_ids", ())
    allow_legacy = configured.get("allow_legacy_auth_token_verification", False)
    if (
        not isinstance(current_key_id, str)
        or not current_key_id
        or current_key_id == CLEARPIPE_LEGACY_PROVENANCE_KEY_ID
        or not isinstance(keys, Mapping)
        or not isinstance(transition_key_ids, (list, tuple))
        or not all(isinstance(key_id, str) and key_id for key_id in transition_key_ids)
        or type(allow_legacy) is not bool
    ):
        return None, None, {}
    active_key_ids = {current_key_id, *transition_key_ids}
    active_keys = {
        key_id: secret
        for key_id, secret in keys.items()
        if key_id in active_key_ids and isinstance(secret, str) and secret
    }
    if (
        allow_legacy
        and CLEARPIPE_LEGACY_PROVENANCE_KEY_ID in active_key_ids
        and isinstance(legacy_secret, str)
        and legacy_secret
    ):
        active_keys.setdefault(CLEARPIPE_LEGACY_PROVENANCE_KEY_ID, legacy_secret)
    signing_secret = active_keys.get(current_key_id)
    return current_key_id, signing_secret, active_keys


def _runtime_provenance_signing_key() -> Optional[tuple]:
    key_id, secret, _ = _runtime_provenance_key_ring()
    return (key_id, secret) if isinstance(secret, str) and secret else None


def _runtime_provenance_signature(payload: Mapping, secret: str) -> str:
    encoded = json.dumps(
        payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False
    ).encode("utf-8")
    return hmac.new(
        secret.encode("utf-8"), encoded, digestmod="sha256"
    ).hexdigest()


def _runtime_provenance(
    run_id: str,
    company_id: str,
    definition_id: str,
    runtime: ClearPipeRuntimeConfiguration,
    runtime_configuration_value: str,
) -> dict:
    signing_key = _runtime_provenance_signing_key()
    if signing_key is None:
        raise errors.server_error.InternalError(
            "ClearPipe runtime provenance signing is unavailable"
        )
    key_id, signing_secret = signing_key
    payload = {
        "schema_version": CLEARPIPE_RUNTIME_PROVENANCE_VERSION,
        "key_id": key_id,
        "run_task_id": run_id,
        "company_id": company_id,
        "definition_task_id": definition_id,
        "definition_revision": runtime.definition_revision,
        "graph_digest": runtime.graph_digest,
        "runtime_configuration_digest": sha256(
            runtime_configuration_value.encode("utf-8")
        ).hexdigest(),
    }
    return {**payload, "signature": _runtime_provenance_signature(payload, signing_secret)}


def _verified_runtime_provenance(
    run: Task, company_id: str
) -> Optional[ClearPipeRuntimeConfiguration]:
    provenance = (run.runtime or {}).get(CLEARPIPE_RUNTIME_PROVENANCE)
    v2_keys = {
        "schema_version",
        "key_id",
        "run_task_id",
        "company_id",
        "definition_task_id",
        "definition_revision",
        "graph_digest",
        "runtime_configuration_digest",
        "signature",
    }
    v1_keys = v2_keys - {"key_id"}
    if not isinstance(provenance, Mapping) or (
        set(provenance) != v1_keys and set(provenance) != v2_keys
    ):
        return None
    signature = provenance.get("signature")
    payload = {key: value for key, value in provenance.items() if key != "signature"}
    schema_version = payload.get("schema_version")
    key_id = (
        payload.get("key_id")
        if schema_version == CLEARPIPE_RUNTIME_PROVENANCE_VERSION
        else CLEARPIPE_LEGACY_PROVENANCE_KEY_ID
        if schema_version == CLEARPIPE_LEGACY_PROVENANCE_VERSION
        else None
    )
    verification_secret = (
        _runtime_provenance_key_ring()[2].get(key_id)
        if isinstance(key_id, str)
        else None
    )
    if (
        not isinstance(signature, str)
        or not isinstance(verification_secret, str)
        or not hmac.compare_digest(
            signature, _runtime_provenance_signature(payload, verification_secret)
        )
        or schema_version
        not in {
            CLEARPIPE_LEGACY_PROVENANCE_VERSION,
            CLEARPIPE_RUNTIME_PROVENANCE_VERSION,
        }
        or payload.get("run_task_id") != run.id
        or payload.get("company_id") != company_id
        or not isinstance(payload.get("definition_task_id"), str)
        or not isinstance(payload.get("definition_revision"), int)
        or not isinstance(payload.get("graph_digest"), str)
        or not isinstance(payload.get("runtime_configuration_digest"), str)
    ):
        return None
    runtime_digest = _runtime_configuration_digest(run)
    runtime = _safe_stored_runtime_configuration(run)
    if (
        runtime is None
        or runtime_digest != payload["runtime_configuration_digest"]
        or runtime.definition_revision != payload["definition_revision"]
        or runtime.graph_digest != payload["graph_digest"]
    ):
        return None
    if _visible_definition(company_id, payload["definition_task_id"]) is None:
        return None
    return runtime


def _idempotency_key(value) -> str:
    if not isinstance(value, str):
        raise errors.bad_request.ValidationError("Invalid ClearPipe idempotency key")
    try:
        parsed = uuid.UUID(value)
    except (AttributeError, ValueError, TypeError):
        raise errors.bad_request.ValidationError("Invalid ClearPipe idempotency key")
    if parsed.version != 4 or str(parsed) != value.lower():
        raise errors.bad_request.ValidationError("Invalid ClearPipe idempotency key")
    return str(parsed)


def _start_fingerprint(
    definition_id: str, revision: int, user_id: str, request, queue_id: str
) -> str:
    value = {
        "definition_id": definition_id,
        "revision": revision,
        "user_id": user_id,
        "queue_id": queue_id,
        "parameters": request.parameters or {},
        "node_queues": request.node_queues or {},
    }
    return sha256(
        json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    ).hexdigest()


def _idempotency_slot(company_id: str, user_id: str, key: str) -> str:
    """Derive a fixed, non-reversible persistence key without storing the UUID."""

    return sha256(
        "{}\0{}\0{}".format(company_id, user_id, key).encode("utf-8")
    ).hexdigest()


def _idempotency_setting_key(slot: str) -> str:
    return "{}.{}".format(CLEARPIPE_IDEMPOTENCY_SETTING_PREFIX, slot)


def _sealed_idempotency(
    slot: str,
    company_id: str,
    definition_id: str,
    revision: int,
    user_id: str,
    fingerprint: str,
    queue_id: str,
    run_id: str,
    state: str,
    enqueued: Optional[bool] = None,
) -> dict:
    signing_key = _runtime_provenance_signing_key()
    if signing_key is None:
        raise errors.server_error.InternalError("ClearPipe idempotency signing is unavailable")
    key_id, secret = signing_key
    payload = {
        "schema_version": CLEARPIPE_IDEMPOTENCY_SCHEMA_VERSION,
        "key_id": key_id,
        "key_hash": slot,
        "company_id": company_id,
        "definition_id": definition_id,
        "revision": revision,
        "user_id": user_id,
        "fingerprint": fingerprint,
        "queue_id": queue_id,
        "run_id": run_id,
        "state": state,
    }
    if enqueued is not None:
        payload["enqueued"] = bool(enqueued)
    return {**payload, "signature": _runtime_provenance_signature(payload, secret)}


def _verified_idempotency_record(record) -> Optional[dict]:
    """Return only signed, bounded metadata; request values are never persisted."""

    required = {
        "schema_version", "key_id", "key_hash", "company_id", "definition_id",
        "revision", "user_id", "fingerprint", "queue_id", "run_id", "state",
        "signature",
    }
    if not isinstance(record, Mapping) or not required.issubset(record):
        return None
    if set(record) - (required | {"enqueued"}):
        return None
    payload = {key: value for key, value in record.items() if key != "signature"}
    signature = record.get("signature")
    _, _, verification_keys = _runtime_provenance_key_ring()
    secret = verification_keys.get(payload.get("key_id"))
    string_fields = (
        "key_hash", "company_id", "definition_id", "user_id", "fingerprint",
        "queue_id", "run_id",
    )
    if (
        not isinstance(signature, str)
        or not isinstance(secret, str)
        or payload.get("schema_version") != CLEARPIPE_IDEMPOTENCY_SCHEMA_VERSION
        or payload.get("state") not in {"reserved", "pending", "committed"}
        or not isinstance(payload.get("revision"), int)
        or not all(
            isinstance(payload.get(field), str)
            and payload[field]
            and len(payload[field]) <= 256
            for field in string_fields
        )
        or not re.fullmatch(r"[0-9a-f]{64}", payload["key_hash"])
        or not re.fullmatch(r"[0-9a-f]{64}", payload["fingerprint"])
        or not hmac.compare_digest(
            signature, _runtime_provenance_signature(payload, secret)
        )
    ):
        return None
    return dict(record)


def _verified_idempotency(run: Task) -> Optional[dict]:
    record = (run.runtime or {}).get(CLEARPIPE_IDEMPOTENCY)
    return _verified_idempotency_record(record)


def _idempotency_matches(
    record: Mapping,
    company_id: str,
    user_id: str,
    slot: str,
    fingerprint: str,
) -> bool:
    return (
        record.get("company_id") == company_id
        and record.get("user_id") == user_id
        and record.get("key_hash") == slot
        and record.get("fingerprint") == fingerprint
    )


def _assert_idempotency_matches(
    record: Mapping,
    company_id: str,
    user_id: str,
    slot: str,
    fingerprint: str,
):
    if not _idempotency_matches(record, company_id, user_id, slot, fingerprint):
        raise errors.bad_request.ValidationError(
            "ClearPipe idempotency key is already bound to a different request"
        )


def _idempotency_reservation(
    company_id: str,
    user_id: str,
    key: str,
    definition_id: str,
    revision: int,
    fingerprint: str,
) -> Optional[dict]:
    """Read and validate the caller-scoped durable reservation, if it exists."""

    slot = _idempotency_slot(company_id, user_id, key)
    record = Settings.get_by_key(_idempotency_setting_key(slot))
    if record is None:
        return None
    record = _verified_idempotency_record(record)
    if record is None:
        raise errors.server_error.InternalError(
            "ClearPipe idempotency reservation is unavailable"
        )
    _assert_idempotency_matches(
        record, company_id, user_id, slot, fingerprint
    )
    if (
        record["definition_id"] != definition_id
        or record["revision"] != revision
    ):
        raise errors.bad_request.ValidationError(
            "ClearPipe idempotency key is already bound to a different request"
        )
    return record


def _reserve_idempotency(
    company_id: str,
    user_id: str,
    key: str,
    definition_id: str,
    revision: int,
    fingerprint: str,
    queue_id: str,
) -> dict:
    """
    Atomically reserve one opaque request record before creating a controller.

    Settings.add_value uses the existing primary-key insert convention. Its
    deterministic key scopes the reservation to the company and caller while
    its signed value binds the exact request fingerprint and random run ID.
    """

    slot = _idempotency_slot(company_id, user_id, key)
    setting_key = _idempotency_setting_key(slot)
    reservation = _sealed_idempotency(
        slot,
        company_id,
        definition_id,
        revision,
        user_id,
        fingerprint,
        queue_id,
        run_id=create_id(),
        state="reserved",
    )
    if Settings.add_value(setting_key, reservation):
        return reservation

    existing = _idempotency_reservation(
        company_id, user_id, key, definition_id, revision, fingerprint
    )
    if existing is None:
        raise errors.server_error.InternalError(
            "ClearPipe idempotency reservation is unavailable"
        )
    return existing


def _update_idempotency_reservation(
    record: Mapping, *, state: str, enqueued=None
) -> dict:
    updated = _sealed_idempotency(
        record["key_hash"],
        record["company_id"],
        record["definition_id"],
        record["revision"],
        record["user_id"],
        record["fingerprint"],
        record["queue_id"],
        record["run_id"],
        state=state,
        enqueued=enqueued,
    )
    Settings.set_or_add_value(
        _idempotency_setting_key(record["key_hash"]), updated
    )
    return updated


def _idempotent_run(
    company_id: str, user_id: str, reservation: Mapping
) -> Optional[Tuple[Task, dict]]:
    """Find only the run reserved for this authenticated caller and request."""

    run = (
        Task.objects(Q(id=reservation["run_id"], company=company_id))
        .only("id", "runtime", "status")
        .first()
    )
    if run is None:
        return None
    record = _verified_idempotency(run)
    if record is None or not _idempotency_matches(
        record,
        company_id,
        user_id,
        reservation["key_hash"],
        reservation["fingerprint"],
    ):
        raise errors.server_error.InternalError(
            "ClearPipe idempotency reservation is inconsistent"
        )
    if (
        record["definition_id"] != reservation["definition_id"]
        or record["revision"] != reservation["revision"]
        or record["queue_id"] != reservation["queue_id"]
        or record["run_id"] != reservation["run_id"]
    ):
        raise errors.server_error.InternalError(
            "ClearPipe idempotency reservation is inconsistent"
        )
    return run, record


def _commit_idempotent_run(
    run: Task, company_id: str, record: Mapping, enqueued: bool
) -> dict:
    committed = _sealed_idempotency(
        record["key_hash"],
        record["company_id"],
        record["definition_id"],
        record["revision"],
        record["user_id"],
        record["fingerprint"],
        record["queue_id"],
        record["run_id"],
        state="committed",
        enqueued=enqueued,
    )
    updated = Task.objects(
        Q(
            id=run.id,
            company=company_id,
            runtime__clearpipe_idempotency__state="pending",
            runtime__clearpipe_idempotency__signature=record["signature"],
        )
    ).update_one(set__runtime__clearpipe_idempotency=committed)
    if not updated:
        latest = _idempotent_run(company_id, record["user_id"], record)
        if latest is None or latest[1]["state"] != "committed":
            raise errors.server_error.InternalError(
                "ClearPipe idempotency state could not be committed"
            )
        return latest[1]
    return committed


def _v2_configurations(graph: Mapping, generated: GeneratedDefinition, revision: int) -> dict:
    configurations = _canonical_v2_configuration(graph)
    runtime = _runtime_configuration(generated, revision)
    # PipelineController owns its live Pipeline monitoring configuration when
    # the cloned Agent task starts. Never seed it from the lossy v1 projection.
    configurations[CLEARPIPE_RUNTIME_CONFIGURATION] = ConfigurationItem(
        name=CLEARPIPE_RUNTIME_CONFIGURATION,
        value=json.dumps(runtime.to_dict(), separators=(",", ":"), ensure_ascii=False),
        type="json",
        description="ClearPipe v2 compiled runtime identity and source map",
    )
    return configurations


def _compiler_output(generated: GeneratedDefinition, revision: int) -> dict:
    runtime = _runtime_configuration(generated, revision)
    return {
        "source": generated.source,
        "source_map": [
            {
                "graph_element_id": entry.graph_element_id,
                "start_line": entry.start_line,
                "end_line": entry.end_line,
            }
            for entry in generated.source_map
        ],
        "manifest": {
            "graph_schema_version": generated.manifest.graph_schema_version,
            "graph_digest": generated.manifest.graph_digest,
            "node_ids": list(generated.manifest.node_ids),
            "runtime_steps": [item.to_dict() for item in generated.manifest.runtime_steps],
        },
        "runtime": runtime.to_dict(),
    }


def _controller_launch_script(source: str, parameter_names=()) -> str:
    """Keep the compiler no-launch while making the cloned Agent task executable."""

    launch_preamble = ""
    if parameter_names:
        launch_preamble = (
            "\n"
            "from clearml import Task as _ClearPipeControllerTask\n"
            "_clearpipe_parameter_values = "
            "_ClearPipeControllerTask.current_task().get_parameters_as_dict(cast=True).get(\"Args\", {})\n"
            "for _clearpipe_parameter_name in "
            + json.dumps(list(parameter_names), ensure_ascii=False)
            + ":\n"
            "    if _clearpipe_parameter_name in _clearpipe_parameter_values:\n"
            "        pipe.get_parameters()[_clearpipe_parameter_name] = "
            "_clearpipe_parameter_values[_clearpipe_parameter_name]\n"
        )
    return '{}{}\nif __name__ == "__main__":\n    pipe.start()\n'.format(
        source.rstrip("\n"),
        launch_preamble,
    )


def _secret_parameter_material(value) -> bool:
    if isinstance(value, Mapping):
        return any(
            _is_secret_key(str(key))
            or _secret_parameter_material(child)
            for key, child in value.items()
        )
    if isinstance(value, list):
        return any(_secret_parameter_material(item) for item in value)
    if not isinstance(value, str):
        return False
    try:
        return _is_sensitive_url(value) or bool(_SECRET_PARAMETER_VALUE.search(value))
    except ValueError:
        return True


def _assert_safe_parameter_overrides(parameters):
    if not isinstance(parameters, Mapping):
        raise errors.bad_request.ValidationError("ClearPipe parameter overrides must be an object")
    if _secret_parameter_material(parameters):
        raise errors.bad_request.ValidationError(
            "ClearPipe parameter overrides contain prohibited secret material",
            issues=[
                {
                    "code": "embedded_secret",
                    "path": "parameters",
                    "message": "Credentials and secrets must be provided by the Agent environment",
                }
            ],
        )


def _v2_parameter_override_names(graph: Mapping, parameters: Mapping):
    parsed = read_graph_v2(graph)
    if not parsed.is_supported:
        raise errors.bad_request.ValidationError("ClearPipe graph v2 could not be compiled")
    declared_names = {parameter.name for parameter in parsed.graph.parameters}
    if any(name not in declared_names for name in parameters):
        raise errors.bad_request.ValidationError(
            "ClearPipe parameter overrides include an unknown pipeline parameter"
        )
    return tuple(sorted(parameters))


def _configurations(compiled: Mapping) -> dict:
    return {
        "ClearPipe": ConfigurationItem(
            name="ClearPipe",
            value=json.dumps(compiled["clearpipe"], separators=(",", ":"), ensure_ascii=False),
            type="json",
            description="Native ClearPipe visual definition",
        ),
        "Pipeline": ConfigurationItem(
            name="Pipeline",
            value=json.dumps(compiled["pipeline"], separators=(",", ":"), ensure_ascii=False),
            type="json",
            description="Normalized native pipeline monitoring structure",
        ),
    }


def _definition(
    task: Task, company_id: str, project_name: Optional[str] = None
) -> dict:
    graph = _graph(task)
    # Never return a graph that predates server-side secret enforcement.
    is_v2 = _is_v2_graph(graph)
    security = _validate_graph(company_id, graph) if is_v2 else GraphValidator().validate(graph)
    if any(issue.code in {"embedded_secret", "CPSEM010"} for issue in security.issues):
        raise errors.bad_request.ValidationError(
            "ClearPipe definition contains prohibited embedded credentials", task=task.id
        )
    if is_v2 and not read_graph_v2(graph).is_supported:
        raise errors.bad_request.ValidationError(
            "ClearPipe definition is not a valid supported graph",
            task=task.id,
            issues=[issue.to_dict() for issue in security.issues],
        )
    if project_name is None and task.project:
        project = Project.objects(id=task.project).only("name").first()
        project_name = project.name if project else None
    can_edit = can_write_definition(task.company, task.company_origin, company_id)
    archived = EntityVisibility.archived.value in (task.system_tags or [])
    schema_version = graph.get("schema_version")
    revision = _revision(task)
    generated = _compile_v2(graph) if is_v2 and security.run_valid else None
    runtime_configuration = _runtime_configuration(generated, revision) if generated is not None else None
    stored_runtime = _stored_runtime_configuration(task) if is_v2 else None
    if (
        runtime_configuration is not None
        and stored_runtime is not None
        and stored_runtime.definition_revision == revision
        and stored_runtime.graph_digest == runtime_configuration.graph_digest
        and stored_runtime.runtime_steps == runtime_configuration.runtime_steps
        and stored_runtime.source_map == runtime_configuration.source_map
    ):
        runtime_configuration = stored_runtime
    v2_execution_available = (
        bool(generated)
        and can_edit
        and not archived
        and _runtime_provenance_signing_key() is not None
    )
    legacy_compilation_available = schema_version != 2
    representation = (
        "clearpipe_graph_v2"
        if schema_version == 2
        else "legacy_clearpipe_graph"
        if schema_version == 1
        else "unsupported_clearpipe_graph"
    )
    return {
        "id": task.id,
        "name": task.name,
        "description": task.comment or "",
        "project": task.project,
        "project_name": project_name,
        "user": task.user,
        "company": task.company,
        "tags": list(task.tags or []),
        "system_tags": list(task.system_tags or []),
        "archived": archived,
        "public": task.company == "",
        "created": task.created.isoformat() if task.created else None,
        "last_update": task.last_update.isoformat() if task.last_update else None,
        "revision": revision,
        "graph": graph,
        # These capabilities reflect the authenticated task boundary. CP-14
        # applies the stricter CP-06 legacy/unsupported representation policy.
        "capabilities": {
            "view": True,
            "edit": can_edit,
            "save_as": True,
            "version": False,
            "run": v2_execution_available if is_v2 else not archived and legacy_compilation_available,
            "compilation": bool(generated) if is_v2 else legacy_compilation_available,
            "execution": v2_execution_available if is_v2 else not archived and legacy_compilation_available,
            "import": True,
            "export": True,
            "source": False,
            "archive": can_edit,
            "delete": can_edit,
        },
        "representation": representation,
        **(
            {
                "validation": security.to_dict(),
                "runtime": runtime_configuration.to_dict(),
            }
            if runtime_configuration is not None
            else {"validation": security.to_dict()} if is_v2 else {}
        ),
    }


def _timestamp(value) -> Optional[str]:
    return value.isoformat() if value is not None and hasattr(value, "isoformat") else None


def _visible_task(
    company_id: str, task_id: str, only_fields
) -> Optional[Task]:
    """Use a scoped minimal projection without turning a task ID into an oracle."""

    return (
        Task.objects(Q(id=task_id) & _visible_query(company_id, True))
        .only(*only_fields)
        .first()
    )


def _visible_definition(company_id: str, task_id: str) -> Optional[Task]:
    return (
        Task.objects(
            Q(id=task_id) & _visible_query(company_id, True) & _definition_query()
        )
        .only("id")
        .first()
    )


def _safe_artifact_descriptor(item: Mapping) -> Optional[dict]:
    artifact_id = item.get("id")
    if not isinstance(artifact_id, str) or not artifact_id:
        return None
    descriptor = {"id": artifact_id, "name": artifact_id}
    if isinstance(item.get("type"), str) and item["type"]:
        descriptor["type"] = item["type"]
    if item.get("direction") in {"input", "output"}:
        descriptor["direction"] = item["direction"]
    return descriptor


def _base_task_eligible(task: Task) -> bool:
    """Only native non-controller root tasks may become TaskIdReferences."""

    return (
        not getattr(task, "parent", None)
        and getattr(task, "type", None) != TaskType.controller
        and not (getattr(task, "runtime", None) or {}).get(
            CLEARPIPE_RUNTIME_PROVENANCE
        )
    )


def _descriptor_ports(company_id: str, task_id: str) -> tuple:
    """
    Project only parameter names/types and artifact key/type/mode in Mongo.
    Param values, artifact URIs, task script, and configuration never enter a
    Task document or response object in this endpoint.
    """

    pipeline = [
        {
            "$match": {
                "_id": task_id,
                "company": {"$in": ["", company_id]},
            }
        },
        {
            "$facet": {
                "parameters": [
                    {
                        "$project": {
                            "sections": {
                                "$objectToArray": {"$ifNull": ["$hyperparams", {}]}
                            }
                        }
                    },
                    {"$unwind": "$sections"},
                    {
                        "$project": {
                            "section": "$sections.k",
                            "items": {"$objectToArray": "$sections.v"},
                        }
                    },
                    {"$unwind": "$items"},
                    {
                        "$project": {
                            "_id": 0,
                            "section": 1,
                            "name": "$items.k",
                            "type": "$items.v.type",
                        }
                    },
                    {"$sort": {"section": 1, "name": 1}},
                ],
                "artifacts": [
                    {
                        "$project": {
                            "items": {
                                "$objectToArray": {
                                    "$ifNull": ["$execution.artifacts", {}]
                                }
                            }
                        }
                    },
                    {"$unwind": "$items"},
                    {
                        "$project": {
                            "_id": 0,
                            "id": {"$ifNull": ["$items.v.key", "$items.k"]},
                            "type": "$items.v.type",
                            "direction": "$items.v.mode",
                        }
                    },
                    {"$sort": {"id": 1}},
                ],
            }
        },
    ]
    result = next(Task.aggregate(pipeline), {})
    parameters = []
    for item in result.get("parameters", ()):
        section = item.get("section")
        name = item.get("name")
        if not isinstance(section, str) or not isinstance(name, str):
            continue
        descriptor = {
            "section": ParameterKeyEscaper.unescape(section),
            "name": ParameterKeyEscaper.unescape(name),
        }
        if isinstance(item.get("type"), str) and item["type"]:
            descriptor["type"] = item["type"]
        parameters.append(descriptor)
    artifacts = [
        descriptor
        for item in result.get("artifacts", ())
        if isinstance(item, Mapping)
        if (descriptor := _safe_artifact_descriptor(item)) is not None
    ]
    return parameters, artifacts


def _task_descriptor(task: Task, company_id: str) -> dict:
    project_name = None
    if task.project:
        project = Project.objects(
            Q(id=task.project) & _visible_query(company_id, True)
        ).only("name").first()
        project_name = project.name if project else None
    context = {
        "name": task.name,
        "type": task.type,
        "status": task.status,
    }
    if task.project:
        context["project_id"] = task.project
    if project_name:
        context["project_name"] = project_name
    if updated_at := _timestamp(task.last_update):
        context["updated_at"] = updated_at
    eligible = _base_task_eligible(task)
    parameters, artifacts = (
        _descriptor_ports(company_id, task.id) if eligible else ([], [])
    )
    return {
        # Base identity is always the immutable task ID. Project/name are
        # display context only and must never be substituted with a run ID.
        "identity": {"task_id": task.id},
        "base_task_eligible": eligible,
        "context": context,
        "parameters": parameters,
        "artifacts": artifacts,
    }


def _runtime_step_task_ids(task: Task, runtime_steps) -> dict:
    """
    Read only monitored child task IDs for server-authenticated runtime step
    names. Provenance establishes graph-to-step identity; Pipeline monitoring
    is never returned and cannot introduce graph node IDs.
    """

    try:
        pipeline = _configuration_value(task, "Pipeline")
    except errors.bad_request.ValidationError:
        return {}
    if not isinstance(pipeline, Mapping):
        return {}
    steps = pipeline.get("steps")
    if not isinstance(steps, Mapping):
        steps = pipeline
    task_ids = {}
    for runtime_step in runtime_steps:
        name = runtime_step.pipeline_step_name
        step = steps.get(name)
        if not isinstance(step, Mapping):
            continue
        task_id = step.get("task_id") or step.get("job_id")
        if isinstance(task_id, str) and task_id:
            task_ids[name] = task_id
    return task_ids


def _safe_models(task: Task, visible_models: Mapping[str, Model]) -> dict:
    result = {}
    task_models = getattr(task, "models", None)
    for direction in ("input", "output"):
        descriptors = []
        for item in getattr(task_models, direction, None) or ():
            model_id = getattr(item, "model", None)
            if not isinstance(model_id, str) or not model_id:
                continue
            model = visible_models.get(model_id)
            if model is None:
                continue
            descriptor = {"id": model.id}
            if isinstance(model.name, str) and model.name:
                descriptor["name"] = model.name
            descriptors.append(descriptor)
        if descriptors:
            result[direction] = descriptors
    return result


def _safe_node_snapshot(
    task: Task,
    visible_models: Mapping[str, Model],
    artifacts_by_task_id: Mapping[str, Mapping],
) -> dict:
    artifact_page = artifacts_by_task_id.get(task.id, {})
    result = {
        "task_id": task.id,
        "status": task.status,
        "record_status": "available",
        # This is an authorized task-detail/log handoff identifier, not log
        # content or a URL.
        "log_task_id": task.id,
        "artifacts": artifact_page.get("artifacts", []),
        "artifacts_truncated": bool(artifact_page.get("truncated")),
        "models": _safe_models(task, visible_models),
    }
    for name, value in (
        ("started_at", _timestamp(task.started)),
        ("completed_at", _timestamp(task.completed)),
        ("updated_at", _timestamp(task.last_update)),
    ):
        if value:
            result[name] = value
    output = getattr(task, "output", None)
    output_result = getattr(output, "result", None)
    if output_result in {"success", "failure"}:
        result["result"] = output_result
    if "dataset" in (getattr(task, "system_tags", None) or ()):
        result["datasets"] = [{"task_id": task.id, "name": task.name}]
    return result


def _visible_run_children(
    company_id: str, run_id: str, task_ids
) -> Mapping[str, Task]:
    task_ids = tuple(dict.fromkeys(task_ids))
    if not task_ids:
        return {}
    fields = (
        "id",
        "parent",
        "name",
        "status",
        "started",
        "completed",
        "last_update",
        "output.result",
        "models",
        "system_tags",
    )
    children = Task.objects(
        Q(id__in=task_ids, parent=run_id) & _visible_query(company_id, True)
    ).only(*fields)
    return {child.id: child for child in children}


def _visible_run_artifacts(
    company_id: str, run_id: str, task_ids
) -> Mapping[str, Mapping]:
    task_ids = tuple(dict.fromkeys(task_ids))
    if not task_ids:
        return {}
    pipeline = [
        {
            "$match": {
                "_id": {"$in": list(task_ids)},
                "parent": run_id,
                "company": {"$in": ["", company_id]},
            }
        },
        {
            "$project": {
                "artifact_items": {
                    "$objectToArray": {"$ifNull": ["$execution.artifacts", {}]}
                }
            }
        },
        {
            "$project": {
                "id": "$_id",
                "truncated": {
                    "$gt": [
                        {"$size": "$artifact_items"},
                        MAX_RUNTIME_ARTIFACTS_PER_NODE,
                    ]
                },
                "artifacts": {
                    "$map": {
                        "input": {
                            "$slice": [
                                "$artifact_items",
                                MAX_RUNTIME_ARTIFACTS_PER_NODE,
                            ]
                        },
                        "as": "item",
                        "in": {
                            "id": {"$ifNull": ["$$item.v.key", "$$item.k"]},
                            "type": "$$item.v.type",
                            "direction": "$$item.v.mode",
                        },
                    }
                },
            }
        },
    ]
    result = {}
    for item in Task.aggregate(pipeline):
        task_id = item.get("_id")
        if not isinstance(task_id, str):
            continue
        result[task_id] = {
            "artifacts": [
                descriptor
                for artifact in item.get("artifacts", ())
                if isinstance(artifact, Mapping)
                if (descriptor := _safe_artifact_descriptor(artifact)) is not None
            ],
            "truncated": bool(item.get("truncated")),
        }
    return result


def _visible_models_by_id(company_id: str, model_ids) -> Mapping[str, Model]:
    model_ids = tuple(sorted(set(model_ids)))
    if not model_ids or len(model_ids) > MAX_RUNTIME_SNAPSHOT_MODELS:
        return {}
    models = Model.objects(
        Q(id__in=model_ids) & _visible_query(company_id, True)
    ).only("id", "name")
    return {model.id: model for model in models}


def _task_model_ids(tasks) -> tuple:
    return tuple(
        model_id
        for task in tasks
        for direction in ("input", "output")
        for item in (getattr(getattr(task, "models", None), direction, None) or ())
        if isinstance((model_id := getattr(item, "model", None)), str) and model_id
    )


def _execution_snapshot(
    run: Task, company_id: str, node_offset: int, node_limit: int
) -> Optional[dict]:
    runtime = _verified_runtime_provenance(run, company_id)
    if (
        runtime is None
        or not runtime.runtime_steps
        or run.type != TaskType.controller
    ):
        return None
    total_nodes = len(runtime.runtime_steps)
    node_offset = min(max(0, node_offset), total_nodes)
    node_limit = min(MAX_RUNTIME_SNAPSHOT_PAGE_SIZE, max(1, node_limit))
    page_steps = runtime.runtime_steps[node_offset : node_offset + node_limit]
    step_task_ids = _runtime_step_task_ids(run, page_steps)
    mapped_task_ids = [
        step_task_ids[item.pipeline_step_name]
        for item in page_steps
        if item.pipeline_step_name in step_task_ids
    ]
    if len(mapped_task_ids) != len(set(mapped_task_ids)):
        return None
    bounded_task_ids = set(mapped_task_ids)
    children = _visible_run_children(company_id, run.id, bounded_task_ids)
    artifacts_by_task_id = _visible_run_artifacts(
        company_id, run.id, bounded_task_ids
    )
    visible_models = _visible_models_by_id(company_id, _task_model_ids(children.values()))
    nodes = []
    for identity in page_steps:
        node = {
            "graph_node_id": identity.graph_node_id,
            "pipeline_step_name": identity.pipeline_step_name,
        }
        step_task_id = step_task_ids.get(identity.pipeline_step_name)
        if not step_task_id:
            node["record_status"] = "unavailable"
            nodes.append(node)
            continue
        child = children.get(step_task_id)
        if child is None:
            node["record_status"] = "unavailable"
            nodes.append(node)
            continue
        node.update(
            _safe_node_snapshot(child, visible_models, artifacts_by_task_id)
        )
        nodes.append(node)
    controller = {"task_id": run.id, "status": run.status}
    for name, value in (
        ("started_at", _timestamp(run.started)),
        ("completed_at", _timestamp(run.completed)),
        ("updated_at", _timestamp(run.last_update)),
    ):
        if value:
            controller[name] = value
    snapshot = {
        "run_task_id": run.id,
        "definition_task_id": run.runtime[CLEARPIPE_RUNTIME_PROVENANCE][
            "definition_task_id"
        ],
        "definition_revision": runtime.definition_revision,
        "graph_digest": runtime.graph_digest,
        "node_offset": node_offset,
        "total_nodes": total_nodes,
        "truncated": node_offset + len(page_steps) < total_nodes,
        "controller": controller,
        "nodes": nodes,
    }
    if snapshot["truncated"]:
        snapshot["next_node_offset"] = node_offset + len(page_steps)
    return snapshot


def _resource_checker(company_id: str):
    visible = _visible_query(company_id, True)

    def check(kind: str, resource_id: str, lookup=()) -> bool:
        if kind in {"task", "dataset", "report"}:
            lookup_values = dict(lookup)
            if kind == "task" and lookup_values:
                project_name = lookup_values.get("project")
                task_name = lookup_values.get("name")
                if not isinstance(project_name, str) or not isinstance(task_name, str):
                    return False
                project = Project.objects(Q(name=project_name) & visible).only("id").first()
                if project is None:
                    return False
                task = (
                    Task.objects(Q(project=project.id, name=task_name) & visible)
                    .only("id", "parent", "type", "runtime")
                    .first()
                )
                return task is not None and _base_task_eligible(task)
            query = Q(id=resource_id) & visible
            if kind == "dataset":
                query &= Q(system_tags="dataset")
            elif kind == "report":
                query &= Q(type=TaskType.report)
            fields = ("id", "parent", "type", "runtime") if kind == "task" else ("id",)
            task = Task.objects(query).only(*fields).first()
            return task is not None and (
                _base_task_eligible(task) if kind == "task" else True
            )
        if kind == "model":
            return Model.objects(Q(id=resource_id) & visible).only("id").first() is not None
        if kind == "project":
            return Project.objects(Q(id=resource_id) & visible).only("id").first() is not None
        # Unsupported native resource kinds fail closed until they have a
        # company-aware model resolver.
        return False

    return check


def _queue_checker(company_id: str):
    def check(queue_id: str) -> bool:
        try:
            return queue_bll.get_by_id(company_id, queue_id, only=("id",)) is not None
        except APIError:
            return False

    return check


def _validate_graph(company_id: str, graph: Mapping):
    if _is_v2_graph(graph):
        return _v2_validation_result(
            graph,
            resource_checker=_resource_checker(company_id),
            queue_checker=_queue_checker(company_id),
        )
    try:
        result = GraphValidator(
            resource_checker=_resource_checker(company_id),
            queue_checker=_queue_checker(company_id),
        ).validate(graph)
    except Exception as ex:
        # Queue/resource lookup failures are authorization failures, not a
        # reason to silently accept an unverified graph.
        raise errors.bad_request.ValidationError(
            "Unable to verify one or more ClearPipe resources"
        ) from ex
    return result


def _assert_valid(result):
    if not result.valid:
        raise errors.bad_request.ValidationError(
            "ClearPipe graph validation failed",
            issues=[issue.to_dict() for issue in result.issues],
        )


def _compile(graph: Mapping, revision: int, node_queues=None):
    if _is_v2_graph(graph):
        raise errors.bad_request.ValidationError("ClearPipe graph v2 must use the canonical compiler")
    graph = deepcopy(dict(graph))
    if node_queues is not None:
        graph["default_queues"] = dict(node_queues)
    try:
        return compile_definition(
            graph,
            revision=revision,
            default_queue=graph.get("default_queue") or graph.get("defaultQueue"),
            default_queues=graph.get("default_queues") or graph.get("defaultQueues"),
        )
    except (TypeError, ValueError, MemoryError) as ex:
        raise errors.bad_request.ValidationError("ClearPipe graph could not be compiled safely") from ex


def _validate_name(name: str):
    if not isinstance(name, str) or len(name.strip()) < 3:
        raise errors.bad_request.ValidationError("ClearPipe name must contain at least 3 characters")
    if name.strip().startswith(".") or "/" in name or "\\" in name:
        raise errors.bad_request.ValidationError("ClearPipe name cannot contain a path")


def _find_project(company_id: str, user_id: str, name: str, description: str) -> str:
    return ProjectBLL.find_or_create(
        user=user_id,
        company=company_id,
        project_name=f".pipelines/{name.strip()}",
        description=description,
        system_tags=[PIPELINE_TAG],
        parent_creation_params={"system_tags": [PIPELINE_TAG]},
    )


def _run_project_for_definition(definition: Task, company_id: str, user_id: str) -> str:
    return (
        _find_project(company_id, user_id, definition.name, definition.comment or "")
        if definition.company == ""
        else definition.project
    )


def _cleanup_unqueued_run(run: Task, company_id: str):
    if run is None:
        return
    Task.objects(id=run.id, company=company_id, status=TaskStatus.created).delete()


def _assert_name_available(company_id: str, project_id: str, task_id: str = None):
    query = Q(company=company_id, project=project_id) & _definition_query()
    if task_id:
        query &= Q(id__ne=task_id)
    if Task.objects(query).only("id").first():
        raise errors.bad_request.ExpectedUniqueData(
            replacement_msg="A ClearPipe definition with this name already exists"
        )


@endpoint(
    "clearpipe.create",
    min_version="2.35",
    request_data_model=CreateRequest,
    response_data_model=CreateResponse,
)
def create(call: APICall, company_id: str, request: CreateRequest):
    _validate_name(request.name)
    result = _validate_graph(company_id, request.graph)
    _assert_valid(result)
    v2_graph = _is_v2_graph(request.graph)
    lock_key = sha256(f"{company_id}\0{request.name.strip().casefold()}".encode()).hexdigest()
    with distributed_lock(name=f"clearpipe_create_{lock_key}", timeout=30):
        project_id = _find_project(company_id, call.identity.user, request.name, request.description)
        _assert_name_available(company_id, project_id)
        compiled = _compile_v2(request.graph) if v2_graph else _compile(request.graph, revision=1)
        configurations = (
            _v2_configurations(request.graph, compiled, revision=1)
            if v2_graph
            else _configurations(compiled)
        )
        now = datetime.now(timezone.utc)
        task = Task(
            id=create_id(),
            company=company_id,
            user=call.identity.user,
            created=now,
            last_update=now,
            last_change=now,
            last_changed_by=call.identity.user,
            name=request.name.strip(),
            comment=request.description,
            project=project_id,
            tags=list(request.tags or []),
            system_tags=[PIPELINE_TAG, CLEARPIPE_TAG],
            type=TaskType.controller,
            configuration=configurations,
            runtime={
                "clearpipe_revision": 1,
                "_pipeline_hash": compiled.manifest.graph_digest if v2_graph else "clearpipe-v1",
            },
            script={
                "binary": "python",
                "entry_point": "clearpipe_controller.py",
                "diff": compiled.source if v2_graph else compiled["script"],
                "requirements": {"pip": ["clearml>=1.16"]},
            },
        )
        with translate_errors_context():
            task_bll.validate(task)
            task.save()
            if request.public:
                Task.set_public(
                    company_id=company_id,
                    user_id=call.identity.user,
                    ids=[task.id],
                    invalid_cls=errors.bad_request.InvalidTaskId,
                    enabled=True,
                )
                task.reload()
            update_project_time(project_id)
    call.result.data = {
        "id": task.id,
        "revision": 1,
        "definition": _definition(task, company_id),
    }


@endpoint(
    "clearpipe.get_all",
    min_version="2.35",
    request_data_model=GetAllRequest,
    response_data_model=GetAllResponse,
)
def get_all(call: APICall, company_id: str, request: GetAllRequest):
    page = max(0, request.page or 0)
    page_size = min(MAX_PAGE_SIZE, max(1, request.page_size or 50))
    query = _visible_query(company_id, request.allow_public) & _definition_query()
    if not request.include_archived:
        query &= Q(system_tags__ne=EntityVisibility.archived.value)
    if request.project:
        query &= Q(project__in=request.project)
    if request.tags:
        query &= Q(tags__all=request.tags)
    if request.search:
        query &= Q(name=re.compile(re.escape(request.search), re.IGNORECASE))
    queryset = Task.objects(query).order_by("-last_update", "id")
    total = queryset.count()
    definitions = [
        _definition(task, company_id)
        for task in queryset.skip(page * page_size).limit(page_size)
    ]
    call.result.data = {"definitions": definitions, "total": total}


@endpoint(
    "clearpipe.get_by_id",
    min_version="2.35",
    request_data_model=DefinitionRequest,
    response_data_model=DefinitionResponse,
)
def get_by_id(call: APICall, company_id: str, request: DefinitionRequest):
    call.result.data = {
        "definition": _definition(_get_task(company_id, request.task), company_id)
    }


@endpoint(
    "clearpipe.update",
    min_version="2.35",
    request_data_model=UpdateRequest,
    response_data_model=UpdateResponse,
)
def update(call: APICall, company_id: str, request: UpdateRequest):
    task = _get_task(company_id, request.task, owned=True)
    current_revision = _revision(task)
    if current_revision != request.revision:
        raise RevisionConflict(expected=current_revision, received=request.revision)
    name = request.name if "name" in call.data else task.name
    description = request.description if "description" in call.data else task.comment
    graph = request.graph if "graph" in call.data else _graph(task)
    tags = list(request.tags) if "tags" in call.data else list(task.tags or [])
    public = request.public if "public" in call.data else task.company == ""
    _validate_name(name)
    result = _validate_graph(company_id, graph)
    _assert_valid(result)
    project_id = task.project
    if name != task.name:
        project_id = _find_project(company_id, call.identity.user, name, description)
        _assert_name_available(company_id, project_id, task.id)
    new_revision = current_revision + 1
    v2_graph = _is_v2_graph(graph)
    compiled = _compile_v2(graph) if v2_graph else _compile(graph, revision=new_revision)
    updates = {
        "set__name": name.strip(),
        "set__comment": description or "",
        "set__project": project_id,
        "set__tags": tags,
        "set__configuration": (
            _v2_configurations(graph, compiled, revision=new_revision)
            if v2_graph
            else _configurations(compiled)
        ),
        "set__script__diff": (
            compiled.source if v2_graph else compiled["script"]
        ),
        "set__last_update": datetime.now(timezone.utc),
        "set__last_change": datetime.now(timezone.utc),
        "set__last_changed_by": call.identity.user,
    }
    if v2_graph:
        runtime = dict(task.runtime or {})
        runtime.update(
            clearpipe_revision=new_revision,
            _pipeline_hash=compiled.manifest.graph_digest,
        )
        updates["set__runtime"] = runtime
    else:
        updates["set__runtime__clearpipe_revision"] = new_revision
    if public and task.company:
        updates.update(set__company="", set__company_origin=company_id)
    elif not public and not task.company:
        updates.update(set__company=company_id, unset__company_origin=1)
    query = Q(id=task.id, runtime__clearpipe_revision=current_revision) & _owned_query(company_id)
    updated = Task.objects(query).update_one(**updates)
    if not updated:
        latest = Task.objects(Q(id=task.id) & _owned_query(company_id)).only("runtime").first()
        expected = (latest.runtime or {}).get("clearpipe_revision") if latest else None
        raise RevisionConflict(expected=expected, received=request.revision)
    update_project_time([task.project, project_id])
    task = _get_task(company_id, task.id, owned=True)
    call.result.data = {
        "updated": 1,
        "revision": new_revision,
        "definition": _definition(task, company_id),
    }


@endpoint(
    "clearpipe.validate",
    min_version="2.35",
    request_data_model=ValidateRequest,
    response_data_model=ValidationResponse,
)
def validate(call: APICall, company_id: str, request: ValidateRequest):
    has_task = "task" in call.data and bool(request.task)
    has_graph = "graph" in call.data
    if has_task == has_graph:
        raise errors.bad_request.ValidationError("Exactly one of task or graph is required")
    task = _get_task(company_id, request.task) if has_task else None
    graph = _graph(task) if task is not None else request.graph
    result = _validate_graph(company_id, graph)
    data = result.to_dict()
    if result.valid:
        if _is_v2_graph(graph):
            revision = _revision(task) if task is not None else 1
            data["pipeline"] = _compiler_output(_compile_v2(graph), revision)
        else:
            data["pipeline"] = _compile(graph, revision=graph.get("revision", 1))["pipeline"]
    call.result.data = data


@endpoint(
    "clearpipe.start",
    min_version="2.35",
    request_data_model=StartRequest,
    response_data_model=StartResponse,
)
def start(
    call: APICall,
    company_id: str,
    request: StartRequest,
):
    definition = _get_task(company_id, request.task)
    if EntityVisibility.archived.value in (definition.system_tags or []):
        raise errors.bad_request.ValidationError("Archived ClearPipe definitions cannot be started")
    revision = _revision(definition)
    if request.revision is not None and request.revision != revision:
        raise RevisionConflict(expected=revision, received=request.revision)
    _assert_safe_parameter_overrides(request.parameters or {})
    graph = _graph(definition)
    v2_graph = _is_v2_graph(graph)
    idempotency_key = (
        _idempotency_key(getattr(request, "idempotency_key", None))
        if v2_graph
        else None
    )
    if v2_graph and not can_write_definition(
        definition.company,
        definition.company_origin,
        company_id,
    ):
        raise errors.bad_request.ValidationError(
            "ClearPipe graph v2 definitions can only be started by their owner"
        )
    graph = deepcopy(graph)
    if v2_graph and request.node_queues:
        raise errors.bad_request.ValidationError(
            "ClearPipe graph v2 does not support per-run node queue overrides"
        )
    if not v2_graph and request.node_queues:
        graph["default_queues"] = dict(request.node_queues)
    v2_parameter_names = (
        _v2_parameter_override_names(graph, request.parameters or {}) if v2_graph else ()
    )
    result = _validate_graph(company_id, graph)
    _assert_valid(result)
    if v2_graph and not result.run_valid:
        raise errors.bad_request.ValidationError(
            "ClearPipe graph cannot be executed",
            issues=[issue.to_dict() for issue in result.issues],
        )
    if v2_graph and _runtime_provenance_signing_key() is None:
        raise errors.bad_request.ValidationError(
            "ClearPipe graph v2 execution requires a configured dedicated provenance signing key",
            issues=[
                {
                    "code": "provenance_signing_unavailable",
                    "path": "runtime",
                    "message": "Configure secure.clearpipe.provenance_keys.current_key_id and its dedicated key before starting a v2 run.",
                }
            ],
        )
    reservation = None
    if v2_graph:
        # The fingerprint contains only stable caller input. In particular, a
        # retry that omitted a queue must resume the original default queue
        # even if the account default changes before the retry arrives.
        requested_queue_id = getattr(request, "queue", None) or ""
        fingerprint = _start_fingerprint(
            definition.id,
            revision,
            call.identity.user,
            request,
            requested_queue_id,
        )
        reservation = _idempotency_reservation(
            company_id,
            call.identity.user,
            idempotency_key,
            definition.id,
            revision,
            fingerprint,
        )
        if reservation is not None:
            queue = queue_bll.get_by_id(
                company_id, reservation["queue_id"], only=("id",)
            )
        elif request.queue:
            queue = queue_bll.get_by_id(company_id, request.queue, only=("id",))
        else:
            queue = queue_bll.get_default(company_id)
        if reservation is None:
            reservation = _reserve_idempotency(
                company_id,
                call.identity.user,
                idempotency_key,
                definition.id,
                revision,
                fingerprint,
                queue.id,
            )
            if reservation["queue_id"] != queue.id:
                queue = queue_bll.get_by_id(
                    company_id, reservation["queue_id"], only=("id",)
                )
    else:
        fingerprint = None
        # Resolve and authorize the controller queue before creating a run so
        # an invalid queue cannot leave an orphaned clone.
        if request.queue:
            queue = queue_bll.get_by_id(company_id, request.queue, only=("id",))
        else:
            queue = queue_bll.get_default(company_id)
    run_record = None
    run = None
    if v2_graph:
        existing = _idempotent_run(company_id, call.identity.user, reservation)
        if existing is not None:
            run, run_record = existing
            if run_record["state"] == "committed":
                if reservation["state"] != "committed":
                    _update_idempotency_reservation(
                        reservation,
                        state="committed",
                        enqueued=bool(run_record.get("enqueued")),
                    )
                call.result.data = {
                    "task": run.id,
                    "enqueued": bool(run_record.get("enqueued")),
                }
                return
        elif reservation["state"] == "committed":
            raise errors.server_error.InternalError(
                "ClearPipe idempotency reservation is inconsistent"
            )
    if v2_graph:
        compiled = _compile_v2(graph)
        configurations = _v2_configurations(graph, compiled, revision)
        controller_script = _controller_launch_script(compiled.source, v2_parameter_names)
        pipeline_hash = compiled.manifest.graph_digest
        hyperparams = {
            "Args": {
                key: ParamsItem(
                    section="Args",
                    name=key,
                    value=json.dumps(value) if not isinstance(value, str) else value,
                )
                for key, value in (request.parameters or {}).items()
            }
        }
    else:
        compiled = _compile(graph, revision=revision, node_queues=request.node_queues)
        configurations = _configurations(compiled)
        controller_script = compiled["script"]
        pipeline_hash = "clearpipe-v1"
        hyperparams = {
            "ClearPipe": {
                key: ParamsItem(
                    section="ClearPipe",
                    name=str(key),
                    value=json.dumps(value) if not isinstance(value, str) else value,
                )
                for key, value in (request.parameters or {}).items()
            }
        }
    run_runtime = {
        "clearpipe_revision": revision,
        "_pipeline_hash": pipeline_hash,
    }
    if v2_graph:
        runtime_configuration_value = configurations[
            CLEARPIPE_RUNTIME_CONFIGURATION
        ].value
        run_runtime[CLEARPIPE_RUNTIME_PROVENANCE] = _runtime_provenance(
            reservation["run_id"],
            company_id,
            definition.id,
            _runtime_configuration(compiled, revision),
            runtime_configuration_value,
        )
        run_runtime[CLEARPIPE_IDEMPOTENCY] = _sealed_idempotency(
            reservation["key_hash"],
            company_id,
            definition.id,
            revision,
            call.identity.user,
            fingerprint,
            queue.id,
            reservation["run_id"],
            state="pending",
        )
    created_run = False
    try:
        if run is None:
            run_project = _run_project_for_definition(
                definition, company_id, call.identity.user
            )
            try:
                run, _ = task_bll.clone_task(
                    company_id=company_id,
                    user_id=call.identity.user,
                    task_id=definition.id,
                    name=definition.name,
                    project=run_project,
                    hyperparams=hyperparams,
                    configuration=configurations,
                    script_overrides={
                        "diff": controller_script,
                        "entry_point": "clearpipe_controller.py",
                    },
                    **(
                        {
                            "new_task_id": reservation["run_id"],
                            "runtime": run_runtime,
                        }
                        if v2_graph
                        else {}
                    ),
                )
            except NotUniqueError:
                # Another request may have won the atomic clone save. The
                # fixed reserved ID lets this retry recover that exact run.
                existing = _idempotent_run(
                    company_id, call.identity.user, reservation
                )
                if existing is None:
                    raise
                run, run_record = existing
            else:
                created_run = True
                if v2_graph:
                    run_record = run_runtime[CLEARPIPE_IDEMPOTENCY]
                    reservation = _update_idempotency_reservation(
                        reservation, state="pending"
                    )
                else:
                    Task.objects(id=run.id, company=company_id).update_one(
                        set__runtime=run_runtime
                    )

        def enqueue_run():
            return enqueue_task(
                task_id=run.id,
                company_id=company_id,
                identity=call.identity,
                queue_id=queue.id,
                status_message="Starting ClearPipe pipeline",
                status_reason="",
                validate=True,
            )
        status = getattr(run, "status", TaskStatus.created)
        if v2_graph and status not in {TaskStatus.created, TaskStatus.queued}:
            # An earlier request advanced this controller after it had been
            # persisted but before its idempotency record was committed.
            queued = True
        else:
            try:
                queued, _ = enqueue_run()
            except errors.bad_request.TaskAlreadyQueued:
                if not v2_graph:
                    raise
                # Queue entries are unique. A concurrent request completed the
                # native enqueue after this attempt read the pending run.
                queued = True
            except errors.bad_request.FailedChangingTaskStatus:
                if not v2_graph:
                    raise
                existing = _idempotent_run(
                    company_id, call.identity.user, reservation
                )
                if existing is None:
                    raise
                run, run_record = existing
                status = getattr(run, "status", TaskStatus.created)
                if status == TaskStatus.created:
                    raise
                if status == TaskStatus.queued:
                    try:
                        queued, _ = enqueue_run()
                    except errors.bad_request.TaskAlreadyQueued:
                        queued = True
                else:
                    queued = True
        if v2_graph:
            run_record = _commit_idempotent_run(
                run, company_id, run_record, bool(queued)
            )
            _update_idempotency_reservation(
                reservation, state="committed", enqueued=bool(queued)
            )
    except Exception:
        if created_run:
            try:
                _cleanup_unqueued_run(run, company_id)
            except Exception as cleanup_error:
                raise errors.server_error.InternalError(
                    "ClearPipe start failed and the unqueued run could not be cleaned up",
                    task=run.id,
                ) from cleanup_error
        raise
    response = {"task": run.id, "enqueued": bool(queued)}
    if request.verify_watched_queue:
        try:
            response["queue_watched"] = queue_bll.check_for_workers(company_id, queue.id)
        except Exception:
            # Worker discovery is advisory after a successful enqueue. Never
            # turn a committed run into an ambiguous failed response.
            response["queue_watched"] = False
    call.result.data = response


def _task_inventory_cursor(cursor: Optional[str], page: int) -> int:
    if cursor is None:
        return max(0, page)
    prefix = "task-page:"
    if not cursor.startswith(prefix) or not cursor[len(prefix) :].isdigit():
        raise errors.bad_request.ValidationError("Invalid ClearPipe task inventory cursor")
    return int(cursor[len(prefix) :])


def _task_inventory_item(task: Task, company_id: str) -> dict:
    project_name = None
    if task.project:
        project = Project.objects(
            Q(id=task.project) & _visible_query(company_id, True)
        ).only("name").first()
        project_name = project.name if project else None
    return {
        "id": task.id,
        "name": task.name,
        "project": project_name or task.project,
        "type": task.type,
        "status": task.status,
        "tags": list(task.tags or []),
        "system_tags": list(task.system_tags or []),
        "last_update": _timestamp(task.last_update),
        "base_task_eligible": True,
    }


@endpoint(
    "clearpipe.task_inventory",
    min_version="2.35",
    request_data_model=TaskInventoryRequest,
    response_data_model=TaskInventoryResponse,
)
def task_inventory(
    call: APICall, company_id: str, request: TaskInventoryRequest
):
    page = _task_inventory_cursor(request.cursor, request.page or 0)
    page_size = min(
        MAX_TASK_INVENTORY_PAGE_SIZE, max(1, request.page_size or 50)
    )
    query = (
        _visible_query(company_id, True)
        & Q(parent=None, type__ne=TaskType.controller)
        & Q(runtime__clearpipe_runtime_provenance__exists=False)
    )
    fields = (
        "id",
        "name",
        "project",
        "type",
        "status",
        "tags",
        "system_tags",
        "last_update",
        "parent",
        "runtime",
    )
    queryset = Task.objects(query).only(*fields).order_by("name", "id")
    total = queryset.count()
    tasks = [
        _task_inventory_item(task, company_id)
        for task in queryset.skip(page * page_size).limit(page_size)
        if _base_task_eligible(task)
    ]
    next_cursor = (
        "task-page:{}".format(page + 1)
        if (page + 1) * page_size < total
        else None
    )
    call.result.data = {
        "tasks": tasks,
        "total": total,
        **({"next_cursor": next_cursor} if next_cursor else {}),
    }


@endpoint(
    "clearpipe.task_descriptor",
    min_version="2.35",
    request_data_model=TaskDescriptorRequest,
    response_data_model=TaskDescriptorResponse,
)
def task_descriptor(
    call: APICall, company_id: str, request: TaskDescriptorRequest
):
    task = _visible_task(company_id, request.task, DESCRIPTOR_TASK_FIELDS)
    if task is None:
        call.result.data = {"status": "unavailable"}
        return
    descriptor = _task_descriptor(task, company_id)
    if (
        request.known_updated_at is not None
        and request.known_updated_at != descriptor["context"].get("updated_at")
    ):
        status = "stale"
    else:
        status = "available"
    call.result.data = {"status": status, "descriptor": descriptor}


@endpoint(
    "clearpipe.execution_snapshot",
    min_version="2.35",
    request_data_model=ExecutionSnapshotRequest,
    response_data_model=ExecutionSnapshotResponse,
)
def execution_snapshot(
    call: APICall, company_id: str, request: ExecutionSnapshotRequest
):
    run = _visible_task(company_id, request.run, SNAPSHOT_RUN_FIELDS)
    if run is None:
        call.result.data = {"status": "unavailable"}
        return
    node_offset = getattr(request, "node_offset", None)
    node_limit = getattr(request, "node_limit", None)
    snapshot = _execution_snapshot(
        run,
        company_id,
        0 if node_offset is None else node_offset,
        MAX_RUNTIME_SNAPSHOT_PAGE_SIZE if node_limit is None else node_limit,
    )
    if snapshot is None:
        call.result.data = {"status": "unavailable"}
        return
    status = "available"
    if (
        request.definition_revision is not None
        and request.definition_revision != snapshot["definition_revision"]
    ) or (
        request.graph_digest is not None
        and request.graph_digest != snapshot["graph_digest"]
    ):
        status = "stale"
    call.result.data = {"status": status, "snapshot": snapshot}


@endpoint(
    "clearpipe.archive",
    min_version="2.35",
    request_data_model=ArchiveRequest,
    response_data_model=ArchiveResponse,
)
def archive(call: APICall, company_id: str, request: ArchiveRequest):
    task = _get_task(company_id, request.task, owned=True)
    revision = _revision(task)
    if request.revision is not None and request.revision != revision:
        raise RevisionConflict(expected=revision, received=request.revision)
    if EntityVisibility.archived.value in (task.system_tags or []):
        call.result.data = {"updated": 0, "revision": revision}
        return
    new_revision = revision + 1
    graph = _graph(task)
    v2_graph = _is_v2_graph(graph)
    compiled = None
    if v2_graph:
        try:
            compiled = _compile_v2(graph)
        except (GenerationError, TypeError, ValueError, MemoryError):
            # Archiving remains available for historical invalid definitions.
            # It must not repair, drop, or execute their canonical graph.
            pass
    else:
        compiled = _compile(graph, revision=new_revision)
    updates = {
        "add_to_set__system_tags": EntityVisibility.archived.value,
        "set__configuration": (
            _v2_configurations(graph, compiled, revision=new_revision)
            if v2_graph and compiled is not None
            else task.configuration
            if v2_graph
            else _configurations(compiled)
        ),
        "set__last_update": datetime.now(timezone.utc),
        "set__last_change": datetime.now(timezone.utc),
        "set__last_changed_by": call.identity.user,
    }
    if v2_graph:
        runtime = dict(task.runtime or {})
        runtime["clearpipe_revision"] = new_revision
        if compiled is not None:
            runtime["_pipeline_hash"] = compiled.manifest.graph_digest
            updates["set__script__diff"] = compiled.source
        updates["set__runtime"] = runtime
    else:
        updates["set__script__diff"] = compiled["script"]
        updates["set__runtime__clearpipe_revision"] = new_revision
    updated = Task.objects(
        Q(id=task.id, runtime__clearpipe_revision=revision) & _owned_query(company_id)
    ).update_one(**updates)
    if not updated:
        raise RevisionConflict(received=request.revision)
    call.result.data = {"updated": 1, "revision": new_revision}


@endpoint(
    "clearpipe.delete",
    min_version="2.35",
    request_data_model=DeleteRequest,
    response_data_model=DeleteResponse,
)
def delete(call: APICall, company_id: str, request: DeleteRequest):
    task = _get_task(company_id, request.task, owned=True)
    revision = _revision(task)
    if request.revision is not None and request.revision != revision:
        raise RevisionConflict(expected=revision, received=request.revision)
    if not request.force and task.status != TaskStatus.created and EntityVisibility.archived.value not in (task.system_tags or []):
        raise errors.bad_request.TaskCannotBeDeleted(
            "Archive the definition or use force=true", task=task.id
        )
    deleted = Task.objects(
        Q(id=task.id, runtime__clearpipe_revision=revision) & _owned_query(company_id)
    ).delete()
    if not deleted:
        raise RevisionConflict(received=request.revision)
    update_project_time(task.project)
    call.result.data = {"deleted": True}


@endpoint(
    "clearpipe.parse_script",
    min_version="2.35",
    request_data_model=ParseScriptRequest,
    response_data_model=ParseScriptResponse,
)
def parse_script(call: APICall, _, request: ParseScriptRequest):
    try:
        call.result.data = parse_python_script(request.script)
    except (ValueError, RecursionError, MemoryError) as ex:
        raise errors.bad_request.ValidationError(str(ex)) from ex
