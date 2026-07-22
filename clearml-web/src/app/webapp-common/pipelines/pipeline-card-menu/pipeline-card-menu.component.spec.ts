import { ComponentFixture, TestBed } from '@angular/core/testing';

import { PipelineCardMenuComponent } from './pipeline-card-menu.component';
import {MatMenuModule} from '@angular/material/menu';
import {StoreModule} from '@ngrx/store';

describe('PipelineCardMenuComponent', () => {
  let component: PipelineCardMenuComponent;
  let fixture: ComponentFixture<PipelineCardMenuComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        PipelineCardMenuComponent,
        MatMenuModule,
        StoreModule.forRoot({})
      ]
    })
    .compileComponents();
  });

  beforeEach(() => {
    fixture = TestBed.createComponent(PipelineCardMenuComponent);
    component = fixture.componentInstance;
    fixture.detectChanges(false);
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
