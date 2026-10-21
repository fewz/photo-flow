import { DEFAULT_REMOTE_FOLDER } from '../constants/app.constants';
import { NextcloudConnectionError } from '../errors/app-error';

// Fixed English names, not the device locale, so every phone writes to the same folders.
const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

const OCTET = '(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)';
const IPV4_HOST = new RegExp(`^${OCTET}(?:\\.${OCTET}){3}$`);

export function normalizeServerUrl(input: string): string {
  const trimmed = input.trim();
  let url: URL;
  try {
    url = new URL(withHttpIfIpAddress(trimmed));
  } catch {
    throw new NextcloudConnectionError('Invalid Nextcloud URL.');
  }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !url.hostname) {
    throw new NextcloudConnectionError('Invalid Nextcloud URL.');
  }
  const path = url.pathname.replace(/\/+$/, '');
  return `${url.protocol}//${url.host}${path === '/' ? '' : path}`;
}

export function usesPlainHttp(serverUrl: string): boolean {
  try {
    return normalizeServerUrl(serverUrl).startsWith('http://');
  } catch {
    return false;
  }
}

function withHttpIfIpAddress(value: string): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) {
    return value;
  }
  const host = ipHost(value);
  if (host && (IPV4_HOST.test(host) || isIpv6Host(host))) {
    return `http://${value}`;
  }
  return value;
}

function ipHost(value: string): string | null {
  const authority = value.split('/')[0] ?? '';
  if (!authority) {
    return null;
  }
  if (authority.startsWith('[')) {
    const end = authority.indexOf(']');
    return end > 1 ? authority.slice(1, end) : null;
  }
  const separator = authority.lastIndexOf(':');
  if (separator > -1 && /^\d+$/.test(authority.slice(separator + 1))) {
    return authority.slice(0, separator);
  }
  return authority;
}

function isIpv6Host(host: string): boolean {
  const address = host.split('%')[0] ?? '';
  if (!address.includes(':')) {
    return false;
  }
  try {
    const parsed = new URL(`http://[${address}]`);
    return parsed.hostname === address || parsed.hostname === `[${address}]`;
  } catch {
    return false;
  }
}

export function webDavRoot(serverUrl: string, username: string): string {
  const base = normalizeServerUrl(serverUrl);
  return `${base}/remote.php/dav/files/${encodeURIComponent(username.trim())}/`;
}

export function remoteFileUrl(serverUrl: string, username: string, remotePath: string): string {
  const root = webDavRoot(serverUrl, username);
  const encoded = remotePath
    .split('/')
    .filter((part) => part.length > 0)
    .map((part) => encodeURIComponent(part))
    .join('/');
  return `${root}${encoded}`;
}

export function sanitizeRemoteFolder(value: string | undefined): string {
  const cleaned = (value ?? '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+|\/+$/g, '');
  if (!cleaned) {
    return DEFAULT_REMOTE_FOLDER;
  }
  const parts = cleaned.split('/').filter((part) => part.length > 0);
  if (parts.some((part) => part === '.' || part === '..')) {
    return DEFAULT_REMOTE_FOLDER;
  }
  return parts.join('/');
}

/** `<folder>/<year>/<English month name>/<file>`, for example `PhotoFlow/2026/March/IMG_1.jpg`. */
export function photoRemotePath(baseFolder: string, photo: { fileName: string; dateTaken: number }): string {
  const folder = sanitizeRemoteFolder(baseFolder);
  const when = photo.dateTaken > 0 ? new Date(photo.dateTaken) : new Date();
  const year = String(when.getFullYear());
  const month = MONTH_NAMES[when.getMonth()];
  const name = photo.fileName.replace(/[\\/]/g, '_').replace(/\.\.+/g, '.') || 'photo.jpg';
  return `${folder}/${year}/${month}/${name}`;
}

export function parentFolders(remotePath: string): string[] {
  const parts = remotePath.split('/').filter((part) => part.length > 0);
  const folders: string[] = [];
  for (let index = 1; index < parts.length; index += 1) {
    folders.push(parts.slice(0, index).join('/'));
  }
  return folders;
}
