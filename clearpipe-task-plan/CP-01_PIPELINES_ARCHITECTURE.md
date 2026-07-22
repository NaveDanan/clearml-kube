# CP-01 — Verified `/pipelines` architecture

**Reviewed revision:** `9558961` (`master`, immediately before this
evidence-only change).  This note describes existing behavior only; it does not select a
ClearPipe architecture.

## Executive model

The existing feature is a **pipeline-project and controller-task browser**, not
a pipeline authoring application:

* A pipeline is discovered as a project with controller-task statistics filtered
  by `system_tags: ['pipeline']` and `type: 'controller'`.
* A runnable pipeline is a controller task.  Its graph is the task
  configuration named `Pipeline`; its displayed version is
  `hyperparams.properties.version.value`.
* A run is a cloned controller task in the same project.  The server applies
  requested `Args` hyperparameter overrides, then enqueues the clone.

This distinction is material: the dedicated `pipelines.*` API has only
`start_pipeline` and `delete_runs`.  It has no create, graph-save,
version-create, schedule, history-list, or graph-edit endpoint.

## Verified routes, navigation, and access metadata

| URL / route segment | Component and exact registration | Result |
| --- | --- | --- |
| `/pipelines` | `clearml-web/src/app/app.routes.ts` → lazy `PipelinesModule`; child route `path: ''` in `webapp-common/pipelines/pipelines.module.ts` | Flat pipeline-project list (`PipelinesPageComponent`). |
| `/pipelines/:projectId/projects` | `app.routes.ts` → `NestedPipelinePageComponent` | Nested pipeline-project browser. |
| `/pipelines/:projectId/pipelines` | `app.routes.ts` → `PipelinesModule` | Flat list scoped through the project route. |
| `/pipelines/:projectId/tasks` | `app.routes.ts` → `PipelinesControllerModule` → child `path: ''` | Controller-task table and run controls. |
| `/pipelines/:projectId/tasks/:controllerId` | `PipelinesControllerModule` child `path: ':controllerId'` → `PipelineControllerInfoComponent` | Read-only graph/detail view for a controller task. |
| `/pipelines/:projectId/compare`, `/compare/scalars`, `/compare/plots` | `PipelinesControllerModule` | Existing experiment comparison; the latter two use `compareViewStateGuard`. |

`PipelinesModule` places `FeaturesEnum.Pipelines` in route data
(`data.features`) and `FeaturesEnum` defines `'pipelines'`
(`business-logic/model/users/featuresEnum.ts`).  The reviewed pipeline route
entries themselves have **no pipeline-specific `canActivate` guard**.  The side
navigation link is rendered for any `currentUser()` and points to either
`/pipelines` or `/pipelines/*/projects` based on
`defaultNestedModeForFeature()['pipelines']`
(`layout/side-nav/side-nav.component.html`).  Therefore, do not infer a
front-end entitlement gate from the feature metadata.  Server mutations pass
`call.identity` to the task BLL, where task write access is enforced.

Navigation helpers are direct router calls, not a centralized pipeline URL
builder:

* `PipelinesPageComponent.projectCardClicked()` navigates to
  `[project.id, 'tasks']`; nested cards navigate to `[id, 'projects']` or
  `[id, 'pipelines']`.
* `PipelinesPageComponent.toggleNestedView()` switches between
  `pipelines/*/projects` and `pipelines`.
* `PipelineControllerInfoComponent` obtains `controllerId` from router
  parameters; it does not manufacture a URL.

## Path-specific call flows

### 1. Discover and open a pipeline

```text
side-nav link
  -> /pipelines (or /pipelines/*/projects)
  -> app.routes.ts lazy PipelinesModule
  -> PipelinesPageComponent (inherits ProjectsPageComponent)
     -> resetProjects + getAllProjectsPageProjects
     -> CommonProjectsEffects.getAllProjects
     -> ApiProjectsService.projectsGetAllEx(...)
        pipeline view: task/system-tag stats filter
          { system_tags: ['pipeline'], type: ['controller'] }
     -> projectsGetAllEx result -> addToProjectsList
  -> PipelineCard click
  -> router.navigate([project.id, 'tasks'])
  -> PipelinesControllerModule / ControllersComponent
```

