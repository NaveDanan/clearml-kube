# CP-23 — Toolbar and synchronized code preview

## Delivered boundary

`ClearpipeToolbarComponent` binds New and Save to `ClearpipeLifecycleService`, routes Open through the editor lifecycle surface, validates/code-previews through the CP-14 adapter, and uses CP-22's `ClearpipeDocumentTransferService` for canonical JSON import/export. Run remains an explicit CP-26-owned disabled hook.

`ClearpipeCodePreviewComponent` is read-only. It requests compiler output only through adapter validation, shows CP-11 diagnostics when source cannot be generated, supports copy and `.py` download, and never persists or executes generated code. Regeneration uses a semantic fingerprint that excludes visual and transient state.

## Verification

- `npx tsc --noEmit -p tsconfig.clearpipe.spec.json`
- `npm run test-clearpipe -- --include src/app/features/clearpipe/testing/clearpipe-toolbar-code-preview.spec.ts --browsers ChromeHeadless --watch=false`
