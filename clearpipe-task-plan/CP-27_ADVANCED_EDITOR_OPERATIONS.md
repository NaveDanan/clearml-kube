# CP-27 — Advanced editor operations

CP-27 adds an in-memory command history over the canonical `GraphStoreService`; it never persists a second graph or clipboard. Replays use GraphStore commands and CP-20 semantic edge controller commands. Clipboard payloads hold selected canonical nodes only in memory, remove sensitive configuration keys, remap node and binding IDs deterministically, and discard bindings that are not wholly internal to the copied selection.

The canvas exposes scoped keyboard commands only while focus is within the canvas and not in editable controls or dialogs. CP-30 can consume `ClearpipeAdvancedEditorOperationsService` for selection, history, and shortcut behavior; it must not bypass GraphStore.