The list queries pipeline projects and project stats; it does not call a
`pipelines.list` endpoint.  Search, tag, active-user, hidden/public, paging,
sort, loader and request-failure behavior are inherited from
`CommonProjectsEffects` and `ProjectsPageComponent`.  `PipelinesPageComponent`
re-fetches after main-page tag/user filter changes.

### 2. Open controller details, graph, and current step status

```text
/pipelines/:projectId/tasks/:controllerId
  -> PipelineControllerInfoComponent
  -> resetExperimentInfo + getExperimentInfo({id: controllerId})
  -> CommonExperimentsInfoEffects.getExperimentInfo$
  -> ApiTasksService.tasksGetAllEx(... PIPELINE_INFO_ONLY_FIELDS)
  -> selected controller task in store
  -> task.configuration.Pipeline.value
  -> JSON.parse + convertPipelineToDagModel()
  -> DAG cards/arrows and status values

select a graph step with runtime _pipeline_hash
  -> getSelectedPipelineStep({id: step.data.job_id})
  -> ApiTasksService.tasksGetByIdEx(... PIPELINE_INFO_ONLY_FIELDS)
  -> selected-step store/details/log view
```

The graph parser returns `[]` on invalid/missing JSON.  For a controller without
`runtime._pipeline_hash`, the view resets running fields to `pending` locally;
it does not persist a status.  `getExperimentInfo` and selected-step retrieval
use the common loaders and emit `requestFailed`, `deactivateLoader`, and a
server-error message on failure.  This is the observed status-refresh path; it
reads task state and configuration, rather than polling a pipeline-specific
status API.

### 3. Run or rerun a controller

```text
ControllersComponent.newRun() or PipelineControllerMenuComponent.runPipelineController()
  -> RunPipelineControllerDialogComponent
     -> getQueuesForEnqueue()
     -> existing selected controller, or
        getControllerForStartPipelineDialog({task?})
          -> CommonExperimentsMenuEffects.getPipelineControllerForRunDialog$
          -> ApiTasksService.tasksGetAllEx(project, type: ['controller'], id/order)
     -> required real queue + editable Args form
  -> commonMenuActions.startPipeline({task, queue, args})
  -> CommonExperimentsMenuEffects.startPipeline$
  -> ApiPipelinesService.pipelinesStartPipeline()
  -> POST /pipelines.start_pipeline
  -> apiserver/services/pipelines.py:start_pipeline()
     -> TaskBLL.clone_task(... hyperparams_overrides={'Args': ...})
     -> _update_task_name()
     -> enqueue_task(..., queue_id)
     -> QueueBLL.check_for_workers() when requested
  -> {pipeline: clone-id, enqueued, queue_watched?}
  -> getExperiments + select clone; warn when queue_watched is false
```

The same UI action is used for “new run” and a rerun.  It is clone-and-enqueue,
not a re-execution of the original task in place.  `StartPipelineRequest`
requires `task` and `queue`; the UI prevents confirmation without a queue and
only accepts an autocomplete queue object.  Server-side `enqueue_task` obtains
write access to the cloned task, sets the task queue/status, and rolls status
back if queue insertion fails.

### 4. Delete a run and its steps

```text
controller delete UI
  -> deleteEntities({entityType: controller, ...})
  -> DeleteDialogEffectsBase.deleteEntityApi()
  -> ApiPipelinesService.pipelinesDeleteRuns({ids, project})
  -> POST /pipelines.delete_runs
  -> apiserver/services/pipelines.py:delete_runs()
     -> controller IDs in requested project only
     -> reject removing every controller run (CannotRemoveAllRuns)
     -> delete_task(... force=True, include_pipeline_steps=True)
     -> remove controller/step artifacts, models, events
  -> succeeded/failed batch response
  -> delete effect parses failures or offers “delete pipeline” confirmation
     for the final-run error, then navigates to /pipelines and deletes project
```

