import {ComponentFixture, TestBed} from '@angular/core/testing';
import {ClearpipeCatalogComponent} from './clearpipe-catalog.component';
import {clearpipeFixtureCatalogEntries} from './clearpipe-ui.fixtures';

describe('ClearpipeCatalogComponent', () => {
  let fixture: ComponentFixture<ClearpipeCatalogComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({imports: [ClearpipeCatalogComponent]}).compileComponents();
    fixture = TestBed.createComponent(ClearpipeCatalogComponent);
    fixture.componentRef.setInput('entries', clearpipeFixtureCatalogEntries);
    fixture.detectChanges();
  });

  it('searches categorized capabilities and reports an accessible empty result', () => {
    const search = fixture.nativeElement.querySelector('#clearpipe-catalog-search') as HTMLInputElement;
    search.value = 'function';
    search.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Function step');
    expect(fixture.nativeElement.textContent).not.toContain('Task step');
    expect(fixture.nativeElement.querySelector('.clearpipe-catalog__result-count').textContent).toContain('1 catalog result');

    search.value = 'nothing';
    search.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.clearpipe-catalog__state h3').textContent).toContain('No matching capabilities');
  });

  it('supports click, keyboard, and drag add hooks without changing graph state', () => {
    const added: string[] = [];
    const dragged: string[] = [];
    fixture.componentInstance.addRequested.subscribe((request) => added.push(`${request.entry.id}:${request.method}`));
    fixture.componentInstance.dragStarted.subscribe((request) => dragged.push(request.entry.id));
    const entry = Array.from((fixture.nativeElement as HTMLElement)
      .querySelectorAll('.clearpipe-catalog__entry-button') as NodeListOf<HTMLButtonElement>)
      .find((button) => button.textContent?.includes('Task step'))!;

    entry.click();
    entry.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter'}));
    const transfer = {setData: jasmine.createSpy('setData'), effectAllowed: ''};
    const dragEvent = new Event('dragstart') as DragEvent;
    Object.defineProperty(dragEvent, 'dataTransfer', {value: transfer});
    entry.dispatchEvent(dragEvent);

    expect(added).toEqual(['task:click', 'task:keyboard']);
    expect(dragged).toEqual(['task']);
    expect(transfer.setData).toHaveBeenCalledWith('application/x-clearpipe-catalog-entry', 'task');
  });

  it('names loading, error, disabled, and per-entry unavailable states', () => {
    fixture.componentRef.setInput('presentation', {state: 'loading'});
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[aria-busy="true"]').textContent).toContain('Loading authoring capabilities');

    fixture.componentRef.setInput('presentation', {state: 'error', message: 'Connection failed.'});
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role="alert"]').textContent).toContain('Connection failed.');

    fixture.componentRef.setInput('presentation', {state: 'ready'});
    fixture.componentRef.setInput('readOnly', true);
    fixture.detectChanges();
    const enabledEntry = Array.from((fixture.nativeElement as HTMLElement)
      .querySelectorAll('.clearpipe-catalog__entry-button') as NodeListOf<HTMLButtonElement>)
      .find((button) => button.textContent?.includes('Task step'))!;
    expect(enabledEntry.disabled).toBeTrue();
    expect(fixture.nativeElement.textContent).toContain('This definition is read-only.');
  });
});
