import { spawnPhase5bFixtureServer } from './phase5b-test-fixture.mjs';

const port = 4326;
const server = spawnPhase5bFixtureServer(port);
const base = `http://127.0.0.1:${port}`;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

try {
  await wait(250);
  const initial = await fetch(`${base}/app.js`);
  const etag = initial.headers.get('etag');
  if (initial.status !== 200 || !etag) throw new Error('静态模块没有返回可校验的 ETag。');
  if (!String(initial.headers.get('cache-control') || '').includes('no-cache')) throw new Error('静态模块没有启用协商缓存。');

  const revalidated = await fetch(`${base}/app.js`, { headers: { 'if-none-match': etag } });
  if (revalidated.status !== 304) throw new Error(`静态模块协商缓存未命中，实际状态为 ${revalidated.status}。`);

  const api = await fetch(`${base}/api/explore`);
  if (api.status !== 200 || !String(api.headers.get('cache-control') || '').includes('no-store')) {
    throw new Error('公开目录 API 不应被浏览器持久缓存。');
  }
  console.log('HTTP 缓存验收通过：静态模块 ETag 304 复用，API 仍保持 no-store。');
} finally {
  server.kill();
}
