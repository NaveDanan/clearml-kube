# Role

You are a senior product engineer, UX architect, and ClearML pipeline domain expert working inside the current repository.

Your task is to design and implement a production-quality visual pipeline authoring experience called **ClearPipe**.

You are responsible for both:

1. Understanding the existing application and ClearML pipeline behavior.
2. Implementing a complete, integrated, usable workflow rather than producing only a design proposal or disconnected mock UI.

---

# Mission

Complete and productionize the work-in-progress `/clearpipe` experience.

ClearPipe must provide one interactive visual workspace for creating and editing ClearML pipelines through two authoring approaches:

1. **Pipeline from Tasks**
   - Build a pipeline from existing ClearML tasks.
   - Each selected task becomes a configurable node in a directed acyclic graph.
   - The pipeline should use the existing task cloning, parameter override, artifact reference, queue, caching, and execution behavior already supported by ClearML.

2. **Pipeline from Code**
   - Build a pipeline from functions or code-based components.
   - Users compose the pipeline visually by adding components and connecting inputs and outputs.
   - The graph generates deterministic, valid, readable ClearML pipeline code.

Both approaches must use:

- One canvas
- One graph model
- One validation system
- One persistence workflow
- One integration boundary with the existing `/pipelines` experience

Do not build a second pipeline runtime.

ClearPipe is a visual authoring and editing layer over the same ClearML pipeline infrastructure used by the existing application.

Verify all actual route names in the repository before making changes. Do not rely on route spelling from this prompt when it conflicts with the workspace.

---

# Reference aliases

The following reference aliases map to external read-only repositories:

- [`@file:pipeline`](./clearml/examples/pipeline) maps to:

  [`https://github.com/clearml/clearml/tree/master/examples/pipeline`](https://github.com/clearml/clearml/tree/master/examples/pipeline)

- [`@file:clearpipe-main`](./clearpipe-main) maps to:

  [`https://github.com/NJ-Labs/clearpipe`](https://github.com/NJ-Labs/clearpipe)

The supplied ClearPipe screenshot is also a required visual and interaction reference.

Do not limit your research to the screenshot or README files. Inspect the relevant implementation areas of both repositories.

---

# Source-of-truth hierarchy

Use the following precedence order when sources disagree.

## 1. Current ClearML workspace

The current workspace is the source of truth for:

- Application architecture
- Target implementation conventions
- Routing
- Existing UI components and design tokens
- State management
- API clients
- Authentication
- Authorization
- Feature flags
- Pipeline persistence
- Pipeline execution
- Testing
- Build and release conventions

Implement ClearPipe using the existing ClearML project’s architecture and conventions.

## 2. ClearML pipeline examples

[`@file:pipeline`](./clearml/examples/pipeline) is the source of truth for:

- ClearML pipeline semantics
- Task-based pipeline behavior
- Function-based pipeline behavior
- Pipeline parameters
- Task and artifact references
- Step dependencies
- Execution queues
- Caching
- Callbacks
- Local and remote execution
- Generated ClearML pipeline code

## 3. ClearPipe reference project and screenshot

[`@file:clearpipe-main`](./clearpipe-main) and the supplied screenshot are the source of truth for:

- Product interaction patterns
- Canvas workspace layout
- Node palette behavior
- Node-card information hierarchy
- Configuration-inspector behavior
- Toolbar hierarchy
- Dataset browsing experience
- Save, open, import, export, and run interactions
- Keyboard workflow
- Execution feedback
- Visual density
- Panel behavior
- First-use experience

Treat ClearPipe as a **functional and UX reference**, not as the implementation architecture for the ClearML project.

Do not copy its persistence model, API routes, execution engine, credential model, data contracts, branding, or implementation-specific architecture.

Do not discuss or reproduce the implementation technologies used by the ClearPipe reference repository. Use only the technologies and conventions appropriate to the current ClearML workspace.

## Conflict rule

When references conflict:

1. Preserve valid ClearML pipeline semantics.
2. Preserve the current ClearML application architecture.
3. Adapt the ClearPipe interaction pattern to those constraints.

Never sacrifice pipeline correctness to reproduce a reference interaction literally.

---

# Non-negotiable product principle

ClearPipe must not become an isolated visual demo.

Every production interaction must connect to real ClearML concepts and existing application services.

In particular:

- Saving must use the existing pipeline persistence workflow.
- Running must use the existing ClearML pipeline execution workflow.
- Existing tasks and datasets must come from real ClearML data sources.
- Permissions must use existing authorization rules.
- Credentials must remain in the existing credential or connection-management system.
- Generated code must represent the graph accurately.
- Reopening a visually authored pipeline must restore the graph accurately.
- `/pipelines` and `/clearpipe` must not maintain conflicting pipeline definitions.

---

# Required discovery phase

Before making broad implementation changes, inspect and document the relevant architecture.

Do not stop after this discovery phase. Use the findings to implement the feature.

## A. Understand the current `/pipelines` experience

Trace the existing pipeline functionality end to end:

- Route definitions
- Page hierarchy
- Pipeline list
- Pipeline details
- Pipeline creation
- Pipeline versioning
- Pipeline execution
- Scheduling
- Run history
- Status updates
- API endpoints
- Service-layer functions
- Request and response models
- Permissions
- Feature flags
- Error handling
- Loading states
- Empty states
- Existing tests

Determine which responsibilities belong to `/pipelines` and which belong to `/clearpipe`.

A likely boundary is:

- `/clearpipe`: authoring, graph editing, validation, parameter binding, and code preview
- `/pipelines`: saved-pipeline management, versions, schedules, runs, execution status, and history

Confirm or revise this boundary based on the workspace.

## B. Understand the current `/clearpipe` implementation

Inspect:

- Current route and page structure
- Existing canvas implementation
- Graph or diagram dependency
- Existing node definitions
- Graph state
- Configuration panels
- API integration
- Mocked behavior
- Incomplete behavior
- Styling
- Responsiveness
- Accessibility
- Existing tests
- Technical debt

Preserve useful existing work.

Do not replace working code merely to introduce a different pattern.

## C. Understand ClearML pipeline semantics

Inspect the entire [`@file:pipeline`](./clearml/examples/pipeline) directory, especially examples covering:

- Pipelines built from existing tasks
- Pipelines built from functions
- Decorator-based pipelines
- Pipeline-level parameters
- Step parameter overrides
- Parent dependencies
- Input and output references
- Artifact references
- Multiple outputs
- Step caching
- Execution queues
- Retry or continuation behavior
- Callbacks
- Local debugging
- Remote execution

At minimum, compare these models:

### Task-backed steps

Understand:

- `PipelineController`
- `add_parameter`
- `add_step`
- Base task ID
- Base task project and name
- Parent relationships
- Parameter overrides
- `${pipeline.*}` references
- `${step.*}` references
- Artifact references
- Queue selection
- Caching
- Execution callbacks

### Function-backed steps

Compare:

- `PipelineController.add_function_step`
- `PipelineDecorator.component`
- `PipelineDecorator.pipeline`

Understand:

- Function arguments
- Default values
- Declared return values
- Multiple outputs
- Automatic dependency inference
- Explicit dependencies
- Package requirements
- Task types
- Caching
- Queue selection
- Local debugging
- Remote execution

Select a primary code-generation model only after comparing it with the current backend and product architecture.

## D. Study the ClearPipe functional reference

Inspect [`@file:clearpipe-main`](./clearpipe-main/) end to end.

Study, at minimum:

- Node catalog and category definitions
- Node palette
- Drag-and-drop behavior
- Canvas interactions
- Connection handles
- Edge creation
- Edge reconnection
- Edge removal
- Node-card layouts
- Node status behavior
- Node action menus
- Configuration inspector
- General node settings
- Dataset browsing
- Dataset version actions
- Connection management
- Toolbar
- Save and Save As
- Open
- Import and export
- Run behavior
- Execution results
- Execution logs
- Undo and redo
- Copy, paste, and duplicate
- Keyboard shortcuts
- Unsaved-change handling
- Panel resizing and collapsing
- Loading, empty, success, and error states
- Sharing, presence, or collaboration behavior
- Responsive behavior

Do not assume every reference feature should be copied.

Determine which features should be:

- Preserved conceptually
- Adapted to ClearML
- Merged into another ClearML concept
- Deferred
- Rejected because they conflict with ClearML semantics

## E. Produce a reference-adaptation matrix

Before broad implementation, produce a concise matrix with these columns:

| Reference capability | Existing ClearML equivalent | Proposed ClearPipe behavior | Decision | Reason |
|---|---|---|---|---|
| Node palette | Existing task/dataset/component services | ClearML-native node catalog | Adapt | Preserve the interaction, replace the domain model |
| Generic cloud execution | ClearML queues and agents | Queue/agent selection | Replace | Use ClearML execution semantics |
| Local pipeline persistence | Existing pipeline APIs | Save through existing services | Replace | Avoid a second persistence system |

Include every major feature discovered in the reference project.

Use this matrix to prevent blind copying.

---

# Product architecture

## One visual workspace

Do not create separate canvas implementations for “Pipeline from Tasks” and “Pipeline from Code.”

Use one ClearPipe workspace.

The initial empty state may ask the user to start from:

- Existing tasks
- Code-based components
- A template
- An existing pipeline

After that selection, the user remains in the same canvas experience.

The selected creation approach may influence:

- Which palette section is emphasized
- Which templates are shown
- Which inspector fields are available
- Whether generated code is shown by default

It must not create unrelated graph implementations.

## One canonical graph model

Design or refine a typed, serializable, versioned intermediate representation for ClearPipe.

The model should account for:

- Schema version
- Pipeline ID
- Pipeline name
- Description
- Project
- Pipeline version
- Pipeline parameters
- Default queue
- Pipeline settings
- Node IDs
- Stable node names
- Node positions
- Node type
- Node implementation type
- Input ports
- Output ports
- Data bindings
- Execution-only dependencies
- Task references
- Dataset references
- Function definitions or component references
- Parameter overrides
- Queue overrides
- Caching settings
- Retry settings
- Tags
- Validation state
- Viewport state where useful
- Creation and update metadata

Do not store credentials or secret values in the graph.

## Source of truth

Prefer:

- The versioned graph document as the editable source of truth
- Deterministic generated code as a derived representation
- Existing pipeline APIs as the persistence and execution boundary

Do not maintain the graph, generated code, and backend payload as three independently editable states.

When the current backend requires a different canonical representation, create a documented adapter with deterministic transformations.

## Schema migration

Include a migration strategy for future graph-schema versions.

Older visually authored pipelines must either:

- Migrate safely, or
- Open in a clearly explained read-only state

Never silently discard unsupported fields.

---

# Integration between `/clearpipe` and `/pipelines`

ClearPipe must reuse existing pipeline functionality rather than duplicating it.

Reuse existing services for:

- Loading a pipeline
- Saving a pipeline
- Updating a pipeline
- Creating a version
- Running a pipeline
- Queue selection
- Scheduling where applicable
- Permission checks
- Error normalization
- Navigation
- Run details
- Execution status

Expected navigation flows include:

- Create visually from `/clearpipe`
- Open an existing pipeline in ClearPipe from `/pipelines`
- Save and return to pipeline details
- Run from ClearPipe and open the resulting run in `/pipelines`
- Create a new version from an edited visual graph
- Show a read-only state when the pipeline cannot be represented safely

Do not rewrite `/pipelines`.

Do not create a separate ClearPipe-only pipeline database.

---

# ClearPipe visual and interaction direction

Use the supplied screenshot to understand the intended hierarchy, density, and interaction placement.

The result does not need to be a pixel-for-pixel clone.

It should preserve the reference’s strengths while conforming to the ClearML product.

## Desktop workspace structure

Use a three-region layout:

```text
┌──────────────────┬─────────────────────────────────────┬──────────────────────┐
│ Node catalog     │ Interactive pipeline canvas         │ Selected-node        │
│ and resources    │ Floating pipeline toolbar           │ inspector            │
│                  │ Graph controls and minimap          │                      │
└──────────────────┴─────────────────────────────────────┴──────────────────────┘
```

Requirements:

* The canvas remains the dominant region.
* The left and right panels are collapsible.
* Panels are resizable when compatible with the current design system.
* Collapsing a panel should expand the canvas without losing state.
* The canvas must remain usable when one or both panels are collapsed.
* Narrow layouts should degrade gracefully through drawers, overlays, or collapsible panels.

## Visual hierarchy

Use:

* A neutral canvas background
* A subtle dot or grid pattern
* Compact node cards
* Clear connection handles
* Consistent spacing
* Subtle elevation
* Strong selected-node treatment
* Category accents
* Status icons
* Badges for concise metadata
* Clear hover and focus states

Do not overload node cards with complete forms.

Configuration belongs in the inspector.

## Color use

Category color may help distinguish concepts such as:

* Data
* Tasks
* Code components
* Training
* Outputs
* Control flow

Color must remain secondary to labels, icons, and status text.

Do not communicate errors, warnings, or completion using color alone.

---

# Left panel: node and resource catalog

The left panel should follow the conceptual model of the reference Node Palette while using ClearML-native concepts.

## Required behaviors

Support:

* Categorized entries
* Search
* Drag-to-add
* Click-to-add
* Clear labels
* Short descriptions
* Icons
* Compact mode when the panel is narrow
* Empty search results
* Loading state
* Permission-aware entries
* Disabled states with an explanation

## Suggested ClearML-native categories

Determine final names from the product, but evaluate categories such as:

### Data

* ClearML Dataset
* Dataset version
* Pipeline parameter
* External input or artifact

### Tasks and components

* Existing ClearML Task
* Function component
* Code component
* Reusable pipeline component

### Specialized templates

* Data processing
* Training
* Evaluation
* Reporting

Treat these as templates or presets when they share the same underlying ClearML execution model.

### Outputs

* Artifact output
* Model output
* Report
* Metric or quality gate

Do not reproduce reference node types merely because they exist in the reference project.

Every available node type must map to a real ClearML behavior.

## Searchable ClearML resources

Where applicable, allow users to search real:

* Tasks
* Projects
* Datasets
* Pipeline templates
* Reusable components

Search results should display enough context to distinguish similarly named resources, such as:

* Project
* Name
* ID
* Type
* Status
* Tags
* Last update
* Version

---

# Canvas requirements

The canvas should feel like a specialized ClearML pipeline editor, not a generic diagramming tool.

## Required interactions

Support:

* Drag and drop
* Click to add
* Select
* Multi-select where supported
* Drag and reposition
* Connect compatible ports
* Reconnect an existing edge
* Remove an edge
* Duplicate a node
* Copy and paste
* Delete
* Undo and redo
* Pan
* Zoom
* Fit to view
* Minimap
* Snap to grid where helpful
* Automatic layout or arrange
* Canvas context menu where useful
* Unsaved-change protection
* Keyboard navigation

## Connection UX

Connections must express real semantics.

Distinguish:

* Data bindings
* Artifact bindings
* Parameter bindings
* Execution-only dependencies
* Conditional or control relationships, only when supported

When creating a connection:

* Highlight compatible ports.
* Reject incompatible ports immediately.
* Explain why a connection is invalid.
* Prevent self-connections.
* Prevent cycles.
* Prevent duplicate bindings where invalid.
* Show the source output and target input.
* Allow the user to choose among multiple outputs or inputs when necessary.

Do not create ambiguous edges that merely indicate visual proximity.

## Empty canvas state

The first-use canvas should explain:

* What ClearPipe does
* The difference between task-based and code-based creation
* How to add the first node
* How to start from a template
* How to open an existing pipeline

Include one clear primary action rather than displaying only an empty grid.

---

# Node-card requirements

Use compact cards inspired by the reference screenshot.

Each node card should contain:

## Header

* Icon
* User-facing node name
* Short description or source identity
* Status indicator
* Validation indicator

## Summary body

Show only the most relevant configured values, for example:

* Base task
* Dataset and version
* Function name
* Queue
* Cache state
* Number of configured inputs
* Number of configured outputs
* Execution mode
* Task type

Limit the summary to the information needed to understand the graph at a glance.

## Ports

Show:

* Clearly positioned input ports
* Clearly positioned output ports
* Port labels when multiple ports exist
* Connection state
* Compatibility state during connection

## Footer

Provide concise actions such as:

* Configure
* Duplicate
* Delete
* Open source task or dataset
* Open generated code where relevant

Destructive actions must be undoable or confirmed according to existing product conventions.

## States

Represent:

* Unconfigured
* Valid
* Warning
* Invalid
* Queued
* Running
* Completed
* Failed
* Disabled
* Unavailable source resource

A selected node must be visually distinct.

A failed or invalid node must remain understandable without relying only on its border color.

---

# Right panel: node inspector

Selecting a node should open the inspector without navigating away from the canvas.

## Inspector header

Display:

* Node icon
* Node name
* Node type
* Stable node ID
* Validation status
* Close or collapse action
* Link to the underlying ClearML resource where applicable

## Inspector organization

At minimum, provide:

1. **Configuration**
2. **General**

Execution information may be:

* A third tab, or
* A clearly separated section

Follow existing ClearML design conventions.

## General tab

Include appropriate fields such as:

* Label
* Description
* Tags
* Node name used in generated code
* Current status
* Source resource
* Last update
* Validation messages
* Execution logs
* Created or executed task links

## Configuration tab

Render a form appropriate to the node type.

Use:

* Progressive disclosure
* Inline help
* Searchable selectors
* Clear defaults
* Field-level validation
* Dependency-aware suggestions
* Loading and error states

Do not display every advanced option by default.

---

# ClearML Dataset experience

The supplied screenshot demonstrates an important interaction model for browsing and selecting datasets.

Adapt that experience to real ClearML Datasets.

## Dataset browser

Support, where the existing APIs allow:

* Search
* Project filtering
* Dataset names
* Dataset IDs
* Versions
* File counts
* Tags
* Updated time
* Pagination or incremental loading
* Refresh
* Empty state
* Loading state
* Error and retry state

## Dataset actions

Evaluate support for:

* Use dataset
* Browse contents
* Download or acquire local copy
* Create dataset
* Create a new dataset version
* Select an existing version
* Open dataset details

Only expose actions supported by the current ClearML product and permissions.

## Dataset inspector

Display the selected dataset using compact cards or rows similar to the reference:

* Project → dataset name
* Version
* File count
* Tags
* Available actions

## Connections and credentials

Credentials must be managed through existing ClearML settings or connection management.

The node should store only a safe reference to the configured connection when required.

Do not place raw credentials into:

* Node state
* Pipeline definitions
* Generated code
* Import or export files
* Browser persistence

## Execution semantics

Translate generic “local versus cloud” concepts into ClearML-native concepts, such as:

* Local development or debugging
* ClearML execution queue
* ClearML Agent
* Existing remote execution configuration

Do not reproduce generic cloud-provider execution controls when ClearML already abstracts execution through queues and agents.

---

# Task-backed node requirements

A task node represents an existing ClearML task used as a pipeline step.

The inspector should support applicable fields such as:

* Step name
* Base task selector
* Base task ID
* Project
* Task name
* Task type
* Parameter overrides
* Pipeline parameter bindings
* Upstream artifact bindings
* Parent dependencies
* Queue override
* Cache behavior
* Retry or continuation behavior
* Tags
* Pre-execution and post-execution behavior, only when safely representable

The UI must distinguish between:

* The base task used as the template
* The task instance created during pipeline execution

Generated task-based code should use the appropriate `PipelineController` behavior.

---

# Code or function node requirements

A code-based node represents a function or reusable code component.

The inspector should support the selected generation model, including applicable fields such as:

* Component name
* Function name
* Description
* Inputs
* Default values
* Input bindings
* Return-value names
* Multiple outputs
* Task type
* Required packages
* Queue
* Caching
* Retry behavior
* Source location or editable component body
* Generated code preview

Do not claim to support arbitrary source-code parsing.

Define a constrained, testable subset.

When code import is supported:

* Prefer code generated previously by ClearPipe.
* Detect unsupported constructs.
* Explain unsupported constructs precisely.
* Never silently generate an incomplete graph.

---

# Reference feature adaptation

The following ClearPipe capabilities should be explicitly evaluated and incorporated when they map cleanly to ClearML.

## Workspace shell

* Three-pane layout
* Collapsible panels
* Resizable panels
* Floating toolbar
* Canvas controls
* Minimap
* Zoom feedback

## Editing

* Drag and drop
* Click to add
* Connect
* Reconnect
* Unlink
* Duplicate
* Copy and paste
* Delete
* Undo and redo
* Keyboard movement
* Select all
* Fit view

## Pipeline lifecycle

* New
* Save
* Save As
* Open
* Rename
* Import
* Export
* Delete
* Unsaved indicator
* Unsaved-change warning

## Node configuration

* Configuration and General tabs
* Contextual forms
* Managed connections
* Upstream-output suggestions
* Compact node summaries
* Status and validation state
* Execution output

## Execution

* Validate before run
* Topological execution representation
* Per-node status
* Running state
* Completed state
* Failure state
* Results summary
* Output and artifact links
* Execution logs

## Collaboration

Inspect the reference collaboration experience, but do not create a separate collaboration backend.

Where the existing ClearML product already supports relevant sharing, permissions, or presence behavior, integrate with it.

Otherwise:

* Preserve permission-aware editing.
* Document real-time collaboration as unsupported.
* Do not mock collaborator presence.

---

# Toolbar requirements

Use a floating or visually distinct canvas toolbar inspired by the supplied screenshot.

The toolbar should expose the highest-frequency actions without becoming overcrowded.

At minimum, evaluate:

* Pipeline name
* Saved or unsaved state
* New
* Save
* Open
* Validate
* Export
* Import
* Code preview
* Run Pipeline
* Settings or additional actions

The Run action should be visually prominent.

Disable or explain actions that are unavailable because of:

* Validation errors
* Missing permissions
* Missing task references
* Missing queue selection
* Unsupported pipeline state
* Unsaved required changes

Use menus for secondary actions.

Do not place every pipeline-management feature directly in the toolbar.

---

# Keyboard interaction

Support established platform conventions where they do not conflict with the existing application.

Evaluate shortcuts for:

* Save
* Save As
* Undo
* Redo
* Copy
* Paste
* Duplicate
* Delete
* Select all
* Zoom in
* Zoom out
* Fit view
* Move selected nodes
* Close inspector
* Toggle side panels

Shortcuts must not trigger while the user is typing in:

* Inputs
* Text areas
* Editors
* Search fields
* Dialogs

Provide a discoverable shortcut reference.

---

# Pipeline execution UX

ClearPipe must trigger the real ClearML execution flow.

Do not execute the pipeline independently in the browser.

## Before execution

Run preflight validation for:

* Graph validity
* Required parameters
* Required task references
* Required datasets
* Queue configuration
* Permissions
* Unsupported nodes
* Unsaved required state

## During execution

Display:

* Pipeline-level running state
* Per-node running state
* Current node
* Completed nodes
* Failed nodes
* Queued nodes
* ClearML task links
* Useful progress information available from the backend

Use subtle edge or node animation to indicate active execution without creating constant visual noise.

## After execution

Show a results summary containing:

* Overall result
* Per-node result
* Created task IDs
* Outputs
* Artifacts
* Models
* Dataset versions
* Errors
* Links to the existing pipeline-run details

Execution logs should be available from the selected node inspector or an execution panel.

Do not replace the existing `/pipelines` run-history experience.

---

# Validation requirements

A valid pipeline must be a directed acyclic graph.

Validate incrementally.

At minimum, detect:

* Cycles
* Self-connections
* Duplicate step names
* Invalid identifiers
* Missing required inputs
* Missing required outputs
* Dangling edges
* Deleted-node references
* Incompatible port connections
* Unknown task IDs
* Deleted or inaccessible tasks
* Unknown dataset IDs
* Missing dataset versions
* Invalid parameter overrides
* Unresolved `${pipeline.*}` references
* Unresolved `${step.*}` references
* Invalid artifact references
* Conflicting dependencies
* Unsupported node combinations
* Missing queues
* Unsupported code-generation features

Display errors:

* On the affected node
* On the affected connection
* Beside the affected inspector field
* In a graph-level validation summary

Messages must explain how to correct the problem.

Do not wait until Save or Run to reveal all errors.

---

# Generated-code requirements

Generated code must be:

* Deterministic
* Syntactically valid
* Readable
* Consistently formatted
* Stable when the graph has not changed
* Safe from invalid identifiers
* Safe from invalid string interpolation
* Covered by fixture, snapshot, or golden-file tests

## Task-based generation

Map task nodes to appropriate concepts such as:

* `PipelineController`
* Pipeline metadata
* Pipeline parameters
* `add_step`
* Base task identity
* Parent dependencies
* Parameter overrides
* Pipeline parameter references
* Step output references
* Artifact references
* Queue overrides
* Caching
* Supported callbacks

## Function-based generation

Choose one primary generation target after discovery:

* `PipelineController.add_function_step`, or
* `PipelineDecorator`

Document why it is the best fit.

Base the decision on:

* Existing backend behavior
* Graph representation
* Inputs and outputs
* Multiple return values
* Dependency inference
* Readability
* Local debugging
* Remote execution
* Extensibility

Avoid mixing both generation styles in one pipeline unless there is a verified requirement and a clear compatibility model.

## Dependency generation

Distinguish:

* Data dependencies
* Artifact dependencies
* Parameter dependencies
* Execution-only dependencies

Do not generate contradictory explicit and inferred dependencies.

## Code preview

Provide synchronized generated code with:

* Syntax highlighting
* Copy
* Download
* Clear regeneration behavior
* Visible generation errors
* A clear indication that the graph is driving the code

The preview may appear as:

* A resizable drawer
* A dedicated tab
* A split view
* A modal for occasional use

Choose the pattern that fits the existing application.

Generated code should be read-only by default unless a safe synchronization model exists.

Never use unrestricted evaluation or execute user-entered code merely to construct the graph.

---

# Save, reload, import, and export

## Save

Saving must preserve:

* Pipeline metadata
* Graph schema version
* Nodes
* Edges
* Positions
* Ports
* Bindings
* Settings
* Generated-code inputs
* Pipeline parameters
* Relevant viewport state

## Reload

Reopening a visually authored pipeline must recreate the same logical graph.

Node positions and selected configuration values must not disappear.

## Import

Support only clearly defined formats.

Validate imported data before replacing the current graph.

Show:

* Unsupported schema version
* Missing fields
* Invalid node type
* Invalid references
* Migration failures

Protect unsaved work before import.

## Export

Export may include:

* Versioned visual graph definition
* Generated ClearML pipeline code
* Both, as separate actions

Never export credentials.

Do not reuse the reference project’s persistence format unless it independently matches the ClearML product requirements.

---

# UX quality requirements

Use the existing ClearML design system and interaction conventions.

Implement:

* Intentional first-use state
* Helpful empty states
* Loading feedback
* Search loading
* Search error and retry
* Empty resource results
* Field validation
* Graph validation
* Save progress
* Save success
* Save failure
* Run progress
* Run result
* Stale-resource handling
* Permission failures
* Destructive-action confirmation where appropriate
* Unsaved-change protection
* Responsive panel behavior
* Tooltips for unfamiliar ClearML concepts

Use progressive disclosure for advanced settings.

Avoid:

* Full-screen forms for ordinary node editing
* Excessive modal dialogs
* Large cards with every possible setting
* Hidden errors
* Nonfunctional toolbar actions
* Generic placeholder text
* Mock data in production flows

---

# Accessibility requirements

At minimum, provide:

* Keyboard-accessible controls
* Visible focus states
* Semantic buttons
* Form labels
* Accessible error messages
* Sufficient contrast
* Non-color-only statuses
* Appropriate tooltips
* Predictable tab order
* Escape behavior for overlays and inspectors
* Reduced-motion consideration for animated edges and transitions

Where practical, provide a non-drag method for adding and connecting nodes.

---

# Implementation constraints

* Reuse existing components, hooks, services, types, and design tokens.
* Reuse the existing graph or canvas dependency when suitable.
* Do not introduce a second state-management system without a demonstrated need.
* Do not duplicate pipeline API clients.
* Do not bypass existing permissions.
* Do not bypass route guards.
* Do not store credentials in graph state.
* Do not silently change backend contracts.
* Do not rewrite `/pipelines`.
* Do not leave core actions as placeholders.
* Do not hard-code task IDs, dataset IDs, queue names, or workspace-specific values.
* Do not reproduce unsupported generic integrations merely because they exist in the reference project.
* Do not use local browser persistence as the production source of truth when existing application services are available.
* Preserve existing feature flags.
* Follow the repository’s formatting, testing, linting, and build conventions.

When backend limitations prevent the ideal UX:

1. Implement the best valid behavior.
2. Explain the limitation.
3. Do not simulate unsupported functionality.

---

# Execution plan

## Phase 1: Discovery and decision record

Produce a concise implementation note containing:

* Relevant workspace files
* `/pipelines` architecture
* Existing `/clearpipe` architecture
* Existing API contracts
* Reusable components
* ClearML pipeline findings
* ClearPipe reference findings
* Reference-adaptation matrix
* Proposed graph schema
* Source-of-truth strategy
* Route integration
* Generated-code strategy
* UX layout
* Risks
* Assumptions
* Ordered implementation milestones

Use exact workspace paths.

## Phase 2: Complete vertical slice

Implement the smallest complete workflow proving the architecture:

1. Open `/clearpipe`.
2. Create a new pipeline.
3. Add at least two real nodes.
4. Configure the nodes.
5. Connect them.
6. Validate the graph.
7. Generate the corresponding pipeline definition or code.
8. Save through the existing service.
9. Reload the pipeline.
10. Run through the existing execution workflow.
11. Open the resulting pipeline or run details.

Prioritize a complete vertical slice over many disconnected components.

## Phase 3: Task-based authoring

Complete:

* Task search
* Task-node creation
* Parameter overrides
* Artifact and output bindings
* Queue configuration
* Caching
* Validation
* Generated definition or code
* Save and run

## Phase 4: Code-based authoring

Complete:

* Function/component creation
* Inputs
* Outputs
* Multiple return values
* Dependencies
* Generated code
* Code preview
* Save and run

## Phase 5: UX hardening

Complete:

* Undo and redo
* Copy and paste
* Keyboard shortcuts
* Panel collapsing and resizing
* Empty states
* Loading states
* Error states
* Unsaved guards
* Dataset browser
* Execution feedback
* Accessibility
* Responsive behavior

## Phase 6: Tests and regression coverage

Add:

* Graph-model tests
* Cycle-detection tests
* Validation tests
* Serialization tests
* Migration tests
* Code-generation fixtures
* Task-reference tests
* Artifact-reference tests
* Save/reload integration tests
* Keyboard-interaction tests
* Core canvas interaction tests
* `/pipelines` regression coverage

Do not stop after creating a plan.

---

# Acceptance criteria

The feature is complete when:

1. `/clearpipe` uses real ClearML application services rather than only mock data.
2. The visual workspace follows the three-pane interaction hierarchy demonstrated in the reference screenshot.
3. The node catalog is categorized, searchable, and usable through drag or click.
4. Users can create a task-backed pipeline visually.
5. Users can create a code-backed pipeline visually.
6. Both modes use the same canonical graph model.
7. Node cards show concise configuration, status, validation, ports, and actions.
8. Selecting a node opens a contextual inspector.
9. ClearML tasks can be searched and selected.
10. ClearML Datasets can be browsed and selected where supported.
11. Dataset metadata, versions, tags, and actions are shown clearly.
12. Users can connect compatible inputs and outputs.
13. Invalid connections are rejected with an explanation.
14. Cycles and broken references are detected.
15. Pipeline and step references are generated correctly.
16. Generated code is deterministic and valid for the supported subset.
17. Saving and reloading preserve the logical graph.
18. Import and export are validated and versioned.
19. Credentials are never stored in graph state or generated output.
20. The toolbar exposes real New, Save, Open, Validate, Export, Import, and Run behavior.
21. Unsaved changes are visible and protected.
22. Undo, redo, duplicate, delete, copy, and paste work.
23. Zoom, pan, fit view, graph controls, and minimap work.
24. Execution shows pipeline-level and node-level status.
25. Execution results link to existing ClearML pipeline or task details.
26. ClearPipe integrates with `/pipelines` rather than replacing it.
27. Existing `/pipelines` behavior remains functional.
28. Core workflows work with a keyboard.
29. Loading, empty, error, warning, success, and read-only states are implemented.
30. Relevant tests, type checks, linting, and builds pass.
31. The application contains no new runtime-console errors.
32. No core interaction remains a nonfunctional placeholder.

---

# Final response format

After implementation, report the following.

## Findings

Summarize:

* Existing `/pipelines` architecture
* Existing `/clearpipe` architecture
* ClearML pipeline semantics
* ClearPipe reference functionality
* Important constraints

## Reference-adaptation decisions

Provide the completed matrix showing what was:

* Preserved
* Adapted
* Replaced
* Deferred
* Rejected

## Architecture decisions

Explain:

* Canonical graph model
* Source of truth
* Persistence model
* `/clearpipe` and `/pipelines` boundary
* Generated-code approach
* Validation architecture
* Dataset and task integration

## UX decisions

Explain how the implementation applies the reference screenshot and repository patterns to:

* Workspace layout
* Palette
* Node cards
* Inspector
* Toolbar
* Canvas controls
* Dataset browser
* Execution feedback
* Responsive behavior
* Accessibility

## Implementation

List the important files changed and the responsibility of each change.

## Verification

List the exact commands run for:

* Tests
* Linting
* Static checks
* Build
* Relevant integration tests

Include the result of each command.

## Remaining limitations

List only concrete, verified limitations.

Do not describe completed behavior as future work.


I reviewed the additional ClearPipe reference and the attached screenshot. Its relevant product patterns include a categorized drag-and-drop palette, a graph canvas with connection controls and a minimap, resizable side panels, node-specific configuration, pipeline lifecycle actions, import/export, execution feedback, keyboard operations, and unsaved-change handling.

Below is a consolidated replacement prompt. It treats [`@file:clearpipe-main`](./clearpipe-main) and the screenshot as **functional and visual references only** , while requiring the implementation to follow the ClearML repository’s own architecture and conventions.


# Role

You are a senior product engineer, UX architect, and systems designer working inside the ClearML application repository.

Your task is to design and implement a production-quality visual pipeline builder called **ClearPipe**.

Do not stop after research or planning. Complete a working vertical slice, integrate it with the existing application, and verify it through the repository’s established quality checks.

---

# Mission

Complete and productionize the work-in-progress `/clearpipe` experience.

ClearPipe must provide one unified, interactive, responsive workspace for visually creating ClearML pipelines through two primary authoring modes:

1. **Pipeline from Tasks**
   - Build pipelines from existing ClearML tasks.
   - Each selected task is represented as a configurable node.
   - Connections represent execution dependencies, parameter bindings, artifact references, or other supported ClearML relationships.

2. **Pipeline from Code**
   - Build pipelines from functions or code-based components.
   - Each visual component is represented as a configurable node.
   - Changes to the graph generate valid, readable, deterministic ClearML pipeline code.

The existing `/pipelines` feature is the established pipeline-management experience.

ClearPipe must not introduce a separate or competing pipeline runtime. It should be a visual authoring and editing layer over the same pipeline infrastructure, services, permissions, persistence mechanisms, and execution flows already used by `/pipelines`.

Verify all actual route names in the repository before implementing changes. Route names may be described inconsistently in this prompt or existing documentation.

---

# External reference mappings

Use the following mappings whenever these reference aliases appear:

- [`@file:pipeline`](./clearml/examples/pipeline) maps to:

  [`https://github.com/clearml/clearml/tree/master/examples/pipeline`](https://github.com/clearml/clearml/tree/master/examples/pipeline)

- [`@file:clearpipe-main`](./clearpipe-main) maps to:

  [`https://github.com/NJ-Labs/clearpipe`](https://github.com/NJ-Labs/clearpipe)

Also use the attached ClearPipe screenshot as a visual and interaction reference.

Treat both repositories as read-only references.

---

# Source-of-truth precedence

Use the following precedence when sources differ:

1. **The current ClearML workspace**
   - Source of truth for implementation architecture.
   - Source of truth for routes, APIs, permissions, persistence, state management, design system, reusable components, testing, build conventions, and supported backend behavior.

2. **[`@file:pipeline`](./clearml/examples/pipeline)**
   - Source of truth for ClearML pipeline semantics.
   - Source of truth for the supported generated ClearML code patterns.
   - Source of truth for task-based, function-based, and decorator-based pipeline behavior.

3. **[`@file:clearpipe-main`](./clearpipe-main)**
   - Functional and interaction-design reference.
   - Use it to understand the expected visual editor, canvas behavior, node configuration experience, pipeline lifecycle, and execution feedback.
   - Do not treat its architecture or implementation choices as requirements.

4. **The attached screenshot**
   - Visual reference for layout, information hierarchy, component density, node presentation, inspector organization, and canvas controls.
   - It is not a requirement for pixel-identical reproduction.

When adapting the reference experience, preserve ClearML’s existing visual language and application conventions.

---

# Strict reference implementation constraint

The ClearPipe reference repository is a **product behavior and UX reference only**.

Do not:

- Mention the reference repository’s programming language.
- Mention its application framework.
- Mention its build tooling.
- Mention its component libraries.
- Mention its state-management libraries.
- Mention its canvas implementation library.
- Copy its project architecture.
- Copy implementation-specific patterns merely because they exist in the reference.
- introduce dependencies solely to recreate its internal implementation.

Do not include those implementation details in:

- Discovery notes
- Architecture documents
- Code comments
- Commit descriptions
- Final reports
- User-facing documentation

Implement ClearPipe using the conventions, dependencies, architecture, and implementation technologies already established by the current ClearML repository.

---

# Product principles

## One product, not two unrelated pipeline builders

`/clearpipe` and `/pipelines` must represent two parts of one coherent pipeline product.

A likely responsibility boundary is:

- `/clearpipe`
  - Visual authoring
  - Graph editing
  - Pipeline configuration
  - Validation
  - Generated-code preview
  - Draft saving
  - Launch preparation

- `/pipelines`
  - Saved-pipeline management
  - Pipeline versions
  - Executions and runs
  - Scheduling
  - Status and history
  - Pipeline details
  - Operational management

Confirm this boundary against the current application before implementation.

Do not duplicate existing `/pipelines` behavior inside `/clearpipe` when the user can be handed off cleanly to the established experience.

## One canonical pipeline model

Use one typed, versioned pipeline graph model shared by task-based and code-based authoring.

Do not create unrelated graph formats for each authoring mode.

Mode-specific nodes may have specialized configuration, but they should share common graph primitives such as:

- Node identity
- Node position
- Input ports
- Output ports
- Edges
- Execution dependencies
- Data bindings
- Validation state
- Execution state
- Display metadata
- Version metadata

## Graph-driven authoring

The graph should be the primary authoring surface.

For pipeline-from-code authoring:

- Visual changes should produce synchronized generated code.
- Generated code should not become an independently editable source of truth by default.
- The graph, generated code, and backend payload must not drift apart.

For pipeline-from-tasks authoring:

- Visual changes should produce the corresponding supported ClearML pipeline definition.
- Task references and parameter bindings must remain resolvable and stable.

## Real ClearML behavior

Do not create a browser-only mock pipeline engine.

Do not reproduce a client-side execution model from the visual reference project.

Saving and execution must use the real ClearML pipeline infrastructure and existing application services.

---

# Required discovery phase

Before making broad implementation changes, inspect the workspace and both external references.

Produce a concise discovery and architecture note before implementing the main vertical slice.

Use exact workspace paths when describing the current ClearML implementation.

---

## 1. Understand the current `/pipelines` implementation

Trace the existing pipeline feature end to end.

Inspect:

- Route definitions
- Page hierarchy
- Components
- Hooks and services
- API clients
- Request and response models
- Pipeline list behavior
- Pipeline creation
- Pipeline editing
- Pipeline deletion
- Pipeline execution
- Pipeline versions
- Run history
- Scheduling
- Permissions
- Feature flags
- Route guards
- Error normalization
- Loading states
- Empty states
- Existing tests

Determine:

- How task-based pipelines are represented.
- How code-based pipelines are represented.
- What representation is persisted.
- Whether visual metadata can be stored.
- How existing pipelines are updated or versioned.
- How the current UI launches and tracks runs.
- What functionality should remain exclusively in `/pipelines`.
- Which components and services can be reused by `/clearpipe`.

Do not infer API contracts from UI behavior alone. Trace the real service and backend boundaries.

---

## 2. Understand the current `/clearpipe` implementation

Inspect the work-in-progress implementation before replacing anything.

Document:

- Existing route and page structure
- Existing canvas behavior
- Existing graph model
- Existing node types
- Existing state handling
- Existing persistence
- Existing API integration
- Existing reusable components
- Working interactions
- Mocked behavior
- Incomplete behavior
- Technical debt
- Accessibility gaps
- Responsive-layout limitations
- Tests
- Known assumptions

Preserve useful existing code.

Do not rewrite working functionality only to introduce a different abstraction or preferred style.

---

## 3. Study ClearML pipeline semantics

Inspect the entire [`@file:pipeline`](./clearml/examples/pipeline) reference directory.

Pay particular attention to:

- `pipeline_from_tasks.py`
- `pipeline_from_functions.py`
- `pipeline_from_decorator.py`
- Decorated pipeline component examples
- Examples using artifacts and parameters
- Examples using execution queues
- Examples using callbacks
- Examples using caching
- Examples demonstrating local and remote execution

### Task-based pipeline concepts

Understand and map:

- `PipelineController`
- Pipeline metadata
- Pipeline-level parameters
- `add_step`
- Base task ID
- Base task project
- Base task name
- Explicit parent relationships
- Parameter overrides
- Pipeline parameter references
- Step ID references
- Artifact references
- Execution queues
- Caching
- Retry behavior where supported
- Pre-execution callbacks
- Post-execution callbacks
- Local execution
- Remote execution

### Code-based pipeline concepts

Compare:

- `PipelineController.add_function_step`
- `PipelineDecorator.component`
- `PipelineDecorator.pipeline`

Understand:

- Function arguments
- Default values
- Required inputs
- Declared outputs
- Multiple return values
- Dependency inference
- Explicit dependencies
- Artifact transport
- Package requirements
- Caching
- Task types
- Execution queues
- Local debugging
- Remote execution
- Serialization limitations

After inspection, select one primary generated-code style for visual pipeline-from-code authoring.

Explain why the selected style is the best match for:

- The current ClearML backend
- Existing product behavior
- The graph model
- Input and output handling
- Multiple outputs
- Readability
- Deterministic generation
- Local debugging
- Future extensibility

Do not mix generated styles inside one pipeline unless a verified product requirement makes that necessary.

---

## 4. Study the ClearPipe functional reference

Inspect [`@file:clearpipe-main`](./clearpipe-main) as a complete product reference.

Study its user-visible behavior rather than its implementation technology.

At minimum, examine:

- Editor layout
- Node palette
- Palette grouping
- Drag-and-drop behavior
- Canvas navigation
- Node cards
- Connection handles
- Edge behavior
- Node selection
- Node duplication
- Node deletion
- Configuration inspector
- General node settings
- Execution modes
- Connection selection
- Dataset browsing
- Dynamic configuration forms
- Pipeline toolbar
- Save and open behavior
- Import and export behavior
- Run behavior
- Execution statuses
- Execution results
- Node logs
- Unsaved-state handling
- Keyboard interactions
- Panel resizing
- Panel collapsing
- Zoom controls
- Minimap
- Error, loading, and empty states
- Sharing or collaboration behavior where present

Do not assume every reference feature belongs in ClearML.

Map each relevant capability to an actual ClearML product concept.

---

## 5. Produce a functional parity matrix

Before implementation, create a table with these columns:

| Reference capability | Observed UX behavior | ClearML equivalent | Decision | Reason | Implementation owner |
|---|---|---|---|---|---|
| Example | Example behavior | Existing ClearML service or concept | Adopt / Adapt / Omit / Defer | Explanation | `/clearpipe`, `/pipelines`, or shared |

The matrix must cover at least:

- Three-panel editor layout
- Node palette
- Node categories
- Drag-and-drop creation
- Node cards
- Port connections
- Edge deletion and reconnection
- Node inspector
- Configuration and general tabs
- Pipeline toolbar
- Save
- Save As or versioning equivalent
- Open
- Delete
- Import
- Export
- Run
- Execution status
- Execution logs
- Undo and redo
- Keyboard shortcuts
- Unsaved-change protection
- Resizable panels
- Collapsible panels
- Zoom and fit-to-view
- Minimap
- Connection management
- Dataset or resource browsing
- Sharing and collaboration

`Omit` and `Defer` are valid decisions only when accompanied by a concrete technical or product reason.

---

# Expected visual direction

Use the attached screenshot as the visual target for the editor’s overall composition and interaction density.

Do not copy it pixel for pixel. Adapt it to ClearML’s design system.

The central canvas must remain the dominant visual area.

---

## Editor shell

Use a three-region workspace:

1. **Left node palette**
2. **Central canvas**
3. **Right configuration inspector**

The left and right panels should be:

- Collapsible
- Resizable where compatible with the current application
- Independently scrollable
- Keyboard accessible
- Restorable without losing the current selection or graph state

When either panel is collapsed, the canvas should expand to use the available space.

Avoid unnecessary route-level padding that reduces the usable canvas area.

---

## Left node palette

The node palette should:

- Have a clear title and concise instruction.
- Group nodes into meaningful categories.
- Use category labels and subtle visual differentiation.
- Show a drag affordance.
- Show an icon or recognizable symbol.
- Show the node name.
- Show a concise description.
- Support dragging a node onto the canvas.
- Support an accessible non-drag alternative such as click-to-add or keyboard insertion.
- Adapt when the panel becomes narrow.
- Remain usable in compact mode.
- Support search when the available task or component catalog is large.

Use categories that match actual ClearML concepts.

The visual reference includes categories resembling:

- Data
- Scripts or components
- Training
- Tracking
- Output

These are interaction and organization examples, not mandatory domain names.

For ClearML, derive the final node catalog from the supported pipeline semantics and existing product services.

Potential categories may include:

- Existing tasks
- Functions or components
- Pipeline inputs
- ClearML datasets
- Models
- Utility or control nodes

Only expose a node type when it can be represented, validated, saved, and executed correctly.

Do not add decorative placeholder node types.

---

## Central canvas

The canvas should include:

- A subtle grid or dot background
- Drag-and-drop node placement
- Pan
- Zoom
- Fit-to-view
- Optional snap-to-grid
- Visible input and output ports
- Directional connections
- Connection previews
- Edge selection
- Edge deletion
- Edge reconnection
- Node selection
- Multi-selection where supported
- Node dragging
- Duplicate
- Copy and paste
- Delete
- Undo and redo
- Automatic or assisted layout
- Minimap
- Canvas controls positioned without blocking graph content

Connections must not be decorative.

Every connection must represent a defined semantic relationship, such as:

- Execution dependency
- Function argument binding
- Task parameter override
- Pipeline parameter binding
- Artifact reference
- Step output reference
- Execution-only parent relationship

The graph must prevent or clearly reject unsupported connection directions.

The user must be able to understand why a connection is invalid.

---

## Node-card design

Node cards should be compact but informative.

Each node should communicate, without opening the inspector:

- Node name
- Node type
- Short description
- Configuration status
- Validation status
- Execution status
- Important configuration summary
- Input ports
- Output ports
- Whether the node is selected
- Whether the node has unsaved changes, when useful

Use consistent category differentiation through restrained combinations of:

- Border color
- Icon treatment
- Header accent
- Badge
- Port treatment

Do not rely on color alone.

The card footer may contain:

- Node-type badge
- Concise status message
- Configure action
- Duplicate action
- Delete action

Avoid placing full forms or advanced settings inside the card.

At normal zoom, users should be able to scan the pipeline structure. At lower zoom, the most important node state should remain distinguishable.

---

## Right configuration inspector

Selecting a node should open the right-side inspector.

The inspector should include:

- Node icon or type symbol
- Node-type title
- Stable node ID or identifier
- Close or collapse action
- Scrollable content
- Clear section hierarchy
- Inline validation
- Helper text
- Loading, empty, and failure states

Use at least two conceptual areas:

1. **Configuration**
   - Type-specific behavior
   - Task or component selection
   - Inputs and outputs
   - Queue or execution settings
   - Caching
   - Retry behavior where supported
   - Resource selection
   - Parameter bindings

2. **General**
   - Display name
   - Description
   - Stable identifier
   - Tags where supported
   - Current validation state
   - Current execution state

Additional tabs or sections may include:

- Inputs and outputs
- Generated code
- Advanced
- Logs
- Run details

Use progressive disclosure. Keep uncommon settings out of the primary configuration flow.

---

## Resource and connection selectors

Where a node needs a ClearML resource, provide structured selection rather than requiring users to paste opaque IDs whenever possible.

Examples include:

- Projects
- Tasks
- Task templates
- Datasets
- Models
- Execution queues
- Agents
- Credentials or configured connections

Selectors should support, where appropriate:

- Search
- Refresh
- Pagination or incremental loading
- Loading state
- Empty state
- Error state
- Retry
- Human-readable project and resource names
- Version
- Tags
- Last updated information
- Stable ID display
- Selection feedback

Use the existing ClearML connection and credential model.

Do not introduce a second credential store.

Do not serialize secrets into:

- Nodes
- Graph documents
- Generated code
- Exported pipeline files
- Browser storage
- URLs

When configuration is managed elsewhere, show a clear management link or handoff to the existing ClearML settings experience.

---

## Top toolbar

Use a compact floating or anchored toolbar that preserves the canvas as the primary workspace.

The toolbar should clearly expose the most frequent actions.

At minimum, account for:

- Pipeline name
- Saved, unsaved, or modified state
- New
- Save
- Save As or create-version equivalent
- Open
- Validate
- Export
- Import
- Run Pipeline
- Settings or advanced actions
- More-actions menu where necessary

Do not place every action at equal visual priority.

`Run Pipeline` should be visually prominent, but it must not bypass validation.

While running:

- Prevent duplicate submissions.
- Show progress or submission state.
- Report submission errors.
- Provide navigation to the real ClearML execution.
- Show actual execution status where available.

Destructive actions should require confirmation.

---

## Generated-code experience

The visual reference does not replace the requirement for synchronized generated ClearML code.

Add a code experience that fits naturally into the editor, such as:

- A toggleable right-side tab
- A bottom drawer
- A secondary panel
- A full-screen preview mode

The generated-code view should provide:

- Syntax highlighting
- Stable formatting
- Copy action
- Download action
- Regeneration status
- Validation messages
- A clear indication that the graph is the source of truth

Manual editing should be disabled by default unless a safe, explicitly supported synchronization model exists.

Do not imply arbitrary code-to-canvas round trips.

---

# Pipeline graph architecture

Design or refine a typed, versioned intermediate representation for the visual graph.

The exact naming should follow current repository conventions.

The representation should account for:

## Pipeline metadata

- ID
- Name
- Description
- Project
- Version
- Tags
- Creation mode
- Schema version
- Created and updated metadata

## Pipeline-level settings

- Pipeline parameters
- Default execution queue
- Caching defaults
- Retry defaults
- Execution behavior
- Supported controller settings

## Nodes

- Stable node ID
- Display name
- Generated-safe name
- Node kind
- Position
- Dimensions where needed
- Task reference or function/component reference
- Input definitions
- Output definitions
- Parameter bindings
- Queue settings
- Caching
- Retry behavior
- Task type
- Execution-only dependencies
- Validation state
- Visual metadata

## Ports

- Stable port ID
- Label
- Direction
- Semantic type
- Required or optional
- Accepted binding types
- Data or execution role
- Multiple-connection rules

## Edges and bindings

- Stable edge ID
- Source node and port
- Target node and port
- Binding kind
- Execution dependency
- Artifact reference
- Parameter expression
- Optional display metadata

## Validation

- Error code
- Severity
- Node or edge target
- Human-readable message
- Suggested correction

Separate domain state from transient UI state where practical.

Do not persist temporary UI state such as open menus or hover state in the pipeline definition.

---

# Source-of-truth strategy

Explicitly document which representation is canonical.

Prefer:

- A versioned graph document as the authoring source of truth
- Deterministic adapters from graph to backend payload
- Deterministic graph-to-code generation

When the current backend requires code or another representation to be canonical:

- Introduce a clear adapter boundary.
- Persist enough visual metadata to reopen the graph safely.
- Do not create three independently editable representations.
- Detect unsupported or lossy conversions.

When an existing pipeline cannot be represented without losing behavior:

- Do not fabricate a partially correct graph.
- Show an unsupported or read-only state.
- Explain exactly what construct prevents visual editing.
- Allow navigation to the existing pipeline details or code experience.

---

# Integration with `/pipelines`

ClearPipe must reuse existing pipeline infrastructure for:

- Fetching pipelines
- Loading pipeline definitions
- Saving pipelines
- Updating pipelines
- Creating versions
- Deleting pipelines
- Running pipelines
- Permissions
- Feature flags
- Error normalization
- Execution status
- Run history
- Navigation

Do not create duplicate API clients under `/clearpipe`.

Add coherent entry points such as:

- Create visually from the existing pipeline area
- Open in ClearPipe
- Edit visually
- Save as new version
- Return to pipeline details
- Run and view execution
- View task-level execution details

Preserve existing `/pipelines` behavior and regression-test the integration.

---

# Authoring-mode behavior

## Shared editor

Both creation modes should use the same canvas shell, toolbar, inspector, persistence boundary, validation system, and graph primitives.

The selected mode may determine:

- Available node types
- Inspector fields
- Code-generation target
- Import compatibility
- Validation rules

Do not maintain two visually similar but technically unrelated editors.

Do not silently mix task-backed and function-backed nodes unless:

- ClearML supports the resulting combination.
- The graph model can represent it.
- Generated output remains deterministic.
- Save and execution behavior are verified.

---

# Core user journeys

## Journey A: Create a pipeline from tasks

The user should be able to:

1. Start a new task-based pipeline.
2. Name the pipeline and choose its ClearML project.
3. Search or browse existing ClearML tasks.
4. Filter tasks by relevant fields.
5. Add selected tasks to the canvas.
6. See task identity and important metadata on the node.
7. Configure each task-backed node.
8. Bind pipeline parameters to task parameters.
9. Bind upstream task outputs or artifacts to downstream parameters.
10. Add execution-only dependencies where supported.
11. Configure queues and caching.
12. Connect nodes using compatible ports.
13. Detect cycles and broken references.
14. Preview the resulting ClearML pipeline definition or generated code.
15. Save through the existing pipeline infrastructure.
16. Reload the saved graph.
17. Run the pipeline through the existing ClearML execution flow.
18. Navigate to the resulting pipeline execution.

Task references should prefer stable IDs internally while displaying human-readable names.

Handle deleted, inaccessible, or stale task references gracefully.

---

## Journey B: Create a pipeline from code

The user should be able to:

1. Start a new code-based pipeline.
2. Add a function or component node.
3. Define or select the function/component identity.
4. Configure arguments and defaults.
5. Declare outputs and return-value names.
6. Connect upstream outputs to downstream inputs.
7. Bind pipeline-level parameters.
8. Configure supported queue, caching, task-type, and execution settings.
9. See synchronized generated ClearML code.
10. Understand which graph elements correspond to generated code.
11. Copy the generated code.
12. Download the generated code.
13. Validate the graph and generated representation.
14. Save through the supported backend flow.
15. Run through the existing ClearML execution infrastructure.

Define and document a predictable generated subset.

Do not claim support for every possible programming construct.

When importing code:

- Prefer code previously generated by ClearPipe.
- Parse only a documented subset.
- Reject unsupported constructs clearly.
- Do not silently discard behavior.
- Do not use unrestricted code evaluation in the browser.

---

## Journey C: Edit an existing pipeline

Where the existing pipeline representation allows safe visual editing, the user should be able to:

1. Open a pipeline from `/pipelines`.
2. Enter `/clearpipe` with the graph loaded.
3. See whether the pipeline is task-based or code-based.
4. Edit the graph.
5. Validate the changes.
6. Review generated output.
7. Save according to existing update or versioning behavior.
8. Return to pipeline details.
9. Run the updated pipeline.

When the pipeline is only partially representable:

- Prefer a read-only graph or a clear unsupported state.
- Identify unsupported constructs.
- Avoid presenting a graph that appears complete but is not semantically equivalent.

---

## Journey D: Run and observe

The user should be able to:

1. Validate the pipeline.
2. Submit it for execution.
3. See submission progress.
4. See the created ClearML pipeline execution.
5. Observe actual node states.
6. Open node or task execution details.
7. Inspect errors and logs.
8. Navigate to the established run-details experience.
9. Retry or rerun through existing supported flows.

Node execution states should be based on real ClearML execution data.

Potential states include:

- Not configured
- Ready
- Submitted
- Queued
- Running
- Completed
- Failed
- Aborted
- Skipped
- Cached

Map them to the actual backend state model.

Do not simulate success for unsupported nodes.

---

# Interaction requirements

Support, where compatible with the existing application:

- Drag node from palette
- Click-to-add node
- Select node
- Multi-select
- Drag nodes
- Snap to grid
- Connect compatible ports
- Reject incompatible ports
- Reconnect edge
- Delete edge
- Delete node
- Duplicate node
- Copy node
- Paste node
- Undo
- Redo
- Select all
- Keyboard movement of selected nodes
- Zoom in
- Zoom out
- Fit graph
- Pan
- Minimap navigation
- Auto-layout
- Close selection
- Collapse palette
- Collapse inspector
- Resize panels
- Contextual insertion
- Unsaved-change protection

Keyboard shortcuts should follow familiar application conventions and must not fire while the user is typing in a form field.

Provide a discoverable shortcut reference where appropriate.

---

# Pipeline semantics and validation

A runnable pipeline must be a directed acyclic graph.

Validation must be incremental and run before save or execution where appropriate.

Validate at least:

- Cycles
- Self-connections
- Duplicate step names
- Invalid generated identifiers
- Missing required inputs
- Missing required task references
- Missing function definitions
- Missing declared outputs
- Dangling edges
- Deleted-node references
- Unknown ports
- Incompatible port relationships
- Multiple bindings where only one is supported
- Invalid pipeline parameter references
- Invalid step references
- Invalid artifact references
- Unresolved `${pipeline.*}` expressions
- Unresolved `${step.*}` expressions
- Unsupported generated-code constructs
- Invalid queue settings
- Invalid caching settings
- Invalid retry settings
- Permission failures
- Inaccessible tasks or resources
- Unsupported mixed authoring modes

Show validation:

- On the affected node
- On the affected port or edge
- In the inspector
- In a graph-level summary
- In the generated-code view when relevant

Messages must explain:

- What is wrong
- Where it is wrong
- How to correct it

Do not rely only on red borders or color indicators.

---

# Generated-code requirements

Generated code must be:

- Deterministic
- Syntactically valid
- Readable
- Consistently formatted
- Stable when the graph has not changed
- Safe from invalid identifier generation
- Safe from invalid string interpolation
- Covered by fixture, snapshot, or golden-file tests

## Task-node generation

Map supported task nodes to the relevant `PipelineController` concepts:

- Pipeline metadata
- Pipeline parameters
- Default queue
- `add_step`
- Task identity
- Parent dependencies
- Parameter overrides
- Pipeline parameter references
- Step references
- Artifact references
- Caching
- Supported callbacks
- Supported retry behavior

## Function-node generation

Choose one primary generated style after discovery:

- `PipelineController.add_function_step`, or
- `PipelineDecorator`

Explain the choice in the architecture note.

Generate:

- Function definitions or references
- Arguments
- Defaults
- Return-value declarations
- Component metadata
- Input bindings
- Output bindings
- Cache settings
- Task types
- Queues
- Pipeline entry point
- Local-debug guidance where appropriate
- Remote execution entry point

## Dependency generation

Distinguish among:

- Data dependency
- Parameter binding
- Artifact binding
- Explicit execution-only dependency
- Automatically inferred dependency

Do not generate contradictory dependency declarations.

Generate explicit parents only when required by the chosen ClearML API and graph semantics.

---

# Persistence, import, and export

## Saving

Saving must preserve:

- Pipeline domain state
- Graph positions
- Node dimensions when needed
- Port identities
- Edge identities
- Authoring mode
- Schema version
- Supported visual metadata

Saving and reopening the same pipeline must preserve the graph.

## Unsaved changes

Show a clear saved or modified state.

Protect users when they:

- Create a new pipeline
- Open another pipeline
- Import a pipeline
- Navigate away
- Close the editor
- Switch to an incompatible mode

## Import and export

Support import and export only through defined, versioned formats.

Validate imported content.

Reject malformed or incompatible files with actionable messages.

Do not import secrets.

When importing an older schema:

- Migrate it explicitly where possible.
- Record the migration.
- Reject it safely when migration is not possible.

---

# Execution feedback

Use the visual reference’s immediate status feedback as inspiration, but connect it to actual ClearML execution.

Provide:

- Pipeline submission state
- Per-node status
- Concise node status messages
- Real error details
- Links to task executions
- Logs where supported
- Start and completion timestamps
- Cached-step indication
- Failure location
- Clear next action

A run-summary surface may show:

- Execution order
- Node name
- Node type
- Result
- Created task ID
- Outputs
- Failure reason

Do not obscure the established `/pipelines` run-details experience. Use concise feedback in ClearPipe and link to the full operational view.

---

# UX quality requirements

Use the existing ClearML design system.

The final experience should include:

- Intentional empty state
- Clear mode selection
- Helpful templates or examples
- Searchable node/resource selection
- Progressive disclosure
- Inline ClearML-specific help
- Clear Save, Validate, and Run actions
- Visible unsaved state
- Confirmation for destructive actions
- Loading indicators
- Skeletons where appropriate
- Empty-search results
- Retry states
- API error states
- Stale-resource handling
- Success feedback
- Accessible focus management
- Responsive panel behavior
- Keyboard alternatives to drag-and-drop

Avoid:

- Excessive modal use
- Overloaded node cards
- Forms directly on the canvas
- Hidden validation
- Placeholder actions
- Decorative nodes
- Inconsistent terminology
- Requiring users to memorize resource IDs
- Generic errors such as “Something went wrong” without context

---

# Accessibility requirements

At minimum:

- All toolbar actions must have accessible labels.
- Node actions must be keyboard reachable.
- Focus state must be visible.
- Drag-only actions must have an alternative.
- Form controls must have labels.
- Validation must not rely on color alone.
- Error messages should be associated with affected controls.
- Canvas controls should be operable without a pointing device where practical.
- Dialog focus must be managed correctly.
- Escape should close transient UI before clearing graph selection.
- Screen-reader users should receive useful status updates for save, validation, and run submission.

---

# Responsive and performance requirements

The canvas experience may be desktop-first, but smaller supported viewports must remain usable.

On constrained widths:

- Panels may collapse into drawers.
- The canvas should remain accessible.
- Toolbar actions may move into an overflow menu.
- Primary actions must remain visible.
- Inspector content must remain scrollable.
- Node configuration must not be clipped.

For large graphs:

- Avoid unnecessary full-graph rerenders.
- Keep node movement responsive.
- Debounce expensive validation where appropriate.
- Preserve deterministic state updates.
- Avoid fetching large task/resource lists without pagination or search.
- Avoid regenerating code unnecessarily when unrelated visual state changes.

---

# Implementation constraints

- Reuse existing ClearML components, hooks, services, types, and design tokens.
- Reuse existing API abstractions.
- Reuse existing permissions and feature flags.
- Reuse the current state-management approach unless there is a demonstrated architectural gap.
- Reuse an existing graph capability when suitable.
- Do not add a major dependency without documenting why the existing stack is insufficient.
- Do not rewrite `/pipelines`.
- Do not bypass route guards.
- Do not bypass permissions.
- Do not silently change backend contracts.
- Do not store credentials in the graph.
- Do not execute user-provided code in the browser merely to inspect it.
- Do not use unrestricted evaluation.
- Do not hard-code task IDs, dataset IDs, project IDs, model IDs, queue IDs, or workspace-specific values.
- Do not leave core actions as nonfunctional buttons.
- Do not ship a mock-only flow as complete.
- Do not copy the ClearPipe reference project’s implementation architecture.
- Follow the repository’s established formatting, linting, testing, and type-checking conventions.

When desired behavior is blocked by a backend limitation:

- Implement the best supported behavior.
- Show the limitation honestly in the UI where necessary.
- Document the exact backend limitation.
- Do not simulate unsupported behavior.

---

# Implementation approach

## Phase 1: Discovery and decisions

Produce an implementation note containing:

- Relevant workspace files and modules
- Current `/pipelines` architecture
- Current `/clearpipe` architecture
- Existing API contracts
- Existing persistence format
- Existing permission model
- Reusable UI components
- ClearML pipeline semantic findings
- ClearPipe reference UX findings
- Functional parity matrix
- Recommended canonical graph model
- Recommended source-of-truth strategy
- Recommended generated-code style
- `/clearpipe` and `/pipelines` integration boundary
- Migration strategy
- Risks
- Assumptions
- Ordered milestones

Keep this note concise and implementation-focused.

Do not stop after writing it.

---

## Phase 2: Complete vertical slice

Implement the smallest complete workflow proving the architecture.

The vertical slice must include:

1. Create a new pipeline.
2. Choose task-based or code-based mode.
3. Add at least two real nodes.
4. Configure both nodes.
5. Connect them.
6. Bind at least one meaningful input or parameter.
7. Validate the graph.
8. Show synchronized generated output.
9. Save through the existing pipeline service.
10. Reload the saved graph.
11. Submit the pipeline using the existing execution flow.
12. Navigate to or display the resulting ClearML execution.

Prioritize a complete working slice over many disconnected controls.

---

## Phase 3: Editor hardening

Add:

- Editing existing representable pipelines
- Undo and redo
- Copy and paste
- Edge reconnection and deletion
- Auto-layout or arrange
- Unsaved-change protection
- Improved validation
- Task and resource search
- Loading states
- Empty states
- Error states
- Execution feedback
- Keyboard interactions
- Accessibility improvements
- Responsive behavior
- Import and export
- Code-generation fixtures
- Integration tests
- Regression coverage for `/pipelines`

---

## Phase 4: Conditional enhancements

Only after the core experience is stable, evaluate:

- Real-time collaboration
- Presence indicators
- Shared editing
- Pipeline templates
- Command palette
- Advanced graph navigation
- Large-graph optimization
- Visual diff between pipeline versions

Do not implement collaboration solely because it exists in the visual reference.

Use existing ClearML identity, sharing, permission, and real-time infrastructure when available. Otherwise, document it as deferred.

---

# Acceptance criteria

The work is complete when all of the following are true:

1. `/clearpipe` uses real ClearML data and services.
2. `/clearpipe` is integrated with `/pipelines`.
3. The visual editor follows the three-region information architecture demonstrated by the reference image.
4. The palette is organized, searchable where needed, and supports accessible node insertion.
5. Users can create a task-based pipeline visually.
6. Users can create a code-based pipeline visually.
7. Both modes use a shared typed graph model.
8. Nodes expose meaningful input and output ports.
9. Connections have real ClearML semantics.
10. Cycles are prevented or reported.
11. Invalid references are reported incrementally.
12. Generated code is deterministic.
13. Generated code is valid for the supported ClearML subset.
14. Pipeline parameter references are generated correctly.
15. Step-output and artifact references are generated correctly.
16. Saving and reopening preserve graph structure and positions.
17. Unsaved changes are visible and protected.
18. Import and export use a versioned validated format.
19. Secrets are not stored in the graph or export.
20. Save, Open, Validate, Import, Export, and Run are functional.
21. Running uses the existing ClearML execution infrastructure.
22. Node statuses reflect actual execution state where available.
23. Errors identify the affected node or connection.
24. Core canvas interactions work with a pointing device.
25. Core editor actions have keyboard support.
26. Side panels can be collapsed and remain usable.
27. The editor behaves acceptably on supported smaller viewports.
28. Existing `/pipelines` functionality continues to work.
29. Relevant unit and integration tests pass.
30. Generated-code fixture or golden-file tests pass.
31. The application has no new linting, type-checking, build, or runtime-console errors.
32. No reference-repository implementation technology is mentioned in the final report.

---

# Final response format

After completing the implementation, respond using this structure:

## Findings

Summarize:

- Existing ClearML pipeline architecture
- Existing `/clearpipe` state
- ClearML pipeline semantics
- Relevant functional and UX lessons from the reference project

Do not mention the reference project’s implementation technology.

## Functional parity decisions

Provide the final Adopt / Adapt / Omit / Defer matrix.

## Architecture decisions

Explain:

- Canonical graph model
- Source of truth
- Task-based representation
- Code-based representation
- Generated-code approach
- Persistence strategy
- `/clearpipe` and `/pipelines` boundary
- Unsupported behavior

## Implementation

List the important workspace files changed and the purpose of each change.

## UX behavior

Describe the completed:

- Palette
- Canvas
- Node cards
- Inspector
- Toolbar
- Generated-code experience
- Validation
- Save and run flow

## Verification

List the exact commands run and results for:

- Tests
- Integration tests
- Linting
- Type checking
- Build
- Any relevant manual verification

Do not claim a command passed unless it was actually run successfully.

## Remaining limitations

List only concrete remaining limitations.

Do not describe completed functionality as future work.
