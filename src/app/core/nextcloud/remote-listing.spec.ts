import { isPhotoEntry, parseListing, sha256Checksum } from './remote-listing';
import { monthFolderIndex, previewUrl, webFileUrl } from './remote-path';

const LISTING = `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns">
  <d:response>
    <d:href>/cloud/remote.php/dav/files/william/PhotoFlow/2026/October/</d:href>
    <d:propstat>
      <d:prop><d:resourcetype><d:collection/></d:resourcetype><d:getetag>"folder-1"</d:getetag></d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
  <d:response>
    <d:href>/cloud/remote.php/dav/files/william/PhotoFlow/2026/October/Fixture%20001.jpg</d:href>
    <d:propstat>
      <d:prop>
        <d:resourcetype/>
        <d:getetag>&quot;abc123&quot;</d:getetag>
        <d:getcontentlength>4200</d:getcontentlength>
        <d:getcontenttype>image/jpeg</d:getcontenttype>
        <d:getlastmodified>Tue, 13 Oct 2026 08:00:00 GMT</d:getlastmodified>
        <oc:fileid>991</oc:fileid>
        <oc:checksums><oc:checksum>SHA1:da39a3ee5e6b4b0d3255bfef95601890afd80709 SHA256:${'AB'.repeat(32)}</oc:checksum></oc:checksums>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
  <d:response>
    <d:href>/cloud/remote.php/dav/files/william/PhotoFlow/2026/October/notes.txt</d:href>
    <d:propstat>
      <d:prop><d:resourcetype/><d:getcontenttype>text/plain</d:getcontenttype></d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
    <d:propstat>
      <d:prop><oc:fileid/></d:prop>
      <d:status>HTTP/1.1 404 Not Found</d:status>
    </d:propstat>
  </d:response>
  <d:response>
    <d:href>/cloud/remote.php/dav/files/william/PhotoFlow/2026/October/Edits/</d:href>
    <d:propstat>
      <d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
</d:multistatus>`;

describe('parseListing', () => {
  it('reads the children of a folder and leaves the folder itself out', () => {
    const entries = parseListing(LISTING, 'PhotoFlow/2026/October');

    expect(entries.map((entry) => entry.path)).toEqual([
      'PhotoFlow/2026/October/Fixture 001.jpg',
      'PhotoFlow/2026/October/notes.txt',
      'PhotoFlow/2026/October/Edits',
    ]);
    expect(entries[0]).toEqual({
      path: 'PhotoFlow/2026/October/Fixture 001.jpg',
      name: 'Fixture 001.jpg',
      isFolder: false,
      etag: 'abc123',
      sizeBytes: 4200,
      mimeType: 'image/jpeg',
      lastModified: Date.UTC(2026, 9, 13, 8),
      fileId: '991',
      sha256: 'ab'.repeat(32),
    });
    expect(entries[1]?.fileId).toBeUndefined();
    expect(entries[2]?.isFolder).toBe(true);
  });

  it('picks the SHA-256 out of the checksums Nextcloud lists', () => {
    expect(sha256Checksum('MD5:abc SHA256:' + 'F0'.repeat(32))).toBe('f0'.repeat(32));
    expect(sha256Checksum('SHA1:da39a3ee5e6b4b0d3255bfef95601890afd80709')).toBeUndefined();
    expect(sha256Checksum('SHA256:not-hex')).toBeUndefined();
    expect(sha256Checksum('')).toBeUndefined();
  });

  it('keeps photos only', () => {
    const photos = parseListing(LISTING, 'PhotoFlow/2026/October').filter(isPhotoEntry);
    expect(photos.map((entry) => entry.name)).toEqual(['Fixture 001.jpg']);
  });

  it('rejects a reply that is not XML', () => {
    expect(() => parseListing('<html', 'PhotoFlow')).toThrow();
  });
});

describe('Nextcloud gallery URLs', () => {
  it('maps English month folders to month numbers', () => {
    expect(monthFolderIndex('January')).toBe(0);
    expect(monthFolderIndex('october')).toBe(9);
    expect(monthFolderIndex('2026')).toBe(-1);
  });

  it('asks the server for a preview by file id, or by path without one', () => {
    expect(previewUrl('https://cloud.example.test/', { fileId: '991', remotePath: 'PhotoFlow/a.jpg' }, 320)).toBe(
      'https://cloud.example.test/index.php/core/preview?fileId=991&x=320&y=320&a=1',
    );
    expect(previewUrl('https://cloud.example.test', { remotePath: 'PhotoFlow/2026/a b.jpg' }, 320)).toBe(
      'https://cloud.example.test/index.php/core/preview.png?file=%2FPhotoFlow%2F2026%2Fa+b.jpg&x=320&y=320&a=1',
    );
  });

  it('links to the file in the Nextcloud web interface', () => {
    expect(webFileUrl('https://cloud.example.test', { fileId: '991', remotePath: 'PhotoFlow/a.jpg' })).toBe(
      'https://cloud.example.test/index.php/f/991',
    );
    expect(webFileUrl('https://cloud.example.test', { remotePath: 'PhotoFlow/2026/March/a.jpg' })).toBe(
      'https://cloud.example.test/index.php/apps/files/?dir=%2FPhotoFlow%2F2026%2FMarch',
    );
  });
});
