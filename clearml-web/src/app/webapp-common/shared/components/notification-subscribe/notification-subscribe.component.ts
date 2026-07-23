import {ChangeDetectionStrategy, Component, computed, effect, inject, input, signal} from '@angular/core';
import {MatButton} from '@angular/material/button';
import {MatTooltip} from '@angular/material/tooltip';
import {EMPTY, Observable} from 'rxjs';
import {catchError, finalize, take} from 'rxjs/operators';
import {ConfigurationService} from '@common/shared/services/configuration.service';
import {NotificationsService} from '@common/shared/services/notifications.service';

/**
 * Toggle button that subscribes the current user to email notifications for an
 * entity (task/pipeline/dataset/report). Renders nothing unless the server
 * advertises email support (environment.emailNotificationsEnabled) and an
 * entityId is provided.
 *
 * Usage: <sm-notification-subscribe entityType="task" [entityId]="taskId" />
 */
@Component({
  selector: 'sm-notification-subscribe',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButton, MatTooltip],
  template: `
    @if (enabled()) {
      <button
        mat-stroked-button
        type="button"
        class="notification-subscribe"
        [disabled]="busy()"
        (click)="toggle()"
        [matTooltip]="subscribed()
          ? 'You will be emailed when this ' + entityType() + ' finishes'
          : 'Get an email when this ' + entityType() + ' finishes'"
      >
        {{ subscribed() ? 'Email notifications on' : 'Notify me by email' }}
      </button>
    }
  `
})
export class NotificationSubscribeComponent {
  private config = inject(ConfigurationService);
  private notifications = inject(NotificationsService);

  entityType = input<string>('task');
  entityId = input<string>();

  protected enabled = computed(
    () => !!this.config.configuration()?.emailNotificationsEnabled && !!this.entityId()
  );
  protected subscribed = signal(false);
  protected busy = signal(false);

  constructor() {
    effect(() => {
      const id = this.entityId();
      if (this.enabled() && id) {
        this.notifications
          .getSubscriptions(this.entityType(), id)
          .pipe(take(1), catchError(() => EMPTY))
          .subscribe(subs => this.subscribed.set(subs.length > 0));
      }
    });
  }

  toggle() {
    const id = this.entityId();
    if (!id || this.busy()) {
      return;
    }
    this.busy.set(true);
    const wasSubscribed = this.subscribed();
    const op: Observable<unknown> = wasSubscribed
      ? this.notifications.unsubscribe(this.entityType(), id)
      : this.notifications.subscribe(this.entityType(), id);
    op.pipe(
      take(1),
      catchError(() => EMPTY),
      finalize(() => this.busy.set(false))
    ).subscribe(() => this.subscribed.set(!wasSubscribed));
  }
}
