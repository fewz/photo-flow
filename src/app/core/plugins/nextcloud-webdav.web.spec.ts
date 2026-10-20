import { NextcloudWebDavWeb, resolveWebDavEndpoint } from './nextcloud-webdav.web';
import { resetWebPhotoLibraryForTests, useWebPhotoFiles, webPhotoUri } from './web-photo-library';

describe('browser WebDAV', () => {
  beforeEach(() => {
    resetWebPhotoLibraryForTests();
    FakeXHR.last = null;
    vi.stubGlobal('XMLHttpRequest', FakeXHR);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps the dev-server proxy on the page origin and the Nextcloud origin in a header', () => {
    const endpoint = resolveWebDavEndpoint(
      'http://192.168.1.99:8080/remote.php/dav/files/william/',
      true,
      'http://localhost:4200',
    );

    expect(endpoint.requestUrl).toBe('http://localhost:4200/__webdav/remote.php/dav/files/william/');
    expect(endpoint.targetOrigin).toBe('http://192.168.1.99:8080');
  });

  it('sends PROPFIND to the proxied WebDAV root with the app password only in the Authorization header', async () => {
    const client = new NextcloudWebDavWeb();
    const result = await client.request({
      method: 'PROPFIND',
      url: 'http://192.168.1.99:8080/remote.php/dav/files/william/',
      username: 'william',
      appPassword: 'app-pass',
      depth: '0',
    });

    const sent = FakeXHR.last;
    expect(result.status).toBe(207);
    expect(result.etag).toBe('remote-etag');
    expect(sent?.method).toBe('PROPFIND');
    expect(sent?.url).toContain('/__webdav/remote.php/dav/files/william/');
    expect(sent?.headers.get('X-Photoflow-Target')).toBe('http://192.168.1.99:8080');
    expect(sent?.headers.get('Depth')).toBe('0');
    expect(String(sent?.body)).toContain('<d:propfind');
    expect(sent?.url).not.toContain('app-pass');
    expect(decodeBasic(sent?.headers.get('Authorization') ?? '')).toBe('william:app-pass');
  });

  it('uploads the chosen photo and returns its sha256', async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const file = new File([bytes], 'holiday.jpg', { type: 'image/jpeg' });
    useWebPhotoFiles([file]);
    const client = new NextcloudWebDavWeb();
    const progress: number[] = [];
    await client.addListener('progress', (event) => progress.push(event.progress));

    const result = await client.upload({
      method: 'PUT',
      url: 'http://192.168.1.99:8080/remote.php/dav/files/william/PhotoFlow/holiday.jpg',
      username: 'william',
      appPassword: 'app-pass',
      localUri: webPhotoUri('holiday.jpg'),
      mimeType: 'image/jpeg',
      jobId: 'job-1',
    });

    expect(result.status).toBe(201);
    expect(result.sha256).toBe(await sha256(bytes));
    expect(FakeXHR.last?.method).toBe('PUT');
    expect(progress).toContain(1);
  });

  it('reports a missing photo without contacting the server', async () => {
    const client = new NextcloudWebDavWeb();
    const result = await client.upload({
      method: 'PUT',
      url: 'http://192.168.1.99:8080/remote.php/dav/files/william/missing.jpg',
      username: 'william',
      appPassword: 'app-pass',
      localUri: webPhotoUri('missing.jpg'),
      mimeType: 'image/jpeg',
      jobId: 'job-2',
    });

    expect(result.status).toBe(0);
    expect(FakeXHR.last).toBeNull();
  });
});

class FakeXHR {
  static last: FakeXHR | null = null;
  method = '';
  url = '';
  headers = new Map<string, string>();
  body: unknown;
  status = 207;
  timeout = 0;
  upload = {
    onprogress: null as ((event: ProgressEvent) => void) | null,
  };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;

  open(method: string, url: string): void {
    this.method = method;
    this.url = url;
    this.status = method === 'PUT' ? 201 : 207;
  }

  setRequestHeader(name: string, value: string): void {
    this.headers.set(name, value);
  }

  getResponseHeader(name: string): string | null {
    return name.toLowerCase() === 'etag' ? '"remote-etag"' : null;
  }

  send(body?: Document | XMLHttpRequestBodyInit | null): void {
    this.body = body;
    FakeXHR.last = this;
    this.upload.onprogress?.({ lengthComputable: true, loaded: 1, total: 1 } as ProgressEvent);
    this.onload?.();
  }
}

function decodeBasic(header: string): string {
  const encoded = header.replace(/^Basic /, '');
  const bytes = Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
