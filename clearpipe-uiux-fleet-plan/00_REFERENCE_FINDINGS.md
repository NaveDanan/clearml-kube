# ClearPipe UI/UX reference findings

## Purpose

This note captures the product behavior worth adapting from the read-only NJ-Labs ClearPipe reference. It does **not** make the reference repository an implementation or visual-style source of truth. The target repository’s ClearML components, tokens, state, services, and routes remain authoritative.

Reference repository: `https://github.com/NJ-Labs/clearpipe`

## Observed user-facing architecture

| Product layer | Reference path | Observed behavior | ClearML adaptation |
|---|---|---|---|
| Node catalog metadata | `src/config/node-definitions.ts` | A centralized list describes node label, description, category, icon role, and initial configuration. | Keep a data-driven catalog, but make it an adapter over canonical ClearML node factories. Do not duplicate domain defaults in UI metadata. |
| Node library/palette | `src/components/pipeline/node-palette.tsx` | Entries are grouped by category and change between full, condensed, and icon-only layouts based on panel width. Dragging carries the selected node type to the canvas. | Preserve categorized discovery and width-aware density. Add search, real resources, click-to-add, keyboard insertion, permissions, loading, empty, and error states. Use ClearML tokens and terminology. |
| Graph creation state | `src/stores/pipeline-store.ts` | The graph store creates nodes from a type, manages selection, panels, dirty state, history, clipboard, and graph changes. | Use the target’s existing canonical graph commands and state. The UI library must call those commands rather than introduce a second store. |
| Renderer registry | `src/components/nodes/index.ts` | Node kinds are mapped to specialized visual renderers. | Keep a registry/extension model so node-family agents can work in parallel without forking the base card. |
| Shared node card | `src/components/nodes/base-node-component.tsx` | A common shell provides handles, identity, status, summary content, and actions. | Preserve one shared card anatomy, but use ClearML density, tokens, statuses, menus, accessibility, and semantic ports. |
| Inspector | `src/components/pipeline/node-config-panel.tsx` | Selecting a node opens a right-side inspector with common header/general content and node-specific configuration. | Preserve contextual configuration and extension points. Improve hierarchy, progressive disclosure, field validation, scrolling, focus, and resource selectors. |
| Workspace panels | `src/components/ui/resizable-panel.tsx` | Left and right panels resize and collapse; the canvas grows into available space. | Preserve the behavior, not the fixed dimensions or styling. Use target layout primitives and supported responsive patterns. |
| Canvas workspace | `src/components/pipeline/pipeline-canvas.tsx` | The canvas combines a subtle background, graph controls, minimap, floating toolbar, zoom feedback, palette, inspector, and connection interactions. | Preserve the spatial hierarchy. Calm the canvas, use semantic edges, and avoid default animation on every edge. |
| Keyboard workflow | `src/components/hooks/use-keyboard-shortcuts.ts` | Common save/edit/zoom/panel shortcuts are available and suppressed while typing or inside dialogs. | Adapt only shortcuts that match ClearML conventions, expose a discoverable reference, and verify focus/dialog behavior. |

## The node-store pattern to preserve

The useful pattern is a five-part chain:

```text
User-facing node library
        ↓
Catalog entry or real ClearML resource result
        ↓
Canonical graph create-node command
        ↓
Registered node-family renderer
        ↓
Contextual inspector extension
```

The target library should support two kinds of entries:

1. **Creation types** — task-backed step, function/component, pipeline parameter/input, supported dataset/resource node, and any other node kind already represented by the canonical graph.
2. **Real resource results** — existing ClearML tasks, datasets and versions, reusable components/templates, projects, queues, models, or artifacts when the current product APIs support them.

A catalog entry should carry only UI metadata and an insertion adapter:

- Stable catalog key
- Canonical node kind
- Category
- Label and concise description
- Icon role
- Search keywords
- Availability and permission state
- Optional resource identity and disambiguating metadata
- Optional preview of inputs/outputs
- Canonical create-node command or factory reference

It should **not** own a second copy of domain defaults, validation, graph state, persistence, or execution behavior.

## Behaviors to adopt

- Categorized and searchable node discovery.
- Full, condensed, and compact library modes based on actual panel width.
- Drag-to-add plus accessible click/keyboard alternatives.
- One shared node-card anatomy with specialized summary slots.
- Contextual inspector instead of forms embedded in cards.
- Collapsible/resizable panels that expand the canvas.
- Clear canvas controls and minimap.
- Familiar keyboard editing and navigation.
- Short, purposeful transitions that preserve orientation.

## Behaviors to adapt

- Replace generic/static node categories with real ClearML concepts and resources.
- Replace reference colors and component styling with current ClearML tokens.
- Replace fixed panel widths with target responsive rules.
- Replace unlabeled single handles with semantic, typed, labeled ports where applicable.
- Replace generic status colors with ClearML status components and non-color cues.
- Replace raw ID entry with structured resource selectors.
- Replace local or duplicated state with existing target graph/UI state.

## Behaviors to reject

- Duplicate default configuration in both catalog metadata and graph creation code.
- A second graph or node state store.
- Unsupported decorative node types.
- Generic cloud/provider choices that do not map to ClearML queues and agents.
- Raw credentials in node configuration.
- Always-animated ordinary edges.
- Hover scaling or looping animation on dense graph content.
- Full forms inside node cards.
- Browser alerts or unexplained disabled actions.
- Pixel-for-pixel copying of the reference.

## ClearML visual rule

Use the reference for **interaction structure and information hierarchy**. Use the current ClearML repository for:

- Typography
- Spacing and density
- Colors and semantic statuses
- Icons
- Buttons and menus
- Forms and selectors
- Tooltips and dialogs
- Loading, error, empty, permission, and read-only states
- Focus and keyboard conventions
- Theme support
- Motion tokens
- Responsive behavior

When the two references conflict, preserve ClearML product consistency and pipeline correctness.
