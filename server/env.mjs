/**
 * Web BFF .env loader.
 *
 * The BFF deliberately imports only its runtime allowlist. Importers and
 * retrieval benchmarks have independent loaders because they need provider,
 * Qdrant, and corpus configuration that must not enter the BFF process.
 * Existing allowed process variables always win.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const canonicalEnvFile = 'D:/scenic-guide/ai/.env';

export const BFF_ENV_NAMES = Object.freeze(new Set([
  'CORE_BACKEND_URL',
  'YUYOUZHICE_JAVA_CORE_URL',
  'YUYOUZHICE_JAVA_TIMEOUT_MS',
  'PORT',
  'YUYOUZHICE_SESSION_TTL_MS',
  'YUYOUZHICE_TOKEN_TTL_MS',
  'YUYOUZHICE_DATA_FILE',
  'YUYOUZHICE_MEMORY',
  'YUYOUZHICE_WEB_ORIGINS',
  'YUYOUZHICE_AUTH_SECRET',
  'YUYOUZHICE_REVOKE_STORE',
  'YUYOUZHICE_REDIS_URL',
  'YUYOUZHICE_REDIS_HOST',
  'YUYOUZHICE_REDIS_PORT',
  'YUYOUZHICE_REDIS_PASSWORD',
  'YUYOUZHICE_REDIS_DATABASE',
  'YUYOUZHICE_REDIS_SSL',
  'YUYOUZHICE_REDIS_TIMEOUT_MS',
  'YUYOUZHICE_REDIS_KEY_PREFIX',
  'REDIS_HOST',
  'REDIS_PORT',
  'REDIS_PASSWORD',
  'REDIS_DATABASE',
  'REDIS_SSL',
  'REDIS_TIMEOUT_MS',
  'AMAP_WEB_JS_KEY',
  'AMAP_WEB_JS_SECURITY_CODE',
  'AMAP_JS_KEY',
  'AMAP_JS_SECURITY_KEY',
  'YUYOUZHICE_TEST_FIXTURES',
  'YUYOUZHICE_TEST_SESSION_COMPAT',
  'YUYOUZHICE_JAVA_TEST_STUB',
  'YUYOUZHICE_TEST_ADMIN_EMAIL',
  'YUYOUZHICE_TEST_ADMIN_PASSWORD'
]));

// Remove known Java/tooling-only values that may have been inherited by a
// standalone Node launch. start-local.ps1 also enforces this boundary before
// creating the child process; this defense keeps the module safe on its own.
const NON_BFF_ENV_NAMES = Object.freeze([
  'JWT_SECRET',
  'DEEPSEEK_API_KEY',
  'DASHSCOPE_API_KEY',
  'BAILIAN_API_KEY',
  'BAIDU_API_KEY',
  'BAIDU_SECRET_KEY',
  'AMAP_WEB_SERVICE_KEY',
  'AMAP_KEY',
  'YUYOUZHICE_EMBEDDING_PROVIDER',
  'YUYOUZHICE_EMBEDDING_API_KEY',
  'YUYOUZHICE_EMBEDDING_URL',
  'YUYOUZHICE_EMBEDDING_MODEL',
  'YUYOUZHICE_EMBEDDING_DIMENSION',
  'YUYOUZHICE_EMBEDDING_BATCH_SIZE',
  'YUYOUZHICE_IMPORT_TIMEOUT_MS',
  'YUYOUZHICE_CORPUS_FILE',
  'YUYOUZHICE_SOURCE_REGISTER_FILE',
  'YUYOUZHICE_EMBEDDING_MANIFEST_FILE',
  'RETRIEVAL_BENCHMARK_COLLECTION',
  'RETRIEVAL_BENCHMARK_TIMEOUT_MS',
  'QDRANT_URL',
  'QDRANT_API_KEY',
  'QDRANT_COLLECTION',
  'QDRANT_HOST',
  'QDRANT_PORT',
  'QDRANT_USE_TLS',
  'KNOWLEDGE_DB_TYPE',
  'KNOWLEDGE_DB_URL',
  'KNOWLEDGE_DB_USERNAME',
  'KNOWLEDGE_DB_PASSWORD',
  'KNOWLEDGE_UPLOAD_DIR',
  'ADMIN_BOOTSTRAP_MODE',
  'ADMIN_BOOTSTRAP_USERNAME',
  'ADMIN_BOOTSTRAP_PASSWORD',
  'QDRANT_PRODUCTION_V2_COLLECTION',
  'QDRANT_PRODUCTION_V2_AUTO_CREATE_INDEXES',
  'DATABASE_URL',
  'POSTGRES_URL',
  'POSTGRES_CONNECTION_STRING',
  'POSTGRES_JDBC_URL',
  'POSTGRES_URI',
  'POSTGRES_HOST',
  'POSTGRES_PORT',
  'POSTGRES_DB',
  'POSTGRES_USER',
  'POSTGRES_PASSWORD'
]);

export function loadDotEnv(filePath, allowlist = null) {
  if (!filePath) return false;
  let raw;
  try { raw = readFileSync(filePath, 'utf8'); } catch { return false; }
  for (const sourceLine of raw.split(/\r?\n/)) {
    const line = sourceLine.replace(/^﻿/, '').trim();
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    const name = match[1];
    if (allowlist && !allowlist.has(name)) continue;
    if (process.env[name] !== undefined) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/, '').trim();
    }
    process.env[name] = value;
  }
  return true;
}

function mirrorAlias(canonical, aliases) {
  if (process.env[canonical] === undefined || process.env[canonical] === '') return;
  for (const alias of aliases) {
    if (process.env[alias] === undefined) process.env[alias] = process.env[canonical];
  }
}

function removeNonBffEnv() {
  for (const name of NON_BFF_ENV_NAMES) delete process.env[name];
}

function loadConfiguredEnv() {
  // Local file precedence is deliberately fixed: no .env.local, project .env,
  // or YUYOUZHICE_ENV_FILE chain is consulted by the Web BFF.
  removeNonBffEnv();
  const loaded = loadDotEnv(canonicalEnvFile, BFF_ENV_NAMES);
  normalizeAliases();
  return loaded;
}

function normalizeAliases() {
  // Compatibility consumers may still read these names, but aliases can never
  // supply a canonical value or select another environment file.
  mirrorAlias('CORE_BACKEND_URL', ['YUYOUZHICE_JAVA_CORE_URL']);
  // The BFF deliberately does not load or mirror the server-side AMap
  // service key; tooling resolves that contract in its own loader.
  mirrorAlias('AMAP_WEB_JS_KEY', ['AMAP_JS_KEY']);
  mirrorAlias('AMAP_WEB_JS_SECURITY_CODE', ['AMAP_JS_SECURITY_KEY']);
}

export const envFileLoaded = loadConfiguredEnv();
export const projectRoot = PROJECT_ROOT;
