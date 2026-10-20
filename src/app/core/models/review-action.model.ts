import { ReviewStatus, UploadStatus } from './photo.model';

export interface ReviewAction {
  id: string;
  photoId: string;
  previousReviewStatus: ReviewStatus;
  previousUploadStatus: UploadStatus;
  nextReviewStatus: ReviewStatus;
  createdAt: number;
}
