# CP-24 task-backed authoring

`provideClearpipeTaskAuthoring()` registers the `task` CP-17 extension at each
ClearPipe editor route. Its catalog action preserves click, keyboard, and typed
drop placement before opening the CP-18-backed task selector.

The authoring façade obtains a CP-14 `taskDescriptor` only for an authorized
inventory task ID. It persists that descriptor identity as `base_task.task_id`,
never runtime or child-task IDs. Descriptor parameters become canonical
sectioned override ports; safe output artifacts become ClearML artifact
reference ports. Queue, cache, clone, retry, defaults, ports, and bindings use
CP-10 commands. CP-20 owns parameter/artifact/execution edge mutation.

Missing, unavailable, and stale descriptors are actionable; stale descriptors
require an explicit confirmation. A descriptor change that would alter a bound
port fails with `CP24BOUND001` until the user disconnects or remaps it.
