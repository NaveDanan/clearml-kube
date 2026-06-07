# Move Run:ai Execution Into `runai_worker`

## Summary
- Build a dedicated `runai_worker` Docker image that contains `oc` plus Run:ai CLI v1 and v2 binaries.
- Change the API server so `submit_workload` only creates a pending Mongo execution record and returns immediately.
- Make `runai_worker` claim pending executions, load the persisted Mongo connection, authenticate, and run the actual `oc` / `runai` commands.
- Add rebuild and verification steps for the Docker image, worker container, async execution flow, and CLI availability.

## Key Changes
- **Docker image**
  - Add a dedicated worker image, for example `clearml/runai-worker:local`, extending `clearml/server:latest` or the local server build output.
  - Install:
    - `oc` into `/usr/local/bin/oc`
    - Run:ai CLI v1 into `/usr/local/bin/runai-v1`
    - Run:ai CLI v2 into `/usr/local/bin/runai-v2`
    - `/usr/local/bin/runai` symlink defaults to v2
  - Use pinned build args for download URLs and checksums:
    - `OC_CLI_URL`, `OC_CLI_SHA256`
    - `RUNAI_CLI_V1_URL`, `RUNAI_CLI_V1_SHA256`
    - `RUNAI_CLI_V2_URL`, `RUNAI_CLI_V2_SHA256`
  - Update all compose variants so only `runai_worker` uses the custom worker image.

- **Backend execution flow**
  - Keep connection settings persisted in `AutoscalerSettings`.
  - Change `autoscaler.submit_workload` to:
    - validate stored connection exists
    - save/update the app instance
    - create `AutoscalerExecution(status="pending")` with company, user, worker, workload name/type, and serialized workload params
    - return `{status: "queued", execution_id}`
  - Refactor current synchronous CLI logic into a reusable worker-side method that accepts an `AutoscalerExecution`.
  - `runai_worker` will:
    - atomically claim pending records by changing `pending -> running`
    - load `AutoscalerSettings` by execution company
    - build isolated `HOME`, `KUBECONFIG`, `RUNAI_CONFIG_DIR`
    - run `oc login` or Run:ai application login
    - select CLI binary by stored `runai_cli_version`: `v1 -> runai-v1`, `v2 -> runai-v2`, `auto -> runai-v2 then runai-v1 fallback`
    - update execution to `success` or `error` with stdout/stderr/return_code
  - Apply the same worker execution pattern to delete/stop requests if they require Run:ai CLI calls, so mutation commands do not run in apiserver.

- **API/UI behavior**
  - Frontend submit action should treat `queued` as a valid non-error result and poll `autoscaler.get_execution(execution_id)` until terminal state.
  - Dashboard can continue reading saved instances immediately; live Run:ai refresh should either stay read-only in apiserver temporarily or be moved to a worker-backed refresh job in a follow-up. Mutation commands must move to `runai_worker` in this change.

## Rebuild Steps
- Build the base server image if local code changes need to be baked in:
  - `docker build -f docker/build/Dockerfile -t clearml/server:latest .`
- Build the dedicated worker image with pinned CLI URLs/checksums:
  - `docker build -f docker/build/runai-worker.Dockerfile -t clearml/runai-worker:local --build-arg ... .`
- Recreate the worker:
  - `docker compose -f docker/compose.yaml up -d --force-recreate runai_worker`
- If apiserver code changed in the image, recreate apiserver too:
  - `docker compose -f docker/compose.yaml up -d --force-recreate apiserver runai_worker`

## Test Plan
- **Image checks**
  - `docker exec runai_worker oc version --client=true`
  - `docker exec runai_worker runai-v1 --version`
  - `docker exec runai_worker runai-v2 --version`
  - `docker exec runai_worker runai --version`
- **Backend checks**
  - Python compile the changed autoscaler files.
  - Submit a workload through the UI/API and verify Mongo has `AutoscalerExecution.status="pending"` immediately.
  - Verify `runai_worker` changes it to `running`, then `success` or `error`.
  - Verify stdout/stderr/return_code are stored on the execution record.
- **Functional checks**
  - Save connection settings, restart apiserver and worker, confirm settings remain in Mongo.
  - Submit a workload and confirm the command is executed from `runai_worker`, not `clearml-apiserver`.
  - Delete/stop an instance and confirm the deletion command is also executed by `runai_worker`.
  - Refresh the page and confirm APP INSTANCES are still loaded from Mongo.
- **Failure checks**
  - Missing stored connection returns API error before enqueue.
  - Invalid credentials produce worker execution `error` with redacted logs.
  - Missing CLI fails worker startup or health check clearly.

## Assumptions
- Use a dedicated worker image, not the shared `clearml/server` image.
- Use pinned CLI download URLs/checksums for reproducible builds.
- Store both Run:ai binaries side by side and select the binary at runtime from `runai_cli_version`.
- `runai_worker` is the only service allowed to execute Run:ai mutation commands.
