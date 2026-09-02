/**
 * retrieval-benchmark.mjs
 *
 * Run the ten-query evidence benchmark against the isolated benchmark Qdrant
 * collection and the Java-owned SQLite kb_document fallback. This script is
 * deliberately read-only: it never writes Qdrant, the production manifest, or
 * the Java database.
 *
 * Qdrant uses a real DashScope query embedding for every query. SQLite ranking
 * mirrors KnowledgeDocumentService.searchLocalKnowledge so the comparison is
 * against the current Java fallback contract, not a Node knowledge adapter.
 */

import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CANONICAL_ENV_FILE = 'D:/scenic-guide/ai/.env';
const DEFAULT_COLLECTION = 'scenic_guide_benchmark_v1';
const JAVA_SQLITE_FILE = 'D:/scenic-guide/ai/data/knowledge.db';
const REQUEST_TIMEOUT_MS = Math.max(5_000, Number(process.env.RETRIEVAL_BENCHMARK_TIMEOUT_MS || 30_000));
const TOP_K = 5;

const QUERIES = [
  '洪崖洞晚上适合去吗？',
  '带父母去重庆有哪些少走路的景点？',
  '三峡博物馆有什么值得看？',
  '重庆三日游有哪些夜景地点？',
  '不想爬坡，在重庆适合去哪？',
  '情侣晚上去哪里拍照比较好？',
  '下雨天带孩子去重庆哪里比较合适？',
  '夏天怕热，想多安排室内景点，有哪些选择？',
  '我不喜欢特别商业化的景点，想看重庆历史文化，去哪比较好？',
  '想安排一个步行少、夜景好、又适合老人的晚上行程。'
];

// These are optional post-retrieval heuristics, not manual review labels or
// retrieval filters. They are applied identically to Qdrant and SQLite results.
const QUERY_SIGNALS = [
  { primary: ['洪崖洞'], secondary: ['晚上', '夜景', '夜游', '拍照', '适合'] },
  { primary: ['父母', '老人', '老年'], secondary: ['少走路', '步行少', '平缓', '无障碍', '轻松'] },
  { primary: ['三峡博物馆'], secondary: ['博物馆', '历史', '文物', '展览', '值得看'] },
  { primary: ['夜景', '夜游'], secondary: ['重庆三日游', '地点', '拍照', '江景', '灯光'] },
  { primary: ['不想爬坡', '少爬坡', '平缓'], secondary: ['室内', '博物馆', '少走路', '适合', '交通'] },
  { primary: ['情侣', '拍照'], secondary: ['晚上', '夜景', '浪漫', '江景', '夜游'] },
  { primary: ['下雨天', '下雨', '雨天'], secondary: ['带孩子', '孩子', '室内', '博物馆', '亲子'] },
  { primary: ['夏天', '怕热'], secondary: ['室内', '博物馆', '清凉', '避暑', '空调'] },
  { primary: ['历史文化', '历史', '文化'], secondary: ['不商业化', '非商业化', '古镇', '博物馆', '人文'] },
  { primary: ['步行少', '少走路', '老人', '适合老人'], secondary: ['夜景', '晚上', '夜游', '江景', '轻松'] }
];

