import {HTTP} from '~/app.constants';
import {SmApiRequestsService} from './api-requests.service';

import {Inject, Injectable, Optional} from '@angular/core';
import {HttpHeaders} from '@angular/common/http';
import {Observable} from 'rxjs';

import {BASE_PATH} from '../variables';
import {Configuration} from '../configuration';

@Injectable()
export class ApiAutoscalerService {

  protected basePath = HTTP.API_BASE_URL;
  public defaultHeaders = new HttpHeaders({'Accept': 'application/json'});
  public configuration = new Configuration();

  constructor(
    protected apiRequest: SmApiRequestsService,
    @Optional() @Inject(BASE_PATH) basePath: string,
    @Optional() configuration: Configuration,
  ) {
    if (basePath) {
      this.basePath = basePath;
    }
    if (configuration) {
      this.configuration = configuration;
      this.basePath = basePath || configuration.basePath || this.basePath;
    }
  }

  public autoscalerGetSettings(request: object): Observable<any> {
    return this.apiRequest.post<any>(`${this.basePath}/autoscaler.get_settings`, request);
  }

  public autoscalerSetSettings(request: object): Observable<any> {
    return this.apiRequest.post<any>(`${this.basePath}/autoscaler.set_settings`, request);
  }

  public autoscalerResetSettings(request: object): Observable<any> {
    return this.apiRequest.post<any>(`${this.basePath}/autoscaler.reset_settings`, request);
  }

  public autoscalerTestConnection(request: object): Observable<any> {
    return this.apiRequest.post<any>(`${this.basePath}/autoscaler.test_connection`, request);
  }

  public autoscalerSubmitWorkload(request: object): Observable<any> {
    return this.apiRequest.post<any>(`${this.basePath}/autoscaler.submit_workload`, request);
  }

  public autoscalerGetExecution(request: object): Observable<any> {
    return this.apiRequest.post<any>(`${this.basePath}/autoscaler.get_execution`, request);
  }

  public autoscalerGetDashboard(request: object): Observable<any> {
    return this.apiRequest.post<any>(`${this.basePath}/autoscaler.get_dashboard`, request);
  }

  public autoscalerSaveAppInstance(request: object): Observable<any> {
    return this.apiRequest.post<any>(`${this.basePath}/autoscaler.save_app_instance`, request);
  }

  public autoscalerDeleteWorkload(request: object): Observable<any> {
    return this.apiRequest.post<any>(`${this.basePath}/autoscaler.delete_workload`, request);
  }
}
