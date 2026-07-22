# CP-22 — import, export, and unsaved-work evidence

## Delivered API for CP-23

`ClearpipeDocumentTransferService` is the toolbar boundary:

* `exportGraph()` returns deterministic, portable v2 JSON and a filename. It
  omits server `document.id`/`document.revision`, transient state is not in the
  canonical graph contract, and invalid/secret-bearing graphs fail closed.
* `downloadGraph()` performs the same export and browser download when a DOM is
  available.
* `importGraph(text)` validates through the CP-06 codec before asking the shared
  Save / Discard / Cancel flow; only a valid graph replaces the CP-10 store.
  Legacy and unsupported documents return a read-only migration outcome without
  mutation.
* `exportGeneratedCode()` returns `code_generation_unavailable`: CP-14 exposes
  no approved server source-generation operation, so CP-22 does not fabricate
  or execute code.
* `importGeneratedCode(source)` returns `code_import_unsupported`: no
  documented constrained generated-code parser is registered, so no source is
  parsed, evaluated, or replaced.

`ClearpipeUnsavedWorkService` supplies `newDocument`, `openDocument`,
`protect`, `beforeClose`, and `beforeModeChange`. Save continues only after
the CP-19 lifecycle service clears CP-10 dirty state; Discard continues without
saving; Cancel preserves the graph. `clearpipeUnsavedWorkGuard` wires that same
flow on all ClearPipe child editor routes.

## Security and compatibility

Imports are size-limited to 4 MiB, JSON-decoded only, then validated by CP-06.
Unknown fields/nodes, newer schemas, and v1 documents are retained as explicit
read-only outcomes rather than repaired or dropped. The CP-06 secret policy is
applied before any graph replacement. No browser persistence, raw HTTP client,
or code evaluation is used.
