import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket, WebSocketServer } from 'ws';
import type { ClientMessage } from '../shared/protocol';
import { RoomManager } from './rooms';

const PORT = Number(process.env.PORT ?? 8787);
/** 리버스 프록시 뒤에 있을 때만 X-Forwarded-For를 믿는다 */
const TRUST_PROXY = process.env.TRUST_PROXY === '1';
const MAX_CONNECTIONS_PER_IP = 20;
const MAX_PAYLOAD_BYTES = 128 * 1024;
const HEARTBEAT_MS = 30_000;

// 번들(dist-server/index.js)과 소스(server/index.ts) 모두 프로젝트 루트의 dist를 가리킨다
const STATIC_ROOT = resolve(fileURLToPath(new URL('../dist', import.meta.url)));

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.xml': 'application/xml',
  '.webmanifest': 'application/manifest+json',
  '.map': 'application/json',
};

function clientIp(req: IncomingMessage): string {
  if (TRUST_PROXY) {
    const forwarded = req.headers['x-forwarded-for'];
    const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim();
    if (first) return first;
  }
  return req.socket.remoteAddress ?? 'unknown';
}

const manager = new RoomManager();

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname === '/healthz') {
    res.writeHead(200, { 'content-type': 'text/plain' }).end('ok');
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405).end();
    return;
  }

  let pathname: string;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    res.writeHead(400).end();
    return;
  }

  // 정적 루트 밖으로 나가는 경로(../)를 막는다
  let file = normalize(join(STATIC_ROOT, pathname));
  if (!file.startsWith(STATIC_ROOT)) {
    res.writeHead(403).end();
    return;
  }
  if (!existsSync(file) || statSync(file).isDirectory()) {
    // 파일 확장자가 있는 요청은 404, 그 외는 SPA 진입점
    if (extname(pathname)) {
      res.writeHead(404).end();
      return;
    }
    file = join(STATIC_ROOT, 'index.html');
    if (!existsSync(file)) {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('client build not found (run: yarn build)');
      return;
    }
  }

  // 해시가 붙은 번들(/assets/...)은 영구 캐시, 나머지는 항상 재검증
  const hashed = pathname.startsWith('/assets/');
  res.writeHead(200, {
    'content-type': MIME[extname(file)] ?? 'application/octet-stream',
    'cache-control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  createReadStream(file).pipe(res);
});

const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD_BYTES });
const connectionsByIp = new Map<string, number>();

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname !== '/ws') {
    socket.destroy();
    return;
  }
  const ip = clientIp(req);
  if ((connectionsByIp.get(ip) ?? 0) >= MAX_CONNECTIONS_PER_IP) {
    socket.write('HTTP/1.1 429 Too Many Requests\r\n\r\n');
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    connectionsByIp.set(ip, (connectionsByIp.get(ip) ?? 0) + 1);
    ws.on('close', () => {
      const left = (connectionsByIp.get(ip) ?? 1) - 1;
      if (left <= 0) connectionsByIp.delete(ip);
      else connectionsByIp.set(ip, left);
    });
    wss.emit('connection', ws, req);
  });
});

wss.on('connection', (ws: WebSocket) => {
  const client = manager.addClient((message) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
  });

  let alive = true;
  ws.on('pong', () => {
    alive = true;
  });
  const heartbeat = setInterval(() => {
    if (!alive) {
      ws.terminate();
      return;
    }
    alive = false;
    ws.ping();
  }, HEARTBEAT_MS);

  ws.on('message', (data, isBinary) => {
    if (isBinary) return;
    let message: ClientMessage;
    try {
      message = JSON.parse(data.toString());
    } catch {
      return;
    }
    if (typeof message !== 'object' || message === null || typeof message.t !== 'string') return;
    try {
      manager.handle(client, message);
    } catch (e) {
      console.error('[server] message handler failed', e);
    }
  });

  ws.on('close', () => {
    clearInterval(heartbeat);
    manager.removeClient(client);
  });
  ws.on('error', () => ws.terminate());
});

server.listen(PORT, () => {
  console.log(`[server] listening on http://localhost:${PORT}`);
});

function shutdown() {
  manager.dispose();
  wss.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
