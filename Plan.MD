# PhotoFlow plan

Android-first photo review app. The user scans photos from the device, swipes to keep or mark for deletion, and later backs up kept photos to a Nextcloud server they configure. There is no backend. The app talks to MediaStore on the device and, in later phases, to Nextcloud WebDAV directly.

Review works offline. SQLite is the source of truth for app state. MediaStore is the source of truth for whether a photo still exists on the device. Nextcloud is the source of truth for whether a remote backup exists.

Swipe left never deletes a file. Physical deletion happens only after an explicit confirmation, and only through MediaStore.

## How to continue

Implement one phase at a time. Phases 1, 2, 3, and 4 are done.

Before changing code:

1. Inspect the repo. Do not recreate the Ionic app or overwrite working Phase 1 code.
2. Reuse the current stack and the tables that already exist.
3. After the phase: lint, unit test, production web build, and `assembleDebug`. Fix compile and test failures before calling the phase done.

## Stack (do not change unless a dependency is incompatible)

- Ionic 9, Angular 22, TypeScript, Capacitor 8.5.x (not Capacitor 9 alpha)
- SQLite via `@capacitor-community/sqlite` 8.x
- Kotlin plugins under `android/app/src/main/java/app/photoflow/`
- `applicationId`: `app.photoflow`
- `minSdk` 24, `compileSdk` / `targetSdk` 36
- Android only. Do not add an iOS project.
- `sql.js` must stay pinned at `1.11.0` (exact). `jeep-sqlite` embeds sql.js 1.11 glue; a newer wasm fails in the browser.

On this machine, put `.tools\node-v24.18.0-win-x64` first on `PATH` before `ng test` or `ng build`. The MSYS Node on the default PATH cannot load the Vitest native binding.

## Status

| Phase | Goal | Status |
| --- | --- | --- |
| 1 | Scan the device and review photos locally | Done |
| 2 | Connect to Nextcloud and upload kept photos | Done |
| 3 | Confirm deletion, backup-before-delete, retry, offline queue | Done |
| 4 | Performance, background upload, duplicates, richer dashboard | Done |

## Rules that apply to every phase

- Do not hard-code a Nextcloud server, password, or photo directory.
- Do not read `/storage/emulated/0` or call `File.delete()` on user photos. Cache files inside the app cache may be deleted.
- Do not load full-resolution originals during scan or review. Original bytes are only for upload.
- Page through photos. Do not hold the whole gallery in memory.
- Keep `reviewStatus` (`pending`, `keep`, `delete`) separate from `uploadStatus` (`not_required`, `pending`, `uploading`, `uploaded`, `failed`).
- Never log passwords, app passwords, authorization headers, or WebDAV URLs that contain credentials.
- User-facing errors stay short and plain. Technical detail stays in development logs.
- Swipe is the primary review gesture, and Delete, Keep, and Undo buttons remain available with accessible names.
- New schema changes are new numbered migrations. Do not drop existing user rows.

---

## Phase 1 — Local review

**Done.** The app scans MediaStore, stores decisions in SQLite, and reviews one photo at a time. Nextcloud, upload processing, and physical deletion are not in the UI.

### What this phase does

1. User opens the app with no network required.
2. User taps Scan. The app asks for photo permission only then.
3. The scanner pages through `MediaStore.Images.Media` (newest first), stores metadata, and does not read file bytes.
4. Review shows one preview. Swipe left or Delete sets `reviewStatus = delete`. Swipe right or Keep sets `reviewStatus = keep`. `uploadStatus` stays `not_required`.
5. Undo restores the last persisted decision. Killing the app does not lose keep/delete, because the decision lives on the photo row.
6. Gallery lists thumbnails in pages of 20.
7. Settings shows permission status, rescan, clear thumbnail cache, app version, and database version.

### Already in the repo

- Routes: `/home`, `/review`, `/gallery`, `/settings`. Standalone, OnPush.
- `PhotoRepository`, `PhotoScannerService`, `ReviewService`, `ThumbnailService`, `Logger`.
- `MemoryPhotoStore` for tests and `SqlitePhotoStore` on device and in the browser.
- Migration 1 creates `photos`, `upload_jobs`, `nextcloud_config`, `app_settings`, and `review_actions`. The upload and Nextcloud tables are empty and unused.
- Kotlin plugins, registered in `MainActivity` before `super.onCreate`:
  - `PhotoScannerPlugin` — permission check/request, `scanPhotos`, `listPhotoIds`, open app settings
  - `PhotoThumbnailPlugin` — preview JPEG in the app cache
  - `PhotoManagerPlugin` — MediaStore delete request. **The UI does not call it.**
