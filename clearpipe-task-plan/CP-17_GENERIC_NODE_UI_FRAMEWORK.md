# CP-17 — Generic node UI framework

## Delivered surfaces

`clearml-web/src/app/features/clearpipe/editor/framework/` provides standalone,
presentation-only components for:

- a categorized, searchable catalog with native drag metadata and semantic
  click/keyboard add requests;
- compact node cards, status, validation, low-emphasis action, and port
  primitives;
- typed renderer and interaction props for the CP-16 canvas adapter;
- a typed task/function extension registry for catalog entries, icons,
  summaries, inspector forms, and supplied status presentation; and
- representative task, function, invalid, running, failed, and unavailable
  fixtures plus repository-native story data.

`editor/clearpipe-config-panel.component.*` is the generic inspector host. It
shows the selected item's stable ID, type/base reference, optional safe source
link, explicit read-only reason, close/collapse controls, Configuration and
General tabs, registered tabs, scrollable content, and optional `logs`,
`execution`, or `code` template slots. A registered form receives only the
typed canonical node, read-only state, and diagnostics through
`CLEARPIPE_INSPECTOR_FORM_CONTEXT`.

## Composition boundary

These components mount only as CP-15 slot contributions:

| Component | CP-15 slot |
| --- | --- |
| `sm-clearpipe-catalog` | `workspace.palette` |
| `sm-clearpipe-config-panel` | `workspace.inspector` |
| `sm-clearpipe-node-card` and `sm-clearpipe-port` | CP-16 renderer inside `workspace.canvas` |

The framework does not create a page shell, query resources, hold a graph,
derive binding compatibility, call production clients, or infer execution
state. Consumers pass CP-10 selector snapshots and emit returned interactions
to their owning command boundary. CP-20 supplies port compatibility props;
CP-18 and CP-21/24/25 supply resource and domain form registrations.
`ClearpipePortPresentation.selected` is likewise a current renderer input
derived from CP-10 selection; the port primitive retains no selection snapshot.

## Extension registration

Domain packets register only task/function extensions. The helper preserves the
node discriminator at compile time:

```ts
registry.register(defineClearpipeNodeExtension<TaskNode>({
  nodeKind: 'task',
  catalog: {
    id: 'approved-task',
    category: 'Run approved tasks',
    label: 'Approved task',
    description: 'Reference an authorized base task.',
    nodeKind: 'task',
    icon: 'account_tree',
  },
  icon: 'account_tree',
  summarize: (node) => ({text: `Base task: ${node.base_task.kind}`}),
  form: {id: 'task-form', component: ApprovedTaskFormComponent},
}));
```

Forms must not implement resource queries, compatibility, execution, or
secrets. They consume the injected context and use their owning command/resource
facade. Status registration is presentation data only; mapping authoritative
runtime data remains outside CP-17.

## Accessibility contract

Catalog entries are semantic buttons, retain non-drag keyboard insertion, and
name disabled reasons. Cards, ports, actions, validation, and status surfaces
repeat every state in text and icon form; color is supplemental. Port labels
include direction, role, accepted binding kinds, multiplicity, connection, and
compatibility. The inspector has named tabs with arrow-key navigation, an
explicit focus request input, visible focus treatment, labelled close/collapse
buttons, and one intentional scrolling body.

## Focused verification

```powershell
Set-Location clearml-web
npm test -- --include src/app/features/clearpipe/editor/framework/clearpipe-catalog.component.spec.ts --include src/app/features/clearpipe/editor/framework/clearpipe-node-card.component.spec.ts --include src/app/features/clearpipe/editor/framework/clearpipe-extension-registry.spec.ts --include src/app/features/clearpipe/editor/clearpipe-config-panel.component.spec.ts --watch=false
```
