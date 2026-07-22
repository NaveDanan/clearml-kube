# CP-31 automated coverage record

`test-clearpipe` runs the maintained ClearPipe regression layers: the integration
fixtures in this directory plus the graph domain, API, platform, resource selector,
and dataset selector specs. `test-pipelines-regression` runs every spec below
`src/app/webapp-common/pipelines`.

The browser request-contract tests use a deterministic transport only at the
external compiler boundary. They verify canonical graph payloads and adapter
outcomes; they do not verify generated source. Source golden coverage is in
`apiserver/tests/test_clearpipe_task_generator.py`, which invokes the production
task and function lowerers against `generator-packet.v2.json`. It has no Redis or
other external-service dependency.

## Verification

Windows 10, Node dependencies installed with `npm ci --no-audit --no-fund`:

| Command | Result |
| --- | --- |
| `npm run test-clearpipe -- --watch=false` | 176 successful |
| `npm run test-clearpipe -- --watch=false` (repeat) | 176 successful |
| `npm run test-pipelines-regression -- --watch=false` | 4 successful |
| `npm run test-pipelines-regression -- --watch=false` (repeat) | 4 successful |
| `py -3.14 -m unittest apiserver.tests.test_clearpipe_task_generator` | 14 successful |
| `py -3.14 -m unittest apiserver.tests.test_clearpipe_function_generation` | 9 successful |
| `npx eslint src/app/features/clearpipe/testing/clearpipe-generator-request-contract.spec.ts src/app/webapp-common/pipelines/clearpipe-entry-routing.regression.spec.ts --max-warnings=0` | successful |
| `npm run lint -- --quiet` | blocked by pre-existing errors outside this scope (beginning in `src/app/app.component.ts`) |

The test commands emitted existing Sass `@import` deprecation warnings. The
compiled test targets and the changed-spec lint scope have no failures.
