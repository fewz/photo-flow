function allowedOrigin(value) {
  if (typeof value !== 'string' || !value) {
    return null;
  }
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

export default {
  '/__webdav': {
    target: 'http://127.0.0.1',
    changeOrigin: true,
    secure: false,
    rewrite(path) {
      return path.replace(/^\/__webdav/, '') || '/';
    },
    configure(proxy) {
      // Vite's proxy does not apply a dynamic `router`, so retarget each call here.
      proxy.before('web', 'stream', (req, res, options) => {
        const header = req.headers['x-photoflow-target'];
        const value = Array.isArray(header) ? header[0] : header;
        delete req.headers['x-photoflow-target'];
        const origin = allowedOrigin(value);
        if (!origin) {
          res.writeHead(400, { 'Content-Type': 'text/plain' });
          res.end('Missing Nextcloud target.');
          return true;
        }
        options.target = new URL(origin);
        return false;
      });
    },
  },
};
