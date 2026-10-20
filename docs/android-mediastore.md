# Android MediaStore

PhotoFlow discovers and deletes device photos through Android MediaStore. It does not scan `/storage/emulated/0` and it does not use `File.delete()` for user photos.

## Permissions

The app asks only when a scan starts.

| Android | Permission | Result |
| --- | --- | --- |
| 14+ (API 34) | `READ_MEDIA_IMAGES` and `READ_MEDIA_VISUAL_USER_SELECTED` | Full access is `granted`. Selected photos only is `limited`. |
| 13 (API 33) | `READ_MEDIA_IMAGES` | `granted` or `denied`. |
| 12 and earlier | `READ_EXTERNAL_STORAGE` | `granted` or `denied`. |

Limited access scans only the photos the user selected. Those other photos are not marked missing, because they may still exist on the device.

Denial leaves the library unchanged and the screen explains how to allow access.

## Queries

Images come from `MediaStore.Images.Media` on the external volume (`VOLUME_EXTERNAL` from API 29, otherwise `EXTERNAL_CONTENT_URI`).

Each row returns the MediaStore id, content URI, display name, MIME type, size, width, height, date taken, date modified, and relative path when the platform provides it.

- `DATE_TAKEN` is milliseconds. If it is missing, the plugin uses `DATE_MODIFIED`.
- `DATE_MODIFIED` is stored by Android in seconds. The plugin converts it to milliseconds before it reaches TypeScript.
- `since` on `scanPhotos` is milliseconds and filters `DATE_MODIFIED`.
- API 26+ pages with `QUERY_ARG_LIMIT` and `QUERY_ARG_OFFSET`, sorted by date taken descending.
- API 24–25 uses `LIMIT` / `OFFSET` in the sort order.
- Relative path is included from API 29.

Scanning reads metadata only. Previews use `ContentResolver.loadThumbnail` from API 29 and `MediaStore.Images.Thumbnails` on older versions. The JPEG is written to the app cache. The original file is not loaded.

## Deletion

`PhotoManager.deletePhoto` and `deletePhotos` are implemented for a later confirmation screen. The review swipe does not call them.

- API 30+ uses `MediaStore.createDeleteRequest`, which asks the user to confirm.
- API 29 uses `ContentResolver.delete` and `RecoverableSecurityException` when Android requires confirmation.
- Older versions use `ContentResolver.delete`.
- A failed delete stays failed for that photo. Nothing is removed with a raw file path.

## TypeScript

`PhotoScanner.checkPermissions()`, `requestPermissions()`, `scanPhotos()`, and `getPhotoThumbnail()` are the app-facing names. On Android they call the Kotlin plugins. In the browser they return fixture photos named `Fixture_001.jpg` and similar, so the review flow can be exercised without a device.

The browser database uses `jeep-sqlite`, which was built with sql.js 1.11.0. `sql.js` is pinned to 1.11.0 so `sql-wasm.wasm` matches that build. A newer wasm file fails to instantiate.
