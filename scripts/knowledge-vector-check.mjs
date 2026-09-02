/**
 * knowledge-vector-check.mjs
 *
 * Read-only deep verification for an already-imported Production V2 collection.
 * It deliberately stays outside knowledge-import.mjs so corpus governance and
 * payload-quality checks do not become part of the import lifecycle.
 */

import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const knowledgeDir = path.join(projectRoot, 'data', 'knowledge');
const canonicalEnvFile = 'D:/scenic-guide/ai/.env';
const corpusFile = String(process.env.YUYOUZHICE_CORPUS_FILE || path.join(knowledgeDir, 'yuyouzhice-knowledge-corpus.jsonl')).trim();
const sourceFile = String(process.env.YUYOUZHICE_SOURCE_REGISTER_FILE || path.join(knowledgeDir, 'yuyouzhice-source-register.json')).trim();
const manifestFile = String(process.env.YUYOUZHICE_EMBEDDING_MANIFEST_FILE || path.join(knowledgeDir, 'yuyouzhice-embedding-manifest.json')).trim();

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

loadDotEnv(canonicalEnvFile);

function firstEnv(...names) {
  for (const name of names) {
    const value = String(process.env[name] || '').trim();
    if (value) return value;
  }
  return '';
}

function qdrantUrl() {
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

const QDRANT_URL = qdrantUrl();
const QDRANT_API_KEY = firstEnv('QDRANT_API_KEY', 'YUYOUZHICE_QDRANT_API_KEY');
const COLLECTION = String(
  process.env.QDRANT_COLLECTION
    || process.env.YUYOUZHICE_VECTOR_STORE_COLLECTION
    || process.env.QDRANT_PRODUCTION_V2_COLLECTION
    || 'scenic_guide_production_v2'
).trim();
const expectedDimension = Number(firstEnv('YUYOUZHICE_EMBEDDING_DIMENSION', 'DASHSCOPE_EMBEDDING_DIMENSION') || 1536);
const timeoutMs = Math.max(1000, Number(process.env.YUYOUZHICE_IMPORT_TIMEOUT_MS || 30000));

function headers() {
  return {
    'content-type': 'application/json',
    accept: 'application/json',
    ...(QDRANT_API_KEY ? { 'api-key': QDRANT_API_KEY } : {})
  };
}

async function requestJson(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const raw = await response.text();
    let data;
    try { data = raw ? JSON.parse(raw) : {}; } catch { data = {}; }
    if (!response.ok) throw new Error(`${response.status} Qdrant request failed`);
    return data;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('Qdrant request timed out');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function readCorpus(raw) {
  return raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line, index) => {
    try { return JSON.parse(line); } catch (error) { throw new Error(`JSONL line ${index + 1} is invalid: ${error.message}`); }
  });
}

function validIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === String(value);
}

function vectorConfig(collection) {
  const vectors = collection?.config?.params?.vectors;
  if (!vectors || Array.isArray(vectors) || typeof vectors !== 'object' || !Number.isFinite(Number(vectors.size))) return null;
  return vectors;
}

