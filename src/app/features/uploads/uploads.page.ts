import { ChangeDetectionStrategy, Component, computed, inject, OnDestroy, signal } from '@angular/core';
import { Router } from '@angular/router';
import { ViewWillEnter, ViewWillLeave } from '@ionic/angular';
import { IonContent, IonHeader, IonToolbar } from '@ionic/angular';

import { IconComponent } from '../../components/icon/icon.component';
import { PhotoThumbComponent } from '../../components/photo-thumb/photo-thumb.component';
import { toUserMessage } from '../../core/errors/app-error';
import { NextcloudSettings } from '../../core/models/nextcloud.model';
import { Photo, PhotoCounts } from '../../core/models/photo.model';
import { UploadJob } from '../../core/models/upload-job.model';
import { PhotoRepository } from '../../core/repositories/photo.repository';
import { NetworkMonitor } from '../../core/services/network-monitor';
import { UploadQueueService } from '../../core/services/upload-queue.service';
import { formatBytes } from '../../core/utils/bytes';

const REFRESH_MS = 2000;
/** Waiting rows shown before "+ N more"; the queue itself is never trimmed. */
const WAITING_SHOWN = 20;

export interface UploadRow {
  job: UploadJob;
  name: string;
  uri: string;
  meta: string;
  percent: number;
}

const EMPTY_COUNTS: PhotoCounts = {
  total: 0,
  reviewed: 0,
  pending: 0,
  markedForDeletion: 0,
  kept: 0,
  backedUp: 0,
  recoverableBytes: 0,
  duplicatePhotos: 0,
};

@Component({
  selector: 'app-uploads',
  templateUrl: './uploads.page.html',
  styleUrl: './uploads.page.scss',
  imports: [IonHeader, IonToolbar, IonContent, IconComponent, PhotoThumbComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UploadsPage implements ViewWillEnter, ViewWillLeave, OnDestroy {
  readonly online = inject(NetworkMonitor).online;
  readonly loaded = signal(false);
  readonly paused = signal(false);
  readonly concurrency = signal(1);
  readonly counts = signal<PhotoCounts>(EMPTY_COUNTS);
  readonly settings = signal<NextcloudSettings | null>(null);
  readonly uploading = signal<UploadRow[]>([]);
  readonly failed = signal<UploadRow[]>([]);
  readonly waiting = signal<UploadRow[]>([]);
  readonly waitingTotal = signal(0);
  readonly uploadedJobs = signal(0);
  readonly busy = signal(false);
  readonly message = signal('');

  readonly left = computed(() => Math.max(0, this.counts().kept - this.counts().backedUp));
  readonly percent = computed(() => {
    const { kept, backedUp } = this.counts();
    return kept > 0 ? Math.floor((backedUp / kept) * 100) : 0;
  });
  readonly stateLabel = computed(() => {
    if (!this.online()) {
      return 'Waiting for network';
    }
    if (this.paused()) {
      return 'Paused';
    }
    if (this.uploading().length || this.waitingTotal()) {
      return this.concurrency() === 1 ? 'Uploading one at a time' : `Uploading ${this.concurrency()} at a time`;
    }
    return this.failed().length ? 'Some uploads need attention' : 'All caught up';
  });
  readonly target = computed(() => {
    const settings = this.settings();
    if (!settings) {
      return '';
    }
    let host = settings.serverUrl;
    try {
      host = new URL(settings.serverUrl).host;
    } catch {
      // Keep the stored text.
    }
    return `${host} · /${settings.baseRemotePath}`;
  });

  private timer = 0;
  private readonly photoCache = new Map<string, Photo>();
  private readonly repository = inject(PhotoRepository);
  private readonly queue = inject(UploadQueueService);
  private readonly router = inject(Router);

  ionViewWillEnter(): void {
    void this.refresh();
    void this.queue.process();
    this.stopRefresh();
    this.timer = window.setInterval(() => void this.refresh(), REFRESH_MS);
  }

  ionViewWillLeave(): void {
    this.stopRefresh();
  }

  ngOnDestroy(): void {
    this.stopRefresh();
  }

  async togglePause(): Promise<void> {
    await this.run(() => (this.paused() ? this.queue.resume() : this.queue.pause()));
  }

  async retryFailed(): Promise<void> {
    await this.run(() => this.queue.retryFailed());
  }

  async retry(row: UploadRow): Promise<void> {
    await this.run(() => this.queue.retry(row.job.id));
  }

  async cancel(row: UploadRow): Promise<void> {
    await this.run(async () => {
      if (!(await this.queue.cancelUpload(row.job.id))) {
        this.message.set('That upload already started and can no longer be cancelled.');
      }
    });
  }

  async clearCompleted(): Promise<void> {
    await this.run(() => this.queue.clearCompleted());
  }

  open(path: string): void {
    void this.router.navigateByUrl(path);
  }

  format(value: number): string {
    return new Intl.NumberFormat().format(value);
  }

  private async run(action: () => Promise<unknown>): Promise<void> {
    if (this.busy()) {
      return;
    }
    this.busy.set(true);
    this.message.set('');
    try {
      await action();
    } catch (error) {
      this.message.set(toUserMessage(error, 'That did not work. Try again.'));
    } finally {
      this.busy.set(false);
      await this.refresh();
    }
  }

  private async refresh(): Promise<void> {
    const [jobs, counts, paused, concurrency, settings] = await Promise.all([
      this.repository.listJobs(),
      this.repository.counts(),
      this.queue.isPaused(),
      this.queue.concurrency(),
      this.repository.getNextcloudSettings(),
    ]);
    const pending = jobs.filter((job) => job.status === 'pending').sort((a, b) => a.createdAt - b.createdAt);
    this.uploading.set(await this.rows(jobs.filter((job) => job.status === 'uploading')));
    this.failed.set(await this.rows(jobs.filter((job) => job.status === 'failed')));
    this.waiting.set(await this.rows(pending.slice(0, WAITING_SHOWN)));
    this.waitingTotal.set(pending.length);
    this.uploadedJobs.set(jobs.filter((job) => job.status === 'uploaded').length);
    this.counts.set(counts);
    this.paused.set(paused);
    this.concurrency.set(concurrency);
    this.settings.set(settings?.enabled && settings.serverUrl && settings.username ? settings : null);
    this.loaded.set(true);
  }

  private async rows(jobs: readonly UploadJob[]): Promise<UploadRow[]> {
    const rows: UploadRow[] = [];
    for (const job of jobs) {
      const photo = await this.photoFor(job.photoId);
      const folder = job.remotePath.split('/').slice(0, -1).join('/');
      rows.push({
        job,
        name: photo?.fileName ?? job.remotePath.split('/').pop() ?? 'Photo',
        uri: photo?.uri ?? job.localUri,
        meta: photo ? `${formatBytes(photo.sizeBytes)} · ${folder}` : folder,
        percent: Math.round(Math.max(0, Math.min(1, job.progress)) * 100),
      });
    }
    return rows;
  }

  /** File name and size do not change while a job runs, so one read per photo is enough. */
  private async photoFor(id: string): Promise<Photo | null> {
    const cached = this.photoCache.get(id);
    if (cached) {
      return cached;
    }
    const photo = await this.repository.getById(id);
    if (photo) {
      this.photoCache.set(id, photo);
      if (this.photoCache.size > 200) {
        const oldest = this.photoCache.keys().next().value;
        if (oldest) {
          this.photoCache.delete(oldest);
        }
      }
    }
    return photo;
  }

  private stopRefresh(): void {
    window.clearInterval(this.timer);
    this.timer = 0;
  }
}
