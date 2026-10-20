import { Capacitor } from '@capacitor/core';

import { PhotoAccess, ScannedPhoto } from '../models/photo.model';
import { DeletePhotoResult, ScanPhotosOptions } from './media-library';

const URI_PREFIX = 'web-photo:';
const DB_NAME = 'photoflow-web';
const STORE = 'handles';
const HANDLE_KEY = 'library';
const IMAGE_EXT = /\.(avif|bmp|gif|heic|heif|jpe?g|png|tiff?|webp)$/i;

interface WebPhotoRecord {
  mediaStoreId: string;
  relativePath: string;
  file: File;
  parent?: FileSystemDirectoryHandle;
  fileName?: string;
}

type DirectoryPicker = (options?: { mode?: 'read' | 'readwrite' }) => Promise<FileSystemDirectoryHandle>;

type PermissionedDirectory = FileSystemDirectoryHandle & {
  queryPermission(descriptor?: { mode?: 'read' | 'readwrite' }): Promise<PermissionState>;
  requestPermission(descriptor?: { mode?: 'read' | 'readwrite' }): Promise<PermissionState>;
};

const photos = new Map<string, WebPhotoRecord>();
let loaded = false;
let sessionAccess: PhotoAccess = 'denied';
let storedHandle: FileSystemDirectoryHandle | null = null;
let pending: Promise<PhotoAccess> | null = null;

const restoreOnce = restoreHandle();

export function primeWebPhotoAccess(force = false): void {
  if (Capacitor.getPlatform() !== 'web' || pending) {
    return;
  }
  if (!force && sessionAccess === 'granted') {
    return;
  }
  const handle = storedHandle;
  pending = (!force && handle ? reuse(handle) : pickFresh()).finally(() => {
    pending = null;
  });
}

export function requestWebPhotoAccess(force = false): Promise<PhotoAccess> {
  if (pending) {
    return pending;
  }
  primeWebPhotoAccess(force);
  return pending ?? Promise.resolve(sessionAccess);
}

export async function webPhotoAccess(): Promise<PhotoAccess> {
  if (sessionAccess === 'granted') {
    return 'granted';
  }
  await restoreOnce;
  if (!storedHandle) {
    return 'denied';
  }
  const state = await asPermissioned(storedHandle).queryPermission({ mode: 'read' }).catch(() => 'denied' as PermissionState);
  if (state === 'granted') {
    sessionAccess = 'granted';
    return 'granted';
  }
  return 'denied';
}

export async function scanWebPhotos(options: ScanPhotosOptions): Promise<ScannedPhoto[]> {
  await ensureLoaded();
  const limit = options.limit ?? 50;
  const offset = options.offset ?? 0;
  const page = sorted().filter((photo) => (options.since ? photo.dateModified > options.since : true));
  return page.slice(offset, offset + limit);
}

export async function listWebPhotoIds(): Promise<string[]> {
  await ensureLoaded();
  return [...photos.keys()];
}

export async function readWebPhoto(uri: string): Promise<File | null> {
  await ensureLoaded();
  return photos.get(idFromUri(uri))?.file ?? null;
}

export async function deleteWebPhoto(mediaStoreId: string, uri: string): Promise<DeletePhotoResult> {
  await ensureLoaded();
  const record = photos.get(mediaStoreId) ?? photos.get(idFromUri(uri));
  if (!record) {
    return { mediaStoreId, success: false, error: 'That photo is no longer in the chosen folder.' };
  }
  if (!record.parent || !record.fileName) {
    return {
      mediaStoreId,
      success: false,
      error: 'This browser cannot delete the file. Remove it from the folder yourself.',
    };
  }
  try {
    await record.parent.removeEntry(record.fileName);
    photos.delete(record.mediaStoreId);
    return { mediaStoreId, success: true };
  } catch {
    return { mediaStoreId, success: false, error: 'The photo could not be deleted.' };
  }
}

export function useWebPhotoFiles(files: readonly File[]): void {
  photos.clear();
  for (const file of files) {
    if (!isImageFile(file)) {
      continue;
    }
    const record = recordFromFile(file);
    photos.set(record.mediaStoreId, record);
  }
  loaded = true;
  storedHandle = null;
  if (files.length > 0) {
    sessionAccess = 'granted';
  }
}

export function resetWebPhotoLibraryForTests(): void {
  photos.clear();
  loaded = false;
  sessionAccess = 'denied';
  storedHandle = null;
  pending = null;
}

export function webPhotoUri(relativePath: string): string {
  return `${URI_PREFIX}${encodeURIComponent(relativePath)}`;
}

function pickFresh(): Promise<PhotoAccess> {
  const picker = directoryPicker();
  if (!picker) {
    return pickWithInput().then((files) => finishFiles(files));
  }
  try {
    return picker({ mode: 'readwrite' }).then(
      (handle) => finishHandle(handle),
      () => sessionAccess,
    );
  } catch {
    return pickWithInput().then((files) => finishFiles(files));
  }
}

function reuse(handle: FileSystemDirectoryHandle): Promise<PhotoAccess> {
  return asPermissioned(handle)
    .requestPermission({ mode: 'readwrite' })
    .catch(() => 'denied' as PermissionState)
    .then(async (state: PermissionState) => {
      if (state !== 'granted') {
        return sessionAccess === 'granted' ? sessionAccess : 'denied';
      }
      await loadFromHandle(handle);
      return 'granted';
    });
}

async function finishHandle(handle: FileSystemDirectoryHandle): Promise<PhotoAccess> {
  storedHandle = handle;
  await saveHandle(handle);
  await loadFromHandle(handle);
  return 'granted';
}

