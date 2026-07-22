# CP-21 dataset browser integration

## Contract

`ClearpipeDatasetBrowserComponent` consumes only the CP-18
`ClearpipeResourceQueryService` dataset controller. It performs local
project/search filtering, pagination, refresh, retry, and state rendering from
that controller. It never calls a ClearML API, validates resources, persists
browser state, or reads credentials.

The current authorized adapter supplies only dataset ID, name, and optional
project. The browser conditionally renders CP-18 optional version, tags, and
updated-time fields if a future authorized adapter supplies them; it explicitly
states when they and file counts are absent. Dataset-version, create, download,
and acquire actions are not rendered because the registered `dataset-version`
kind is unavailable. The only action is CP-14's verified management link.

## Inspector and canonical handoff

`provideClearpipeDatasetInspectorExtension()` is the CP-17 registration
provider. A host with no competing task inspector form can install it to render
the dataset browser in the task inspector. The current editor shell has not
yet installed any CP-17 extension providers, so this module intentionally does
not alter the generic framework or legacy editor.

`ClearpipeDatasetBindingHandoffService.bind(selection, node, portId)` is the
CP-24/25 handoff API. It accepts only a CP-18
`ClearpipeResourceSelection`, requires an existing task artifact-input port,
and writes the already-approved CP-06 `resources[]` dataset reference plus
`artifact` binding through `GraphStoreService`. It refuses unsupported ports,
read-only/no-graph failures, and replacement of an existing binding. The graph
contains only `kind`, stable server `resource_id`, and optional server label,
so CP-19 save/reload retains the reference without credentials.

CP-11 must continue to use `ClearpipeResourceQueryService.resolver()` for
status-only resolution. This UI deliberately makes no validation or network
call.
