import json
import re
from hashlib import sha256
from copy import deepcopy
from datetime import datetime, timezone
from typing import Mapping, Optional

from mongoengine import Q

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
    GetAllRequest,
    GetAllResponse,
    ParseScriptRequest,
    ParseScriptResponse,
    StartRequest,
    StartResponse,
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
from apiserver.database.errors import translate_errors_context
from apiserver.database.model import EntityVisibility
from apiserver.database.model.model import Model
from apiserver.database.model.project import Project
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


CLEARPIPE_TAG = "clearpipe"
PIPELINE_TAG = "pipeline"
MAX_PAGE_SIZE = 500
CLEARPIPE_RUNTIME_CONFIGURATION = "ClearPipeRuntime"
CLEARPIPE_RUNTIME_SCHEMA_VERSION = 1
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


def _controller_launch_script(source: str) -> str:
    """Keep the compiler no-launch while making the cloned Agent task executable."""

    return '{}\nif __name__ == "__main__":\n    pipe.start()\n'.format(source.rstrip("\n"))


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
    security = _v2_validation_result(graph) if is_v2 else GraphValidator().validate(graph)
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
    v2_execution_available = bool(generated) and can_edit and not archived
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


def _resource_checker(company_id: str):
    visible = _visible_query(company_id, True)

    def check(kind: str, resource_id: str) -> bool:
        if kind in {"task", "dataset", "report"}:
            query = Q(id=resource_id) & visible
            if kind == "dataset":
                query &= Q(system_tags="dataset")
            elif kind == "report":
                query &= Q(type=TaskType.report)
            return Task.objects(query).only("id").first() is not None
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
def start(call: APICall, company_id: str, request: StartRequest):
    definition = _get_task(company_id, request.task)
    if EntityVisibility.archived.value in (definition.system_tags or []):
        raise errors.bad_request.ValidationError("Archived ClearPipe definitions cannot be started")
    revision = _revision(definition)
    if request.revision is not None and request.revision != revision:
        raise RevisionConflict(expected=revision, received=request.revision)
    _assert_safe_parameter_overrides(request.parameters or {})
    graph = _graph(definition)
    v2_graph = _is_v2_graph(graph)
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
    result = _validate_graph(company_id, graph)
    _assert_valid(result)
    if v2_graph and not result.run_valid:
        raise errors.bad_request.ValidationError(
            "ClearPipe graph cannot be executed",
            issues=[issue.to_dict() for issue in result.issues],
        )
    # Resolve and authorize the controller queue before creating a run so an
    # invalid queue cannot leave an orphaned clone.
    if request.queue:
        queue = queue_bll.get_by_id(company_id, request.queue, only=("id",))
    else:
        queue = queue_bll.get_default(company_id)
    if v2_graph:
        compiled = _compile_v2(graph)
        configurations = _v2_configurations(graph, compiled, revision)
        controller_script = _controller_launch_script(compiled.source)
        pipeline_hash = compiled.manifest.graph_digest
    else:
        compiled = _compile(graph, revision=revision, node_queues=request.node_queues)
        configurations = _configurations(compiled)
        controller_script = compiled["script"]
        pipeline_hash = "clearpipe-v1"
    hyperparams = {
        "ClearPipe": {
            key: ParamsItem(section="ClearPipe", name=str(key), value=json.dumps(value) if not isinstance(value, str) else value)
            for key, value in (request.parameters or {}).items()
        }
    }
    run = None
    try:
        run_project = _run_project_for_definition(
            definition, company_id, call.identity.user
        )
        run, _ = task_bll.clone_task(
            company_id=company_id,
            user_id=call.identity.user,
            task_id=definition.id,
            name=definition.name,
            project=run_project,
            hyperparams=hyperparams,
            configuration=configurations,
            script_overrides={"diff": controller_script, "entry_point": "clearpipe_controller.py"},
        )
        Task.objects(id=run.id, company=company_id).update_one(
            set__runtime={"clearpipe_revision": revision, "_pipeline_hash": pipeline_hash}
        )
        queued, enqueue_result = enqueue_task(
            task_id=run.id,
            company_id=company_id,
            identity=call.identity,
            queue_id=queue.id,
            status_message="Starting ClearPipe pipeline",
            status_reason="",
            validate=True,
        )
    except Exception as start_error:
        if run is not None:
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
