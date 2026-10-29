import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { Lobby } from './src/lobby.mjs';

const assets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
]);

async function readBody(request) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 4096) throw new Error('요청이 너무 큽니다.');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString() || '{}'); }
  catch { throw new Error('요청 형식이 올바르지 않습니다.'); }
}

export function createApp() {
  const lobby = new Lobby();
  const server = createServer(async (request, response) => {
    const headers = {
      'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    };
    const json = (status, value) => {
      response.writeHead(status, { ...headers, 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify(value));
    };
    try {
      const path = new URL(request.url, 'http://localhost').pathname;
      if (request.method === 'GET' && assets.has(path)) {
        const [file, type] = assets.get(path);
        const contents = await readFile(new URL(`./public/${file}`, import.meta.url));
        response.writeHead(200, { ...headers, 'Content-Type': type });
        response.end(contents);
        return;
      }
      if (request.method === 'GET' && path === '/api/health') {
        return json(200, { ok: true, project: 'skull_king', stage: 'lobby' });
      }
      if (request.method === 'POST') {
        // Browser cross-origin writes are rejected; the local starter exposes no CORS permission.
        const origin = request.headers.origin;
        if (origin && origin !== `http://${request.headers.host}` && origin !== `https://${request.headers.host}`) {
          return json(403, { error: '다른 출처의 요청은 허용되지 않습니다.' });
        }
        if (!request.headers['content-type']?.startsWith('application/json')) {
          return json(415, { error: 'JSON 요청이 필요합니다.' });
        }
        const body = await readBody(request);
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('요청 형식이 올바르지 않습니다.');
        if (path === '/api/rooms') return json(201, lobby.create(body.name));
        if (path === '/api/join') return json(200, lobby.join(body.code, body.name));
        const token = request.headers.authorization?.replace(/^Bearer /, '');
        if (path === '/api/ready') return json(200, lobby.ready(token, body.ready));
        if (path === '/api/leave') { lobby.leave(token); return json(200, { ok: true }); }
      }
      if (request.method === 'GET' && path === '/api/state') {
        return json(200, lobby.state(request.headers.authorization?.replace(/^Bearer /, '')));
      }
      json(404, { error: '주소를 찾을 수 없습니다.' });
    } catch (error) {
      json(error.status ?? 400, { error: error.message });
    }
  });
  server.requestTimeout = 10_000;
  return { server, lobby };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 4180);
  const host = process.env.HOST || '127.0.0.1';
  const { server } = createApp();
  server.on('error', error => {
    console.error(error.code === 'EADDRINUSE' ? `포트 ${port}가 사용 중입니다. PORT를 변경해 주세요.` : error.message);
    process.exitCode = 1;
  });
  server.listen(port, host, () => console.log(`Skull King 대기실: http://${host}:${port}/`));
}
