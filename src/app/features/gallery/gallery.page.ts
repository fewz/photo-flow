import { ChangeDetectionStrategy, Component, computed, inject, OnDestroy, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Platform, ViewWillEnter, ViewWillLeave } from '@ionic/angular';
import {
  IonContent,
  IonFooter,
  IonHeader,
  IonInfiniteScroll,
  IonInfiniteScrollContent,
  IonToolbar,
} from '@ionic/angular';
import { Subscription } from 'rxjs';

import { BackupSheetComponent } from '../../components/backup-sheet/backup-sheet.component';
import { IconComponent } from '../../components/icon/icon.component';
import { PhotoThumbComponent } from '../../components/photo-thumb/photo-thumb.component';
import { PhotoViewerComponent } from '../../components/photo-viewer/photo-viewer.component';
import { GALLERY_PAGE_SIZE, SETTING_GALLERY_COLUMNS } from '../../core/constants/app.constants';
import { toUserMessage } from '../../core/errors/app-error';
import { Photo, PhotoCounts, PhotoQuery } from '../../core/models/photo.model';
import { PhotoRepository } from '../../core/repositories/photo.repository';
import { NetworkMonitor } from '../../core/services/network-monitor';
import { SecureCredentialStore } from '../../core/services/secure-credential.store';
import { BackupPlan, UploadQueueService } from '../../core/services/upload-queue.service';
import { groupByDay } from './photo-sections';

type GalleryFilter = 'all' | 'pending' | 'keep' | 'delete' | 'duplicates';
const FILTERS: readonly unknown[] = ['all', 'pending', 'keep', 'delete', 'duplicates'];
type TileState = 'backed-up' | 'kept' | 'marked' | 'pending';

const LONG_PRESS_MS = 450;
const LONG_PRESS_SLOP = 10;

interface FilterChip {
  id: GalleryFilter;
  label: string;
  count: number;
}

interface PendingBackup {
  plan: BackupPlan;
  configured: boolean;
}

