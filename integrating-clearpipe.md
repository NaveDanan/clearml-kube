# Native ClearPipe Integration

## Summary

Port ClearPipe into ClearML as a native Angular 20 feature at `/clearpipe`, backed by ClearML Server and existing authentication, projects, tasks, artifacts, queues, agents, autoscaler, storage, reports, and permissions.

ClearPipe definitions will be native controller tasks tagged `pipeline` and `clearpipe`. They will appear in both the ClearPipe library and existing ClearML Pipelines views. Supabase, Next.js APIs, direct server-side command execution, custom invitations, and live presence will not be part of the integrated architecture.

## Backend and API

- Add an authorized `clearpipe` API service at API version 2.35 with:
  - `create`, `get_all`, `get_by_id`, `update`, `validate`, `start`, `archive`, `delete`, and `parse_script`.
  - Company/user filtering identical to existing task and project APIs.
  - Optimistic revision checking to prevent overwriting concurrent edits.
- Represent each definition as:
  - A pipeline project following ClearML’s `.pipelines/<name>` convention and tagged `pipeline`.
  - A `controller` task tagged `pipeline` and `clearpipe`.
  - `configuration.ClearPipe` containing schema version, revision, nodes, edges, viewport, default queues, and non-secret node configuration.
  - `configuration.Pipeline` containing the normalized parent/step structure consumed by existing pipeline monitoring.
  - Native owner, company, tags, archive state, and public/private visibility.
- Validate unique node/edge IDs, graph acyclicity, connected references, required node settings, queue/resource access, dataset/task/model visibility, and absence of embedded secrets.
- `start` will validate and clone the definition through the native pipeline lifecycle, apply parameter overrides, enqueue the controller, verify queue availability, and return the run task ID.
- Generate a self-contained ClearPipe controller runner in the task script definition so any compatible ClearML Agent can execute it without a separate ClearPipe service.
- The runner will create child tasks, set the controller as parent, update `configuration.Pipeline` with child IDs/statuses, respect dependencies, propagate failure/cancellation, and use standard task events for logs and metrics.
- Transfer data between nodes through ClearML dataset IDs, artifact URIs, task/model IDs, and manifest artifacts—never through shared web-server filesystem paths.

## Node Execution and ClearML Resources

- **Dataset:** select native ClearML datasets, task artifacts, uploaded files, URLs, or configured cloud storage; resolve data on the agent and publish a manifest artifact.
- **Versioning:** implement ClearML Data create/version/download plus DVC, Git LFS, MLflow artifacts, and custom versioning commands as agent tasks.
- **Execute:** run inline, browser-uploaded, or repository scripts as `data_processing` tasks; map upstream artifact values to validated environment variables and publish declared outputs as artifacts.
- **Training:** create or clone native `training` tasks from repository, uploaded script, existing task, or model configuration; map parameters to hyperparameters and enqueue on the selected target.
- **Experiment Tracking:** use native ClearML tracking directly; for MLflow, W&B, or Comet, run an agent-side synchronization task using credentials already available in the agent environment.
- **Report:** generate HTML, Markdown, JSON, or PDF from upstream metrics, plots, models, and artifacts; upload the output and create/publish a native ClearML report record.
- Support queue targets and configured autoscaler/Run:ai targets. Autoscaled workloads retain corresponding ClearML child tasks and mirror workload state, logs, and failures.
- Use typed native resource selectors for projects, tasks, datasets, models/artifacts, queues/workers, autoscaler resources, reports, serving endpoints, and storage capabilities.
- Reference ClearML server configuration, storage settings, task script settings, queue profiles, and agent environment variables. Raw credentials must never be returned to the browser or serialized into a graph.

## Angular Web Feature

- Add lazy routes:
  - `/clearpipe` — searchable pipeline-definition library.
  - `/clearpipe/new` — new definition.
  - `/clearpipe/:taskId` — visual editor.
- Add a visible authenticated side-navigation button with active-route styling and ClearML-native tooltip/icon treatment.
- Port the ClearPipe experience to Angular:
  - Node palette, draggable canvas, connections, pan/zoom, selection, keyboard shortcuts, undo/redo, resizable configuration panel, toolbar, minimap, validation results, and unsaved-change protection.
  - Native ClearML theme, typography, dialogs, notifications, loading states, error handling, and dark mode.
  - NgRx actions/effects/reducer or signal-backed feature state following existing ClearML conventions.
- Implement the canvas with Angular/CDK and SVG edges; do not embed React, Next.js, or an iframe.
- Provide create/open/save-as/archive/delete/run, JSON import/export, revision-conflict handling, resource navigation links, and run-status links into existing task/pipeline pages.
- Replace ClearPipe login/profile, Supabase settings, custom secrets, team-member roles, share tokens, and presence with the current ClearML session and native permissions.
- Add a `clearpipeEnabled` configuration flag defaulting to enabled; disabling it hides the navigation entry and route.
- Preserve sub-path hosting by deriving all links and API/file URLs from existing ClearML configuration rather than absolute application-root URLs.

## Packaging and Compatibility

- Include the Angular feature in the existing ClearML Web build copied into the server image; no additional frontend or database service is introduced.
- Include the controller-runner template and required validation/compiler code in the ClearML Server image.
- Keep `clearpipe-main` unchanged as a reference implementation, mark it non-canonical in documentation, and remove it from supported deployment instructions.
- Support local Docker, standard Compose, Helm/Argo CD, sub-path hosting, and air-gapped builds. Agent task requirements must work through configured package mirrors.

## Test and Acceptance Plan

- Server tests:
  - Authorized CRUD, company isolation, public/private visibility, revisions, archive/delete, validation, script parsing, and start/clone/enqueue behavior.
  - Graph cycles, missing references, inaccessible resources, invalid queues, malformed imports, oversized scripts, and secret rejection.
  - Runner DAG ordering, parallel branches, artifact propagation, retries, cancellation, failed parents, autoscaler errors, and all six node adapters.
- Web tests:
  - Routing and side navigation, library filtering, editor state, node/edge operations, undo/redo, validation, save conflicts, import/export, resource selectors, run flow, permissions, and dark/sub-path rendering.
- Integration tests:
  - Create a six-node pipeline, save it as a controller definition, run through a test agent, inspect child tasks/logs/artifacts/report, stop a run, and reopen it in existing ClearML Pipelines.
  - Verify user/company isolation and confirm that graphs and network responses contain no raw credentials.
- Build validation:
  - ClearML Server automated tests, Angular unit tests and lint, production web build, local server image build, Compose smoke test, Helm rendering, Argo CD manifests, and an air-gapped build using configured mirrors.

## Assumptions

- ClearML Agents have access to required repositories, storage credentials, and optional external tracker credentials through their existing environment/configuration.
- Local script/file selection becomes browser upload to the ClearML fileserver; server-local filesystem paths are not preserved.
- Existing Supabase data is not migrated, but current ClearPipe JSON graph import/export remains supported.
- Existing ClearML pipeline monitoring remains the authoritative run view; ClearPipe is the authoritative visual definition editor.
