import {ComponentFixture, TestBed} from '@angular/core/testing';
import {ClearpipeNodeCardComponent} from './clearpipe-node-card.component';
import {clearpipeFixtureFailedFunctionCard, clearpipeFixtureRunningTaskCard} from './clearpipe-ui.fixtures';

describe('ClearpipeNodeCardComponent', () => {
  let fixture: ComponentFixture<ClearpipeNodeCardComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({imports: [ClearpipeNodeCardComponent]}).compileComponents();
    fixture = TestBed.createComponent(ClearpipeNodeCardComponent);
    fixture.componentRef.setInput('presentation', clearpipeFixtureRunningTaskCard);
    fixture.detectChanges();
  });

  it('renders compact identity, textual status, validation, and stable port descriptions', () => {
    const card = fixture.nativeElement.querySelector('article') as HTMLElement;
    const port = fixture.nativeElement.querySelector('[aria-label^="Input port dataset_url"]') as HTMLButtonElement;

    expect(card.getAttribute('aria-label')).toContain('Task node Train model');
    expect(card.textContent).toContain('Stable ID');
    expect(card.textContent).toContain('Running');
    expect(card.textContent).toContain('A required input is not connected.');
    expect(port.getAttribute('aria-label')).toContain('accepts artifact, parameter');
    expect(port.textContent).toContain('Unconnected');
    expect(port.textContent).toContain('An artifact or parameter source is required.');
  });

  it('emits selection, port, action, and validation interactions without owning mutations', () => {
    const selections: string[] = [];
    const ports: string[] = [];
    const actions: string[] = [];
    const validations: string[] = [];
    fixture.componentInstance.selected.subscribe((id) => selections.push(id));
    fixture.componentInstance.portActivated.subscribe((port) => ports.push(port.port.id));
    fixture.componentInstance.actionRequested.subscribe((action) => actions.push(action.id));
    fixture.componentInstance.validationFocused.subscribe((validation) => validations.push(validation.code!));

    (fixture.nativeElement.querySelector('.clearpipe-node-card__identity') as HTMLButtonElement).click();
    (fixture.nativeElement.querySelector('[aria-label^="Input port dataset_url"]') as HTMLButtonElement).click();
    (fixture.nativeElement.querySelector('.clearpipe-node-action button') as HTMLButtonElement).click();
    (fixture.nativeElement.querySelector('button.clearpipe-validation') as HTMLButtonElement).click();

    expect(selections).toEqual(['train-model']);
    expect(ports).toEqual(['dataset_input']);
    expect(actions).toEqual(['inspect']);
    expect(validations).toEqual(['CPSEM003']);
  });

  it('renders selected-port state directly from each current renderer input', () => {
    const selected = {
      ...clearpipeFixtureRunningTaskCard,
      ports: clearpipeFixtureRunningTaskCard.ports!.map((port, index) => ({...port, selected: index === 0})),
    };
    fixture.componentRef.setInput('presentation', selected);
    fixture.detectChanges();
    const input = fixture.nativeElement.querySelector('[aria-label^="Input port dataset_url"]') as HTMLButtonElement;

    expect(input.getAttribute('aria-pressed')).toBe('true');

    fixture.componentRef.setInput('presentation', {
      ...selected,
      ports: selected.ports.map((port) => ({...port, selected: false})),
    });
    fixture.detectChanges();
    expect(input.getAttribute('aria-pressed')).toBe('false');
  });

  it('makes unavailable and failed state understandable without relying on color', () => {
    fixture.componentRef.setInput('presentation', clearpipeFixtureFailedFunctionCard);
    fixture.detectChanges();

    const card = fixture.nativeElement.querySelector('article') as HTMLElement;
    expect(card.getAttribute('aria-disabled')).toBe('true');
    expect(card.textContent).toContain('Failed');
    expect(card.textContent).toContain('This definition is read-only.');
    expect(card.textContent).toContain('warning');
  });
});