interface Feedback {
  text: string;
  error: boolean;
  showUploads: boolean;
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

const STATE_LABELS: Record<TileState, string> = {
  'backed-up': 'kept, backed up',
  kept: 'kept, waiting to upload',
  marked: 'marked for deletion',
  pending: 'not reviewed',
};

@Component({
  selector: 'app-gallery',
  templateUrl: './gallery.page.html',
  styleUrl: './gallery.page.scss',
  imports: [
    IonHeader,
    IonToolbar,
    IonContent,
    IonFooter,
    IonInfiniteScroll,
    IonInfiniteScrollContent,
    IconComponent,
    PhotoThumbComponent,
    PhotoViewerComponent,
    BackupSheetComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GalleryPage implements ViewWillEnter, ViewWillLeave, OnDestroy {
  readonly filter = signal<GalleryFilter>('all');
  readonly columns = signal<3 | 4>(3);
  readonly counts = signal<PhotoCounts>(EMPTY_COUNTS);
  readonly photos = signal<Photo[]>([]);
  readonly loaded = signal(false);
  readonly done = signal(false);
  readonly viewing = signal<Photo | null>(null);

  readonly selecting = signal(false);
  readonly selected = signal<ReadonlySet<string>>(new Set());
  readonly selectingAll = signal(false);
  readonly busy = signal(false);
  readonly pendingBackup = signal<PendingBackup | null>(null);
  readonly feedback = signal<Feedback | null>(null);
  readonly online = inject(NetworkMonitor).online;

  readonly sections = computed(() => groupByDay(this.photos()));
  readonly chips = computed<FilterChip[]>(() => {
    const counts = this.counts();
    return [
      { id: 'all', label: 'All', count: counts.total },
      { id: 'pending', label: 'To review', count: counts.pending },
      { id: 'keep', label: 'Kept', count: counts.kept },
      { id: 'delete', label: 'Delete', count: counts.markedForDeletion },
      { id: 'duplicates', label: 'Duplicates', count: counts.duplicatePhotos },
    ];
  });
  /** Number of photos in the active filter, for "Select all". */
  readonly filterCount = computed(() => this.chips().find((chip) => chip.id === this.filter())?.count ?? 0);
  readonly allSelected = computed(() => this.filterCount() > 0 && this.selected().size >= this.filterCount());

  private loadToken = 0;
  private pressTimer = 0;
  private pressStart: { x: number; y: number } | null = null;
  private suppressClick = false;
  private backHandle: Subscription | null = null;
  private readonly repository = inject(PhotoRepository);
  private readonly uploads = inject(UploadQueueService);
  private readonly credentials = inject(SecureCredentialStore);
  private readonly platform = inject(Platform);
  private readonly router = inject(Router);

  ionViewWillEnter(): void {
    // `/gallery?filter=duplicates` (from Home) picks the filter; tab pages are reused, so read the live URL.
    const requested = this.router.parseUrl(this.router.url).queryParams['filter'];
    if (FILTERS.includes(requested)) {
      this.filter.set(requested);
    }
    void this.loadColumns();
    void this.reload();
  }

  ionViewWillLeave(): void {
    this.exitSelection();
  }

  ngOnDestroy(): void {
    this.cancelPress();
    this.backHandle?.unsubscribe();
  }

  setFilter(filter: GalleryFilter): void {
    if (filter === this.filter()) {
      return;
    }
    this.filter.set(filter);
    // "Select all" follows the active filter, so a new filter starts a new selection.
    this.selected.set(new Set());
    void this.reload();
  }

  async toggleColumns(): Promise<void> {
    const next = this.columns() === 3 ? 4 : 3;
    this.columns.set(next);
    await this.repository.setSetting(SETTING_GALLERY_COLUMNS, String(next));
  }

  async loadMore(event: CustomEvent): Promise<void> {
    await this.append(this.loadToken);
    await (event.target as HTMLIonInfiniteScrollElement).complete();
  }

  // Selection: hold a photo (or tap Select) to start; then taps toggle.

  onPressStart(photo: Photo, event: PointerEvent): void {
    if (event.pointerType === 'mouse' && event.button !== 0) {
      return;
    }
    this.cancelPress();
    this.pressStart = { x: event.clientX, y: event.clientY };
    this.pressTimer = window.setTimeout(() => {
      this.pressTimer = 0;
      this.suppressClick = true;
      if (!this.selecting()) {
        this.enterSelection();
      }
      this.toggle(photo.id, true);
      navigator.vibrate?.(15);
    }, LONG_PRESS_MS);
  }

  onPressMove(event: PointerEvent): void {
    if (!this.pressStart) {
      return;
    }
    const moved = Math.hypot(event.clientX - this.pressStart.x, event.clientY - this.pressStart.y);
    if (moved > LONG_PRESS_SLOP) {
      this.cancelPress();
    }
  }

  cancelPress(): void {
    window.clearTimeout(this.pressTimer);
    this.pressTimer = 0;
    this.pressStart = null;
  }

  tap(photo: Photo): void {
    if (this.suppressClick) {
      this.suppressClick = false;
      return;
    }
    if (this.selecting()) {
      this.toggle(photo.id);
    } else {
      this.viewing.set(photo);
    }
  }

  enterSelection(): void {
    this.selecting.set(true);
    this.feedback.set(null);
    // Android back leaves selection mode before it leaves the screen.
    this.backHandle ??= this.platform.backButton.subscribeWithPriority(101, () => this.exitSelection());
  }

  exitSelection(): void {
    this.selecting.set(false);
    this.selected.set(new Set());
    this.backHandle?.unsubscribe();
    this.backHandle = null;
  }

  isSelected(id: string): boolean {
    return this.selected().has(id);
  }

  async toggleSelectAll(): Promise<void> {
    if (this.allSelected()) {
      this.selected.set(new Set());
      return;
    }
    this.selectingAll.set(true);
    try {
      const filter = this.filter();
      const ids = await this.repository.listIds(this.query());
      if (filter === this.filter()) {
        this.selected.set(new Set(ids));
      }
    } finally {
      this.selectingAll.set(false);
    }
  }

  // Backup

  async askBackup(): Promise<void> {
    const ids = [...this.selected()];
    if (ids.length === 0 || this.busy()) {
      return;
    }
    this.busy.set(true);
    try {
      const [plan, settings, hasPassword] = await Promise.all([
        this.uploads.planBackup(ids),
        this.repository.getNextcloudSettings(),
        this.credentials.hasAppPassword(),
      ]);
      const configured = Boolean(settings?.enabled && settings.serverUrl && settings.username && hasPassword);
      this.pendingBackup.set({ plan, configured });
    } finally {
      this.busy.set(false);
    }
  }

  cancelBackup(): void {
    if (!this.busy()) {
      this.pendingBackup.set(null);
    }
  }

  openSettings(): void {
    this.pendingBackup.set(null);
    this.exitSelection();
    void this.router.navigateByUrl('/settings');
  }

  async confirmBackup(): Promise<void> {
    const pending = this.pendingBackup();
    if (!pending || this.busy()) {
      return;
    }
    this.busy.set(true);
    try {
      const queued = await this.uploads.startBackup(pending.plan);
      const noun = queued === 1 ? 'photo' : 'photos';
      this.feedback.set({
        text: this.online()
          ? `Backing up ${this.format(queued)} ${noun}.`
          : `${this.format(queued)} ${noun} will upload when you are back online.`,
        error: false,
        showUploads: true,
      });
      this.exitSelection();
      await this.reload();
    } catch (error) {
      this.feedback.set({
        text: toUserMessage(error, 'Those photos could not be added to the upload queue. Try again.'),
        error: true,
        showUploads: false,
      });
    } finally {
      this.busy.set(false);
      this.pendingBackup.set(null);
    }
  }

  state(photo: Photo): TileState {
    if (photo.reviewStatus === 'delete') {
      return 'marked';
    }
    if (photo.reviewStatus === 'keep') {
      return photo.uploadStatus === 'uploaded' && photo.remotePath ? 'backed-up' : 'kept';
    }
    return 'pending';
  }

  tileLabel(photo: Photo): string {
    const state = STATE_LABELS[this.state(photo)];
    if (this.selecting()) {
      return `${photo.fileName}, ${state}`;
    }
    return `${photo.fileName}, ${state}. Open full screen; hold to select`;
  }

  open(path: string): void {
    void this.router.navigateByUrl(path);
  }

  format(value: number): string {
    return new Intl.NumberFormat().format(value);
  }

  private toggle(id: string, forceOn = false): void {
    const next = new Set(this.selected());
    if (next.has(id) && !forceOn) {
      next.delete(id);
    } else {
      next.add(id);
    }
    this.selected.set(next);
  }

  private async loadColumns(): Promise<void> {
    const stored = await this.repository.getSetting(SETTING_GALLERY_COLUMNS);
    this.columns.set(stored === '4' ? 4 : 3);
  }

  private async reload(): Promise<void> {
    // A newer reload (e.g. a quick filter change) wins over a slower older one.
    const token = ++this.loadToken;
    this.counts.set(await this.repository.counts());
    if (token !== this.loadToken) {
      return;
    }
    this.photos.set([]);
    this.done.set(false);
    await this.append(token);
    this.loaded.set(true);
  }

  private async append(token: number): Promise<void> {
    const page = await this.repository.list({
      ...this.query(),
      limit: GALLERY_PAGE_SIZE,
      offset: this.photos().length,
    });
    if (token !== this.loadToken) {
      return;
    }
    this.photos.update((current) => [...current, ...page]);
    if (page.length < GALLERY_PAGE_SIZE) {
      this.done.set(true);
    }
  }

  private query(): Omit<PhotoQuery, 'limit' | 'offset'> {
    switch (this.filter()) {
      case 'pending':
      case 'keep':
      case 'delete':
        return { reviewStatus: this.filter() as PhotoQuery['reviewStatus'] };
      case 'duplicates':
        return { duplicatesOnly: true };
      default:
        return {};
    }
  }
}
