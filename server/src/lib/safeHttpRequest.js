const http = require('http');
const https = require('https');
const { validateAndResolveUrl, SSRFBlockedError } = require('./ssrf');
const { HTTP_REQUEST_TIMEOUT_MS, HTTP_MAX_RESPONSE_BYTES } = require('../constants');

/**
 * Performs an outbound HTTP(S) request for the HTTP_REQUEST step with full
 * SSRF protection:
 *  - re-validates and re-resolves the URL right before connecting (see
 *    src/lib/ssrf.js for why this must happen at request time, not save time)
 *  - connects directly to the validated, pinned IP address rather than
 *    handing the hostname to Node's HTTP client (which would perform its own
 *    DNS lookup and could be rebound between our check and the connection)
 *  - still sends the original hostname via the Host header / TLS SNI so
 *    virtual-hosted / CDN-fronted targets keep working
 *  - enforces a hard timeout and a hard cap on bytes read from the response
 */
async function safeHttpRequest({ url, method = 'GET', headers = {}, body }) {
  const resolved = await validateAndResolveUrl(url);
  const lib = resolved.protocol === 'https:' ? https : http;

  return new Promise((resolve, reject) => {
    const options = {
      hostname: resolved.pinnedAddress, // connect to the validated IP directly
      port: resolved.port,
      path: resolved.path || '/',
      method: (method || 'GET').toUpperCase(),
      headers: {
        ...headers,
        Host: resolved.hostname,
      },
      timeout: HTTP_REQUEST_TIMEOUT_MS,
      // For HTTPS, set SNI/cert-checking hostname to the original hostname
      // even though we're dialing the pinned IP.
      servername: resolved.protocol === 'https:' ? resolved.hostname : undefined,
    };

    const startedAt = Date.now();
    const req = lib.request(options, (res) => {
      let received = 0;
      let truncated = false;
      const chunks = [];

      res.on('data', (chunk) => {
        received += chunk.length;
        if (received > HTTP_MAX_RESPONSE_BYTES) {
          truncated = true;
          res.destroy();
          return;
        }
        chunks.push(chunk);
      });

      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks).toString('utf8'),
          truncated,
          durationMs: Date.now() - startedAt,
        });
      });

      res.on('error', (err) => reject(err));
    });

    req.on('timeout', () => {
      req.destroy(new Error(`Request timed out after ${HTTP_REQUEST_TIMEOUT_MS}ms`));
    });

    req.on('error', (err) => reject(err));

    if (body !== undefined && body !== null && options.method !== 'GET' && options.method !== 'HEAD') {
      const payload = typeof body === 'string' ? body : JSON.stringify(body);
      if (!options.headers['Content-Type'] && !options.headers['content-type']) {
        req.setHeader('Content-Type', 'application/json');
      }
      req.write(payload);
    }

    req.end();
  });
}

module.exports = { safeHttpRequest, SSRFBlockedError };
