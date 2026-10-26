import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { networkInterfaces } from 'node:os';
import { createApi } from './api.js';

/**
 * Сервер для занятия: раздаёт собранный сайт из dist/ и API.
 * Запуск: npm run build && npm start (порт — переменная PORT, по умолчанию 3000).
 */

const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? '0.0.0.0';
const DIST = new URL('../dist/', import.meta.url).pathname;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

// Короткие адреса страниц.
const PAGES = { '/': '/index.html', '/admin': '/admin.html' };

if (!existsSync(join(DIST, 'index.html'))) {
  console.error('Нет собранного сайта. Сначала выполните: npm run build');
  process.exit(1);
}

const api = createApi();

function serveStatic(req, res) {
  const path = decodeURIComponent((req.url ?? '/').split('?')[0]);
  const file = normalize(join(DIST, PAGES[path] ?? path));
  if (!file.startsWith(DIST) || !existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Не найдено');
    return;
  }
  res.writeHead(200, {
    'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream',
    // Файлы из assets/ содержат хеш в имени — их можно кешировать навсегда.
    'Cache-Control': file.includes('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  createReadStream(file).pipe(res);
}

const server = createServer((req, res) => api(req, res, () => serveStatic(req, res)));

server.listen(PORT, HOST, () => {
  console.log('Emmet · Тетрадь запущена:');
  console.log(`  на этом компьютере:  http://localhost:${PORT}`);
  for (const address of Object.values(networkInterfaces()).flat()) {
    if (address?.family === 'IPv4' && !address.internal) {
      console.log(`  для студентов:       http://${address.address}:${PORT}`);
    }
  }
  console.log(`  панель преподавателя: http://localhost:${PORT}/admin`);
});

// Перед выходом дописываем несохранённую статистику.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    api.store.flush();
    process.exit(0);
  });
}
