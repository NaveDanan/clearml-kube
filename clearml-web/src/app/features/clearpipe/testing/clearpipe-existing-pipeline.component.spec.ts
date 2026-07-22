import {ComponentFixture, TestBed} from '@angular/core/testing';
import {convertToParamMap, ActivatedRoute, ParamMap} from '@angular/router';
import {Subject} from 'rxjs';
import {ClearpipeAdapterService} from '../platform/clearpipe-adapter.service';
import {ClearpipeLifecycleService} from '../editor/clearpipe-lifecycle.service';
import {ExistingPipelineLoadResult} from '../existing-pipeline/clearpipe-existing-pipeline.models';
import {ClearpipeExistingPipelineLoaderService} from '../existing-pipeline/clearpipe-existing-pipeline-loader.service';
import {ClearpipeExistingPipelineComponent} from '../existing-pipeline/clearpipe-existing-pipeline.component';

interface ExistingPipelineComponentHarness {
  result: () => ExistingPipelineLoadResult;
  returnToPipeline(): void;
}

describe('ClearpipeExistingPipelineComponent', () => {
  let fixture: ComponentFixture<ClearpipeExistingPipelineComponent>;
  let paramMaps: Subject<ParamMap>;
  let loader: jasmine.SpyObj<ClearpipeExistingPipelineLoaderService>;
  let adapter: jasmine.SpyObj<ClearpipeAdapterService>;

  beforeEach(() => {
    paramMaps = new Subject<ParamMap>();
    loader = jasmine.createSpyObj<ClearpipeExistingPipelineLoaderService>('ClearpipeExistingPipelineLoaderService', ['load']);
    adapter = jasmine.createSpyObj<ClearpipeAdapterService>('ClearpipeAdapterService', ['navigate']);
    adapter.navigate.and.resolveTo(true);

    TestBed.configureTestingModule({
      imports: [ClearpipeExistingPipelineComponent],
      providers: [
        {provide: ActivatedRoute, useValue: {paramMap: paramMaps.asObservable()}},
        {provide: ClearpipeExistingPipelineLoaderService, useValue: loader},
        {provide: ClearpipeAdapterService, useValue: adapter},
        {provide: ClearpipeLifecycleService, useValue: {}},
      ],
    });
    TestBed.overrideComponent(ClearpipeExistingPipelineComponent, {set: {template: '', imports: []}});
    fixture = TestBed.createComponent(ClearpipeExistingPipelineComponent);
    fixture.detectChanges();
  });

  afterEach(() => fixture.destroy());

  it('cancels an older route load so an A response cannot overwrite B or its return target', () => {
    const firstLoad = new Subject<ExistingPipelineLoadResult>();
    const secondLoad = new Subject<ExistingPipelineLoadResult>();
    loader.load.and.callFake(taskId => taskId === 'pipeline-a' ? firstLoad : secondLoad);
    const component = fixture.componentInstance as unknown as ExistingPipelineComponentHarness;

    paramMaps.next(convertToParamMap({taskId: 'pipeline-a'}));
    firstLoad.next({
      status: 'unsupported',
      blockers: [],
      problem: {message: 'A is unsupported', retryable: false},
    });
    expect(component.result().status).toBe('unsupported');

    paramMaps.next(convertToParamMap({taskId: 'pipeline-b'}));
    expect(component.result().status).toBe('loading');

    firstLoad.next({
      status: 'denied',
      problem: {message: 'late A response', retryable: false},
    });
    expect(component.result().status).toBe('loading');

    secondLoad.next({
      status: 'denied',
      problem: {message: 'B is unavailable', retryable: false},
    });
    expect(component.result()).toEqual({
      status: 'denied',
      problem: {message: 'B is unavailable', retryable: false},
    });

    component.returnToPipeline();
    expect(adapter.navigate).toHaveBeenCalledWith({kind: 'pipeline-details', runTaskId: 'pipeline-b'});
  });
});
