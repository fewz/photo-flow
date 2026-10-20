import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { ViewWillEnter } from '@ionic/angular';
import {
  IonBackButton,
  IonButtons,
  IonContent,
  IonFooter,
  IonHeader,
  IonInfiniteScroll,
  IonInfiniteScrollContent,
  IonToolbar,
} from '@ionic/angular';

import { DeleteSheetComponent, DeleteSummary } from '../../components/delete-sheet/delete-sheet.component';
import { IconComponent } from '../../components/icon/icon.component';
import { PhotoThumbComponent } from '../../components/photo-thumb/photo-thumb.component';
import { GALLERY_PAGE_SIZE } from '../../core/constants/app.constants';
import { toUserMessage } from '../../core/errors/app-error';
import { hasVerifiedBackup, Photo } from '../../core/models/photo.model';
import { PhotoRepository } from '../../core/repositories/photo.repository';
import { DeletionReport, DeletionService } from '../../core/services/deletion.service';
import { formatBytes } from '../../core/utils/bytes';

interface PendingDelete {
  summary: DeleteSummary;
  /** Loaded photos in this delete, for the preview strip. */
  photos: readonly Photo[];
  run: () => Promise<DeletionReport>;
}

interface Feedback {
  text: string;
  error: boolean;
}

@Component({
  selector: 'app-deletions',
  templateUrl: './deletions.page.html',
  styleUrl: './deletions.page.scss',
  imports: [
    IonHeader,
    IonToolbar,
    IonButtons,
    IonBackButton,
    IonContent,
    IonFooter,
    IonInfiniteScroll,
    IonInfiniteScrollContent,
    IconComponent,
    PhotoThumbComponent,
    DeleteSheetComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DeletionsPage implements ViewWillEnter {
  readonly photos = signal<Photo[]>([]);
  readonly marked = signal(0);
  readonly recoverableBytes = signal(0);
  readonly backupBeforeDelete = signal(true);
  readonly selecting = signal(false);
  readonly selected = signal<ReadonlySet<string>>(new Set());
  readonly loaded = signal(false);
  readonly done = signal(false);
  readonly busy = signal(false);
  readonly feedback = signal<Feedback | null>(null);
  readonly pending = signal<PendingDelete | null>(null);

  readonly failed = computed(() => this.photos().filter((photo) => photo.deleteError));
  readonly selectedPhotos = computed(() => this.photos().filter((photo) => this.selected().has(photo.id)));
  readonly selectedBytes = computed(() => this.selectedPhotos().reduce((sum, photo) => sum + photo.sizeBytes, 0));

  private readonly repository = inject(PhotoRepository);
  private readonly deletion = inject(DeletionService);
  private readonly router = inject(Router);

  ionViewWillEnter(): void {
    void this.reload();
  }

  isSelected(id: string): boolean {
    return this.selected().has(id);
  }

  toggleSelecting(): void {
    this.selecting.update((value) => !value);
    this.selected.set(new Set());
  }

  tap(photo: Photo): void {
    if (!this.selecting()) {
      void this.router.navigateByUrl(`/deletions/${photo.id}`);
      return;
    }
    const next = new Set(this.selected());
    if (next.has(photo.id)) {
      next.delete(photo.id);
    } else {
      next.add(photo.id);
    }
    this.selected.set(next);
  }

  selectLoaded(): void {
    this.selected.set(new Set(this.photos().map((photo) => photo.id)));
  }

  async loadMore(event: CustomEvent): Promise<void> {
    await this.append();
    await (event.target as HTMLIonInfiniteScrollElement).complete();
  }

  askDeleteAll(): void {
    const all = this.done() ? this.photos() : null;
    this.pending.set({
      summary: this.summarize(this.marked(), this.recoverableBytes(), all),
      photos: this.photos(),
      run: () => this.deletion.deleteAllMarked(),
    });
  }

  askDeleteSelected(): void {
    const photos = this.selectedPhotos();
    if (photos.length === 0) {
      return;
    }
    const ids = photos.map((photo) => photo.id);
    this.pending.set({
      summary: this.summarize(photos.length, this.selectedBytes(), photos),
      photos,
      run: () => this.deletion.deleteMarked(ids),
    });
  }

  askRetryFailed(): void {
    const photos = this.failed();
    const ids = photos.map((photo) => photo.id);
    this.pending.set({
      summary: this.summarize(
        photos.length,
        photos.reduce((sum, photo) => sum + photo.sizeBytes, 0),
        photos,
      ),
      photos,
      run: () => this.deletion.deleteMarked(ids),
    });
  }

  cancelDelete(): void {
    if (!this.busy()) {
      this.pending.set(null);
    }
  }

  async confirmDelete(): Promise<void> {
    const pending = this.pending();
    if (!pending || this.busy()) {
      return;
    }
    this.busy.set(true);
    this.feedback.set(null);
    try {
      const report = await pending.run();
      this.feedback.set({ text: report.message, error: report.deleted === 0 });
      this.selecting.set(false);
      this.selected.set(new Set());
      await this.reload();
    } catch (error) {
      this.feedback.set({ text: toUserMessage(error, 'Those photos could not be deleted. Try again.'), error: true });
    } finally {
      this.busy.set(false);
      this.pending.set(null);
    }
  }

  verified(photo: Photo): boolean {
    return hasVerifiedBackup(photo);
  }

  tileLabel(photo: Photo): string {
    const parts = [photo.fileName, formatBytes(photo.sizeBytes)];
    if (hasVerifiedBackup(photo)) {
      parts.push('backed up');
    }
    if (photo.deleteError) {
      parts.push('not deleted');
    }
    return this.selecting() ? parts.join(', ') : `Open ${parts.join(', ')}`;
  }

  storage(bytes: number): string {
    return formatBytes(bytes);
  }

  format(value: number): string {
    return new Intl.NumberFormat().format(value);
  }

  private summarize(count: number, bytes: number, photos: readonly Photo[] | null): DeleteSummary {
    const backedUp = photos ? photos.filter((photo) => hasVerifiedBackup(photo)).length : null;
    return {
      count,
      bytes,
      backupBeforeDelete: this.backupBeforeDelete(),
      uploadFirst: photos && backedUp != null ? photos.length - backedUp : null,
      backedUp,
    };
  }

  private async reload(): Promise<void> {
    const [counts, backup] = await Promise.all([this.repository.counts(), this.deletion.backupBeforeDelete()]);
    this.marked.set(counts.markedForDeletion);
    this.recoverableBytes.set(counts.recoverableBytes);
    this.backupBeforeDelete.set(backup);
    this.photos.set([]);
    this.done.set(false);
    await this.append();
    this.loaded.set(true);
    if (this.marked() === 0) {
      this.selecting.set(false);
    }
  }

  private async append(): Promise<void> {
    const page = await this.repository.list({
      reviewStatus: 'delete',
      limit: GALLERY_PAGE_SIZE,
      offset: this.photos().length,
    });
    this.photos.update((current) => [...current, ...page]);
    if (page.length < GALLERY_PAGE_SIZE) {
      this.done.set(true);
    }
  }
}
