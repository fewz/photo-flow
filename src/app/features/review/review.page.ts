import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { App } from '@capacitor/app';
import { PluginListenerHandle } from '@capacitor/core';
import { Router } from '@angular/router';
import { ViewWillEnter, ViewWillLeave } from '@ionic/angular';
import { IonBackButton, IonButtons, IonContent, IonHeader, IonToolbar } from '@ionic/angular';

import { IconComponent } from '../../components/icon/icon.component';
import { PhotoViewerComponent } from '../../components/photo-viewer/photo-viewer.component';
import { SwipeCardComponent } from '../../components/swipe-card/swipe-card.component';
import { REVIEW_PREVIEW_SIZE } from '../../core/constants/app.constants';
import { toUserMessage } from '../../core/errors/app-error';
import { Photo } from '../../core/models/photo.model';
import { PhotoRepository } from '../../core/repositories/photo.repository';
import { ReviewService } from '../../core/services/review.service';
import { ThumbnailService } from '../../core/services/thumbnail.service';

@Component({
  selector: 'app-review',
  templateUrl: './review.page.html',
  styleUrl: './review.page.scss',
  imports: [
    IonHeader,
    IonToolbar,
    IonButtons,
    IonBackButton,
    IonContent,
    IconComponent,
    SwipeCardComponent,
    PhotoViewerComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReviewPage implements ViewWillEnter, ViewWillLeave {
  readonly current = signal<Photo | null>(null);
  readonly previewUrl = signal<string | null>(null);
  readonly remaining = signal(0);
  readonly total = signal(0);
  readonly marked = signal(0);
  readonly loaded = signal(false);
  readonly busy = signal(false);
  readonly canUndo = signal(false);
  readonly error = signal('');
  readonly viewing = signal(false);

  readonly percentDone = computed(() => {
    const total = this.total();
    // Floor so it only reads 100% when nothing is left.
    return total > 0 ? Math.floor(((total - this.remaining()) / total) * 100) : 0;
  });

  private readonly queue: Photo[] = [];
  private readonly previews = new Map<string, string>();
  private resumeHandle: PluginListenerHandle | null = null;
  private readonly photos = inject(PhotoRepository);
  private readonly review = inject(ReviewService);
  private readonly thumbnails = inject(ThumbnailService);
  private readonly router = inject(Router);

  ionViewWillEnter(): void {
    void this.reload();
  }

  async ionViewDidEnter(): Promise<void> {
    this.resumeHandle = await App.addListener('appStateChange', ({ isActive }) => {
      if (isActive) {
        void this.refreshCounts();
      }
    });
  }

  ionViewWillLeave(): void {
    this.viewing.set(false);
    void this.resumeHandle?.remove();
    this.resumeHandle = null;
  }

  async choose(decision: 'keep' | 'delete'): Promise<void> {
    const photo = this.current();
    if (!photo || this.busy()) {
      return;
    }
    this.busy.set(true);
    this.error.set('');
    try {
      await this.review.decide(photo.id, decision);
      this.queue.shift();
      await this.refreshCounts();
      await this.showCurrent();
    } catch (error) {
      this.error.set(toUserMessage(error, 'That decision could not be saved. Try again.'));
    } finally {
      this.busy.set(false);
    }
  }

  async undo(): Promise<void> {
    if (this.busy()) {
      return;
    }
    this.busy.set(true);
    this.error.set('');
    try {
      const restored = await this.review.undo();
      if (restored?.reviewStatus === 'pending') {
        const rest = this.queue.filter((photo) => photo.id !== restored.id);
        this.queue.splice(0, this.queue.length, restored, ...rest);
        await this.showCurrent();
      }
      await this.refreshCounts();
    } catch (error) {
      this.error.set(toUserMessage(error, 'The last decision could not be undone.'));
    } finally {
      this.busy.set(false);
    }
  }

  open(path: string): void {
    void this.router.navigateByUrl(path);
  }

  format(value: number): string {
    return new Intl.NumberFormat().format(value);
  }

  private async reload(): Promise<void> {
    this.queue.length = 0;
    this.current.set(null);
    this.loaded.set(false);
    await this.refreshCounts();
    await this.showCurrent();
    this.loaded.set(true);
  }

  private async refreshCounts(): Promise<void> {
    const counts = await this.photos.counts();
    this.remaining.set(counts.pending);
    this.total.set(counts.total);
    this.marked.set(counts.markedForDeletion);
    this.canUndo.set(await this.review.canUndo());
  }

  private async fillQueue(): Promise<void> {
    if (this.queue.length >= 2) {
      return;
    }
    const page = await this.photos.list({
      reviewStatus: 'pending',
      limit: 8,
      offset: this.queue.length,
    });
    const known = new Set(this.queue.map((photo) => photo.id));
    for (const photo of page) {
      if (!known.has(photo.id)) {
        this.queue.push(photo);
      }
    }
  }

  private async showCurrent(): Promise<void> {
    await this.fillQueue();
    const photo = this.queue[0] ?? null;
    const next = this.queue[1] ?? null;
    this.current.set(photo);
    this.retainPreviews(photo?.id ?? null, next?.id ?? null);
    if (!photo) {
      this.previewUrl.set(null);
      return;
    }
    this.previewUrl.set(this.previews.get(photo.id) ?? null);
    this.previewUrl.set(await this.previewFor(photo));
    // Preload only the next preview.
    if (next) {
      void this.previewFor(next);
    }
  }

  private retainPreviews(currentId: string | null, nextId: string | null): void {
    const keep = new Set([currentId, nextId].filter((id): id is string => id != null));
    for (const id of this.previews.keys()) {
      if (!keep.has(id)) {
        this.previews.delete(id);
      }
    }
  }

  private async previewFor(photo: Photo): Promise<string | null> {
    const cached = this.previews.get(photo.id);
    if (cached) {
      return cached;
    }
    try {
      const src = await this.thumbnails.preview(photo.uri, REVIEW_PREVIEW_SIZE);
      this.previews.set(photo.id, src);
      return src;
    } catch {
      return null;
    }
  }
}
