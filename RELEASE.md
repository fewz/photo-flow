# PhotoFlow releases

Release notes, newest first, plus the list of what the app can do. Add a section here for every release and bump the version in `package.json`, `src/app/core/constants/app.constants.ts` (`APP_VERSION`) and `android/app/build.gradle` (`versionName`, and `versionCode` = major × 10000 + minor × 100 + patch).

## Features

| Area | Feature | Since |
| --- | --- | --- |
| Scan | Reads the phone's photo library through Android MediaStore, newest first, metadata only (no original files) | 0.1.0 |
| Scan | Works with "selected photos only" access without treating the rest as deleted | 0.1.0 |
| Scan | Rescan keeps earlier decisions and picks up new photos | 0.1.0 |
| Scan | Popup at the top of every tab while a scan runs, with the number of photos found so far; can be hidden, then shows "Scan complete" with a shortcut to Review | 0.1.0 |
| Review | Swipe right to keep, left to mark for deletion; Keep, Delete and Undo buttons as well | 0.1.0 |
| Review | Works offline | 0.1.0 |
| Preview | Full-screen preview sized to the screen's real resolution (up to 2560 px), never the original | 0.1.0 |
| Preview | Pinch to zoom (up to 5×), drag to pan, double tap to zoom in or out, + / - / 0 keys | 0.1.0 |
| Gallery | Filters (All, To review, Kept, Delete, Duplicates), day sections, 3 or 4 columns | 0.1.0 |
| Gallery | Hold to select, Select all for the active filter, Back up a selection | 0.1.0 |
| Duplicates | Hints for photos with the same size and modified time | 0.1.0 |
| Backup | Kept photos upload to your own Nextcloud over WebDAV into `PhotoFlow/YYYY/MM/` | 0.1.0 |
| Backup | Background uploads (WorkManager), 1 or 2 at a time, pause while offline and resume on reconnect | 0.1.0 |
| Backup | Uploads screen: progress, pause/resume, retry failed, cancel waiting, clear completed | 0.1.0 |
| Deletion | Nothing is deleted by a swipe; Review deletions screen with put back, select and delete all | 0.1.0 |
| Deletion | Confirmation sheet with count, space freed and what uploads first; Android asks once more | 0.1.0 |
| Deletion | Backup before delete (on by default): a photo without a verified backup is uploaded first and kept if that fails | 0.1.0 |
| Security | Nextcloud app password stored in Android encrypted storage, never logged; warning for plain `http://` | 0.1.0 |
| Settings | Server setup with connection test, remote folder, uploads at a time, clear thumbnail cache | 0.1.0 |

## 0.1.0 (2026-10-21)

First release build, signed with the PhotoFlow release key.

### New

- Scan progress popup at the top of the app while photos are being scanned, including the number found so far, a hide button and a "Scan complete" note with a Review shortcut. The Home "Scan for new photos" row shows the same progress.
- Pinch to zoom in the full-screen preview, with one-finger pan, double tap to zoom and keyboard shortcuts.

### Improved

- Full-screen previews (Review, Gallery viewer, deletion detail) follow the screen's resolution instead of a fixed 1080 px box, and are saved at JPEG quality 90, so photos no longer look blurry on high-density screens.

### Fixed

- App crash on Android 14+ when background uploads started (the WorkManager foreground service now declares the `dataSync` type).
- Blank screen after the app's data was restored from a device backup (the SQLite plugin no longer uses Keystore-backed encryption, and backup rules leave out data that cannot be restored).

### Known issues

- Android 9 and older still use the small system thumbnail for previews, so they stay soft there.
- In the browser dev mode, reloading a tab can hang on database start; opening a new tab works.

### Install note

The release APK is signed with a different key than debug builds. If a debug build is installed, uninstall it first; that also removes its local review decisions.
