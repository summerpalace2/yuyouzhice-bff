/**
 * knowledge-corpus-check.mjs
 *
 * Validate the checked-in corpus/import artifacts while proving runtime local
 * knowledge retrieval is owned by Java rather than the Node JSONL adapter.
 */

import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const knowledgeDir = path.join(projectRoot, 'data', 'knowledge');
const corpusPath = path.join(knowledgeDir, 'yuyouzhice-knowledge-corpus.jsonl');
const sourcePath = path.join(knowledgeDir, 'yuyouzhice-source-register.json');
const manifestPath = path.join(knowledgeDir, 'yuyouzhice-embedding-manifest.json');
const lines = readFileSync(corpusPath, 'utf8').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
const documents = lines.map((line, index) => {
  try { return JSON.parse(line); } catch (error) { throw new Error(`JSONL 第 ${index + 1} 行解析失败：${error.message}`); }
});
const sources = JSON.parse(readFileSync(sourcePath, 'utf8'));
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const docIds = new Set(documents.map((item) => item.docId));
const sourceIds = new Set(sources.map((item) => item.sourceId));
const topicsByEntity = new Map();
const contentLength = (value) => Array.from(String(value || '')).length;
for (const document of documents) {
  if (!document.docId || !document.entityId || !document.entityName || !document.content || !Array.isArray(document.sourceIds) || !document.sourceIds.length) throw new Error(`文档字段不完整：${document.docId || '(无 docId)'}`);
  const length = contentLength(document.content);
  if (length < 100 || length > 800) throw new Error(`content 长度必须为 100-800 字：${document.docId}，实际=${length}`);
  if (!Array.isArray(document.claims) || document.claims.length === 0) throw new Error(`文档缺少 claims：${document.docId}`);
  if (document.sourceIds.some((sourceId) => !sourceIds.has(sourceId))) throw new Error(`文档引用了不存在的 sourceId：${document.docId}`);
  const hasDynamicContent = document.dataType === 'dynamic' || (Array.isArray(document.claims) && document.claims.some((claim) => claim.status === 'dynamic'));
  if (hasDynamicContent) {
    const freshness = document.freshness;
    if (!freshness || !/^\d{4}-\d{2}-\d{2}$/.test(String(freshness.checkedAt || '')) || !/^\d{4}-\d{2}-\d{2}$/.test(String(freshness.expiresAt || ''))) throw new Error(`动态文档缺少 freshness.checkedAt/expiresAt：${document.docId}`);
    if (String(freshness.expiresAt) < String(freshness.checkedAt)) throw new Error(`动态文档 freshness 过期顺序非法：${document.docId}`);
  }
  const topics = topicsByEntity.get(document.entityId) || new Set();
  topics.add(document.dataType);
  topicsByEntity.set(document.entityId, topics);
  for (const claim of document.claims) if (!['verified', 'dynamic', 'unknown', 'needs_review'].includes(claim.status)) throw new Error(`claim 状态非法：${document.docId}`);
}
if (docIds.size !== documents.length) throw new Error('docId 存在重复');
if (new Set(sources.map((item) => item.sourceId)).size !== sources.length) throw new Error('sourceId 存在重复');
if (sources.some((source) => !/^https?:\/\//.test(String(source.url || '')))) throw new Error('来源存在不完整 URL');
if (manifest.documentCount !== documents.length) throw new Error(`manifest documentCount=${manifest.documentCount}，实际=${documents.length}`);
const pendingManifest = ['not_generated', 'pending'].includes(manifest.embeddingStatus) && manifest.vectorStoreStatus === 'not_imported' && manifest.dimension === null && !manifest.vectorStore;
const importedManifest = manifest.embeddingStatus === 'generated' && manifest.vectorStoreStatus === 'imported' && manifest.dimension === 1536 && manifest.vectorStore?.pointCount === documents.length && manifest.vectorStore?.verificationStatus === 'verified';
if (!pendingManifest && !importedManifest) throw new Error('manifest 状态必须是诚实的 not_generated/not_imported，或包含真实回读证据的 generated/imported');

const port = await new Promise((resolve, reject) => {
  const probe = createServer();
  probe.once('error', reject);
  probe.listen(0, '127.0.0.1', () => {
    const value = probe.address().port;
    probe.close(() => resolve(value));
  });
});
const app = spawn(process.execPath, ['server/index.mjs'], {
  cwd: projectRoot,
  env: { ...process.env, PORT: String(port), JWT_SECRET: 'J'.repeat(64), YUYOUZHICE_AUTH_SECRET: 'A'.repeat(64), CORE_BACKEND_URL: `http://127.0.0.1:${port + 1}`, YUYOUZHICE_MEMORY: '1', YUYOUZHICE_JAVA_TEST_STUB: '1', YUYOUZHICE_RETRIEVAL_URL: '' },
  stdio: ['ignore', 'pipe', 'pipe']
});
let output = '';
app.stdout.on('data', (chunk) => { output += chunk.toString(); });
app.stderr.on('data', (chunk) => { output += chunk.toString(); });
const base = `http://127.0.0.1:${port}`;
try {
  let status;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`${base}/api/retrieval/status`);
      if (response.ok) { status = await response.json(); break; }
    } catch { /* 服务尚未监听 */ }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const retrievalStatus = status?.retrieval;
  if (retrievalStatus?.provider !== 'Java Core Backend' || retrievalStatus?.directEmbedding !== false || retrievalStatus?.directQdrant !== false) {
    throw new Error(`运行时知识入口仍不是 Java：${JSON.stringify(retrievalStatus)}`);
  }
  const planResponse = await fetch(`${base}/api/plan`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: '重庆两天旅行，带父母，少走路，想看洪崖洞和博物馆。' })
  });
  const plan = await planResponse.json();
  const retrieval = plan.trip?.retrieval;
  if (!planResponse.ok || !String(retrieval?.mode || '').startsWith('Java') || !retrieval.verified || !plan.trip.citations?.length) {
    throw new Error(`TripPlan 未挂载 Java 知识检索结果：${JSON.stringify({ retrieval, output })}`);
  }
  console.log(JSON.stringify({ ok: true, artifactDocuments: documents.length, artifactSources: sources.length, retrievalMode: retrieval.mode, provider: retrieval.provider, directEmbedding: retrieval.directEmbedding, directQdrant: retrieval.directQdrant, citations: plan.trip.citations.length }, null, 2));
} finally {
  app.kill();
}
