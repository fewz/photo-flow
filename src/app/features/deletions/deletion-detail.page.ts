import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ViewWillEnter } from '@ionic/angular';
import { IonBackButton, IonButtons, IonContent, IonHeader, IonToolbar } from '@ionic/angular';

import { DeleteSheetComponent, DeleteSummary } from '../../components/delete-sheet/delete-sheet.component';
import { IconComponent } from '../../components/icon/icon.component';
import { PhotoThumbComponent } from '../../components/photo-thumb/photo-thumb.component';
import { PhotoViewerComponent } from '../../components/photo-viewer/photo-viewer.component';
import { REVIEW_PREVIEW_SIZE } from '../../core/constants/app.constants';
import { toUserMessage } from '../../core/errors/app-error';
import { hasVerifiedBackup, Photo } from '../../core/models/photo.model';
import { PhotoRepository } from '../../core/repositories/photo.repository';
import { DeletionService } from '../../core/services/deletion.service';
import { formatBytes } from '../../core/utils/bytes';

@Component({
  selector: 'app-deletion-detail',
  templateUrl: './deletion-detail.page.html',
  styleUrl: './deletion-detail.page.scss',
  imports: [IonHeader, IonToolbar, IonButtons, IonBackButton, IonContent, IconComponent, PhotoThumbComponent, PhotoViewerComponent, DeleteSheetComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DeletionDetailPage implements ViewWillEnter {
  readonly previewSize = REVIEW_PREVIEW_SIZE;
  readonly photo = signal<Photo | null>(null);
  readonly loaded = signal(false);
  readonly busy = signal(false);
  readonly message = signal('');
  readonly confirming = signal<DeleteSummary | null>(null);
  readonly viewing = signal(false);
  readonly sheetPhotos = computed(() => {
    const photo = this.photo();
    return photo ? [photo] : [];
  });

  readonly backedUp = computed(() => {
    const photo = this.photo();
    return photo ? hasVerifiedBackup(photo) : false;
  });
  readonly meta = computed(() => {
    const photo = this.photo();
    if (!photo) {
      return '';
    }
    const parts = [formatBytes(photo.sizeBytes)];
    if (photo.dateTaken > 0) {
      parts.unshift(new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(photo.dateTaken));
    }
    return parts.join(' · ');
  });

  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly photos = inject(PhotoRepository);
  private readonly deletion = inject(DeletionService);

  ionViewWillEnter(): void {
    void this.reload();
  }

  async putBack(): Promise<void> {
    const photo = this.photo();
    if (!photo || this.busy()) {
      return;
    }
    this.busy.set(true);
    this.message.set('');
    try {
      await this.deletion.undoMark(photo.id);
      await this.router.navigateByUrl('/deletions');
    } catch (error) {
      this.message.set(toUserMessage(error, 'That decision could not be undone. Try again.'));
    } finally {
      this.busy.set(false);
    }
  }

  async askDelete(): Promise<void> {
    const photo = this.photo();
    if (!photo) {
      return;
    }
    const backedUp = hasVerifiedBackup(photo);
    this.confirming.set({
      count: 1,
      bytes: photo.sizeBytes,
      backupBeforeDelete: await this.deletion.backupBeforeDelete(),
      uploadFirst: backedUp ? 0 : 1,
      backedUp: backedUp ? 1 : 0,
    });
  }

  cancelDelete(): void {
    if (!this.busy()) {
      this.confirming.set(null);
    }
  }

  async confirmDelete(): Promise<void> {
    const photo = this.photo();
    if (!photo || this.busy()) {
      return;
    }
    this.busy.set(true);
    this.message.set('');
    try {
      const report = await this.deletion.deleteMarked([photo.id]);
      if (report.deleted === 1) {
        this.confirming.set(null);
        await this.router.navigateByUrl('/deletions');
        return;
      }
      this.message.set(report.message);
      await this.reload();
    } catch (error) {
      this.message.set(toUserMessage(error, 'That photo could not be deleted. Try again.'));
    } finally {
      this.busy.set(false);
      this.confirming.set(null);
    }
  }

  private async reload(): Promise<void> {
    const id = this.route.snapshot.paramMap.get('id');
    const photo = id ? await this.photos.getById(id) : null;
    this.photo.set(photo && !photo.mediaMissing && photo.reviewStatus === 'delete' ? photo : null);
    this.loaded.set(true);
  }
}
