import { ChangeDetectionStrategy, Component, computed, inject, OnDestroy, signal } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { Router } from '@angular/router';
import { ViewWillEnter, ViewWillLeave } from '@ionic/angular';
import { IonContent, IonHeader, IonToolbar } from '@ionic/angular';

import { IconComponent } from '../../components/icon/icon.component';
import { SETTING_LAST_SCAN_ACCESS } from '../../core/constants/app.constants';
import { toUserMessage } from '../../core/errors/app-error';
import { NextcloudSettings } from '../../core/models/nextcloud.model';
import { PhotoAccess, PhotoCounts } from '../../core/models/photo.model';
import { UploadJob } from '../../core/models/upload-job.model';
import { CapacitorMediaLibrary } from '../../core/plugins/capacitor-media-library';
import { primeWebPhotoAccess } from '../../core/plugins/web-photo-library';
import { PhotoRepository } from '../../core/repositories/photo.repository';
import { NetworkMonitor } from '../../core/services/network-monitor';
import { PhotoScannerService } from '../../core/services/photo-scanner.service';
import { UploadQueueService } from '../../core/services/upload-queue.service';
import { formatBytes } from '../../core/utils/bytes';

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

const QUEUE_REFRESH_MS = 5000;

interface QueueSummary {
  uploading: number;
  waiting: number;
  failed: number;
  paused: boolean;
}

@Component({
  selector: 'app-home',
  templateUrl: './home.page.html',
  styleUrl: './home.page.scss',
  imports: [IonHeader, IonToolbar, IonContent, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HomePage implements ViewWillEnter, ViewWillLeave, OnDestroy {
  readonly web = Capacitor.getPlatform() === 'web';
  readonly counts = signal<PhotoCounts>(EMPTY_COUNTS);
  readonly error = signal('');
  readonly access = signal<PhotoAccess | null>(null);
  readonly nextcloud = signal<NextcloudSettings | null>(null);
  readonly queue = signal<QueueSummary>({ uploading: 0, waiting: 0, failed: 0, paused: false });
  readonly online = inject(NetworkMonitor).online;

  readonly reviewPercent = computed(() => percent(this.counts().reviewed, this.counts().total));
  readonly backupPercent = computed(() => percent(this.counts().backedUp, this.counts().kept));
  readonly serverLabel = computed(() => {
    const settings = this.nextcloud();
    if (!settings) {
      return '';
    }
    return `${hostOf(settings.serverUrl)} · /${settings.baseRemotePath}`;
  });
  readonly queueLabel = computed(() => {
    const { uploading, waiting, failed, paused } = this.queue();
    const parts: string[] = [];
    if (paused) {
      parts.push('Paused');
    } else if (uploading) {
      parts.push(`Uploading ${this.format(uploading)}`);
    }
    if (waiting) {
      parts.push(`${this.format(waiting)} waiting`);
    }
    if (failed) {
      parts.push(`${this.format(failed)} failed`);
    }
    return parts.length ? parts.join(' · ') : 'Nothing waiting';
  });
  readonly queueTone = computed(() => {
    const { uploading, waiting, failed, paused } = this.queue();
    if (failed) {
      return 'delete';
    }
    return paused || (!uploading && !waiting) ? 'idle' : 'keep';
  });

  private timer = 0;
  private readonly photos = inject(PhotoRepository);
  private readonly scanner = inject(PhotoScannerService);
  readonly scanning = computed(() => this.scanner.status().state === 'scanning');
  readonly scanFound = computed(() => this.scanner.status().found);
  private readonly uploads = inject(UploadQueueService);
  private readonly media = inject(CapacitorMediaLibrary);
  private readonly router = inject(Router);

  ionViewWillEnter(): void {
    void this.refresh();
    this.stopRefresh();
    this.timer = window.setInterval(() => void this.refreshProgress(), QUEUE_REFRESH_MS);
  }

  ionViewWillLeave(): void {
    this.stopRefresh();
  }

  ngOnDestroy(): void {
    this.stopRefresh();
  }

  async scan(): Promise<void> {
    primeWebPhotoAccess();
    this.error.set('');
    try {
      const summary = await this.scanner.scan();
      this.access.set(summary.access);
      await this.refresh();
    } catch (error) {
      this.error.set(toUserMessage(error, 'The photo library could not be read. Try again.'));
    }
  }

  async openSettings(): Promise<void> {
    if (this.web) {
      await this.router.navigateByUrl('/settings');
      return;
    }
    await this.media.openAppSettings();
  }

  emptyMessage(): string {
    return this.web
      ? 'Choose a folder of photos to start reviewing. Swiping never deletes a photo.'
      : 'Scan this device to start reviewing. Swiping never deletes a photo.';
  }

  scanLabel(): string {
    if (this.scanning()) {
      return 'Scanning…';
    }
    return this.web && this.access() !== 'granted' ? 'Choose photo folder' : 'Scan photos';
  }

  rescanLabel(): string {
    if (this.scanning()) {
      return 'Scanning…';
    }
    return this.web && this.access() !== 'granted' ? 'Choose photo folder' : 'Scan for new photos';
  }

  open(path: string): void {
    void this.router.navigateByUrl(path);
  }

  format(value: number): string {
    return new Intl.NumberFormat().format(value);
  }

  formatStorage(bytes: number): string {
    return formatBytes(bytes);
  }

  private async refresh(): Promise<void> {
    const [stored, settings] = await Promise.all([
      this.photos.getSetting(SETTING_LAST_SCAN_ACCESS),
      this.photos.getNextcloudSettings(),
      this.refreshProgress(),
    ]);
    this.access.set(stored === 'granted' || stored === 'limited' || stored === 'denied' ? stored : null);
    this.nextcloud.set(settings?.enabled && settings.serverUrl && settings.username ? settings : null);
  }

  private async refreshProgress(): Promise<void> {
    const [counts, jobs, paused] = await Promise.all([
      this.photos.counts(),
      this.photos.listJobs(),
      this.uploads.isPaused(),
    ]);
    this.counts.set(counts);
    this.queue.set(summarizeJobs(jobs, paused));
  }

  private stopRefresh(): void {
    window.clearInterval(this.timer);
    this.timer = 0;
  }
}

function percent(value: number, total: number): number {
  if (total <= 0) {
    return 0;
  }
  // Floor so the bar only reaches 100% when everything is done.
  return Math.max(0, Math.min(100, Math.floor((value / total) * 100)));
}

function hostOf(serverUrl: string): string {
  try {
    return new URL(serverUrl).host;
  } catch {
    return serverUrl;
  }
}

function summarizeJobs(jobs: readonly UploadJob[], paused: boolean): QueueSummary {
  const summary: QueueSummary = { uploading: 0, waiting: 0, failed: 0, paused };
  for (const job of jobs) {
    if (job.status === 'uploading') {
      summary.uploading += 1;
    } else if (job.status === 'pending') {
      summary.waiting += 1;
    } else if (job.status === 'failed') {
      summary.failed += 1;
    }
  }
  return summary;
}
