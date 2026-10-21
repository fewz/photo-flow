const DAV = 'DAV:';
const OWNCLOUD = 'http://owncloud.org/ns';
const FILES_ROOT = '/remote.php/dav/files/';

/** One child of a WebDAV folder. */
export interface RemoteEntry {
  /** Path under the user's WebDAV root, without leading or trailing slashes. */
  path: string;
  name: string;
  isFolder: boolean;
  etag?: string;
  sizeBytes: number;
  mimeType: string;
  lastModified: number;
  fileId?: string;
  /** Lower-case hex SHA-256 from `oc:checksums`, when the uploader sent one. */
  sha256?: string;
}

export const LISTING_PROPFIND_BODY = `<?xml version="1.0" encoding="UTF-8"?>
<d:propfind xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns"><d:prop>
<d:resourcetype/><d:getetag/><d:getcontentlength/><d:getcontenttype/><d:getlastmodified/><oc:fileid/><oc:checksums/>
</d:prop></d:propfind>`;

/** Reads a Depth 1 PROPFIND reply. The folder itself is left out. */
export function parseListing(xml: string, folderPath: string): RemoteEntry[] {
  const document = new DOMParser().parseFromString(xml, 'application/xml');
  if (document.getElementsByTagName('parsererror').length > 0) {
    throw new SyntaxError('The folder listing could not be read.');
  }
  const self = trimSlashes(folderPath);
  const entries: RemoteEntry[] = [];
  for (const response of Array.from(document.getElementsByTagNameNS(DAV, 'response'))) {
    const path = hrefPath(text(response, DAV, 'href'));
    if (path === null || path === self) {
      continue;
    }
    const isFolder = response.getElementsByTagNameNS(DAV, 'collection').length > 0;
    const modified = Date.parse(text(response, DAV, 'getlastmodified'));
    entries.push({
      path,
      name: path.split('/').pop() ?? path,
      isFolder,
      etag: trimQuotes(text(response, DAV, 'getetag')) || undefined,
      sizeBytes: Number(text(response, DAV, 'getcontentlength')) || 0,
      mimeType: text(response, DAV, 'getcontenttype') || (isFolder ? '' : 'application/octet-stream'),
      lastModified: Number.isFinite(modified) ? modified : 0,
      fileId: text(response, OWNCLOUD, 'fileid') || undefined,
      sha256: sha256Checksum(text(response, OWNCLOUD, 'checksum')),
    });
  }
  return entries;
}

export function isPhotoEntry(entry: RemoteEntry): boolean {
  if (entry.isFolder) {
    return false;
  }
  if (entry.mimeType.startsWith('image/')) {
    return true;
  }
  return /\.(jpe?g|png|gif|webp|heic|heif|dng|avif)$/i.test(entry.name);
}

/** `/nextcloud/remote.php/dav/files/alice/PhotoFlow/2026/` → `PhotoFlow/2026`. */
function hrefPath(href: string): string | null {
  let path = href;
  try {
    path = new URL(href, 'http://local.invalid').pathname;
  } catch {
    return null;
  }
  const start = path.indexOf(FILES_ROOT);
  if (start < 0) {
    return null;
  }
  const rest = path.slice(start + FILES_ROOT.length).split('/');
  // Drop the user name segment.
  const parts = rest.slice(1).filter((part) => part.length > 0);
  try {
    return parts.map((part) => decodeURIComponent(part)).join('/');
  } catch {
    return null;
  }
}

/** `SHA1:… MD5:… SHA256:abc…` → `abc…`. Nextcloud lists every checksum it has, space separated. */
export function sha256Checksum(value: string): string | undefined {
  for (const part of value.split(/\s+/)) {
    const [type, digest] = part.split(':');
    if (type?.toUpperCase() === 'SHA256' && digest && /^[0-9a-f]{64}$/i.test(digest)) {
      return digest.toLowerCase();
    }
  }
  return undefined;
}

function text(parent: Element, namespace: string, name: string): string {
  for (const element of Array.from(parent.getElementsByTagNameNS(namespace, name))) {
    const value = element.textContent?.trim();
    if (value) {
      return value;
    }
  }
  return '';
}

function trimSlashes(value: string): string {
  return value.replace(/^\/+|\/+$/g, '');
}

function trimQuotes(value: string): string {
  return value.replace(/^"+|"+$/g, '');
}
