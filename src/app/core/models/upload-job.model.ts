export type UploadJobStatus = 'pending' | 'uploading' | 'uploaded' | 'failed' | 'cancelled';

export interface UploadJob {
  id: string;
  photoId: string;
  localUri: string;
  remotePath: string;
  status: UploadJobStatus;
  progress: number;
  retryCount: number;
  error?: string;
  createdAt: number;
  updatedAt: number;
}
