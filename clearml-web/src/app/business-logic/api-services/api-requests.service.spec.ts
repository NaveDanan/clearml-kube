import {TestBed} from '@angular/core/testing';
import {HttpHeaders, HttpParams} from '@angular/common/http';
import {HttpTestingController, provideHttpClientTesting} from '@angular/common/http/testing';
import {provideHttpClient} from '@angular/common/http';
import {firstValueFrom} from 'rxjs';

import {SmApiRequestsService} from './api-requests.service';

describe('SmApiRequestsService', () => {
  let service: SmApiRequestsService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        SmApiRequestsService,
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });

    service = TestBed.inject(SmApiRequestsService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('posts with credentials when options are omitted', async () => {
    const result = firstValueFrom(service.post('/api/test', {value: 1}));

    const req = httpMock.expectOne('/api/test');
    expect(req.request.withCredentials).toBeTrue();
    expect(req.request.body).toEqual({value: 1});
    req.flush({data: {ok: true}, meta: {}});

    await expectAsync(result).toBeResolvedTo({ok: true});
  });

  it('preserves provided post options and forces credentials', async () => {
    const headers = new HttpHeaders({'X-Test': '1'});
    const params = new HttpParams().set('query', 'abc');
    const result = firstValueFrom(service.post('/api/test', null, {
      headers,
      params,
      withCredentials: false,
    }));

    const req = httpMock.expectOne(request => request.url === '/api/test' && request.params.get('query') === 'abc');
    expect(req.request.headers.get('X-Test')).toBe('1');
    expect(req.request.withCredentials).toBeTrue();
    req.flush({data: {ok: true}, meta: {}});

    await expectAsync(result).toBeResolvedTo({ok: true});
  });

  it('posti returns the full response when options are omitted', async () => {
    const result = firstValueFrom(service.posti('/api/test', {value: 2}));

    const req = httpMock.expectOne('/api/test');
    expect(req.request.withCredentials).toBeTrue();
    req.flush({data: {ok: true}, meta: {id: 'meta-id'}});

    await expectAsync(result).toBeResolvedTo({data: {ok: true}, meta: {id: 'meta-id'}});
  });

  it('does not throw synchronously for autoscaler-style calls', () => {
    expect(() => {
      service.post('/api/autoscaler.test_connection', {connection_method: 'runai_application'}).subscribe();
      httpMock.expectOne('/api/autoscaler.test_connection').flush({data: {connected: false}, meta: {}});
    }).not.toThrow();
  });
});
