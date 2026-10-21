import { NextcloudConnectionError } from '../errors/app-error';
import { normalizeServerUrl, photoRemotePath, webDavRoot } from './remote-path';

describe('Nextcloud paths', () => {
  it('normalizes the server URL and builds the WebDAV root', () => {
    expect(normalizeServerUrl('http://192.168.1.99:8080/')).toBe('http://192.168.1.99:8080');
    expect(normalizeServerUrl('192.168.1.99')).toBe('http://192.168.1.99');
    expect(normalizeServerUrl('192.168.1.99:8080/nextcloud/')).toBe('http://192.168.1.99:8080/nextcloud');
    expect(normalizeServerUrl('[::1]:8080')).toBe('http://[::1]:8080');
    expect(normalizeServerUrl('https://10.0.0.5')).toBe('https://10.0.0.5');
    expect(webDavRoot('http://192.168.1.99:8080/', 'william')).toBe(
      'http://192.168.1.99:8080/remote.php/dav/files/william/',
    );
  });

  it('rejects a URL that is not http or https', () => {
    expect(() => normalizeServerUrl('ftp://files.example')).toThrowError(NextcloudConnectionError);
    expect(() => normalizeServerUrl('files.example')).toThrowError(NextcloudConnectionError);
    expect(() => normalizeServerUrl('999.1.1.1')).toThrowError(NextcloudConnectionError);
  });

  it('places a photo in a year and English month name folder', () => {
    const path = photoRemotePath('PhotoFlow', {
      fileName: 'IMG_20261008_182301.jpg',
      dateTaken: new Date(2026, 9, 8, 18, 23, 1).getTime(),
    });
    expect(path).toBe('PhotoFlow/2026/October/IMG_20261008_182301.jpg');
    expect(photoRemotePath('PhotoFlow', { fileName: 'a.jpg', dateTaken: new Date(2026, 0, 1).getTime() })).toBe(
      'PhotoFlow/2026/January/a.jpg',
    );
    expect(photoRemotePath('PhotoFlow', { fileName: 'b.jpg', dateTaken: new Date(2026, 11, 31).getTime() })).toBe(
      'PhotoFlow/2026/December/b.jpg',
    );
  });
});
