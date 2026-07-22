# CP-28 vertical-slice integration record

The deterministic CP-28 transport fixture is the external ClearPipe boundary; all
browser-side graph, authoring, lifecycle, adapter, preview, and execution services
are production implementations.

Verified typed constraints:

- Task authoring accepts only server-authorized immutable base-task descriptor IDs.
- A runnable v2 validation response must include generated source plus a manifest
  containing a `sha256:` graph digest and one runtime mapping per stable graph node.
- Start requires the saved definition ID, its revision, watched-queue confirmation,
  and an opaque idempotency key. The returned task ID is the only run-navigation ID.
- Snapshot application is scoped by run ID, definition revision, and graph digest;
  the transport returns no runtime data if any correlation value differs.
- The fixture contains descriptor metadata and opaque IDs only—no parameter defaults,
  credentials, source secrets, or browser-side execution path.
