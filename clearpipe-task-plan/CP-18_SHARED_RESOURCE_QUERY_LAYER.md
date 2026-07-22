# CP-18 — Shared resource query layer

## Boundary

`clearml-web/src/app/features/clearpipe/resources/` is ClearPipe's single
resource-query boundary. It consumes only CP-14's
`ClearpipeAdapterService`; it never imports a production resource client,
stores credentials, or makes validation-triggered network calls.

## Consumer API

* `ClearpipeResourceQueryService.for(kind)` supplies a cancellable controller
  with `load`, `refresh`, `retry`, `loadMore`, `selection`, and
  `managementLink`.
* `CLEARPIPE_RESOURCE_REGISTRATIONS` is the typed handoff for CP-17/21/24/25.
  Projects, tasks, datasets, queues, and models are adapter-backed. Dataset
  versions, templates, and components are explicitly unavailable until the
  adapter verifies an authorized selector.
* `ClearpipeResourceSelectorComponent` exposes `selectedIdChange` and
  `resourceSelected`, whose reference has only `kind`, server `resource_id`,
  and optional display label.
* `ClearpipeCredentialSelectorComponent` accepts existing
  `ClearpipeCredentialReference` values only. It rejects URL/basic-auth,
  key-like, and JWT-like values and can render only supplied management route
  commands.
* `ClearpipeResourceQueryService.resolver()` returns a synchronous CP-11
  status-only resolver. It emits exactly `available`, `missing`, `denied`,
  `stale`, `pending`, or `unavailable` from cached query state; it cannot
  issue a network request.

## State and authorization behavior

Queries distinguish loading, refreshing, ready, empty, error, stale, deleted,
denied, and unavailable. Obsolete adapter subscriptions are cancelled.
CP-14 currently returns an authorized inventory rather than a cursor, so
search/filtering and incremental pages are applied locally without bypassing
that adapter. A refresh failure retains only previously authorized normalized
summaries as `stale`; a denied result clears them and exposes no protected
resource identity. Management routes are requested only for an item returned
by the authorized adapter and only for registrations with a verified route.

Normalized summaries retain stable ID, name, project, and only optional
verified display metadata. They deliberately discard raw response properties,
error bodies, and all secret/credential values.
