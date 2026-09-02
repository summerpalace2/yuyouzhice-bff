/**
 * knowledge-import.mjs
 *
 * Import the checked-in knowledge corpus with real Embedding vectors into Qdrant.
 * Corpus/source/freshness rules belong to knowledge-corpus-check.mjs; this file
 * owns only the external import lifecycle and minimal read-back verification.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const KNOWLEDGE_DIR = path.join(PROJECT_ROOT, 'data', 'knowledge');
const CANONICAL_ENV_FILE = 'D:/scenic-guide/ai/.env';

function loadDotEnv(filePath) {
  let raw;
  try {
    raw = readFileSync(filePath, 'utf8');
  } catch {
    return false;
  }
  for (const sourceLine of raw.split(/\r?\n/)) {
    const line = sourceLine.replace(/^\uFEFF/, '').trim();
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match || process.env[match[1]] !== undefined) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/, '').trim();
    }
    process.env[match[1]] = value;
  }
  return true;
}

const envFileLoaded = loadDotEnv(CANONICAL_ENV_FILE);

function firstEnv(...names) {
  for (const name of names) {
    const value = String(process.env[name] || '').trim();
    if (value) return value;
  }
  return '';
}

function normalizeQdrantUrl() {
  // QDRANT_URL is the developer-facing REST name; old prefixed names remain
  // fallback aliases only. QDRANT_PORT=6334 is Java gRPC, so REST uses 6333.
  const explicit = firstEnv('QDRANT_URL', 'YUYOUZHICE_QDRANT_URL');
  if (explicit) return explicit.replace(/\/$/, '');
  const host = firstEnv('QDRANT_HOST');
  if (!host) return '';
  if (/^https?:\/\//i.test(host)) return host.replace(/\/$/, '');
  const configuredPort = firstEnv('QDRANT_PORT') || '6333';
  const restPort = configuredPort === '6334' ? '6333' : configuredPort;
  const isQdrantCloud = /\.qdrant\.io$/i.test(host);
  const scheme = isQdrantCloud
    ? 'https'
    : (firstEnv('QDRANT_SCHEME', 'QDRANT_PROTOCOL', 'YUYOUZHICE_QDRANT_SCHEME') || 'http');
  return `${scheme}://${host}:${restPort}`;
}

const CORPUS_FILE = String(
  process.env.YUYOUZHICE_CORPUS_FILE || path.join(KNOWLEDGE_DIR, 'yuyouzhice-knowledge-corpus.jsonl')
).trim();
const MANIFEST_FILE = String(
  process.env.YUYOUZHICE_EMBEDDING_MANIFEST_FILE || path.join(KNOWLEDGE_DIR, 'yuyouzhice-embedding-manifest.json')
).trim();
const EMBEDDING_PROVIDER = firstEnv('YUYOUZHICE_EMBEDDING_PROVIDER')
  || (firstEnv('DASHSCOPE_API_KEY', 'BAILIAN_API_KEY') ? 'dashscope' : 'openai-compatible');
const IS_DASHSCOPE = EMBEDDING_PROVIDER.toLowerCase() === 'dashscope'
  || firstEnv('YUYOUZHICE_EMBEDDING_URL', 'DASHSCOPE_EMBEDDING_URL').includes('dashscope.aliyuncs.com');
const EMBEDDING_URL = firstEnv('YUYOUZHICE_EMBEDDING_URL', 'DASHSCOPE_EMBEDDING_URL')
  || (IS_DASHSCOPE
    ? 'https://dashscope.aliyuncs.com/api/v1/services/embeddings/text-embedding/text-embedding'
    : '');
const EMBEDDING_API_KEY = firstEnv(
  'YUYOUZHICE_EMBEDDING_API_KEY',
  'DASHSCOPE_API_KEY',
  'BAILIAN_API_KEY',
  'OPENAI_API_KEY'
);
const EMBEDDING_MODEL = firstEnv(
  'YUYOUZHICE_EMBEDDING_MODEL',
  'DASHSCOPE_EMBEDDING_MODEL',
  'BAILIAN_EMBEDDING_MODEL',
  'OPENAI_EMBEDDING_MODEL'
) || (IS_DASHSCOPE ? 'text-embedding-v2' : '');
const configuredDimension = Number(firstEnv('YUYOUZHICE_EMBEDDING_DIMENSION', 'DASHSCOPE_EMBEDDING_DIMENSION'));
const EMBEDDING_DIMENSION = Number.isFinite(configuredDimension) && configuredDimension > 0
  ? configuredDimension
  : (IS_DASHSCOPE ? 1536 : 0);
const configuredBatchSize = Number(process.env.YUYOUZHICE_EMBEDDING_BATCH_SIZE || (IS_DASHSCOPE ? 10 : 32));
const EMBEDDING_BATCH_SIZE = Number.isFinite(configuredBatchSize)
  ? Math.max(1, Math.min(128, configuredBatchSize))
  : 10;
const configuredTimeout = Number(process.env.YUYOUZHICE_IMPORT_TIMEOUT_MS || 30000);
const IMPORT_TIMEOUT_MS = Number.isFinite(configuredTimeout) ? Math.max(1000, configuredTimeout) : 30000;
const QDRANT_URL = normalizeQdrantUrl();
const QDRANT_API_KEY = firstEnv('QDRANT_API_KEY', 'YUYOUZHICE_QDRANT_API_KEY');
const COLLECTION = String(
  process.env.QDRANT_COLLECTION
    || process.env.YUYOUZHICE_VECTOR_STORE_COLLECTION
    || process.env.QDRANT_PRODUCTION_V2_COLLECTION
    || 'scenic_guide_production_v2'
).trim();

function parseArgs(argv) {
  return { run: argv.includes('--run'), rebuild: argv.includes('--rebuild') };
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function readCorpus() {
  const raw = await readFile(CORPUS_FILE, 'utf8');
  return raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      throw new Error(`JSONL 第 ${index + 1} 行无法解析：${error.message}`);
    }
  });
}

function validateImportInputs(documents, manifest, { allowImported = false } = {}) {
  if (!documents.length) throw new Error('知识语料为空');
  if (documents.some((document) => !document?.docId)) throw new Error('知识语料存在缺少 docId 的文档');
  if (manifest.documentCount !== documents.length) {
    throw new Error(`manifest 文档数 ${manifest.documentCount} 与 JSONL 实际数量 ${documents.length} 不一致`);
  }
  const pendingEmbedding = ['not_generated', 'pending'].includes(manifest.embeddingStatus);
  if (!allowImported && (!pendingEmbedding || manifest.vectorStoreStatus !== 'not_imported')) {
    throw new Error('输入 manifest 已不是待导入状态，请先确认是否要重新导入');
  }
}

function stablePointId(docId) {
  const hex = createHash('sha256').update(String(docId)).digest('hex').slice(0, 32).split('');
  hex[12] = '5';
  hex[16] = ['8', '9', 'a', 'b'][parseInt(hex[16], 16) % 4];
  const value = hex.join('');
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

function embeddingText(document) {
  return [
    document.entityName,
    document.title,
    document.content,
    Array.isArray(document.keywords) ? document.keywords.join('、') : '',
    document.dataType,
    document.district,
    document.city
  ].filter(Boolean).join('\n');
}

function headers(apiKey = '', authMode = 'bearer') {
  const authorization = apiKey
    ? (authMode === 'qdrant' ? { 'api-key': apiKey } : { authorization: `Bearer ${apiKey}` })
    : {};
  return { 'content-type': 'application/json', accept: 'application/json', ...authorization };
}

async function requestJson(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), IMPORT_TIMEOUT_MS);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const raw = await response.text();
    let data;
    try {
      data = raw ? JSON.parse(raw) : {};
    } catch {
      data = { raw };
    }
    if (!response.ok) {
      throw new Error(`${response.status} ${data?.error?.message || data?.message || raw.slice(0, 240)}`.trim());
    }
    return data;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error(`请求超时：${url}`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function extractEmbeddings(data, expectedCount) {
  const values = Array.isArray(data?.data)
    ? data.data.slice().sort((left, right) => Number(left.index || 0) - Number(right.index || 0)).map((item) => item.embedding)
    : Array.isArray(data?.embeddings)
      ? data.embeddings
      : Array.isArray(data?.output?.embeddings)
        ? data.output.embeddings.slice().sort((left, right) => Number(left.text_index || 0) - Number(right.text_index || 0)).map((item) => item.embedding)
        : [];
  if (values.length !== expectedCount || values.some((value) => !Array.isArray(value) || !value.length || value.some((number) => !Number.isFinite(number)))) {
    throw new Error(`Embedding 响应数量或向量格式不正确，期望 ${expectedCount} 条，实际 ${values.length} 条`);
  }
  const dimension = values[0].length;
  if (values.some((value) => value.length !== dimension)) throw new Error('Embedding 向量维度不一致');
  if (EMBEDDING_DIMENSION && dimension !== EMBEDDING_DIMENSION) {
    throw new Error(`Embedding 维度不符合 canonical 配置：期望 ${EMBEDDING_DIMENSION}，实际 ${dimension}`);
  }
  return { values, dimension };
}

function embeddingRequestBody(texts) {
  if (IS_DASHSCOPE) {
    return {
      model: EMBEDDING_MODEL,
      input: { texts },
      ...(EMBEDDING_DIMENSION ? { parameters: { dimension: EMBEDDING_DIMENSION } } : {})
    };
  }
  return { model: EMBEDDING_MODEL, input: texts, encoding_format: 'float' };
}

async function inspectCollection() {
  const url = `${QDRANT_URL}/collections/${encodeURIComponent(COLLECTION)}`;
  try {
    const data = await requestJson(url, { method: 'GET', headers: headers(QDRANT_API_KEY, 'qdrant') });
    return data.result || data;
  } catch (error) {
    if (String(error.message).startsWith('404 ')) return null;
    throw error;
  }
}

function collectionPointCount(collection) {
  return Number(collection?.points_count ?? collection?.vectors_count ?? 0);
}

function collectionVectorConfig(collection) {
  const vectors = collection?.config?.params?.vectors;
  if (!vectors || Array.isArray(vectors) || typeof vectors !== 'object') return null;
  return Number.isFinite(Number(vectors.size)) ? vectors : null;
}

function validateCollectionContract(collection, dimension) {
  if (!collection) return;
  const vectors = collectionVectorConfig(collection);
  if (!vectors) throw new Error('Qdrant collection 向量 schema 无法证明为单一 unnamed vector');
  if (Number(vectors.size) !== dimension) {
    throw new Error(`Qdrant collection 维度不匹配：现有 ${vectors.size}，Embedding 为 ${dimension}`);
  }
  if (String(vectors.distance || '').toLowerCase() !== 'cosine') {
    throw new Error(`Qdrant collection distance 不匹配：现有 ${vectors.distance || '(missing)'}，要求 Cosine`);
  }
}

async function ensureCollection(existing, dimension) {
  if (existing) {
    validateCollectionContract(existing, dimension);
    return { collection: existing, created: false };
  }
  const url = `${QDRANT_URL}/collections/${encodeURIComponent(COLLECTION)}`;
  await requestJson(url, {
    method: 'PUT',
    headers: headers(QDRANT_API_KEY, 'qdrant'),
    body: JSON.stringify({ vectors: { size: dimension, distance: 'Cosine' } })
  });
  const collection = await inspectCollection();
  if (!collection) throw new Error('Qdrant collection 创建后无法回读');
  validateCollectionContract(collection, dimension);
  return { collection, created: true };
}

async function upsertPoints(points) {
  const url = `${QDRANT_URL}/collections/${encodeURIComponent(COLLECTION)}/points?wait=true`;
  return requestJson(url, {
    method: 'PUT',
    headers: headers(QDRANT_API_KEY, 'qdrant'),
    body: JSON.stringify({ points })
  });
}

async function sampleCollectionPoints(limit = 20) {
  const url = `${QDRANT_URL}/collections/${encodeURIComponent(COLLECTION)}/points/scroll`;
  const data = await requestJson(url, {
    method: 'POST',
    headers: headers(QDRANT_API_KEY, 'qdrant'),
    body: JSON.stringify({ limit, with_payload: true, with_vector: true })
  });
  return data?.result?.points || data?.points || [];
}

function verifyMinimalSample(points, documents, dimension) {
  const expectedSampleSize = Math.min(20, documents.length);
  if (points.length < expectedSampleSize) {
    throw new Error(`Qdrant 回读样本不足：期望至少 ${expectedSampleSize}，实际 ${points.length}`);
  }
  const documentIds = new Set(documents.map((document) => String(document.docId)));
  const seenDocumentIds = new Set();
  const seenPointIds = new Set();
  for (const point of points.slice(0, expectedSampleSize)) {
    const pointId = String(point?.id || '');
    const payload = point?.payload || {};
    const docId = String(payload.docId || '');
    const vector = point?.vector;
    if (!pointId || seenPointIds.has(pointId)) throw new Error('Qdrant 回读样本 point ID 重复或为空');
    if (!docId || !documentIds.has(docId) || seenDocumentIds.has(docId)) throw new Error(`Qdrant 回读样本 docId 无效：${docId || '(empty)'}`);
    if (!String(payload.content || '').trim()) throw new Error(`Qdrant 回读样本 content 为空：${docId}`);
    if (!Array.isArray(vector) || vector.length !== dimension || vector.some((value) => !Number.isFinite(Number(value)))) {
      throw new Error(`Qdrant 回读样本向量无效：${docId}`);
    }
    seenPointIds.add(pointId);
    seenDocumentIds.add(docId);
  }
  return { sampledPointCount: expectedSampleSize, uniqueDocumentIds: seenDocumentIds.size, verified: true };
}

async function updateManifest(patch) {
  const current = await readJson(MANIFEST_FILE);
  const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
  await mkdir(path.dirname(MANIFEST_FILE), { recursive: true });
  const tempFile = `${MANIFEST_FILE}.${process.pid}.tmp`;
  await writeFile(tempFile, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  await rename(tempFile, MANIFEST_FILE);
  return next;
}

export async function runImport({ run = false, rebuild = false } = {}) {
  const [documents, manifest] = await Promise.all([readCorpus(), readJson(MANIFEST_FILE)]);
  validateImportInputs(documents, manifest, { allowImported: !run || rebuild });
  const ready = {
    documents: documents.length,
    collection: COLLECTION,
    envFileLoaded,
    embeddingProvider: EMBEDDING_PROVIDER,
    embeddingUrlConfigured: Boolean(EMBEDDING_URL),
    embeddingApiKeyConfigured: Boolean(EMBEDDING_API_KEY),
    embeddingModelConfigured: Boolean(EMBEDDING_MODEL),
    qdrantConfigured: Boolean(QDRANT_URL)
  };
  if (!run) return { ok: true, mode: 'dry-run', ready, message: '未执行外部调用，也未写入 manifest。' };
  if (!EMBEDDING_API_KEY || !EMBEDDING_URL || !EMBEDDING_MODEL) throw new Error('BLOCKED_BY_EMBEDDING_CONFIG');
  if (!QDRANT_URL) throw new Error('缺少 Qdrant 配置：QDRANT_URL（兼容旧名 YUYOUZHICE_QDRANT_URL）');

  // Inspect first. Existing non-empty collections are never changed implicitly.
  const existingBeforeImport = await inspectCollection();
  if (existingBeforeImport) {
    validateCollectionContract(existingBeforeImport, EMBEDDING_DIMENSION);
    const existingPointCount = collectionPointCount(existingBeforeImport);
    if (existingPointCount > 0 && !rebuild) {
      throw new Error(`QDRANT_COLLECTION_NOT_EMPTY: ${existingPointCount} points already exist; rerun only with explicit --rebuild after review`);
    }
  }

  const vectors = [];
  let dimension = null;
  for (let offset = 0; offset < documents.length; offset += EMBEDDING_BATCH_SIZE) {
    const batch = documents.slice(offset, offset + EMBEDDING_BATCH_SIZE);
    const data = await requestJson(EMBEDDING_URL, {
      method: 'POST',
      headers: headers(EMBEDDING_API_KEY),
      body: JSON.stringify(embeddingRequestBody(batch.map(embeddingText)))
    });
    const result = extractEmbeddings(data, batch.length);
    dimension ??= result.dimension;
    if (dimension !== result.dimension) throw new Error(`Embedding 维度变化：之前 ${dimension}，当前 ${result.dimension}`);
    vectors.push(...result.values);
  }

  const collectionState = await ensureCollection(existingBeforeImport, dimension);
  for (let offset = 0; offset < documents.length; offset += EMBEDDING_BATCH_SIZE) {
    const points = documents.slice(offset, offset + EMBEDDING_BATCH_SIZE).map((document, index) => ({
      id: stablePointId(document.docId),
      vector: vectors[offset + index],
      payload: {
        docId: document.docId,
        entityId: document.entityId,
        entityName: document.entityName,
        title: document.title,
        content: document.content,
        keywords: document.keywords || [],
        topic: document.topic || document.dataType,
        dataType: document.dataType,
        confidence: document.confidence,
        reviewStatus: document.reviewStatus,
        sourceIds: document.sourceIds,
        validity: document.validity || {},
        freshness: document.freshness || {},
        activation_namespace: 'production-v2',
        rag_eligible: true
      }
    }));
    await upsertPoints(points);
  }

  const collection = await inspectCollection();
  validateCollectionContract(collection, dimension);
  const pointCount = collectionPointCount(collection);
  if (!Number.isFinite(pointCount) || pointCount < documents.length) {
    throw new Error(`Qdrant 回读点数不足：期望至少 ${documents.length}，实际 ${pointCount}`);
  }
  const sampleVerification = verifyMinimalSample(await sampleCollectionPoints(20), documents, dimension);
  const vectorConfig = collectionVectorConfig(collection);
  const nextManifest = await updateManifest({
    embeddingStatus: 'generated',
    vectorStoreStatus: 'imported',
    embeddingModel: EMBEDDING_MODEL,
    dimension,
    documentCount: documents.length,
    vectorStore: {
      provider: 'Qdrant',
      collection: COLLECTION,
      importedAt: new Date().toISOString(),
      pointIdStrategy: 'stable UUID from sha256(docId)',
      pointCount,
      vectorDimension: Number(vectorConfig?.size || dimension),
      distanceMetric: vectorConfig?.distance || 'Cosine',
      collectionCreated: collectionState.created,
      sampleVerification,
      verificationStatus: 'verified'
    }
  });
  return {
    ok: true,
    mode: 'run',
    ready,
    dimension,
    importedDocuments: documents.length,
    qdrant: {
      collection: COLLECTION,
      pointCount,
      vectorDimension: Number(vectorConfig?.size || dimension),
      distanceMetric: vectorConfig?.distance || 'Cosine',
      collectionCreated: collectionState.created,
      sampleVerification,
      verificationStatus: 'verified'
    },
    manifest: nextManifest
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const args = parseArgs(process.argv.slice(2));
  runImport(args)
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error) => {
      console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
      process.exitCode = 1;
    });
}
