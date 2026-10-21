# CLAUDE.md

PhotoFlow (`app.photoflow`) is an Android-first photo cleanup app. The user scans photos on the phone and swipes through them one by one: **right = keep**, **left = mark for deletion**. Kept photos are backed up to a self-hosted **Nextcloud** server (URL/IP set by the user) over WebDAV. There is no backend of our own.

`Plan.MD` is the product spec and phase history (phases 1–4 done). Read it before larger changes; its "Rules that apply to every phase" are binding.

## Stack

- Ionic 9 + Angular 22 (standalone components, OnPush, lazy routes), TypeScript 6
- Capacitor 8.5.x — **Android only**, no iOS project
- SQLite via `@capacitor-community/sqlite` 8.x (jeep-sqlite + `sql.js` in the browser)
- Native Kotlin plugins in `android/app/src/main/java/app/photoflow/` (OkHttp, WorkManager, androidx security-crypto)
- Tests: Vitest via `@angular/build:unit-test` (jsdom)
- minSdk 24, compile/target SDK 36

Do not upgrade to Capacitor 9 alpha. `sql.js` must stay pinned at exactly `1.11.0` (jeep-sqlite embeds 1.11 glue; newer wasm breaks the browser).

## Commands

```powershell
npm start          # ng serve, with proxy.conf.mjs for WebDAV
npm run lint
npm test
npm run build      # outputs to www/
npx cap sync android
cd android; .\gradlew.bat assembleDebug   # APK: android\app\build\outputs\apk\debug\app-debug.apk
npm run android:live   # scripts/android-live.cjs: ng serve on the LAN IP + debug APK pointed at it (USB phone)
```

`cap run android` does not work in this shell (`./gradlew` under cmd.exe, and cmd here does not search the current folder), so `android-live.cjs` runs sync → gradlew.bat (full path) → `adb install` → launch itself. It writes `server.url` into `android/app/src/main/assets/capacitor.config.json`; the next `npx cap sync android` removes it again.