function finishFiles(files: readonly File[]): PhotoAccess {
  if (files.length === 0) {
    return sessionAccess;
  }
  useWebPhotoFiles(files);
  void deleteHandle();
  return 'granted';
}

async function loadFromHandle(root: FileSystemDirectoryHandle): Promise<void> {
  const next = new Map<string, WebPhotoRecord>();
  await walk(root, '', next);
  photos.clear();
  for (const [id, record] of next) {
    photos.set(id, record);
  }
  loaded = true;
  sessionAccess = 'granted';
}

async function walk(dir: FileSystemDirectoryHandle, prefix: string, into: Map<string, WebPhotoRecord>): Promise<void> {
  for await (const [name, entry] of dir.entries()) {
    if (name.startsWith('.')) {
      continue;
    }
    const path = prefix ? `${prefix}/${name}` : name;
    if (entry.kind === 'directory') {
      await walk(entry as FileSystemDirectoryHandle, path, into);
      continue;
    }
    const handle = entry as FileSystemFileHandle;
    const file = await handle.getFile();
    if (!isImageFile(file)) {
      continue;
    }
    const record = recordFromFile(file, path, dir, name);
    into.set(record.mediaStoreId, record);
  }
}

async function ensureLoaded(): Promise<void> {
  if (loaded) {
    return;
  }
  await restoreOnce;
  if (!storedHandle) {
    return;
  }
  const state = await asPermissioned(storedHandle).queryPermission({ mode: 'read' }).catch(() => 'denied' as PermissionState);
  if (state !== 'granted') {
    return;
  }
  await loadFromHandle(storedHandle);
}

function sorted(): ScannedPhoto[] {
  return [...photos.values()]
    .map(toScanned)
    .sort((a, b) => b.dateTaken - a.dateTaken || a.fileName.localeCompare(b.fileName));
}

function toScanned(record: WebPhotoRecord): ScannedPhoto {
  const taken = record.file.lastModified || Date.now();
  const folder = record.relativePath.includes('/')
    ? record.relativePath.slice(0, record.relativePath.lastIndexOf('/') + 1)
    : undefined;
  return {
    mediaStoreId: record.mediaStoreId,
    uri: webPhotoUri(record.relativePath),
    fileName: record.file.name,
    mimeType: mimeFor(record.file),
    sizeBytes: record.file.size,
    width: 0,
    height: 0,
    dateTaken: taken,
    dateModified: taken,
    relativePath: folder,
  };
}

function recordFromFile(
  file: File,
  relativePath = relativePathOf(file),
  parent?: FileSystemDirectoryHandle,
  fileName?: string,
): WebPhotoRecord {
  return {
    mediaStoreId: relativePath,
    relativePath,
    file,
    parent,
    fileName: fileName ?? file.name,
  };
}

function relativePathOf(file: File): string {
  const relative = file.webkitRelativePath?.replace(/\\/g, '/').replace(/^\/+/, '');
  return relative || file.name;
}

function isImageFile(file: File): boolean {
  return file.type.startsWith('image/') || IMAGE_EXT.test(file.name);
}

function mimeFor(file: File): string {
  if (file.type) {
    return file.type;
  }
  const ext = file.name.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    case 'gif':
      return 'image/gif';
    case 'webp':
      return 'image/webp';
    case 'bmp':
      return 'image/bmp';
    case 'avif':
      return 'image/avif';
    case 'heic':
      return 'image/heic';
    case 'heif':
      return 'image/heif';
    case 'tif':
    case 'tiff':
      return 'image/tiff';
    default:
      return 'application/octet-stream';
  }
}

function idFromUri(uri: string): string {
  if (!uri.startsWith(URI_PREFIX)) {
    return uri;
  }
  const encoded = uri.slice(URI_PREFIX.length);
  try {
    return decodeURIComponent(encoded);
  } catch {
    return encoded;
  }
}

function asPermissioned(handle: FileSystemDirectoryHandle): PermissionedDirectory {
  return handle as PermissionedDirectory;
}

function directoryPicker(): DirectoryPicker | null {
  const host = window as Window & { showDirectoryPicker?: DirectoryPicker };
  return host.showDirectoryPicker ?? null;
}

function pickWithInput(): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = 'image/*';
    input.setAttribute('webkitdirectory', '');
    const finish = (files: File[]) => {
      input.remove();
      resolve(files);
    };
    input.addEventListener('change', () => finish(Array.from(input.files ?? [])));
    input.addEventListener('cancel', () => finish([]));
    document.body.appendChild(input);
    input.click();
  });
}

function restoreHandle(): Promise<void> {
  if (Capacitor.getPlatform() !== 'web') {
    return Promise.resolve();
  }
  return readHandle()
    .then((handle) => {
      if (!loaded) {
        storedHandle = handle;
      }
    })
    .catch(() => undefined);
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readHandle(): Promise<FileSystemDirectoryHandle | null> {
  if (typeof indexedDB === 'undefined') {
    return null;
  }
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const request = tx.objectStore(STORE).get(HANDLE_KEY);
      request.onsuccess = () => resolve((request.result as FileSystemDirectoryHandle | undefined) ?? null);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

async function saveHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  if (typeof indexedDB === 'undefined') {
    return;
  }
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(handle, HANDLE_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // The chosen folder still works for this tab if the handle cannot be stored.
  } finally {
    db.close();
  }
}

async function deleteHandle(): Promise<void> {
  storedHandle = null;
  if (typeof indexedDB === 'undefined') {
    return;
  }
  try {
    const db = await openDb();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).delete(HANDLE_KEY);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  } catch {
    // A missing saved handle only means the folder is chosen again next time.
  }
}
