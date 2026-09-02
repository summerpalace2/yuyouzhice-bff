/**
 * knowledge-import-check.mjs
 *
 * 核心职责：使用本地 Embedding/Qdrant stub 验证真实导入流程，避免依赖用户生产凭证。
 */

import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function listen(server) {
  return new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => resolve(server.address().port)); });
}

const tempDir = await mkdtemp(path.join(os.tmpdir(), 'yuyouzhice-import-'));
const embeddingServer = createServer(async (req, res) => {
  if (req.method !== 'POST' || req.url !== '/embeddings') { res.writeHead(404); return res.end(); }
  let raw = ''; for await (const chunk of req) raw += chunk;
  const input = JSON.parse(raw).input || [];
  const texts = Array.isArray(input) ? input : Array.isArray(input.texts) ? input.texts : [];
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ data: texts.map((_, index) => ({ index, embedding: [1, index + 1, 0.5] })) }));
});
let pointCount = 0;
const storedPoints = [];
const qdrantServer = createServer(async (req, res) => {
  if (req.method === 'PUT' && /^\/collections\/[^/]+$/.test(req.url)) { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ result: true, status: 'ok' })); }
  if (req.method === 'GET' && /^\/collections\/[^/]+$/.test(req.url)) { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ result: { points_count: pointCount, config: { params: { vectors: { size: 3, distance: 'Cosine' } } } } })); }
  if (req.method === 'PUT' && /^\/collections\/[^/]+\/points\?wait=true$/.test(req.url)) { let raw = ''; for await (const chunk of req) raw += chunk; const points = JSON.parse(raw).points || []; if (!points.length || points.some((point) => !/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(point.id))) { res.writeHead(400); return res.end(JSON.stringify({ message: 'invalid points' })); } pointCount += points.length; storedPoints.push(...points); res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ result: { status: 'completed' }, status: 'ok' })); }
  if (req.method === 'POST' && /^\/collections\/[^/]+\/points\/scroll$/.test(req.url)) { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ result: { points: storedPoints.slice(0, 20).map((point) => ({ id: point.id, vector: point.vector, payload: { docId: point.payload.docId, content: point.payload.content } })) } })); }
  res.writeHead(404); res.end();
});
const embeddingPort = await listen(embeddingServer);
const qdrantPort = await listen(qdrantServer);
const manifestPath = path.join(tempDir, 'manifest.json');
const baselineManifest = JSON.parse(await readFile(path.join(projectRoot, 'data', 'knowledge', 'yuyouzhice-embedding-manifest.json'), 'utf8'));
baselineManifest.embeddingStatus = 'not_generated';
baselineManifest.vectorStoreStatus = 'not_imported';
baselineManifest.embeddingModel = '';
baselineManifest.dimension = null;
delete baselineManifest.vectorStore;
delete baselineManifest.updatedAt;
await writeFile(manifestPath, `${JSON.stringify(baselineManifest, null, 2)}\n`);
const app = spawn(process.execPath, ['scripts/knowledge-import.mjs', '--run', '--rebuild'], { cwd: projectRoot, env: { ...process.env, YUYOUZHICE_EMBEDDING_URL: `http://127.0.0.1:${embeddingPort}/embeddings`, YUYOUZHICE_EMBEDDING_API_KEY: 'fixture-embedding-key', YUYOUZHICE_EMBEDDING_MODEL: 'stub-embedding-v1', YUYOUZHICE_EMBEDDING_DIMENSION: '3', QDRANT_URL: '', QDRANT_API_KEY: '', QDRANT_COLLECTION: '', YUYOUZHICE_QDRANT_URL: `http://127.0.0.1:${qdrantPort}`, YUYOUZHICE_VECTOR_STORE_COLLECTION: 'yuyouzhice_test', YUYOUZHICE_EMBEDDING_MANIFEST_FILE: manifestPath }, stdio: ['ignore', 'pipe', 'pipe'] });
let stdout = ''; let stderr = '';
app.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
app.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
const exitCode = await new Promise((resolve) => app.once('close', resolve));
try {
  if (exitCode !== 0) throw new Error(`导入脚本失败：${stderr || stdout}`);
  const result = JSON.parse(stdout);
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (!result.ok || result.importedDocuments !== baselineManifest.documentCount || result.dimension !== 3 || manifest.embeddingStatus !== 'generated' || manifest.vectorStoreStatus !== 'imported' || manifest.dimension !== 3 || manifest.documentCount !== baselineManifest.documentCount) throw new Error(`导入结果不完整：${JSON.stringify({ result, manifest })}`);
  console.log(JSON.stringify({ ok: true, importedDocuments: result.importedDocuments, dimension: result.dimension, embeddingStatus: manifest.embeddingStatus, vectorStoreStatus: manifest.vectorStoreStatus }, null, 2));
} finally { embeddingServer.close(); qdrantServer.close(); await rm(tempDir, { recursive: true, force: true }); }
