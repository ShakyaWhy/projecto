#!/usr/bin/env node
'use strict';
// The web server: /api/v1 and the board's page. Listens on this computer only. No packages needed.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Store, ApiError } = require('./src/store');
const { route, openapi } = require('./src/api');

const PUBLIC = path.join(__dirname, 'public');
const FILES = {
  '/': ['index.html', 'text/html'], '/app.css': ['app.css', 'text/css'], '/app.js': ['app.js', 'text/javascript'],
  '/docs': ['docs.html', 'text/html'], '/favicon.svg': ['favicon.svg', 'image/svg+xml']
};
const LIMIT = 1024 * 1024;

function create(options) {
  const store = new Store(options.file);
  const token = options.token || '';
  const digest = s => crypto.createHash('sha256').update(s).digest();

  function send(res, status, body, type) {
    res.writeHead(status, {
      'Content-Type': (type || 'application/json') + '; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; object-src 'none'",
      'Referrer-Policy': 'no-referrer'
    });
    res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
  }
  const refuse = (res, e) => send(res, e.status, { error: { code: e.code, message: e.message } });

  function body(req) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      let size = 0;
      req.on('data', c => {
        size += c.length;
        if (size > LIMIT) { reject(new ApiError(413, 'too_large', 'The request is larger than 1 MB.')); req.destroy(); return; }
        chunks.push(c);
      });
      req.on('error', reject);
      req.on('end', () => {
        if (!size) { return resolve({}); }
        // a form on another website cannot send this content type without asking first
        if (!String(req.headers['content-type']).toLowerCase().startsWith('application/json')) { return reject(new ApiError(415, 'unsupported', 'Send JSON with Content-Type: application/json.')); }
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (e) { reject(new ApiError(400, 'invalid', 'The body is not valid JSON.')); }
        return undefined;
      });
    });
  }

  const server = http.createServer(async (req, res) => {
    try {
      // only requests addressed to this computer by name, and only from this app's own page
      const port = server.address().port;
      const hosts = ['127.0.0.1:' + port, 'localhost:' + port];
      const origin = req.headers.origin;
      if (!hosts.includes(req.headers.host) || (origin && !hosts.includes(origin.replace(/^http:\/\//, '')))) { throw new ApiError(403, 'forbidden', 'Open the board at http://127.0.0.1:' + port + '.'); }
      const url = new URL(req.url, 'http://local');
      if (url.pathname.startsWith('/api/v1/')) {
        if (token) {
          const given = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
          if (!crypto.timingSafeEqual(digest(given), digest(token))) { throw new ApiError(401, 'unauthorized', 'Send Authorization: Bearer <token>.'); }
        }
        const at = url.pathname.slice('/api/v1'.length).replace(/\/$/, '');
        if (at === '/openapi.json' && req.method === 'GET') { return send(res, 200, openapi(!!token)); }
        const input = req.method === 'GET' || req.method === 'HEAD' ? {} : await body(req);
        const out = route(store, req.method, at, Object.fromEntries(url.searchParams), input);
        return send(res, out.status, out.result);
      }
      const file = req.method === 'GET' && FILES[url.pathname];
      if (!file) { throw new ApiError(404, 'not_found', 'There is no such page.'); }
      return send(res, 200, fs.readFileSync(path.join(PUBLIC, file[0])), file[1]);
    } catch (e) {
      if (e instanceof ApiError) { return refuse(res, e); }
      console.error(e);
      return refuse(res, new ApiError(500, 'server_error', 'The change could not be made: ' + e.message));
    }
  });
  server.store = store;
  return server;
}

module.exports = { create };

if (require.main === module) {
  const port = Number(process.env.KANBAN_PORT || 4600);
  const server = create({ file: process.env.KANBAN_DATA || path.join(__dirname, 'data', 'board.json'), token: process.env.KANBAN_TOKEN });
  server.on('error', e => { console.error(e.code === 'EADDRINUSE' ? 'Port ' + port + ' is in use: the board may already be running.' : e.message); process.exit(1); });
  server.listen(port, '127.0.0.1', () => console.log('Kanban: http://127.0.0.1:' + port + '   API: /api/v1   Docs: /docs' + (process.env.KANBAN_TOKEN ? '   (token required)' : '')));
}
