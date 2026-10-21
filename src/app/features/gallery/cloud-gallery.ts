import { computed, signal } from '@angular/core';

import { CLOUD_PAGE_SIZE } from '../../core/constants/app.constants';
import { toUserMessage } from '../../core/errors/app-error';
import { CloudCounts, CloudFilter, CloudPhoto, CloudSection } from '../../core/models/cloud-photo.model';
import { CloudLibraryService, RecordedBackups } from '../../core/services/cloud-library.service';
import { NetworkStatus } from '../../core/services/network-monitor';

export interface CloudChip {
  id: CloudFilter;
  label: string;
  count: number;
}

export interface CloudMonth {
  key: string;
  label: string;
  count: number;
  photos: CloudPhoto[];
}

const EMPTY_COUNTS: CloudCounts = { total: 0, cloudOnly: 0, onPhone: 0 };

/**
 * State of the Gallery's Nextcloud source. Reads the cached listing from SQLite page by page
 * and refreshes it from the server when it is old, like the device gallery reads `photos`.
 */
export class CloudGallery {
  /** `null` until checked. */
  readonly configured = signal<boolean | null>(null);
  readonly folderName = signal('');
  readonly filter = signal<CloudFilter>('all');
  readonly counts = signal<CloudCounts>(EMPTY_COUNTS);
  readonly photos = signal<CloudPhoto[]>([]);
  readonly loaded = signal(false);
  readonly done = signal(false);
  readonly syncing = signal(false);
  readonly syncError = signal<string | null>(null);
  readonly lastSynced = signal<number | null>(null);
  readonly viewing = signal<CloudPhoto | null>(null);
  /** How many phone photos the last check found in Nextcloud and marked Kept and backed up. */
  readonly recorded = signal<RecordedBackups | null>(null);

  readonly chips = computed<CloudChip[]>(() => {
    const counts = this.counts();
    return [
      { id: 'all', label: 'All', count: counts.total },
      { id: 'cloud_only', label: 'Only in Nextcloud', count: counts.cloudOnly },
      { id: 'on_phone', label: 'Also on phone', count: counts.onPhone },
    ];
  });

  readonly months = computed<CloudMonth[]>(() => {
    const sizes = new Map(this.sectionList().map((section) => [section.folder, section]));
    const months: CloudMonth[] = [];
    for (const photo of this.photos()) {
      let month = months[months.length - 1];
      if (!month || month.key !== photo.folder) {
        month = {
          key: photo.folder,
          label: monthLabel(photo.year, photo.month),
          count: sizes.get(photo.folder)?.count ?? 0,
          photos: [],
        };
        months.push(month);
      }
      month.photos.push(photo);
    }
    return months;
  });

  private readonly sectionList = signal<CloudSection[]>([]);
  private loadToken = 0;

  constructor(
    private readonly library: CloudLibraryService,
    private readonly network: NetworkStatus,
    private readonly folderOf: () => Promise<string>,
  ) {}

  /** Shows the cached listing at once, then refreshes it when it is old and the phone is online. */
  async enter(): Promise<void> {
    const configured = await this.library.isConfigured();
    this.configured.set(configured);
    if (!configured) {
      return;
    }
    this.folderName.set(await this.folderOf());
    this.lastSynced.set(await this.library.lastSyncedAt());
    // Photos scanned since the last refresh may already be in the cached listing.
    this.addRecorded(await this.library.recordBackups());
    await this.reload();
    if (this.network.isOnline() && (await this.library.needsSync())) {
      await this.refresh();
    }
  }

  async refresh(): Promise<void> {
    if (this.syncing() || !this.configured()) {
      return;
    }
    if (!this.network.isOnline()) {
      this.syncError.set(null);
      return;
    }
    this.syncing.set(true);
    this.syncError.set(null);
    try {
      // The first months show while older ones are still being listed.
      const report = await this.library.sync(() => {
        if (this.photos().length < CLOUD_PAGE_SIZE) {
          void this.reload();
        }
      });
      this.addRecorded(report);
      this.lastSynced.set(await this.library.lastSyncedAt());
    } catch (error) {
      this.syncError.set(toUserMessage(error, 'Nextcloud could not be reached.'));
    } finally {
      this.syncing.set(false);
      await this.reload();
    }
  }

  dismissRecorded(): void {
    this.recorded.set(null);
  }

  private addRecorded(found: RecordedBackups): void {
    if (found.kept + found.markedForDeletion === 0) {
      return;
    }
    this.recorded.update((total) => ({
      kept: (total?.kept ?? 0) + found.kept,
      markedForDeletion: (total?.markedForDeletion ?? 0) + found.markedForDeletion,
    }));
  }

  async setFilter(filter: CloudFilter): Promise<void> {
    if (filter === this.filter()) {
      return;
    }
    this.filter.set(filter);
    await this.reload();
  }

  async loadMore(): Promise<void> {
    await this.append(this.loadToken);
  }

  /** A newer reload wins over a slower older one. */
  async reload(): Promise<void> {
    const token = ++this.loadToken;
    const [counts, sections] = await Promise.all([this.library.counts(), this.library.sections(this.filter())]);
    if (token !== this.loadToken) {
      return;
    }
    this.counts.set(counts);
    this.sectionList.set(sections);
    this.photos.set([]);
    this.done.set(false);
    await this.append(token);
    this.loaded.set(true);
  }

  private async append(token: number): Promise<void> {
    const page = await this.library.list({ filter: this.filter(), limit: CLOUD_PAGE_SIZE, offset: this.photos().length });
    if (token !== this.loadToken) {
      return;
    }
    this.photos.update((current) => [...current, ...page]);
    if (page.length < CLOUD_PAGE_SIZE) {
      this.done.set(true);
    }
  }
}

export function monthLabel(year: number, month: number): string {
  return new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(new Date(year, month, 1));
}

/** "just now", "5 minutes ago", "yesterday"… */
export function updatedLabel(at: number, now = Date.now()): string {
  const seconds = Math.round((at - now) / 1000);
  const format = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  if (Math.abs(seconds) < 60) {
    return 'just now';
  }
  const minutes = Math.round(seconds / 60);
  if (Math.abs(minutes) < 60) {
    return format.format(minutes, 'minute');
  }
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) {
    return format.format(hours, 'hour');
  }
  return format.format(Math.round(hours / 24), 'day');
}