The generated TypeScript caller includes an `include_pipeline_steps` property,
but `DeleteRunsRequest` and `pipelines.conf` do **not** define it; the server
always passes `include_pipeline_steps=True`.  Consumers must not treat the
client property as an API contract or as a way to retain child steps.

### 5. Related lifecycle operations

The controller table reuses generic task actions rather than adding
`pipelines.*` operations:

* Continue/enqueue uses `enqueueClicked` → the generic `tasks.enqueue_many`
  flow (`PipelineControllerMenuComponent.continueController()`).
* Abort uses `abortAllChildren`, and archive uses
  `tasks.archive_many(... include_pipeline_steps: isPipelines)` in
  `CommonExperimentsMenuEffects`.
* Server task endpoints delegate to task BLL operations with
  `include_pipeline_steps`; `test_controller_operations` verifies stop,
  archive/unarchive, and delete propagation to controller children.

## Save, version, creation, schedule, and history boundaries

| Lifecycle request | Verified current behavior | Boundary for a downstream adapter |
| --- | --- | --- |
| Create pipeline | The “Create Pipeline” button opens `PipelinesEmptyStateComponent` containing starter Python only; it dispatches no create action or API call. | Creation must be explicitly designed; do not claim this UI creates a persistent pipeline. |
| Save/edit graph | Detail graph parses `configuration.Pipeline.value`; existing UI is read-only. Generic `tasks.edit_configuration` exists, but no reviewed pipeline graph editor invokes it. | A writer would need an explicit task/configuration contract and permission/error handling; this note does not choose one. |
| Rename/tags project | `PipelineCard` inherits project-card editing; `updateProject` → `projects.update`; tags are updated optimistically then reconciled. | Reuse project mutations only for pipeline-project metadata, not graph content. |
| Version | Version is displayed from `hyperparams.properties.version.value` in the run dialog title. No dedicated version endpoint or version-history UI was found. | Do not invent version semantics or use display metadata as immutable revisioning. |
| Run/rerun | Dedicated clone-and-enqueue flow above. `Args` are copied as hyperparameter overrides. | Wrap `pipelines.start_pipeline`; preserve its returned clone ID and queue-watcher warning. |
| Delete run | Dedicated forced deletion with child-step deletion and a “at least one controller remains” invariant. | Wrap `pipelines.delete_runs`; do not replace it with generic task deletion. |
| Stop/archive/unarchive/continue | Generic task operations with pipeline-child inclusion from shared experiments UI. | Reuse existing task lifecycle actions and their status eligibility checks. |
| Schedule | No pipeline schedule route, component, `pipelines.*` schema operation, or service was found. | Unresolved for CP-05; no current surface may be represented as scheduling support. |
| History/status | Controller task table and details fetch task data; graph/status is task configuration/runtime plus task status. | Reuse task listing/detail/status APIs; there is no pipeline history/status service to wrap. |

## Reuse / wrap / do not use

