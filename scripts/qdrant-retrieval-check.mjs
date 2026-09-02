/**
 * qdrant-retrieval-check.mjs
 *
 * Boundary check: Node may receive legacy-looking Embedding/Qdrant settings,
 * but all runtime retrieval is delegated to the Java RAG test boundary.
 */

import { createServer } from 'node:http';
import { spawn } from 'node:child_process';

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

const embeddingPort = await freePort();
const qdrantPort = await freePort();
let embeddingHits = 0;
let qdrantHits = 0;
const embeddingServer = createServer((req, res) => {
  embeddingHits += 1;
  res.writeHead(410);
  res.end();
});
const qdrantServer = createServer((req, res) => {
  qdrantHits += 1;
  res.writeHead(410);
  res.end();
});
await new Promise((resolve) => embeddingServer.listen(embeddingPort, '127.0.0.1', resolve));
await new Promise((resolve) => qdrantServer.listen(qdrantPort, '127.0.0.1', resolve));

const appPort = await freePort();
const app = spawn(process.execPath, ['server/index.mjs'], {
  env: {
    ...process.env,
    YUYOUZHICE_MEMORY: '1',
    YUYOUZHICE_JAVA_TEST_STUB: '1',
    PORT: String(appPort),
    YUYOUZHICE_RETRIEVAL_URL: '',
    YUYOUZHICE_EMBEDDING_PROVIDER: 'dashscope',
    YUYOUZHICE_EMBEDDING_URL: `http://127.0.0.1:${embeddingPort}/embeddings`,
    YUYOUZHICE_EMBEDDING_MODEL: 'stub-embedding-v1',
    YUYOUZHICE_EMBEDDING_DIMENSION: '3',
    YUYOUZHICE_QDRANT_URL: `http://127.0.0.1:${qdrantPort}`,
    YUYOUZHICE_VECTOR_STORE_COLLECTION: 'yuyouzhice_test'
  },
  stdio: ['ignore', 'pipe', 'pipe']
});
let output = '';
app.stdout.on('data', (chunk) => { output += chunk.toString(); });
app.stderr.on('data', (chunk) => { output += chunk.toString(); });
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
  if (!ready) throw new Error(`应用未启动：${output}`);
  const response = await fetch(`${base}/api/plan`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: '带老人去重庆，少走路，想了解洪崖洞。' })
  });
  const plan = await response.json();
  const retrieval = plan.trip?.retrieval;
  const stops = plan.trip?.days?.flatMap((day) => day.stops) || [];
  if (!response.ok || retrieval?.mode !== 'Java Qdrant 语义检索' || !retrieval?.vectorSearch
      || !retrieval.verified || !retrieval.citations?.length
      || !stops.some((stop) => stop.facts?.some((fact) => fact.label === 'Java RAG 测试事实'))) {
    throw new Error(`Java 语义检索结果不完整：${JSON.stringify({ status: response.status, retrieval, stops, output })}`);
  }
  if (embeddingHits !== 0 || qdrantHits !== 0) {
    throw new Error(`Node 直接请求了 Embedding/Qdrant：embedding=${embeddingHits}, qdrant=${qdrantHits}`);
  }
  console.log(JSON.stringify({ ok: true, mode: retrieval.mode, embeddingHits, qdrantHits, resultCount: retrieval.vectorSearch.resultCount, citations: retrieval.citations.length }, null, 2));
} finally {
  app.kill();
  embeddingServer.close();
  qdrantServer.close();
}
