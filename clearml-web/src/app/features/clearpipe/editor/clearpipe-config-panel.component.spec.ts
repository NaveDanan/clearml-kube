import {ComponentFixture, TestBed} from '@angular/core/testing';
import {ClearpipeConfigPanelComponent} from './clearpipe-config-panel.component';
import {clearpipeFixtureInspector} from './framework/clearpipe-ui.fixtures';

describe('ClearpipeConfigPanelComponent', () => {
  let fixture: ComponentFixture<ClearpipeConfigPanelComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({imports: [ClearpipeConfigPanelComponent]}).compileComponents();
    fixture = TestBed.createComponent(ClearpipeConfigPanelComponent);
    fixture.componentRef.setInput('presentation', clearpipeFixtureInspector);
    fixture.detectChanges();
  });

  it('renders a labelled inspector header with stable identity, source link, and read-only reason', () => {
    const inspector = fixture.nativeElement.querySelector('.clearpipe-inspector') as HTMLElement;
    const source = fixture.nativeElement.querySelector('.clearpipe-inspector__identity a') as HTMLAnchorElement;

    expect(inspector.getAttribute('aria-label')).toBe('Inspector for Train model');
    expect(fixture.nativeElement.querySelector('h2').textContent).toContain('Train model');
    expect(fixture.nativeElement.textContent).toContain('Stable ID');
    expect(fixture.nativeElement.textContent).toContain('train-model');
    expect(source.textContent).toContain('Open base task');
    expect(fixture.nativeElement.querySelector('[role="status"]').textContent).toContain('This definition is read-only.');
    expect(fixture.nativeElement.querySelector('.clearpipe-inspector__body')).not.toBeNull();
  });

  it('emits close and collapse intents and exposes keyboard-operable Configuration and General tabs', () => {
    const closed = jasmine.createSpy('closed');
    const collapsed = jasmine.createSpy('collapsed');
    const changed = jasmine.createSpy('changed');
    fixture.componentInstance.closeRequested.subscribe(closed);
    fixture.componentInstance.collapseRequested.subscribe(collapsed);
    fixture.componentInstance.tabChanged.subscribe(changed);
    const tabs = (fixture.nativeElement as HTMLElement)
      .querySelectorAll('[role="tab"]') as NodeListOf<HTMLButtonElement>;

    expect(Array.from(tabs).map((tab) => tab.textContent?.trim())).toEqual(['Configuration', 'General']);
    (fixture.nativeElement.querySelector('[aria-label="Collapse inspector"]') as HTMLButtonElement).click();
    (fixture.nativeElement.querySelector('[aria-label="Close inspector"]') as HTMLButtonElement).click();
    tabs[0].dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowRight'}));
    fixture.detectChanges();

    expect(collapsed).toHaveBeenCalled();
    expect(closed).toHaveBeenCalled();
    expect(changed).toHaveBeenCalledWith('general');
    expect(tabs[1].getAttribute('aria-selected')).toBe('true');
    expect(fixture.nativeElement.querySelector('.clearpipe-inspector__general').textContent).toContain('Train_Model');
  });

  it('moves focus to the inspector heading only for an explicit focus request', async () => {
    fixture.componentRef.setInput('focusRequest', 1);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(document.activeElement).toBe(fixture.nativeElement.querySelector('h2'));
  });
});
