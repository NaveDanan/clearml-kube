import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  EnvironmentInjector,
  inject,
  Injector,
  input,
  output,
  signal,
  Type,
  viewChild,
  ViewContainerRef,
} from '@angular/core';
import {NgTemplateOutlet} from '@angular/common';
import {MatIconModule} from '@angular/material/icon';
import {ClearpipeExtensionRegistry} from './framework/clearpipe-extension-registry';
import {ClearpipeStatusComponent} from './framework/clearpipe-status.component';
import {ClearpipeValidationComponent} from './framework/clearpipe-validation.component';
import {
  CLEARPIPE_INSPECTOR_FORM_CONTEXT,
  ClearpipeInspectorFormContext,
  ClearpipeInspectorFormContract,
  ClearpipeInspectorPresentation,
  ClearpipeInspectorSlot,
  ClearpipeInspectorSlotContext,
  ClearpipeValidationPresentation,
} from './framework/clearpipe-ui.types';
import {GraphNode} from '../domain/graph-v2.types';

interface InspectorTab {
  readonly id: string;
  readonly label: string;
  readonly slot?: ClearpipeInspectorSlot;
}

/**
 * Generic inspector host. Domain forms are registered through CP-17's typed
 * registry and receive canonical node data as a read-only input signal.
 */
@Component({
  selector: 'sm-clearpipe-config-panel',
  templateUrl: './clearpipe-config-panel.component.html',
  styleUrl: './clearpipe-config-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule, NgTemplateOutlet, ClearpipeStatusComponent, ClearpipeValidationComponent],
})
export class ClearpipeConfigPanelComponent {
  private readonly injectedRegistry = inject(ClearpipeExtensionRegistry);
  private readonly injector = inject(Injector);
  private readonly environmentInjector = inject(EnvironmentInjector);
  private readonly host = inject(ElementRef<HTMLElement>);
  private currentOutlet: ViewContainerRef | undefined;
  private currentForm: unknown;
  private handledFocusRequest = -1;

  readonly presentation = input<ClearpipeInspectorPresentation | null>(null);
  readonly extensionRegistry = input<ClearpipeExtensionRegistry>(this.injectedRegistry);
  readonly focusRequest = input(0);

  readonly closeRequested = output<void>();
  readonly collapseRequested = output<void>();
  readonly tabChanged = output<string>();
  readonly sourceRequested = output<ClearpipeInspectorPresentation['source']>();
  readonly validationFocused = output<ClearpipeValidationPresentation>();

  protected readonly activeTab = signal('configuration');
  protected readonly selectedTab = computed(() => {
    const selected = this.activeTab();
    return this.tabs().some((tab) => tab.id === selected) ? selected : 'configuration';
  });
  protected readonly heading = viewChild<ElementRef<HTMLElement>>('inspectorHeading');
  private readonly formOutlet = viewChild('formOutlet', {read: ViewContainerRef});
  protected readonly tabs = computed<readonly InspectorTab[]>(() => {
    const inspector = this.presentation();
    const ownerSlots: ClearpipeInspectorSlot[] = [
      ...(inspector?.logs ? [{id: 'logs', label: 'Logs', template: inspector.logs.template}] : []),
      ...(inspector?.execution ? [{id: 'execution', label: 'Execution', template: inspector.execution.template}] : []),
      ...(inspector?.code ? [{id: 'code', label: 'Code', template: inspector.code.template}] : []),
    ];
    const slots = [...ownerSlots, ...(inspector?.slots ?? [])]
      .filter((slot) => slot.id !== 'configuration' && slot.id !== 'general')
      .filter((slot, index, values) => values.findIndex((value) => value.id === slot.id) === index);
    return [
      {id: 'configuration', label: 'Configuration'},
      {id: 'general', label: 'General'},
      ...slots.map((slot) => ({id: slot.id, label: slot.label, slot})),
    ];
  });
  protected readonly currentTab = computed<InspectorTab>(() =>
    this.tabs().find((tab) => tab.id === this.selectedTab()) ?? this.tabs()[0]);
  protected readonly activeSlot = computed(() => this.currentTab().slot);
  protected readonly inspectorContext = computed<ClearpipeInspectorFormContext<GraphNode> | null>(() => {
    const inspector = this.presentation();
    return inspector ? {
      node: inspector.node,
      readOnly: !!inspector.readOnly,
      readOnlyReason: inspector.readOnlyReason,
      validations: inspector.validations ?? [],
    } : null;
  });
  protected readonly form = computed(() => {
    const inspector = this.presentation();
    return inspector ? this.extensionRegistry().formFor(inspector.node) : undefined;
  });

  private readonly renderRegisteredForm = effect(() => {
    const outlet = this.formOutlet();
    const form = this.form();
    const context = this.inspectorContext();
    if (!outlet || !context) return;
    if (this.currentOutlet === outlet && this.currentForm === form) return;
    outlet.clear();
    this.currentOutlet = outlet;
    this.currentForm = form;
    if (!form) return;
    const contextSignal = this.inspectorContext as unknown as () => ClearpipeInspectorFormContext<GraphNode>;
    outlet.createComponent(form.component as Type<ClearpipeInspectorFormContract<GraphNode>>, {
      environmentInjector: this.environmentInjector,
      injector: Injector.create({
        parent: this.injector,
        providers: [{provide: CLEARPIPE_INSPECTOR_FORM_CONTEXT, useValue: contextSignal}],
      }),
    });
  });

  private readonly focusHeading = effect(() => {
    const request = this.focusRequest();
    const heading = this.heading();
    if (!request || request === this.handledFocusRequest || !heading || !this.presentation()) return;
    this.handledFocusRequest = request;
    queueMicrotask(() => heading.nativeElement.focus());
  });

  protected selectTab(tab: InspectorTab): void {
    this.activeTab.set(tab.id);
    this.tabChanged.emit(tab.id);
  }

  protected moveTab(event: KeyboardEvent, index: number): void {
    const tabs = this.tabs();
    if (!tabs.length || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const nextIndex = event.key === 'Home' ? 0
      : event.key === 'End' ? tabs.length - 1
        : (index + (event.key === 'ArrowLeft' ? -1 : 1) + tabs.length) % tabs.length;
    this.selectTab(tabs[nextIndex]);
    queueMicrotask(() => {
      const buttons = (this.host.nativeElement as HTMLElement)
        .querySelectorAll('[data-clearpipe-inspector-tab]') as NodeListOf<HTMLButtonElement>;
      buttons[nextIndex]?.focus();
    });
  }

  protected slotContext(): ClearpipeInspectorSlotContext {
    const inspector = this.presentation()!;
    return {node: inspector.node, readOnly: !!inspector.readOnly, readOnlyReason: inspector.readOnlyReason};
  }

  protected baseReference(): string {
    const node = this.presentation()?.node;
    if (!node) return '';
    if (node.kind === 'function') return node.signature;
    return node.base_task.kind === 'task-id'
      ? node.base_task.task_id
      : `${node.base_task.project} / ${node.base_task.name}`;
  }

  protected tabId(tab: InspectorTab): string {
    return `clearpipe-inspector-tab-${this.presentation()?.node.id ?? 'empty'}-${tab.id}`;
  }

  protected panelId(tab: InspectorTab): string {
    return `${this.tabId(tab)}-panel`;
  }
}
