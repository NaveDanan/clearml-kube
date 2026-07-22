# Native ClearPipe

ClearPipe is part of ClearML Server and ClearML Web. The canonical API is the
authorized `clearpipe` service introduced at API version 2.35. Definitions are
native controller tasks in `.pipelines/<name>` projects; runs use the existing
ClearML Agent, queue, artifact, report, and pipeline-monitoring lifecycle.

There is no ClearPipe database, web server, secret store, or deployment. The
top-level `clearpipe-main` directory is a non-canonical UI/behavior reference
only and must not be deployed in supported environments.

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

