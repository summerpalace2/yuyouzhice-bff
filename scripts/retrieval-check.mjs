/**
 * retrieval-check.mjs
 *
 * Boundary check: the Web BFF delegates retrieval to Java and never calls the
 * retired Node Production V2 Retrieval URL directly.
 */

import { createServer } from 'node:http';
import { spawn } from 'node:child_process';

const appPort = await new Promise((resolve, reject) => {
  const probe = createServer();
  probe.once('error', reject);
  probe.listen(0, '127.0.0.1', () => {
    const port = probe.address().port;
    probe.close(() => resolve(port));
  });
});
const retiredPort = await new Promise((resolve, reject) => {
  const probe = createServer();
  probe.once('error', reject);
  probe.listen(0, '127.0.0.1', () => {
    const port = probe.address().port;
    probe.close(() => resolve(port));
  });
});
let retiredHits = 0;
const retiredServer = createServer((req, res) => {
  retiredHits += 1;
  res.writeHead(410, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ ok: false, message: 'retired Node retrieval boundary' }));
});
await new Promise((resolve) => retiredServer.listen(retiredPort, '127.0.0.1', resolve));

const app = spawn(process.execPath, ['server/index.mjs'], {
  env: {
    ...process.env,
    YUYOUZHICE_MEMORY: '1',
    YUYOUZHICE_JAVA_TEST_STUB: '1',
    PORT: String(appPort),
    YUYOUZHICE_RETRIEVAL_URL: `http://127.0.0.1:${retiredPort}/retrieve`
  },
  stdio: ['ignore', 'pipe', 'pipe']
});
let appOutput = '';
app.stdout.on('data', (chunk) => { appOutput += chunk.toString(); });
app.stderr.on('data', (chunk) => { appOutput += chunk.toString(); });
const base = `http://127.0.0.1:${appPort}`;
try {
  let ready = false;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      if ((await fetch(`${base}/api/health`)).ok) {
        ready = true;
        break;
      }
    } catch { /* 服务尚未监听 */ }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  if (!ready) throw new Error(`应用未启动：${appOutput}`);
  const response = await fetch(`${base}/api/plan`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: '重庆两天旅行，少走路。' })
  });
  const plan = await response.json();
  const stops = plan.trip?.days?.flatMap((day) => day.stops) || [];
  const retrieval = plan.trip?.retrieval;
  if (!response.ok || !retrieval?.verified || !String(retrieval.mode).startsWith('Java')) {
    throw new Error(`Java RAG 未挂载到 TripPlan：${JSON.stringify({ status: response.status, retrieval, appOutput })}`);
  }
  if (!stops.some((stop) => stop.facts?.some((item) => item.label === 'Java RAG 测试事实'))
      || !plan.trip.citations?.some((item) => item.publisher === 'Java Core Backend')) {
    throw new Error('Java RAG Facts/Citations 没有挂载到 TripPlan');
  }
  if (retiredHits !== 0) throw new Error(`Node 仍请求已废弃 Retrieval URL：${retiredHits}`);
  console.log(JSON.stringify({ ok: true, mode: retrieval.mode, javaProvider: retrieval.provider, retiredHits, citations: retrieval.citations.length }, null, 2));
} finally {
  app.kill();
  retiredServer.close();
}
