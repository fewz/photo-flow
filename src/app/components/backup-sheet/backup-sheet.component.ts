import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  input,
  output,
  viewChild,
} from '@angular/core';

import { BackupPlan } from '../../core/services/upload-queue.service';
import { IconComponent } from '../icon/icon.component';

/** States what a manual backup will do and asks before anything is queued. */
@Component({
  selector: 'app-backup-sheet',
  template: `
    <div class="pf-sheet-backdrop" aria-hidden="true" (click)="cancelled.emit()"></div>
    <section
      class="pf-sheet"
      role="dialog"
      aria-modal="true"
      aria-labelledby="backup-sheet-title"
      (keydown.escape)="cancelled.emit()"
    >
      <div class="pf-sheet__handle" aria-hidden="true"></div>
      <h2 id="backup-sheet-title" class="pf-sheet__title">{{ title() }}</h2>
      <ul class="pf-sheet__facts">
        @if (!configured()) {
          <li>
            <span class="pf-icon-tile pf-icon-tile--fact pf-icon-tile--delete"><app-icon name="alert" [size]="17" /></span>
            <span>Nextcloud is not set up yet. Add your server and app password first.</span>
          </li>
        }
        @if (plan().toUpload.length) {
          <li>
            <span class="pf-icon-tile pf-icon-tile--fact pf-icon-tile--keep"><app-icon name="cloud-upload" [size]="17" /></span>
            <span><strong>{{ format(plan().toUpload.length) }}</strong> {{ noun(plan().toUpload.length) }} upload to Nextcloud.</span>
          </li>
        }
        @if (plan().markKeep) {
          <li>
            <span class="pf-icon-tile pf-icon-tile--fact pf-icon-tile--keep"><app-icon name="check" [size]="17" [stroke]="2.4" /></span>
            <span><strong>{{ format(plan().markKeep) }}</strong> not reviewed yet will be marked Keep.</span>
          </li>
        }
        @if (plan().alreadyBackedUp) {
          <li>
            <span class="pf-icon-tile pf-icon-tile--fact pf-icon-tile--success"><app-icon name="cloud" [size]="17" /></span>
            <span><strong>{{ format(plan().alreadyBackedUp) }}</strong> already backed up, skipped.</span>
          </li>
        }
        @if (plan().markedForDeletion) {
          <li>
            <span class="pf-icon-tile pf-icon-tile--fact"><app-icon name="trash" [size]="17" /></span>
            <span>
              <strong>{{ format(plan().markedForDeletion) }}</strong> marked for deletion, skipped. Backup before delete
              handles them.
            </span>
          </li>
        }
        @if (offline() && configured() && plan().toUpload.length) {
          <li>
            <span class="pf-icon-tile pf-icon-tile--fact"><app-icon name="wifi-off" [size]="17" /></span>
            <span>You are offline. They upload when the connection is back.</span>
          </li>
        }
      </ul>
      <div class="pf-sheet__actions">
        @if (!configured()) {
          <button type="button" class="pf-button pf-button--primary pf-button--large" (click)="openSettings.emit()">
            Set up Nextcloud
          </button>
        } @else if (plan().toUpload.length) {
          <button type="button" class="pf-button pf-button--primary pf-button--large" [disabled]="busy()" (click)="confirmed.emit()">
            {{ busy() ? 'Adding to queue…' : 'Back up ' + format(plan().toUpload.length) + ' ' + noun(plan().toUpload.length) }}
          </button>
        }
        <button #cancelButton type="button" class="pf-button pf-button--secondary" (click)="cancelled.emit()">
          {{ configured() && !plan().toUpload.length ? 'Close' : 'Cancel' }}
        </button>
      </div>
    </section>
  `,
  host: { class: 'pf-sheet-host' },
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BackupSheetComponent {
  readonly plan = input.required<BackupPlan>();
  readonly configured = input(true);
  readonly offline = input(false);
  readonly busy = input(false);
  readonly confirmed = output<void>();
  readonly cancelled = output<void>();
  readonly openSettings = output<void>();

  readonly title = computed(() => {
    const count = this.plan().toUpload.length;
    if (!this.configured()) {
      return 'Set up backup first';
    }
    return count ? `Back up ${this.format(count)} ${this.noun(count)}?` : 'Nothing new to back up';
  });

  private readonly cancelButton = viewChild.required<ElementRef<HTMLButtonElement>>('cancelButton');

  constructor() {
    afterNextRender(() => this.cancelButton().nativeElement.focus());
  }

  format(value: number): string {
    return new Intl.NumberFormat().format(value);
  }

  noun(count: number): string {
    return count === 1 ? 'photo' : 'photos';
  }
}
