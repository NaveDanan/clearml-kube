# CP-15 — ClearPipe workspace shell

## Purpose

`sm-clearpipe-editor` is the single full-height ClearPipe workspace. It owns
only layout, landmarks, responsive panel behavior, first-use messaging, and
route surfaces. It is not a graph store, a second authoring mode, a browser
runner, or a resource client.

The shell keeps panel width, visibility, active drawer, focus-return target,
and announcements in component signals only. It does not write browser
storage, query strings, graph state, selection, request state, or run state.
Collapsing or resizing a panel therefore cannot mark a graph dirty.

## Regions and accessibility

The DOM order is identity header, labelled toolbar, authoring catalog aside,
primary canvas, inspector aside, then the polite status region. A skip link
enters the canvas. Each side region has a named, keyboard-reachable collapse
control. Desktop resize separators are labelled vertical `role="separator"`
controls with min/max/current pixel values and Arrow/Home/End handling.

At widths below 960px the side regions become modal-style drawers. Only one
drawer can be open, its heading receives focus, Escape/backdrop/Close dismiss
it, and focus returns to the invoking control. The canvas remains underneath.
The shell provides visible focus styling and disables nonessential animation
under `prefers-reduced-motion: reduce`.

## Slot contract

`editor/clearpipe-workspace-slots.ts` is the composition contract. The
`smClearpipeWorkspaceSlot` directive marks content mounted by the shell; its
typed slot names and intent/context types are the review boundary for future
contributions. A contribution emits an intent to its owner and must not reach
sibling instances or production clients.

| Slot | Consumer / owner | Shell rule |
|---|---|---|
| `workspace.palette` | CP-17 | Registered task/function discovery only; no legacy generic choices or drag-only flow. |
| `workspace.canvas` | CP-16 | Receives the dominant centre region; no shell graph authority. |
| `workspace.inspector` | CP-17 | Owns generic host content, while the shell owns drawer, heading, scrolling, and close behavior. |
| `workspace.toolbar.primary` / `.overflow` | CP-19, CP-23, CP-26 | Contributions stay in the single toolbar and use labelled overflow. |
| `workspace.preview` | CP-23 | Server-derived, read-only preview only. |
| `workspace.execution` | CP-26 | Real preflight/submission/handoff only; no browser runner or simulated status. |
| `workspace.first-use` | CP-15, CP-19, CP-22 | Real starts only, no seeded graph or fake template. |
| `workspace.status` | All action owners | Structured safe status only; no raw server or secret data. |

CP-16 replaces the temporary canvas implementation behind
`workspace.canvas`; CP-17 registers catalog/inspector content; CP-23 mounts
toolbar/preview content; and CP-26 mounts execution content. None should
create a second page shell or change the shell's transient state boundary.

## First use and route surfaces

An empty v2 draft is an intentional first-use state. It has one primary action
to explore registered starts and explains that task/function, code-backed,
template, and existing-pipeline paths appear only after their owning,
authorized capability is available. It creates no runnable-looking sample.

The shell distinguishes loading, denied, not found, unsupported/legacy,
read-only, and generic load failure. Unsupported definitions are read-only:
there is no edit, conversion, or Run path. The Run entry is visible but
disabled with its adjacent Agent-proof gate explanation until CP-26 proves the
approved real ClearML path.

## Verification

The focused editor spec covers route preservation, conflict reload failure,
oversize import rejection, collapse state preservation, keyboard resize
semantics, narrow one-drawer/focus return, the disabled Run gate, and a
permission-denied surface. Run the existing web test command with this spec
once the repository's web dependencies are installed:

```powershell
Set-Location clearml-web
npm test -- --include src/app/features/clearpipe/editor/clearpipe-editor.component.spec.ts --watch=false
```