function verifySample(points, documents, sources, dimension) {
  const required = Math.min(20, documents.length);
  if (points.length < required) throw new Error(`sample contains ${points.length} points; expected at least ${required}`);
  const docsById = new Map(documents.map((document) => [String(document.docId), document]));
  const sourceIds = new Set(sources.map((source) => String(source.sourceId)));
  const seenDocIds = new Set();
  const seenPointIds = new Set();

  for (const point of points.slice(0, required)) {
    const pointId = String(point?.id || '');
    const payload = point?.payload || {};
    const docId = String(payload.docId || '');
    const document = docsById.get(docId);
    if (!pointId || seenPointIds.has(pointId)) throw new Error('sample contains duplicate or empty point IDs');
    if (!docId || seenDocIds.has(docId) || !document) throw new Error(`sample contains invalid or duplicate docId: ${docId || '(empty)'}`);
    if (payload.activation_namespace !== 'production-v2' || payload.rag_eligible !== true) throw new Error(`Java activation payload is invalid: ${docId}`);
    if (String(payload.entityId || '') !== String(document.entityId) || String(payload.entityName || '') !== String(document.entityName)) throw new Error(`entity relation mismatch: ${docId}`);
    if (!String(payload.content || '').trim()) throw new Error(`content is empty: ${docId}`);
    if (!Array.isArray(payload.sourceIds) || !payload.sourceIds.length || payload.sourceIds.some((sourceId) => !sourceIds.has(String(sourceId)))) throw new Error(`source reference is not closed: ${docId}`);

    const freshness = payload.freshness || {};
    const requiresFreshness = document.dataType === 'dynamic' || (document.claims || []).some((claim) => claim.status === 'dynamic');
    if (requiresFreshness && (!validIsoDate(freshness.checkedAt) || !validIsoDate(freshness.expiresAt))) throw new Error(`freshness is missing or invalid: ${docId}`);
    if (freshness.checkedAt || freshness.expiresAt) {
      if (!validIsoDate(freshness.checkedAt) || !validIsoDate(freshness.expiresAt) || freshness.expiresAt < freshness.checkedAt) throw new Error(`freshness date range is invalid: ${docId}`);
    }

    const vector = point?.vector;
    if (!Array.isArray(vector) || vector.length !== dimension || vector.some((value) => !Number.isFinite(Number(value)))) throw new Error(`vector dimension/value is invalid: ${docId}`);
    const norm = Math.sqrt(vector.reduce((sum, value) => sum + Number(value) ** 2, 0));
    if (!Number.isFinite(norm) || norm === 0) throw new Error(`vector norm is invalid: ${docId}`);
    seenPointIds.add(pointId);
    seenDocIds.add(docId);
  }
  return { sampledPointCount: required, uniqueDocumentIds: seenDocIds.size, verified: true };
}

async function main() {
  if (!QDRANT_URL) throw new Error('Qdrant configuration is missing');
  const corpusRaw = await readFile(corpusFile, 'utf8');
  const documents = readCorpus(corpusRaw);
  const collectionData = await requestJson(`${QDRANT_URL}/collections/${encodeURIComponent(COLLECTION)}`, { headers: headers() });
  const collection = collectionData.result || collectionData;
  const vectors = vectorConfig(collection);
  if (!vectors) throw new Error('collection vector schema is not a single unnamed vector');
  if (Number(vectors.size) !== expectedDimension) throw new Error(`collection dimension ${vectors.size} != expected ${expectedDimension}`);
  if (String(vectors.distance || '').toLowerCase() !== 'cosine') throw new Error('collection distance is not Cosine');
  const pointCount = Number(collection.points_count ?? collection.vectors_count ?? 0);

  const scrollData = await requestJson(`${QDRANT_URL}/collections/${encodeURIComponent(COLLECTION)}/points/scroll`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ limit: Math.min(20, documents.length), with_payload: true, with_vector: !process.argv.includes('--inspect') })
  });
  const points = scrollData?.result?.points || scrollData?.points || [];
  if (process.argv.includes('--inspect')) {
    console.log(JSON.stringify({
      ok: true,
      mode: 'inspect',
      collection: COLLECTION,
      pointCount,
      vectorDimension: Number(vectors.size),
      distanceMetric: vectors.distance,
      samplePayloads: points.slice(0, 3).map((point) => ({
        pointIdPresent: Boolean(point?.id),
        payloadKeys: Object.keys(point?.payload || {}).sort(),
        docIdPresent: Boolean(point?.payload?.docId),
        contentPresent: Boolean(String(point?.payload?.content || '').trim())
      }))
    }, null, 2));
    return;
  }

  const [sources, manifest] = await Promise.all([
    readFile(sourceFile, 'utf8').then(JSON.parse),
    readFile(manifestFile, 'utf8').then(JSON.parse)
  ]);
  if (manifest.vectorStoreStatus !== 'imported' || manifest.embeddingStatus !== 'generated') throw new Error('manifest does not claim a completed import');
  if (manifest.documentCount !== documents.length || pointCount < documents.length) throw new Error('manifest, corpus, and Qdrant point count disagree');
  const sample = verifySample(points, documents, sources, Number(vectors.size));
  console.log(JSON.stringify({
    ok: true,
    collection: COLLECTION,
    pointCount,
    vectorDimension: Number(vectors.size),
    distanceMetric: vectors.distance,
    sample,
    sourceReferenceCheck: 'verified',
    freshnessCheck: 'verified',
    entityRelationCheck: 'verified',
    activationPayloadCheck: 'verified'
  }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
  process.exitCode = 1;
});