function loadCanonicalEnv() {
  let raw;
  try { raw = readFileSync(CANONICAL_ENV_FILE, 'utf8'); } catch { return false; }
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

const envFileLoaded = loadCanonicalEnv();

function firstEnv(...names) {
  for (const name of names) {
    const value = String(process.env[name] || '').trim();
    if (value) return value;
  }
  return '';
}

function normalizeQdrantUrl() {
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

const COLLECTION = firstEnv('RETRIEVAL_BENCHMARK_COLLECTION') || DEFAULT_COLLECTION;
const QDRANT_URL = normalizeQdrantUrl();
const QDRANT_API_KEY = firstEnv('QDRANT_API_KEY', 'YUYOUZHICE_QDRANT_API_KEY');
const EMBEDDING_PROVIDER = firstEnv('YUYOUZHICE_EMBEDDING_PROVIDER')
  || (firstEnv('DASHSCOPE_API_KEY', 'BAILIAN_API_KEY') ? 'dashscope' : '');
const IS_DASHSCOPE = EMBEDDING_PROVIDER.toLowerCase() === 'dashscope'
  || firstEnv('YUYOUZHICE_EMBEDDING_URL', 'DASHSCOPE_EMBEDDING_URL').includes('dashscope.aliyuncs.com');
const EMBEDDING_URL = firstEnv('YUYOUZHICE_EMBEDDING_URL', 'DASHSCOPE_EMBEDDING_URL')
  || (IS_DASHSCOPE ? 'https://dashscope.aliyuncs.com/api/v1/services/embeddings/text-embedding/text-embedding' : '');
const EMBEDDING_API_KEY = firstEnv('YUYOUZHICE_EMBEDDING_API_KEY', 'DASHSCOPE_API_KEY', 'BAILIAN_API_KEY', 'OPENAI_API_KEY');
const EMBEDDING_MODEL = firstEnv('YUYOUZHICE_EMBEDDING_MODEL', 'DASHSCOPE_EMBEDDING_MODEL', 'BAILIAN_EMBEDDING_MODEL', 'OPENAI_EMBEDDING_MODEL')
  || (IS_DASHSCOPE ? 'text-embedding-v2' : '');
const configuredDimension = Number(firstEnv('YUYOUZHICE_EMBEDDING_DIMENSION', 'DASHSCOPE_EMBEDDING_DIMENSION'));
const EXPECTED_DIMENSION = Number.isFinite(configuredDimension) && configuredDimension > 0
  ? configuredDimension
  : (IS_DASHSCOPE ? 1536 : 0);

function headers(apiKey = '', mode = 'bearer') {
  return {
    'content-type': 'application/json',
    accept: 'application/json',
    ...(apiKey ? (mode === 'qdrant' ? { 'api-key': apiKey } : { authorization: `Bearer ${apiKey}` }) : {})
  };
}

async function requestJson(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const raw = await response.text();
    let data;
    try { data = raw ? JSON.parse(raw) : {}; } catch { data = { raw }; }
    if (!response.ok) {
      const detail = data?.status?.error || data?.error?.message || data?.message || raw.slice(0, 240);
      throw new Error(`${response.status} ${detail}`.trim());
    }
    return data;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error(`请求超时：${url}`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function embeddingBody(texts) {
  if (IS_DASHSCOPE) {
    return {
      model: EMBEDDING_MODEL,
      input: { texts },
      ...(EXPECTED_DIMENSION ? { parameters: { dimension: EXPECTED_DIMENSION } } : {})
    };
  }
  return { model: EMBEDDING_MODEL, input: texts, encoding_format: 'float' };
}

function extractEmbeddings(data, expectedCount) {
  const values = Array.isArray(data?.data)
    ? data.data.slice().sort((left, right) => Number(left.index || 0) - Number(right.index || 0)).map((item) => item.embedding)
    : Array.isArray(data?.embeddings)
      ? data.embeddings
      : Array.isArray(data?.output?.embeddings)
        ? data.output.embeddings.slice().sort((left, right) => Number(left.text_index || 0) - Number(right.text_index || 0)).map((item) => item.embedding)
        : [];
  if (values.length !== expectedCount || values.some((value) => !Array.isArray(value) || !value.length || value.some((number) => !Number.isFinite(Number(number))))) {
    throw new Error(`Embedding 响应数量或向量格式不正确，期望 ${expectedCount} 条，实际 ${values.length} 条`);
  }
  const dimension = values[0].length;
  if (values.some((value) => value.length !== dimension)) throw new Error('Embedding 向量维度不一致');
  if (EXPECTED_DIMENSION && dimension !== EXPECTED_DIMENSION) throw new Error(`Embedding 维度不符合配置：期望 ${EXPECTED_DIMENSION}，实际 ${dimension}`);
  for (const vector of values) {
    const norm = Math.sqrt(vector.reduce((sum, value) => sum + Number(value) ** 2, 0));
    if (!(norm > 0) || !Number.isFinite(norm)) throw new Error('Embedding 返回了零向量或非有限向量');
  }
  return { values, dimension };
}

async function embedQueries() {
  if (!EMBEDDING_API_KEY || !EMBEDDING_URL || !EMBEDDING_MODEL) throw new Error('BLOCKED_BY_EMBEDDING_CONFIG');
  const data = await requestJson(EMBEDDING_URL, {
    method: 'POST',
    headers: headers(EMBEDDING_API_KEY),
    body: JSON.stringify(embeddingBody(QUERIES))
  });
  return extractEmbeddings(data, QUERIES.length);
}

function qdrantFilter() {
  return {
    must: [
      { key: 'activation_namespace', match: { value: 'production-v2' } },
      { key: 'rag_eligible', match: { value: true } }
    ]
  };
}

function extractPoints(data) {
  const result = data?.result;
  if (Array.isArray(result)) return result;
  if (Array.isArray(result?.points)) return result.points;
  if (Array.isArray(data?.points)) return data.points;
  return [];
}

let qdrantFilterMode = 'server_filter';

function verifySemanticPayload(points) {
  for (const point of points) {
    const payload = point?.payload || {};
    if (payload.activation_namespace !== 'production-v2' || payload.rag_eligible !== true) {
      throw new Error(`Qdrant 返回了不符合 Java semantic payload contract 的 point：${String(point?.id || '')}`);
    }
  }
  return points;
}

async function searchQdrant(vector) {
  const collectionPath = `${QDRANT_URL}/collections/${encodeURIComponent(COLLECTION)}`;
  const body = { vector, limit: TOP_K, with_payload: true, filter: qdrantFilter() };
  try {
    const data = await requestJson(`${collectionPath}/points/search`, {
      method: 'POST',
      headers: headers(QDRANT_API_KEY, 'qdrant'),
      body: JSON.stringify(body)
    });
    return verifySemanticPayload(extractPoints(data));
  } catch (error) {
    const message = String(error.message);
    // Newer Qdrant deployments may expose query_points instead of search.
    if (message.startsWith('404 ')) {
      const data = await requestJson(`${collectionPath}/points/query`, {
        method: 'POST',
        headers: headers(QDRANT_API_KEY, 'qdrant'),
        body: JSON.stringify({ query: vector, limit: TOP_K, with_payload: true, filter: qdrantFilter() })
      });
      return verifySemanticPayload(extractPoints(data));
    }
    // Qdrant requires a payload index for keyword filters. Do not create a
    // remote index during a read-only benchmark; search unfiltered and verify
    // the Java activation payload locally on every returned point instead.
    if (message.startsWith('400 ') && /Index required/i.test(message)) {
      qdrantFilterMode = 'client_verified_payload_no_remote_index_mutation';
      const data = await requestJson(`${collectionPath}/points/search`, {
        method: 'POST',
        headers: headers(QDRANT_API_KEY, 'qdrant'),
        body: JSON.stringify({ vector, limit: TOP_K, with_payload: true })
      });
      return verifySemanticPayload(extractPoints(data));
    }
    throw error;
  }
}

function normalizeText(value) {
  return String(value || '').toLowerCase().replace(/\s+/g, '');
}

function countSignals(text, signals) {
  const value = normalizeText(text);
  return signals.filter((signal) => value.includes(normalizeText(signal))).length;
}

function heuristicFor(queryIndex, point) {
  const spec = QUERY_SIGNALS[queryIndex];
  const payload = point?.payload || point || {};
  const searchable = [
    payload.entityName,
    payload.title,
    payload.content,
    payload.topic,
    payload.dataType,
    ...(Array.isArray(payload.keywords) ? payload.keywords : [])
  ].join(' ');
  const primaryMatches = countSignals(searchable, spec.primary);
  const secondaryMatches = countSignals(searchable, spec.secondary);
  const genericMatches = countSignals(searchable, ['重庆', '重庆市', '旅游', '景点', '文化', '夜景', '博物馆']);
  return {
    score: primaryMatches * 2 + secondaryMatches,
    primaryMatches,
    secondaryMatches,
    genericMatches
  };
}

function shortSummary(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (text.length <= 140) return text;
  return `${text.slice(0, 137)}...`;
}

function normalizeQdrantResult(queryIndex, point, rank) {
  const payload = point?.payload || {};
  const heuristic = heuristicFor(queryIndex, point);
  return {
    rank,
    pointId: String(point?.id || ''),
    docId: String(payload.docId || ''),
    entity: String(payload.entityName || payload.entityId || ''),
    topic: String(payload.topic || payload.dataType || ''),
    score: Number(point?.score),
    summary: shortSummary(payload.content),
    heuristicScore: heuristic.score,
    heuristicSignals: heuristic
  };
}

function runPythonSqlite() {
  const script = String.raw`
import json, re, sqlite3, sys
path = sys.argv[1]
queries = json.loads(sys.argv[2])

def terms(query):
    normalized = re.sub(r'\\s+', '', str(query or '').lower())
    if not normalized: return []
    out=[]; seen=set()
    for run in re.findall(r'[\\u4e00-\\u9fff]{2,}', normalized):
        for value in [run] + [run[i:i+2] for i in range(len(run)-1)]:
            if value not in seen: seen.add(value); out.append(value)
    for value in re.findall(r'[a-z0-9][a-z0-9_-]{1,}', normalized):
        if value not in seen: seen.add(value); out.append(value)
    for value in ['重庆','旅行','行程','景点','希望','需要','可以']:
        if value in seen: seen.remove(value); out.remove(value)
    return out

try:
    db=sqlite3.connect(path)
    db.row_factory=sqlite3.Row
    rows=db.execute("SELECT id, title, content, tags, source_name FROM kb_document WHERE (status IS NULL OR status <> 'archived') ORDER BY updated_at DESC").fetchall()
    result=[]
    for query in queries:
        ranked=[]
        query_terms=terms(query)
        for row in rows:
            title=str(row['title'] or '')
            content=str(row['content'] or '')
            tags=str(row['tags'] or '')
            score=0
            for term in query_terms:
                if term in title.lower(): score += 5
                if term in tags.lower(): score += 3
                if term in content.lower(): score += 1
            if not query_terms or score > 0:
                ranked.append({'id':str(row['id'] or ''),'title':title,'content':content,'tags':tags,'sourceName':str(row['source_name'] or ''),'retrievalScore':score})
        ranked.sort(key=lambda item:item['retrievalScore'], reverse=True)
        result.append(ranked[:5])
    print(json.dumps({'ok':True,'rowCount':len(rows),'results':result}, ensure_ascii=False))
except Exception as exc:
    print(json.dumps({'ok':False,'error':str(exc)}, ensure_ascii=False))
`;
  return new Promise((resolve, reject) => {
    const child = spawn(process.env.PYTHON || 'python', ['-c', script, JAVA_SQLITE_FILE, JSON.stringify(QUERIES)], {
      cwd: PROJECT_ROOT,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.once('error', reject);
    child.once('close', (code) => {
      if (code !== 0) return reject(new Error(`SQLite helper failed: ${stderr || stdout}`));
      try { resolve(JSON.parse(stdout)); } catch { reject(new Error(`SQLite helper returned invalid JSON: ${stderr || stdout}`)); }
    });
  });
}

function normalizeSqliteResult(queryIndex, row, rank) {
  const heuristic = heuristicFor(queryIndex, {
    payload: { title: row.title, content: row.content, keywords: row.tags }
  });
  return {
    rank,
    pointId: '',
    docId: row.id,
    entity: row.title,
    topic: '',
    score: row.retrievalScore,
    summary: shortSummary(row.content),
    heuristicScore: heuristic.score,
    heuristicSignals: heuristic
  };
}

function summarizePath(results) {
  return {
    queryCount: results.length,
    totalReturned: results.reduce((sum, items) => sum + items.length, 0),
    querySummaries: results.map((items) => ({
      returned: items.length,
      topScore: items[0]?.score ?? null
    }))
  };
}

async function main() {
  if (COLLECTION !== DEFAULT_COLLECTION) throw new Error(`为保护生产集合，benchmark 只允许 ${DEFAULT_COLLECTION}，实际=${COLLECTION}`);
  if (!QDRANT_URL) throw new Error('缺少 Qdrant URL');
  const before = await requestJson(`${QDRANT_URL}/collections/${encodeURIComponent(COLLECTION)}`, { headers: headers(QDRANT_API_KEY, 'qdrant') });
  const collection = before?.result || before;
  const pointCount = Number(collection?.points_count ?? 0);
  const dimension = Number(collection?.config?.params?.vectors?.size ?? 0);
  const distance = String(collection?.config?.params?.vectors?.distance || '');
  if (pointCount !== 168 || dimension !== 1536 || distance.toLowerCase() !== 'cosine') {
    throw new Error(`benchmark collection contract 不符合预期：pointCount=${pointCount}, dimension=${dimension}, distance=${distance}`);
  }

  const embedded = await embedQueries();
  const qdrantResults = [];
  for (let index = 0; index < QUERIES.length; index += 1) {
    const points = await searchQdrant(embedded.values[index]);
    qdrantResults.push(points.slice(0, TOP_K).map((point, pointIndex) => normalizeQdrantResult(index, point, pointIndex + 1)));
  }

  const sqlite = await runPythonSqlite();
  if (!sqlite.ok) throw new Error(`SQLite helper failed: ${sqlite.error}`);
  const sqliteResults = sqlite.results.map((items, queryIndex) => items.map((row, rowIndex) => normalizeSqliteResult(queryIndex, row, rowIndex + 1)));
  const qdrantSummary = summarizePath(qdrantResults);
  const sqliteSummary = summarizePath(sqliteResults);

  console.log(JSON.stringify({
    ok: true,
    benchmark: {
      collection: COLLECTION,
      pointCount,
      vectorDimension: embedded.dimension,
      collectionDimension: dimension,
      distanceMetric: distance,
      embeddingProvider: EMBEDDING_PROVIDER,
      embeddingModel: EMBEDDING_MODEL,
      embeddingStatus: 'GENERATED_VERIFIED',
      queryCount: QUERIES.length,
      topK: TOP_K,
      filter: 'activation_namespace=production-v2 AND rag_eligible=true',
      filterMode: qdrantFilterMode,
      evaluationStatus: 'RAW_RETRIEVAL_OUTPUT_REQUIRES_POST_RETRIEVAL_MANUAL_REVIEW',
      heuristicNote: 'heuristicScore and heuristicSignals are informational only; they are not manual relevance labels and do not decide winners',
      manualReviewRule: 'Use the same query-specific HIGH/MEDIUM/LOW/IRRELEVANT review rule for every Qdrant and SQLite Top-5 result after all raw results are collected'
    },
    qdrant: { results: qdrantResults, summary: qdrantSummary },
    sqlite: {
      database: JAVA_SQLITE_FILE,
      rowCount: sqlite.rowCount,
      status: sqlite.rowCount > 0 ? 'READ_VERIFIED' : 'EMPTY',
      results: sqliteResults,
      summary: sqliteSummary
    },
    evaluation: {
      status: 'PENDING_POST_RETRIEVAL_MANUAL_REVIEW',
      qdrantAndSqliteUseSameRule: true,
      manualReviewLabels: ['HIGH', 'MEDIUM', 'LOW', 'IRRELEVANT'],
      heuristicDoesNotDecideWinner: true
    },
    productionSafety: {
      productionCollection: 'scenic_guide_production_v2',
      productionCollectionModified: 'NO',
      productionManifestModified: 'NO',
      benchmarkWrites: 'NONE'
    },
    envFileLoaded
  }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
  process.exitCode = 1;
});
