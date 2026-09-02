/**
 * retrieval-readiness-check.mjs
 *
 * Verify that the Web BFF reports Java as the sole retrieval authority and
 * does not claim Node-owned Embedding/Qdrant readiness.
 */

import { createServer } from 'node:http';
import { spawn } from 'node:child_process';

const port = await new Promise((resolve, reject) => {
  const probe = createServer();
  probe.once('error', reject);
  probe.listen(0, '127.0.0.1', () => {
    const selectedPort = probe.address().port;
    probe.close(() => resolve(selectedPort));
  });
});

const server = spawn(process.execPath, ['server/index.mjs'], {
  env: {
    ...process.env,
    PORT: String(port),
    YUYOUZHICE_MEMORY: '1',
    YUYOUZHICE_JAVA_TEST_STUB: '1',
    YUYOUZHICE_RETRIEVAL_URL: '',
    YUYOUZHICE_VECTOR_STORE_URL: ''
  },
  stdio: ['ignore', 'pipe', 'pipe']
});
const base = `http://127.0.0.1:${port}`;
try {
  let status;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`${base}/api/retrieval/status`);
      if (response.ok) {
        status = await response.json();
        break;
      }
    } catch { /* 服务尚未监听 */ }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  if (!status?.retrieval) throw new Error('检索状态接口未返回 retrieval 状态');
  const retrieval = status.retrieval;
  if (retrieval.provider !== 'Java Core Backend' || retrieval.owner !== 'Java') throw new Error('检索 authority 未声明为 Java Core Backend');
  if (retrieval.directEmbedding !== false || retrieval.directQdrant !== false) throw new Error('Node direct Embedding/Qdrant 标志不正确');
  if (retrieval.embedding?.directFromNode !== false || retrieval.vectorStore?.directFromNode !== false) throw new Error('Node 仍被标记为 Embedding/Qdrant 业务 owner');
  if (!retrieval.vectorStore?.configured) throw new Error('Java-managed vector store 未标记为 configured');
  if (!retrieval.contract?.request || !retrieval.contract?.response || !retrieval.contract?.verified) throw new Error('Java RAG 检索契约信息缺失');
  console.log(JSON.stringify({ ok: true, retrievalMode: retrieval.mode, provider: retrieval.provider, vectorStore: retrieval.vectorStore, fallbackOwner: retrieval.fallbackOwner }, null, 2));
} finally {
  server.kill();
}
