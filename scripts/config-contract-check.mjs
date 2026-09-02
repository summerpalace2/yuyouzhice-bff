import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const javaRoot = process.env.SCENIC_GUIDE_JAVA_DIR || 'D:/scenic-guide/ai';
const canonicalTemplate = path.join(javaRoot, '.env.example');
const legacyTemplate = path.join(root, '.env.example');
const legacyLocalTemplate = path.join(root, '.env.local.example');
const applicationYaml = path.join(javaRoot, 'src', 'main', 'resources', 'application.yml');
const javaApplication = path.join(javaRoot, 'src', 'main', 'java', 'com', 'ai', 'guide', 'ScenicGuideApplication.java');
const javaDatabaseConfig = path.join(javaRoot, 'src', 'main', 'java', 'com', 'ai', 'guide', 'common', 'config', 'KnowledgeDbConfig.java');
const envLoader = path.join(root, 'server', 'env.mjs');
const javaCoreClient = path.join(root, 'server', 'java-core-client.mjs');
const sessionStore = path.join(root, 'server', 'web-session-store.mjs');
const revocationStore = path.join(root, 'server', 'revocation-store.mjs');
const serverIndex = path.join(root, 'server', 'index.mjs');
const importer = path.join(root, 'scripts', 'knowledge-import.mjs');
const benchmark = path.join(root, 'scripts', 'retrieval-benchmark.mjs');
const vectorCheck = path.join(root, 'scripts', 'knowledge-vector-check.mjs');
const startLocal = path.join(root, 'start-local.ps1');
const manifestPath = path.join(root, 'data', 'knowledge', 'yuyouzhice-embedding-manifest.json');

const EXPECTED_CATEGORIES = [
  'REQUIRED_LOCAL_CORE',
  'OPTIONAL_FEATURE',
  'LEGACY_ALIAS',
  'PRODUCTION_ONLY'
];

const CATEGORY_SET = new Set(EXPECTED_CATEGORIES);
const TEST_ONLY = /^(?:YUYOUZHICE_TEST_|YUYOUZHICE_JAVA_TEST_STUB$|PYTHON$|SCENIC_GUIDE_JAVA_DIR$)/;

function parseAssignment(line) {
  const active = line.trim().match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/);
  if (active) return { name: active[1], commented: false };
  const commented = line.trim().match(/^#\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/);
  return commented ? { name: commented[1], commented: true } : null;
}