- Web fixtures (`Fixture_001.jpg` and similar) so the browser and tests run without a phone.
- Permissions: `READ_MEDIA_IMAGES` (API 33+), `READ_MEDIA_VISUAL_USER_SELECTED` (API 34+), `READ_EXTERNAL_STORAGE` with `maxSdkVersion` 32. A limited grant is reported as partial access and does not mark other photos `media_missing`.

### Verified

- Lint clean. Production web build succeeded. Capacitor Android sync succeeded.
- 12 unit tests passed: insert, no duplicate and no review reset, swipe left/right, undo, permission denial writes no photos, limited access does not mark hidden photos missing.
- Browser: 45 fixtures scanned; swipe left, undo, and swipe right; Delete and Undo buttons; gallery pages through all 45; rescan updated 45 and added 0; home ended at 45 photos, 2 reviewed, 43 pending, 1 marked for deletion.
- Debug APK: `android\app\build\outputs\apk\debug\app-debug.apk`.

### Intentionally not in Phase 1

Kept photos do not create upload jobs. Home has no Upload Queue or Review Deletions actions. Settings has no Nextcloud fields. `PhotoManagerPlugin.deletePhoto` exists for Phase 3 and must stay unused until the user confirms deletion.

---

## Phase 2 — Nextcloud backup of kept photos

**Done.** A kept photo becomes a backup job. Settings stores the server URL, username, and remote folder in SQLite, and the app password in Android encrypted storage (session memory in the browser). Test Connection reports connected, authentication failed, server unreachable, invalid URL, or WebDAV unavailable. The upload queue pauses, resumes, retries, and clears completed jobs. Swipe left still does not upload or delete. Physical deletion is still Phase 3.

### What the user can do when this phase is done

1. In Settings, enter server URL, username, app password, and remote folder. The password is not shown again after save and is not stored in a plaintext file or logged.
2. Tap Test Connection and see one of: connected, authentication failed, server unreachable, invalid URL, or WebDAV unavailable.
3. Swipe right (or Keep) sets `reviewStatus = keep` and `uploadStatus = pending`, and inserts one `upload_jobs` row. Swipe left still sets `delete` and `not_required`, and still does not upload or delete.
4. Upload Queue shows uploading, pending, and failed jobs, with progress that survives leaving the screen.
5. A successful upload sets `uploadStatus = uploaded` and stores `remotePath` and `remoteETag`. The same photo is not uploaded again unless the user asks.
6. Home shows a backup count (uploaded / kept) and an Upload Queue action.

### Build

- `CloudStorageProvider` with `testConnection`, `createDirectory`, `upload`, `fileExists`, and `getFileMetadata`.
- `NextcloudWebDavProvider` is the only implementation. WebDAV base is `{serverUrl}/remote.php/dav/files/{username}/`. Strip a trailing slash from the server URL. Do not add a custom Nextcloud backend. Do not add Google Drive, OneDrive, or S3.
- Default remote folder is `PhotoFlow`. Path uses `dateTaken` when present: `PhotoFlow/2026/10/IMG_20261008_182301.jpg`. `MKCOL` is fine when the folder already exists.
- `UploadQueueService`: enqueue, process, pause, resume, retry, cancel, persist, progress, recover after restart. Concurrency default is 1 or 2, never a large burst.
- Stream the `content://` URI with `ContentResolver.openInputStream` from Kotlin when that avoids loading the image into a JavaScript buffer. TypeScript keeps a small API such as upload photo in, `{ success, remotePath, etag }` or progress events out.
- After upload, PROPFIND (or equivalent) may confirm the remote file. SHA-256 is only for that verification, never during the gallery scan.
- Prefer Android secure storage for the app password. `nextcloud_config` may store non-secret settings. Do not write the app password into SQLite in plaintext.
- HTTP is allowed only when the user typed an `http://` URL, with a short warning that credentials can be intercepted. Do not disable TLS checks.
- Typed errors: `NextcloudConnectionError`, `NextcloudAuthenticationError`, `NextcloudUploadError`, `NetworkError`. Map them to the plain messages above.
- Logger categories already include `Nextcloud` and `UploadQueue`.

### Tests to add

