# CP-19 persistence lifecycle evidence

## Delivered

- `ClearpipeLifecycleService` owns new/open/save/reload/Save As/return side
  effects while `GraphStoreService` remains the only editable graph authority.
- New definitions use `ClearpipeAdapterService.create`; saved definitions use
  CAS `update` with the returned revision. “Create version” is intentionally a
  Save As create: current revisions are mutable edit tokens, not history.
- Adapter outcomes expose busy, saved, failure, conflict, permission-disabled,
  and read-only states. Stale and failed saves retain the local graph.
- A denied Save As/create-version is operation-scoped: it keeps an otherwise
  editable graph writable for normal CAS updates.
- Unsupported representations stay read-only and are not converted or saved.
  Return uses the adapter’s existing definition-details navigation.

## Verification

`npm run test-clearpipe -- --include
src/app/features/clearpipe/testing/clearpipe-lifecycle.service.spec.ts`

- 6 Jasmine specs passed in ChromeHeadless.
- Task and function graphs round-trip through create/update/load/reload with
  logical equality, including typed ports, bindings, settings, parameters,
  generated inputs derived from bindings, and approved visual metadata.
- Tests cover create, CAS update, Save As/create-version, stale revision,
  backend failure, permission-disabled, unsupported/read-only, return
  navigation, and transient dirty boundaries.
- Save As/create-version denial with `edit: true, save_as: false` preserves
  unsaved edits and canonical editability, then permits a normal update save.
- Persisted fake-adapter payload inspection confirms selection, hover, drag,
  polling, request state, and derived generated-input UI state are absent.
  Secret-bearing graph input is rejected by the canonical codec before any
  persistence call.

`eslint src/app/features/clearpipe/editor/clearpipe-lifecycle.service.ts
src/app/features/clearpipe/testing/clearpipe-lifecycle.service.spec.ts`

- Passed (the repository emits its pre-existing `.eslintignore` migration
  warning).

## Guardrails

- No browser persistence, secondary graph store, raw client, HTTP client, or
  `SmApiRequestsService` was introduced.
- Unknown/unsupported graph representations are surfaced as read-only instead
  of being dropped or transformed.
- The adapter remains the sole production browser boundary and server
  authorization/CAS remains authoritative.