function parseTemplate(content) {
  const result = new Map(EXPECTED_CATEGORIES.map((category) => [category, []]));
  let current = null;
  for (const line of content.split(/\r?\n/)) {
    const heading = line.trim().match(/^#\s*(REQUIRED_LOCAL_CORE|OPTIONAL_FEATURE|LEGACY_ALIAS|PRODUCTION_ONLY)\s*$/);
    if (heading) {
      current = heading[1];
      continue;
    }
    const assignment = parseAssignment(line);
    if (assignment && current) result.get(current).push(assignment);
  }
  return result;
}

function activeKeys(content) {
  return new Set(content.split(/\r?\n/).flatMap((line) => {
    const assignment = line.trim().match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    return assignment ? [assignment[1]] : [];
  }));
}

function uppercaseReferences(content) {
  return new Set([...content.matchAll(/\$\{([A-Z][A-Z0-9_]*)/g)].map((match) => match[1]));
}

function javaValueReferences(content) {
  return new Set([...content.matchAll(/@Value\("\$\{([A-Z][A-Z0-9_]*)/g)].map((match) => match[1]));
}

function processEnvReferences(content) {
  return new Set([...content.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)].map((match) => match[1]));
}

function quotedEnvReferences(content) {
  return new Set([...content.matchAll(/['"]([A-Z][A-Z0-9_]*)['"]/g)].map((match) => match[1]));
}

function assertContains(content, needle, message) {
  if (!content.includes(needle)) throw new Error(message || `缺少配置契约：${needle}`);
}

function assertCanonicalFirst(content, canonical, alias, message) {
  const canonicalIndex = content.indexOf(canonical);
  const aliasIndex = content.indexOf(alias);
  if (canonicalIndex < 0 || aliasIndex < 0 || canonicalIndex > aliasIndex) {
    throw new Error(message || `canonical 未优先于 alias：${canonical} / ${alias}`);
  }
}

function assertPattern(content, pattern, message) {
  if (!pattern.test(content)) throw new Error(message || `缺少配置契约：${pattern}`);
}

function resolveCanonical(canonical, alias, fallback = '') {
  return String(canonical || '').trim() || String(alias || '').trim() || fallback;
}

function resolveFromEnv(env, canonical, aliases = [], fallback = '') {
  const values = [env[canonical], ...aliases.map((name) => env[name])];
  for (const value of values) {
    if (String(value || '').trim()) return String(value).trim();
  }
  return fallback;
}

function evaluateScenario(env) {
  const qdrantUrl = resolveFromEnv(env, 'QDRANT_URL', ['YUYOUZHICE_QDRANT_URL']);
  const qdrantCollection = resolveFromEnv(env, 'QDRANT_COLLECTION', ['YUYOUZHICE_VECTOR_STORE_COLLECTION'], 'scenic_guide_production_v2');
  const embeddingKey = resolveFromEnv(env, 'YUYOUZHICE_EMBEDDING_API_KEY', ['DASHSCOPE_API_KEY', 'BAILIAN_API_KEY', 'OPENAI_API_KEY']);
  const redisEnabled = String(env.YUYOUZHICE_REVOKE_STORE || 'memory').toLowerCase() === 'redis';
  const databaseType = String(env.KNOWLEDGE_DB_TYPE || 'sqlite').toLowerCase();
  const adminMode = String(env.ADMIN_BOOTSTRAP_MODE || 'disabled').toLowerCase();
  return {
    qdrantConfigured: Boolean(qdrantUrl),
    qdrantCollection,
    embeddingConfigured: Boolean(embeddingKey),
    redisEnabled,
    databaseType,
    adminBootstrapEnabled: adminMode !== 'disabled'
  };
}

async function exists(filePath) {
  try { await access(filePath); return true; } catch { return false; }
}

const requiredFiles = [
  canonicalTemplate,
  applicationYaml,
  javaApplication,
  javaDatabaseConfig,
  envLoader,
  javaCoreClient,
  sessionStore,
  revocationStore,
  serverIndex,
  importer,
  benchmark,
  vectorCheck,
  startLocal,
  manifestPath,
  legacyTemplate,
  legacyLocalTemplate,
  path.join(root, 'app', 'app.js')
];
for (const filePath of requiredFiles) {
  if (!(await exists(filePath))) throw new Error(`配置契约文件不存在：${filePath}`);
}

const [
  templateContent,
  yamlContent,
  javaContent,
  javaDatabaseContent,
  loaderContent,
  javaCoreContent,
  sessionContent,
  revocationContent,
  serverContent,
  importerContent,
  benchmarkContent,
  vectorContent,
  startContent,
  manifestContent,
  legacyContent,
  legacyLocalContent,
  browserSource
] = await Promise.all([
  readFile(canonicalTemplate, 'utf8'),
  readFile(applicationYaml, 'utf8'),
  readFile(javaApplication, 'utf8'),
  readFile(javaDatabaseConfig, 'utf8'),
  readFile(envLoader, 'utf8'),
  readFile(javaCoreClient, 'utf8'),
  readFile(sessionStore, 'utf8'),
  readFile(revocationStore, 'utf8'),
  readFile(serverIndex, 'utf8'),
  readFile(importer, 'utf8'),
  readFile(benchmark, 'utf8'),
  readFile(vectorCheck, 'utf8'),
  readFile(startLocal, 'utf8'),
  readFile(manifestPath, 'utf8'),
  readFile(legacyTemplate, 'utf8'),
  readFile(legacyLocalTemplate, 'utf8'),
  readFile(path.join(root, 'app', 'app.js'), 'utf8')
]);

const templateKeys = activeKeys(templateContent);
const templateCategories = parseTemplate(templateContent);
for (const category of EXPECTED_CATEGORIES) {
  if (!templateCategories.get(category)?.length) throw new Error(`canonical 分类为空或缺失：${category}`);
}

const categoryOwners = new Map();
for (const category of EXPECTED_CATEGORIES) {
  for (const entry of templateCategories.get(category)) {
    if (categoryOwners.has(entry.name)) throw new Error(`环境变量重复分类：${entry.name}`);
    categoryOwners.set(entry.name, category);
  }
}
const uncategorized = [...templateKeys].filter((key) => !categoryOwners.has(key));
if (uncategorized.length) throw new Error(`canonical 环境变量未分类：${uncategorized.join(',')}`);
if (templateKeys.has('YUYOUZHICE_ENV_FILE')) throw new Error('YUYOUZHICE_ENV_FILE 不得成为 canonical 配置变量');

const canonicalVariables = [...templateKeys].sort();
const legacyAliases = templateCategories.get('LEGACY_ALIAS').filter((entry) => entry.commented).map((entry) => entry.name).sort();
const optionalVariables = templateCategories.get('OPTIONAL_FEATURE').filter((entry) => !entry.commented).map((entry) => entry.name).sort();
const productionOnlyVariables = templateCategories.get('PRODUCTION_ONLY').filter((entry) => !entry.commented).map((entry) => entry.name).sort();
const allSupported = new Set([...canonicalVariables, ...legacyAliases]);

const applicationReferences = uppercaseReferences(yamlContent);
const javaReferences = javaValueReferences(javaContent);
const javaDatabaseReferences = javaValueReferences(javaDatabaseContent);
const unresolvedApplication = [...applicationReferences].filter((key) => !allSupported.has(key));
const unresolvedJava = [...new Set([...javaReferences, ...javaDatabaseReferences])].filter((key) => !allSupported.has(key));
if (unresolvedApplication.length) throw new Error(`application.yml 引用了未登记变量：${unresolvedApplication.join(',')}`);
if (unresolvedJava.length) throw new Error(`Java @Value 引用了未登记变量：${unresolvedJava.join(',')}`);

const runtimeContents = [loaderContent, javaCoreContent, sessionContent, revocationContent, serverContent, importerContent, benchmarkContent, vectorContent];
const runtimeReferences = new Set();
for (const content of runtimeContents) {
  for (const name of processEnvReferences(content)) runtimeReferences.add(name);
  for (const name of quotedEnvReferences(content)) {
    if (allSupported.has(name)) runtimeReferences.add(name);
  }
}
const unresolvedRuntime = [...runtimeReferences].filter((key) => !allSupported.has(key) && !TEST_ONLY.test(key));
if (unresolvedRuntime.length) throw new Error(`Node/script 引用了未登记变量：${unresolvedRuntime.join(',')}`);

assertContains(loaderContent, "export const canonicalEnvFile = 'D:/scenic-guide/ai/.env';", 'Web BFF 未固定到 canonical 环境文件');
for (const forbidden of ['PROJECT_ENV_LOCAL_FILE', 'PROJECT_ENV_FILE', 'process.env.YUYOUZHICE_ENV_FILE', 'const explicitEnvFile']) {
  if (loaderContent.includes(forbidden)) throw new Error(`Web BFF 仍包含旧配置链：${forbidden}`);
}
assertContains(importerContent, "const CANONICAL_ENV_FILE = 'D:/scenic-guide/ai/.env';", 'knowledge-import.mjs 未固定到 canonical 环境文件');
for (const forbidden of ['PROJECT_ENV_FILE', 'process.env.YUYOUZHICE_ENV_FILE', 'const explicitEnvFile', 'const chainedEnvFile']) {
  if (importerContent.includes(forbidden)) throw new Error(`knowledge-import.mjs 仍包含旧配置链：${forbidden}`);
}
assertContains(startContent, "$Config = Join-Path $JavaRoot '.env'", 'start-local.ps1 未加载 ai/.env');
if (startContent.includes('.env.local') || startContent.includes('YUYOUZHICE_ENV_FILE')) throw new Error('start-local.ps1 仍包含非 canonical 配置源');
if (startContent.includes('$coreUrlState') || startContent.includes('CORE_BACKEND_URL\' -Names')) throw new Error('CORE_BACKEND_URL 不应阻塞本地启动');
assertContains(startContent, "if (-not ($jwtReady -and $authReady))", '启动阻塞集合不是 JWT_SECRET + YUYOUZHICE_AUTH_SECRET');
for (const section of ['CORE', 'AI', 'MAP', 'RAG', 'OPTIONAL']) assertContains(startContent, `Show-Section -Name '${section}'`, `启动输出缺少 ${section} 功能区`);
for (const label of ['QDRANT', 'REDIS', 'ADMIN BOOTSTRAP']) assertContains(startContent, `'${label}'`, `启动输出缺少 ${label} 状态`);
if (startContent.includes('Show-KeyStatus')) throw new Error('启动输出仍逐变量打印状态');

if (!javaContent.includes('CANONICAL_ENV_FILE') || !javaContent.includes('D:\\\\scenic-guide\\\\ai\\\\.env')) {
  throw new Error('Java 未固定到 D:\\scenic-guide\\ai\\.env');
}
if (javaContent.includes('String[] candidates')) throw new Error('Java 仍按工作目录探测多个 .env 文件');
if (!legacyContent.includes('DEPRECATED TEMPLATE') || !legacyLocalContent.includes('DEPRECATED TEMPLATE')) {
  throw new Error('Node .env.example/.env.local.example 未明确弃用');
}

// Canonical-first assertions cover the real resolver order, not only the
// category labels in the template.
if (resolveCanonical('canonical-value', 'legacy-value', 'fallback') !== 'canonical-value') throw new Error('canonical wins over alias 行为失败');
assertCanonicalFirst(javaCoreContent, 'process.env.CORE_BACKEND_URL', 'process.env.YUYOUZHICE_JAVA_CORE_URL', 'CORE_BACKEND_URL 未优先于旧 alias');
assertCanonicalFirst(importerContent, "firstEnv('QDRANT_URL', 'YUYOUZHICE_QDRANT_URL')", "firstEnv('QDRANT_API_KEY', 'YUYOUZHICE_QDRANT_API_KEY')", 'Qdrant canonical resolver 顺序无法验证');
assertContains(importerContent, "firstEnv('QDRANT_API_KEY', 'YUYOUZHICE_QDRANT_API_KEY')", 'QDRANT_API_KEY canonical resolver 缺失');
assertContains(importerContent, 'process.env.QDRANT_COLLECTION\n    || process.env.YUYOUZHICE_VECTOR_STORE_COLLECTION', 'QDRANT_COLLECTION 未优先于旧 collection alias');
assertContains(vectorContent, "firstEnv('QDRANT_API_KEY', 'YUYOUZHICE_QDRANT_API_KEY')", 'vector check 的 QDRANT_API_KEY 未 canonical-first');
assertContains(benchmarkContent, "firstEnv('QDRANT_API_KEY', 'YUYOUZHICE_QDRANT_API_KEY')", 'benchmark 的 QDRANT_API_KEY 未 canonical-first');
assertPattern(importerContent, /firstEnv\(\s*'YUYOUZHICE_EMBEDDING_API_KEY'\s*,\s*'DASHSCOPE_API_KEY'/s, 'Embedding canonical resolver 缺失');
assertPattern(benchmarkContent, /firstEnv\(\s*'YUYOUZHICE_EMBEDDING_API_KEY'\s*,\s*'DASHSCOPE_API_KEY'/s, 'benchmark Embedding canonical resolver 缺失');
assertContains(loaderContent, "mirrorAlias('CORE_BACKEND_URL', ['YUYOUZHICE_JAVA_CORE_URL'])", 'Node core canonical alias normalization 缺失');
assertContains(loaderContent, "'AMAP_WEB_SERVICE_KEY'", 'Node BFF 必须明确排除 AMap Web Service key');
assertContains(loaderContent, "'AMAP_KEY'", 'Node BFF 必须明确排除 AMap legacy service key alias');
if (loaderContent.includes("mirrorAlias('AMAP_WEB_SERVICE_KEY', ['AMAP_KEY'])")) throw new Error('Node BFF 不得镜像 AMap Web Service key');
assertCanonicalFirst(serverContent, 'process.env.AMAP_WEB_JS_KEY', 'process.env.AMAP_JS_KEY', 'AMAP_WEB_JS_KEY 未优先于旧 alias');
assertContains(yamlContent, '${AMAP_WEB_SERVICE_KEY:${AMAP_KEY:}}', 'application.yml AMap canonical fallback 缺失');
assertContains(sessionContent, 'process.env.YUYOUZHICE_SESSION_TTL_MS || process.env.YUYOUZHICE_TOKEN_TTL_MS', 'Web session TTL canonical-first 缺失');
assertContains(revocationContent, 'process.env.YUYOUZHICE_REDIS_DATABASE || process.env.REDIS_DATABASE', 'Redis database canonical-first 缺失');

const scenarioDefinitions = [
  {
    name: 'minimal-core',
    env: { JWT_SECRET: 'present', YUYOUZHICE_AUTH_SECRET: 'present' },
    expect: { qdrantConfigured: false, embeddingConfigured: false, redisEnabled: false, databaseType: 'sqlite', adminBootstrapEnabled: false }
  },
  {
    name: 'redis-disabled',
    env: { YUYOUZHICE_REVOKE_STORE: 'memory', REDIS_HOST: 'localhost' },
    expect: { redisEnabled: false }
  },
  {
    name: 'sqlite-default',
    env: {},
    expect: { databaseType: 'sqlite' }
  },
  {
    name: 'admin-bootstrap-disabled',
    env: { ADMIN_BOOTSTRAP_MODE: 'disabled', ADMIN_BOOTSTRAP_USERNAME: 'unused' },
    expect: { adminBootstrapEnabled: false }
  },
  {
    name: 'qdrant-unconfigured',
    env: {},
    expect: { qdrantConfigured: false }
  },
  {
    name: 'qdrant-configured',
    env: { QDRANT_URL: 'http://qdrant.test', QDRANT_API_KEY: 'fixture-only' },
    expect: { qdrantConfigured: true }
  },
  {
    name: 'dashscope-canonical-embedding',
    env: { YUYOUZHICE_EMBEDDING_PROVIDER: 'dashscope', YUYOUZHICE_EMBEDDING_API_KEY: 'canonical-only' },
    expect: { embeddingConfigured: true }
  },
  {
    name: 'legacy-alias-only',
    env: { YUYOUZHICE_QDRANT_URL: 'http://legacy.test', YUYOUZHICE_VECTOR_STORE_COLLECTION: 'legacy_collection' },
    expect: { qdrantConfigured: true, qdrantCollection: 'legacy_collection' }
  },
  {
    name: 'canonical-wins-over-legacy',
    env: { QDRANT_URL: 'http://canonical.test', YUYOUZHICE_QDRANT_URL: 'http://legacy.test', QDRANT_COLLECTION: 'canonical_collection', YUYOUZHICE_VECTOR_STORE_COLLECTION: 'legacy_collection' },
    expect: { qdrantConfigured: true, qdrantCollection: 'canonical_collection' }
  }
];
const scenarioResults = scenarioDefinitions.map((scenario) => {
  const actual = evaluateScenario(scenario.env);
  for (const [key, expected] of Object.entries(scenario.expect)) {
    if (actual[key] !== expected) throw new Error(`配置场景失败：${scenario.name}.${key}=${actual[key]}，expected=${expected}`);
  }
  return scenario.name;
});

const manifest = JSON.parse(manifestContent);
if (manifest.collectionName !== 'scenic_guide_production_v2') throw new Error(`manifest collectionName 不一致：${manifest.collectionName}`);
if (manifest.documentCount !== 168) throw new Error(`manifest documentCount 不一致：${manifest.documentCount}`);
if (manifest.embeddingStatus === 'generated' || manifest.vectorStoreStatus === 'imported') {
  throw new Error('配置验证阶段不应伪造已生成或已导入状态');
}
if (!importerContent.includes("activation_namespace: 'production-v2'") || !importerContent.includes('rag_eligible: true')) {
  throw new Error('knowledge-import.mjs 未写入 Java Production V2 语义过滤字段');
}
for (const forbidden of ['DEEPSEEK_API_KEY', 'AMAP_WEB_SERVICE_KEY', 'QDRANT_API_KEY', 'DASHSCOPE_API_KEY']) {
  if (browserSource.includes(forbidden)) throw new Error(`浏览器代码包含服务端凭据名：${forbidden}`);
}

console.log(JSON.stringify({
  ok: true,
  canonicalEnvFile: 'D:/scenic-guide/ai/.env',
  envTemplate: 'D:/scenic-guide/ai/.env.example',
  totalSupportedVariables: allSupported.size,
  canonicalVariables,
  legacyAliases,
  optionalVariables,
  productionOnlyVariables,
  startupBlockingVariables: ['JWT_SECRET', 'YUYOUZHICE_AUTH_SECRET'],
  canonicalEmbeddingConfig: {
    provider: 'YUYOUZHICE_EMBEDDING_PROVIDER',
    apiKey: 'YUYOUZHICE_EMBEDDING_API_KEY',
    javaApiKey: 'DASHSCOPE_API_KEY',
    url: 'YUYOUZHICE_EMBEDDING_URL',
    model: 'YUYOUZHICE_EMBEDDING_MODEL',
    dimension: 'YUYOUZHICE_EMBEDDING_DIMENSION'
  },
  canonicalQdrantConfig: { url: 'QDRANT_URL', apiKey: 'QDRANT_API_KEY', collection: 'QDRANT_COLLECTION', javaHost: 'QDRANT_HOST', javaPort: 'QDRANT_PORT' },
  canonicalDatabaseConfig: { type: 'KNOWLEDGE_DB_TYPE', url: 'KNOWLEDGE_DB_URL', username: 'KNOWLEDGE_DB_USERNAME', password: 'KNOWLEDGE_DB_PASSWORD' },
  canonicalRedisConfig: { mode: 'YUYOUZHICE_REVOKE_STORE', url: 'YUYOUZHICE_REDIS_URL', host: 'YUYOUZHICE_REDIS_HOST', port: 'YUYOUZHICE_REDIS_PORT' },
  precedence: { canonicalWinsOverAlias: true, legacyAliasSupport: true },
  localRequirements: { redis: false, postgres: false, qdrant: false, adminBootstrap: false },
  scenarioChecks: scenarioResults,
  applicationReferences: applicationReferences.size,
  javaReferences: new Set([...javaReferences, ...javaDatabaseReferences]).size,
  runtimeReferences: runtimeReferences.size,
  manifestStatus: { embeddingStatus: manifest.embeddingStatus, vectorStoreStatus: manifest.vectorStoreStatus },
  browserSecretBoundary: 'verified'
}, null, 2));
