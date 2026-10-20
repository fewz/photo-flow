export class AppError extends Error {
  override readonly name: string;

  constructor(
    message: string,
    readonly code: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = new.target.name;
  }
}

export class MediaPermissionError extends AppError {
  constructor(message = 'Photo access is required to scan this device. You can allow it in system settings.') {
    super(message, 'media_permission_denied');
  }
}

export class MediaStoreError extends AppError {
  constructor(message = 'The photo library could not be read. Try again.', options?: { cause?: unknown }) {
    super(message, 'media_store', options);
  }
}

export class NextcloudConnectionError extends AppError {
  constructor(message = 'The Nextcloud server could not be reached.') {
    super(message, 'nextcloud_connection');
  }
}

export class NextcloudAuthenticationError extends AppError {
  constructor(message = 'Nextcloud authentication failed. Check your username and App Password.') {
    super(message, 'nextcloud_auth');
  }
}

export class NextcloudUploadError extends AppError {
  constructor(message = 'The photo could not be uploaded. Try again.', options?: { cause?: unknown }) {
    super(message, 'nextcloud_upload', options);
  }
}

export class NetworkError extends AppError {
  constructor(message = 'Server unreachable.') {
    super(message, 'network');
  }
}

export class DatabaseError extends AppError {
  constructor(message = 'The local library could not be saved. Try again.', options?: { cause?: unknown }) {
    super(message, 'database', options);
  }
}

export function toUserMessage(error: unknown, fallback: string): string {
  return error instanceof AppError ? error.message : fallback;
}