| Classification | Exact path(s) | Evidence-based use |
| --- | --- | --- |
| **Reuse** | `clearml-web/src/app/webapp-common/projects/common-projects.effects.ts`; `.../pipelines/pipelines-page/pipelines-page.component.ts`; `.../pipelines/nested-pipeline-page/nested-pipeline-page.component.ts` | Pipeline-project discovery, filters, paging, loading, empty/list state, and nested navigation. |
| **Reuse** | `clearml-web/src/app/webapp-common/pipelines-controller/pipelines-controller.module.ts`; `.../pipeline-controller-info/pipeline-controller-info.component.ts`; `.../controllers.component.ts` | Existing controller listing, detail routing, DAG read rendering, and common task-table status lifecycle. |
| **Reuse** | `clearml-web/src/app/webapp-common/experiments/effects/common-experiments-info.effects.ts`; `.../controllers.consts.ts` | Task read/refresh and `PIPELINE_INFO_ONLY_FIELDS`; retrieve the `Pipeline` configuration through established task APIs. |
| **Wrap** | `clearml-web/src/app/business-logic/api-services/pipelines.service.ts`; `clearml-server/apiserver/services/pipelines.py`; `.../schema/services/pipelines.conf` | The only dedicated pipeline mutations: start/clone/enqueue and delete runs. Keep generated client and server API semantics intact. |
| **Wrap** | `clearml-web/src/app/webapp-common/experiments/effects/common-experiments-menu.effects.ts`; `.../run-pipeline-controller-dialog/run-pipeline-controller-dialog.component.ts` | Queue selection, Args collection, loader/error actions, selection refresh, and unwatched-queue notification around starting a run. |
| **Reuse carefully** | `clearml-web/src/app/webapp-common/shared/entity-page/entity-delete/base-delete-dialog.effects.ts` | Controller deletion has final-run handling; generic project deletion occurs only after the server rejects deletion of every run. |
| **Do not use as persistence** | `PipelinesEmptyStateComponent` and `PipelinesPageComponent.initPipelineCode` | They show/copy sample Python only. They do not create a project, controller task, graph, or version. |
| **Do not use as an API contract** | `PipelinesDeleteRunsRequest` client shape | Its extra `include_pipeline_steps` field is absent from the schema/model and ignored by the server contract. |
| **Do not use as a version store** | `hyperparams.properties.version.value` | It is existing display metadata; no version lifecycle or history guarantees were found. |
| **Do not duplicate** | New `/pipelines` client/list/history/status endpoints | No such dedicated endpoints exist. Use project/task services for reads and the two established pipeline operations for mutations. |

## Responsibilities (preliminary; not a CP-05 decision)

| Existing `/pipelines` owns | Candidate `/clearpipe` must not assume | Evidence |
| --- | --- | --- |
| Pipeline-project discovery and project metadata | That a pipeline is a standalone server entity or that `/pipelines` creates it | Project list is filtered by pipeline task statistics; create UI is sample code only. |
| Controller task execution, queueing, child-step task lifecycle, and access enforcement | That a graph runner/scheduler API exists | `start_pipeline` clones/enqueues a task; lifecycle delegates to task BLL using identity. |
| Reading an executed controller graph/configuration and current task status | That the parsed graph is editable, versioned, or a durable generic graph document | The view parses `configuration.Pipeline.value` read-only. |
| Existing routes and generic task/project UX state | A centralized route builder, explicit UI feature guard, or dedicated telemetry convention | Navigation uses component-local calls; no route-specific guard or pipeline telemetry call was found. |

CP-05 should decide any new graph persistence, version identity, scheduling,
save conflict behavior, import/export, and how a ClearPipe artifact relates to
a project/controller task.  This discovery does not assign those decisions.

## Verified limitations and questions handed to CP-05

1. **Only two dedicated operations exist.** `pipelines.conf`, generated client,
   and service implementation contain `start_pipeline` and `delete_runs` only.
   There is no verified pipeline create/update/version/schedule/history/status
   API.
2. **Run identity is clone identity.** Starting creates a new controller task;
   it removes the copied execution queue before enqueueing and establishes task
   parentage in `TaskBLL.clone_task`.  It is not an in-place run counter.
3. **Delete has a hard invariant.** The API rejects requests that would delete
   every controller run in a project.  UI has special final-run confirmation.
   Any project-level deletion design must account for this.
4. **Child-step propagation is server-owned for pipeline deletion.** The
   dedicated delete operation always invokes deletion with
   `include_pipeline_steps=True`; the generated client’s extra field does not
   change that behavior.