Machine-specific: put `.tools\node-v24.18.0-win-x64` first on `PATH` before `ng test` / `ng build` (the MSYS Node on the default PATH can't load the Vitest/rolldown native bindings; `scripts/link-win32-gnu-bindings.cjs` runs on postinstall to patch this). `.tools\jdk` (JDK 21) and `.tools\android-sdk` are used for Gradle. `.tools\` and `android\local.properties` are gitignored.

Definition of done for a change: lint clean, unit tests pass, production web build succeeds, `assembleDebug` succeeds.

## Architecture

```
src/app/
  app.routes.ts            tabs shell (/home /gallery /uploads /settings) + pushed /review /deletions; /queue → /uploads
  features/<name>/         pages (*.page.ts + .html)
  features/tabs/           bottom tab bar (ion-tabs)
  components/              icon (inline stroke SVGs), swipe-card, photo-thumb, photo-viewer, delete-sheet, backup-sheet
  core/
    provide-photo-flow.ts  DI wiring + app initializer (DB init → network monitor → queue recovery)
    constants/             DB version, page sizes, setting keys
    models/                Photo, UploadJob, NextcloudSettings, ReviewAction
    database/              PhotoStore interface, SqlitePhotoStore, MemoryPhotoStore (tests), migrations.ts
    repositories/          PhotoRepository (thin layer over PhotoStore)
    services/              PhotoScanner, Review, UploadQueue, Deletion, Nextcloud, NetworkMonitor,
                           SecureCredentialStore, Thumbnail, Logger
    nextcloud/             CloudStorageProvider, NextcloudWebDavProvider, WebDavTransport, remote-path
    plugins/               Capacitor plugin wrappers; each `x.ts` has a `x.web.ts` browser fallback
    errors/app-error.ts    typed AppError subclasses with plain user-facing messages
android/app/src/main/java/app/photoflow/
  MainActivity.java        registers all plugins BEFORE super.onCreate
  plugins/                 PhotoScanner, PhotoThumbnail, PhotoManager (delete), NextcloudWebDav,
                           SecureStore, UploadWork
  mediastore/              MediaStore queries + permission handling
  nextcloud/WebDavClient   OkHttp WebDAV (streams content:// URIs, no JS buffers)
  upload/                  UploadWorker (WorkManager) + UploadDatabase
  security/SecretStore     encrypted storage for the Nextcloud app password
  thumbnails/              bounded thumbnail cache
```

Services are plain classes constructed via factories in `provide-photo-flow.ts` (constructor injection of interfaces), so they can be unit-tested with `MemoryPhotoStore` and fakes — see existing `*.spec.ts` for the pattern.

### Core flows

- **Scan**: `PhotoScannerService` → `MediaLibrary` (Kotlin `PhotoScannerPlugin`). Pages through MediaStore newest-first, metadata only, never file bytes. Permission is requested only when scanning. Limited access (`READ_MEDIA_VISUAL_USER_SELECTED`) must not mark unseen photos `media_missing`. See `docs/android-mediastore.md`.
- **Review**: `ReviewService` sets `reviewStatus` and pushes a `review_actions` row for Undo. Keep → `uploadStatus = pending` + an `upload_jobs` row via `UploadQueueService.noteKept`. Delete → only marks; never deletes or uploads.
- **Upload**: `UploadQueueService` (enqueue, pause/resume, retry, cancel, recovery after restart; concurrency 1–2). On Android, pending jobs are claimed by the native WorkManager `UploadWorker`; in the browser and tests uploads run in-page. UI reads status from SQLite, not memory.
- **Nextcloud**: `NextcloudService` + `NextcloudWebDavProvider`. WebDAV base `{serverUrl}/remote.php/dav/files/{username}/`; remote path `PhotoFlow/YYYY/MM/<file>` from `dateTaken` (`remote-path.ts`). Non-secret config lives in the `nextcloud_config` table; the app password lives in Android encrypted storage (session memory on web).
- **Deletion**: `DeletionService` → `PhotoManagerPlugin` (`createDeleteRequest` API 30+, `RecoverableSecurityException` API 29, `ContentResolver.delete` older). Always after explicit user confirmation. `backup_before_delete` defaults on: a photo without a verified backup (`hasVerifiedBackup`) is uploaded first and is not deleted if that fails.
- **Browser dev mode**: `web-photo-library.ts` uses the File System Access API (directory picker) instead of MediaStore. WebDAV calls go to `/__webdav/...` with an `x-photoflow-target` header; `proxy.conf.mjs` retargets them to the user's Nextcloud origin to avoid CORS.

### Database

- Migrations in `core/database/migrations.ts`; current `DATABASE_VERSION = 4` in `app.constants.ts`.
- **Schema changes = a new numbered migration.** Never edit old migrations or drop user rows. Bump `DATABASE_VERSION`.
- **The Kotlin `UploadDatabase` opens the same SQLite file directly** (`upload_jobs`, `photos`, `app_settings` keys like `upload_paused`, `upload_concurrency`). Column/status/setting renames must be mirrored in Kotlin.
- Implement new `PhotoStore` methods in both `SqlitePhotoStore` and `MemoryPhotoStore`.

### UI design

- The new look comes from the "PhotoFlow Home" design canvas (screens + a "Design rules" board). Every screen follows it: tabs Home, Gallery, Uploads, Settings; pushed Review (swipe), Review deletions and `/deletions/:id`.
- Uploads: hero with photos left (kept − backed up), Pause/Resume, Retry failed; Uploading / Needs attention / Waiting (first 20 + "N more", each cancellable via `UploadQueueService.cancelUpload`, which leaves the photo kept but unqueued) / Clear completed. Polls SQLite every 2 s while visible.
- Gallery: filter chips (`/gallery?filter=duplicates|pending|keep|delete` preselects one), day sections from `groupByDay`, 3/4 columns saved in the `gallery_columns` app setting, tap → `app-photo-viewer`. Hold a photo (or tap Select) for select mode; "Select all" uses `listIds` for the active filter. "Back up" goes through `app-backup-sheet` → `UploadQueueService.planBackup/startBackup`: kept photos are queued, unreviewed ones are marked Keep first (no Undo entry), already backed-up and marked-for-deletion ones are skipped.
- Deleting always goes through `app-delete-sheet` (states count, space freed, what uploads first) before `DeletionService` runs; Android then shows its own system confirm. Thumbnails use `app-photo-thumb` (cached previews only, never the original).
- Tokens: `--pf-*` custom properties in `src/theme/variables.scss` (also mapped onto Ionic's `--ion-*`). Shared classes (`pf-card`, `pf-hero`, `pf-button--*`, `pf-progress`, `pf-chip`, tab bar…) live in `src/theme/photoflow.scss`; keep page `.scss` small because of the 4 kB `anyComponentStyle` budget.
- Font: Plus Jakarta Sans, self-hosted via `@fontsource-variable/plus-jakarta-sans` (no Google Fonts request, works offline). Numbers use tabular figures.
- Light theme only: the Ionic dark palette import is commented out in `global.scss`.
- Colour meaning: blue `--pf-keep` = keep / primary action, orange `--pf-delete` = delete / failure. One dark hero card per screen. Icons come from `app-icon`, not ionicons.
- Browser preview: `.claude/launch.json` starts `ng serve` with the Node in `.tools\`.

## Rules (from Plan.MD — do not break)

- Swipe left never deletes. Physical deletion only after explicit confirmation, only through MediaStore (`PhotoManagerPlugin`). Never read `/storage/emulated/0` directly or `File.delete()` user photos (app cache files are fine).
- Keep `reviewStatus` (`pending|keep|delete`) separate from `uploadStatus` (`not_required|pending|uploading|uploaded|failed`).
- No full-resolution originals during scan/review — originals are only for upload. Page through photos; don't hold the whole gallery in memory. Review preloads only the next preview.
- Never hard-code a Nextcloud server, password, or photo directory.
- Never log passwords, app passwords, Authorization headers, or URLs with credentials. Never store the app password in SQLite plaintext. Don't disable TLS checks; HTTP only if the user typed `http://` (with a warning).
- User-facing errors short and plain (use `AppError` subclasses / `toUserMessage`); technical detail goes to `Logger` with a `LogCategory`.
- Swipe is primary, but Keep/Delete/Undo buttons stay with accessible names.
- Only Nextcloud is implemented; other providers would go behind `CloudStorageProvider`. No custom backend, no iOS.
- Review must work offline; the queue resumes when the network returns (`NetworkMonitor.onReconnect`).

## Conventions

- 2-space indent, single quotes in TS, UTF-8, final newline (`.editorconfig`).
- Component/page class suffixes `Page` / `Component`; selectors prefixed `app-`.
- New native plugin: Kotlin class in `plugins/`, register in `MainActivity` before `super.onCreate`, TS wrapper in `core/plugins/` with a `.web.ts` fallback so the browser and tests keep working.
- Unit tests use `MemoryPhotoStore` plus fake `MediaLibrary`/transport classes and `Fixture_NNN.jpg`-style photos; in the browser the app runs without a phone by picking a local folder.