- Kept photo creates an upload job.
- A photo already `uploaded` with a `remotePath` is not enqueued again.
- Failed upload can retry.
- Offline does not drop the queue and does not start the upload.
- Authentication failure is a user-facing message and does not log the password.

### Out of scope for Phase 2

Do not add the deletion confirmation screen, backup-before-delete, or MediaStore delete calls from the UI. Those are Phase 3. Do not add WorkManager yet. That is Phase 4. A foreground queue that resumes from SQLite is enough here.

---

## Phase 3 — Safe deletion

**Done.** Review Deletions lists photos marked for deletion. The user can open one, undo it back to pending review, delete a selection, or delete all marked. The app states how many photos will be removed and asks before anything is deleted. Removal goes through `PhotoManagerPlugin`. Backup before delete defaults to on: a photo without a verified backup is uploaded first, and a failed or unreachable backup leaves that photo in place with a retry. Home shows the storage those marked photos would free.

### What the user can do when this phase is done

1. Review Deletions lists photos with `reviewStatus = delete`. The user can open one, undo the decision, select several, delete the selection, or delete all marked.
2. Before any physical delete, the app states how many photos will be removed and asks for confirmation.
3. Deletion uses `PhotoManagerPlugin` (`MediaStore.createDeleteRequest` on API 30+, recoverable security exception on API 29, `ContentResolver.delete` on older versions). Android may show its own system confirm. A failed item stays in the database with a retry.
4. Setting `backupBeforeDelete` defaults to **on**. For each marked photo, the app uploads first if there is no verified backup. If Nextcloud is down, it does not delete that photo. If the user turns the setting off, Settings explains that local delete will not keep a backup.
5. Upload retry and the offline queue stay intact: reviewing never needs a network; when the network returns, pending jobs resume. Pause and resume stay under the user's upload settings.
6. Home can show storage that would be freed by the marked photos, and a Review Deletions action.

### Tests to add

- Backup-before-delete blocks deletion when upload fails or the server is unreachable.
- A verified upload allows deletion.
- Undo on the deletion screen returns the photo to pending review and does not remove the file.
- Queue state is still present after a simulated restart.

### Out of scope for Phase 3

Do not add duplicate detection, blur detection, or background WorkManager. Those are Phase 4.

---

## Phase 4 — Scale and background behavior

**Done.** Large libraries keep a bounded thumbnail cache, Android backups continue through WorkManager after the process stops, and duplicate photos are grouped by size and modified time. The home screen shows backup progress, recoverable storage, review counts, and a duplicate count. A single Offline line appears on home and the upload queue, and the queue resumes once when the network returns.

### What to add

- Thumbnail cache limits and eviction beyond the Phase 1 cache clear button. Review still preloads only the next preview.
- WorkManager uploader for long-running uploads. The UI still reads status from SQLite, not from an in-memory list. Jobs survive process death.
- Duplicate detection using `mediaStoreId`, size, and `dateModified`, with optional SHA-256 only when checking a backup. Room in the model for a later perceptual hash, screenshot flag, or blur flag, without implementing those detectors.
- Dashboard: backup progress (uploaded / kept), recoverable storage, and the existing review counts. Keep the screen simple.
- Network indicator: a small Offline state. Do not spam errors. On reconnect, resume the queue within the concurrency setting.
- Lifecycle: background, foreground, rotation, and process death do not lose review decisions or upload jobs.

### Verified

- Lint clean. 39 unit tests passed. Production web build succeeded. Debug APK assembled.
- Duplicate grouping uses size and modified time only. SHA-256 stays on the backup upload path. `perceptual_hash`, `is_screenshot`, and `blur_flag` are unused.
- On Android, pending uploads are claimed by WorkManager. The web app and unit tests still upload in the page.

### Still not in this phase

Google Drive, OneDrive, S3, and other providers stay behind `CloudStorageProvider` only. No AI analysis. No iOS app.

---

## Run and build

Web:

```powershell
npm start
```

Checks:

```powershell
npm run lint
npm test
npm run build
```

Debug APK, with `JAVA_HOME` on JDK 21 and `ANDROID_HOME` on an SDK that has platform 36:

```powershell
npx cap sync android
cd android
.\gradlew.bat assembleDebug
```

`android\local.properties` is gitignored and points at the local SDK. JDK and SDK command-line tools used for the Phase 1 APK live under `.tools\`, which is gitignored.

At the end of Phase 2, 3, and 4, report files touched, dependencies, permissions, migrations, how to run, how to build the APK, tests, limitations, and the next phase.