5. **Current graph data is operational/configuration data.** It is parsed from
   a `Pipeline` task configuration and malformed JSON yields an empty view.
   No schema validation or persistence transaction was found in this feature.
6. **Queue availability is advisory.** Start can succeed while
   `queue_watched === false`; the UI warns after creating the clone.  A future
   integration must preserve the distinction between enqueue success and an
   available worker.
7. **No direct pipeline telemetry convention was found.** Reviewed pipeline
   components/effects use standard NgRx loader/request/server-error and message
   actions; they contain no pipeline analytics/telemetry call.
8. **Open question:** Which task configuration/schema, if any, is sanctioned
   for authored ClearPipe graphs and what optimistic-concurrency/version
   semantics apply?  Existing source does not answer this.
9. **Open question:** What service owns schedules and schedule history?  No
   current `/pipelines` implementation establishes either.

## Loading, empty, error, and authorization behavior

* Project discovery activates/deactivates the shared loader around
  `getAllProjectsPageProjects`; failed reads dispatch `requestFailed`.  The
  list distinguishes no projects from examples and has `PipelinesEmptyState`.
* Start uses shared loader/error actions, refreshes the controller table on
  success, and emits `setServerError(..., 'Run Pipeline failed')` plus
  `requestFailed` on failure.  The run dialog requires an existing queue.
* Detail/step retrieval uses the common experiment loader and error paths.
  Invalid graph JSON is handled locally as an empty DAG.
* Delete maps batch failures, deactivates the loader, and surfaces a
  server-error message; the final-run server error triggers a separate
  confirmation instead of silently deleting the project.
* The backend mutation paths pass `call.identity`; `enqueue_task` and
  `delete_task` obtain task write access.  This is the verified authorization
  boundary.  No pipeline-specific front-end route guard was found.

## Evidence and verification

The following source checks were run in `D:\Projects\clearml\.worktrees\cp-01`
against the reviewed source revision:

```powershell
git status --short --branch
git --no-pager log -1 --oneline
rg "pipelines(StartPipeline|DeleteRuns)|ApiPipelinesService" clearml-web/src -g "*.ts"
rg "start_pipeline|delete_runs" clearml-server -g "*.py"
rg "include_pipeline_steps|system_tags.*pipeline|pipeline.*system_tags" clearml-server/apiserver -g "*.py"
```

They located the exact paths cited above; the dedicated-service search returned
only the two pipeline operations and their automated test.  The focused
existing test candidates are:

* `clearml-server/apiserver/tests/automated/test_pipelines.py`:
  `test_controller_operations`, `test_delete_runs`, and `test_start_pipeline`.
* `clearml-web/src/app/webapp-common/pipelines/pipeline-card-menu/pipeline-card-menu.component.spec.ts`.

This worktree has no `clearml-web/node_modules`, so the focused UI command
exited with `ng is not recognized`.  The available Python launcher is
`Python 3.14.2`, but its interpreter has no `pytest` module, so the focused
server command exited with `No module named pytest`.  Those existing checks
cannot be executed here without installing/restoring dependencies unrelated to
this evidence-only change.
Documentation validation is performed with `git diff --check`; path validation
is performed with `Test-Path` for every cited repository path before commit.

## Acceptance-criteria traceability

| Acceptance criterion | Completion evidence |
| --- | --- |
| Every lifecycle action maps to real code/service calls | Five call flows and the save/version/schedule table identify real paths or explicitly establish that no implementation exists. |
| Route names/navigation helpers are verified | Route table and component-local navigation call inventory cite exact registrations/paths. |
| Permissions, flags, errors, loading, and empty states are documented | Route metadata/guard findings and the loading/error/authorization section provide the verified boundary. |
| Save/version/run boundaries support adapter design | Executive model, lifecycle table, limitations, and CP-05 handoff separate project, task, graph-config, and clone/run semantics without selecting a new architecture. |
