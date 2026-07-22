# Native ClearPipe

ClearPipe is part of ClearML Server and ClearML Web. The canonical API is the
authorized `clearpipe` service introduced at API version 2.35. Definitions are
native controller tasks in `.pipelines/<name>` projects; runs use the existing
ClearML Agent, queue, artifact, report, and pipeline-monitoring lifecycle.

There is no ClearPipe database, web server, secret store, or deployment. The
top-level `clearpipe-main` directory is a non-canonical UI/behavior reference
only and must not be deployed in supported environments.

## Browser integration contract

Browser code uses the existing authenticated `clearpipe.*` service only through
the ClearPipe platform adapter. Its typed v2.35 request/response envelopes,
CAS revision handling, capability flags, paging, error outcomes, legacy
read-only policy, resource-selector boundary, and `/pipelines` handoff are
specified in
[`clearpipe-task-plan/CP-07_BACKEND_INTEGRATION_CONTRACT.md`](../../clearpipe-task-plan/CP-07_BACKEND_INTEGRATION_CONTRACT.md).
`/pipelines` remains the controller/run monitoring and rerun surface; it is
not a visual-definition persistence API.

The `clearpipeEnabled` web flag only controls guarded navigation visibility.
It is not authorization. Existing server company/public checks and server-side
secret rejection remain authoritative. Unsupported or legacy graph
representations must be shown read-only until their CP-06/CP-29 migration
contract is available.

## Graph v2 execution boundary

The service validates and stores CP-06 graph v2 documents canonically in
`configuration.ClearPipe`; it never routes their `kind`/`bindings` structure
through the legacy `type`/`edges` compiler. The CP-12 compiler is not yet
registered with the definition lifecycle or the CP-13 function lowerer, so v2
definitions report `capabilities.compilation`,
`capabilities.execution`, and `capabilities.run` as `false`. `validate`
returns the typed `compilation_unavailable` warning, and `start` rejects with
the same code before cloning a task. Controller parameter overrides use the
same secret policy as graph validation and reject secret-shaped keys or values
without returning their values.

## Packaging

The standard, local, and air-gapped server Dockerfiles copy the complete
`apiserver` tree, which includes the ClearPipe schema, validator/compiler, and
self-contained controller template. Compose, Helm, and Argo CD continue to use
the single ClearML server image; no new service or ingress is required.

Controller and child tasks declare only public package names. ClearML Agent
resolves them with its configured Python/package mirrors, so air-gapped Agents
must make the declared `clearml` SDK and any optional node tool packages
available in their existing mirror configuration. Credentials stay in Agent
configuration/environment and must never be placed in a graph.
