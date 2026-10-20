# PhotoFlow

PhotoFlow is an Android app for cleaning up the photo library on your phone. You go through your photos one at a time and **swipe right to keep** or **swipe left to mark for deletion**. Kept photos are backed up to **your own Nextcloud server** (a local IP or a domain you set), and marked photos are only removed after you confirm.

There is no PhotoFlow server or account. The app talks to the phone's photo library and, for backups, directly to your Nextcloud over WebDAV.

## What it does

- **Swipe review.** One photo at a time, with Delete, Undo and Keep buttons for when you don't want to swipe. Tap a photo to see it full screen. Reviewing works offline.
- **Nothing is deleted by a swipe.** Swiping left only marks a photo. Deletion happens on the *Review deletions* screen, after a confirmation that says how many photos and how much space, and Android asks once more.
- **Backup before delete** (on by default). A marked photo without a backup is uploaded to Nextcloud first; if that upload fails, the photo stays on the phone.
- **Automatic backup of kept photos.** Uploads keep running in the background, pause when you are offline and resume when the network is back.
- **Gallery** with filters (All, To review, Kept, Delete, Duplicates), photos grouped by day, and multi-select: hold a photo to start selecting, use *Select all* for the active filter, then *Back up*.
- **Uploads** screen with progress, pause/resume, retry for failed uploads and cancel for waiting ones.
- **Duplicate hints** for photos that share the same size and modified time.

## Using the app

### 1. Set up Nextcloud (once)

1. In Nextcloud, open **Settings → Security → Devices & sessions** and create an **app password** for PhotoFlow. Don't use your normal login password.
2. In PhotoFlow, open the **Settings** tab and fill in:
   - **Server URL**: for example `https://cloud.example.com` or `192.168.1.20` (a bare IP is treated as `http://`).
   - **Username** and the **App password** you just created.
   - **Remote folder** (default `PhotoFlow`). Photos are saved as `PhotoFlow/YYYY/MM/<file name>`.
3. Tap **Test connection**. You should see **Connected**.

The app password is kept in Android's encrypted storage and is never shown again or written to logs. If the server uses plain `http://`, the app warns you that the password can be intercepted on an untrusted network.

### 2. Scan your photos

On **Home**, tap **Scan photos** and allow photo access. PhotoFlow only reads photo details (name, date, size); it does not open the original files until it uploads them. If you only allow *selected photos*, PhotoFlow works with those and leaves the rest alone.

### 3. Review

Tap **Start reviewing** on Home.

| Action | Result |
| --- | --- |
| Swipe right / **Keep** | Photo is kept and queued for backup |
| Swipe left / **Delete** | Photo is *marked* for deletion. Nothing is removed yet |
| **Undo** | Reverts your last decision |
| Tap the photo | Full-screen preview (✕ or Back to close) |

### 4. Free up space

On Home, tap **Review deletions**. You can:

- tap a photo to look at it and **Put back** if you change your mind,
- **Select** a few photos and delete only those, or
- **Delete all**.

A confirmation sheet shows how many photos will go, how much space is freed and which ones upload first. Tap a thumbnail there to check it full screen before you confirm.

### 5. Check backups

The **Uploads** tab shows what is uploading, what is waiting and what needs attention. From the **Gallery** you can also back up any selection: hold a photo, pick more (or *Select all*), then **Back up**. Photos not reviewed yet are marked Keep; ones already backed up or marked for deletion are skipped. The sheet tells you this before anything happens.

### Settings worth knowing

- **Backup before delete**: turn off only if you are fine with deleting photos that have no backup.
- **Uploads at a time**: 1 or 2.
- **Rescan photos** finds new photos and keeps your earlier decisions.
- **Clear thumbnail cache** frees the preview cache. Previews are rebuilt when needed.

## For developers

### Stack

Ionic 9 + Angular 22 (standalone components, signals), Capacitor 8.5 (Android only), SQLite via `@capacitor-community/sqlite`, and Kotlin plugins for MediaStore, thumbnails, deletion, encrypted storage and WorkManager uploads. Unit tests use Vitest.

### Requirements

- Node 24 (on this machine: `.tools\node-v24.18.0-win-x64`, put it first on `PATH`; the MSYS Node can't load the test/build native bindings)
- For the APK: JDK 21 and an Android SDK with platform 36 (`.tools\jdk`, `.tools\android-sdk`; point `android\local.properties` at the SDK)

### Commands

```powershell
npm install
npm start            # dev server on http://localhost:4200
npm run lint
npm test
npm run build        # production web build into www/
npx cap sync android
cd android; .\gradlew.bat assembleDebug
```

The debug APK ends up in `android\app\build\outputs\apk\debug\app-debug.apk`.

### Running in the browser

`npm start` runs the whole app in Chrome or Edge without a phone. Instead of the phone's gallery, you pick a **folder of photos** (File System Access API). Nextcloud calls go through the dev server proxy (`proxy.conf.mjs`), so a Nextcloud on your local network works without CORS changes. In the browser the app password is only kept for the session.

### Project layout

```
src/app/
  features/        screens: home, review, deletions, gallery, uploads, settings, tabs
  components/      icon, swipe-card, photo-thumb, photo-viewer, delete-sheet, backup-sheet
  core/            models, SQLite store + migrations, repository, services
                   (scanner, review, upload queue, deletion, Nextcloud), Capacitor plugin wrappers
src/theme/         design tokens (variables.scss) and shared styles (photoflow.scss)
android/app/src/main/java/app/photoflow/   Kotlin plugins and the background uploader
docs/              Android MediaStore notes
```

`Plan.MD` has the product spec and phase history, and `CLAUDE.md` has the architecture notes and the rules every change must follow (for example: never delete a user photo without confirmation and never store or log the app password in plain text).
