import {inject, Injectable} from '@angular/core';
import {HttpClient} from '@angular/common/http';
import {Observable} from 'rxjs';
import {map} from 'rxjs/operators';
import {HTTP} from '~/app.constants';

export interface NotificationSubscription {
  id?: string;
  // eslint-disable-next-line @typescript-eslint/naming-convention
  entity_type: string;
  entity: string;
  events?: string[];
  channel?: string;
}

/**
 * Client for the apiserver `notifications.*` endpoints. Lets a user subscribe to
 * email notifications for an entity (task/pipeline/dataset/report) so they are
 * emailed when it finishes.
 */
@Injectable({providedIn: 'root'})
export class NotificationsService {
  private http = inject(HttpClient);
  private basePath = HTTP.API_BASE_URL;

  subscribe(entityType: string, entity: string, events?: string[]): Observable<string> {
    const body: Record<string, unknown> = {entity_type: entityType, entity};
    if (events?.length) {
      body['events'] = events;
    }
    return this.http
      .post<{data: {id: string}}>(`${this.basePath}/notifications.subscribe`, body, {withCredentials: true})
      .pipe(map(res => res?.data?.id));
  }

  unsubscribe(entityType: string, entity: string): Observable<number> {
    return this.http
      .post<{data: {deleted: number}}>(
        `${this.basePath}/notifications.unsubscribe`,
        {entity_type: entityType, entity},
        {withCredentials: true}
      )
      .pipe(map(res => res?.data?.deleted));
  }

  getSubscriptions(entityType?: string, entity?: string): Observable<NotificationSubscription[]> {
    const body: Record<string, unknown> = {};
    if (entityType) {
      body['entity_type'] = entityType;
    }
    if (entity) {
      body['entity'] = entity;
    }
    return this.http
      .post<{data: {subscriptions: NotificationSubscription[]}}>(
        `${this.basePath}/notifications.get_subscriptions`,
        body,
        {withCredentials: true}
      )
      .pipe(map(res => res?.data?.subscriptions ?? []));
  }
}
