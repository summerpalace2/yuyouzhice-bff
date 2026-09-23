/**
 * index.mjs
 *
 * 核心职责：提供渝游智策静态页面、浏览器 API 路由、Java 委托、认证会话、反馈和管理员概览。
 * 主要导出：createAppServer、resetDemoState。
 */

import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { appendFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPersistentStore } from './persistent-store.mjs';
import { knowledgeAdminStatus, retrievalStatus, retrieveTravelKnowledge, getKnowledgeDocuments, updateKnowledgeDocument, createKnowledgeDocument } from './retrieval-adapter.mjs';
import { createRevocationStore } from './revocation-store.mjs';
import { createJavaCoreClient, JavaCoreError, normalizeJavaPrincipal } from './java-core-client.mjs';
import { compareShadow, createShadowMetrics } from './shadow-comparison.mjs';
import { createWebSessionStore } from './web-session-store.mjs';
import {
  SESSION_COOKIE_NAME,
  CSRF_HEADER_NAME,
  clearCsrfCookie,
  clearSessionCookie,
  csrfCookie,
  requestCsrfToken,
  requestSessionId,
  sessionCookie,
  testBearerSessionId,
  assertMutationSecurity
} from './web-security.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const PORT = Number(process.env.PORT || 3000);
const BFF_LOG_FILE = process.env.YUYOUZHICE_LOG_FILE || path.join(ROOT, 'logs', 'bff-runtime.log');
// Canonical Web BFF session TTL; TOKEN_TTL_MS remains a compatibility alias.
const SESSION_TTL_MS = Math.max(1000, Number(process.env.YUYOUZHICE_SESSION_TTL_MS || process.env.YUYOUZHICE_TOKEN_TTL_MS || 7 * 24 * 60 * 60 * 1000));
const CHECK_MODE = process.argv.includes('--check');
const JAVA_MAP_ADAPTER = Object.freeze({
  provider: 'Java Core Backend AMap boundary',
  mode: 'Java Core Backend 路线与 POI 能力',
  keyConfigured: false,
  endpoints: [
    '/v5/place/text',
    '/v5/place/detail',
    '/v3/geocode/geo',
    '/v3/geocode/regeo',
    '/v5/direction/walking',
    '/v5/direction/transit/integrated',
    '/v3/direction/transit/integrated',
    '/v3/assistant/inputtips',
    '/v3/weather/weatherInfo'
  ]
});

// Planner draft sessions and authenticated Web sessions are intentionally separate.
const sessions = new Map();
const webSessions = createWebSessionStore({ ttlMs: SESSION_TTL_MS });
const javaCore = createJavaCoreClient();
// 景点目录是公开的、低频变化的数据。缓存只存在于 BFF 进程内，用来避免每次
// 首屏都经过远端数据库；用户行程、账户、聊天等私有数据绝不进入这里。
const EXPLORE_CACHE_TTL_MS = Math.max(30_000, Number(process.env.YUYOUZHICE_EXPLORE_CACHE_TTL_MS || 5 * 60 * 1000));
const exploreCatalogCache = new Map();
// Shadow metrics are intentionally process-local observation data, never
// persisted Trip or user state.
const shadowMetrics = createShadowMetrics();
const revocationStore = createRevocationStore();
const persistentStore = await createPersistentStore({
  rootDir: ROOT,
  filePath: process.env.YUYOUZHICE_DATA_FILE || path.join(ROOT, 'data', 'yuyouzhice.json'),
  // Static --check must remain usable without opening persistent user storage;
  // normal startup still requires an externally configured signing secret.
  // Port 3000 is the user-facing local runtime: if its canonical auth secret
  // is present, keep planner mappings durable even when an old .env still
  // carries the test-only memory toggle. Isolated checks use other ports and
  // can continue to opt into YUYOUZHICE_MEMORY=1 explicitly.
  enabled: !CHECK_MODE && (process.env.YUYOUZHICE_MEMORY !== '1'
    || (PORT === 3000 && String(process.env.YUYOUZHICE_AUTH_SECRET || '').trim().length >= 32))
});

function diagnosticError(error) {
  return {
    name: String(error?.name || 'UnknownError'),
    code: String(error?.code || ''),
    status: Number(error?.status || 0),
    message: String(error?.message || '').replace(/Bearer\s+[^\s]+/gi, 'Bearer [redacted]').slice(0, 500),
    stack: String(error?.stack || '').split('\n').slice(0, 4).join('\n')
  };
}

function writeBffDiagnostic(event, details = {}) {
  const record = {
    at: new Date().toISOString(),
    event,
    ...details
  };
  return mkdir(path.dirname(BFF_LOG_FILE), { recursive: true })
    .then(() => appendFile(BFF_LOG_FILE, `${JSON.stringify(record)}\n`, 'utf8'))
    .catch(() => {});
}
const feedbackByUser = persistentStore.feedbackByUser;
// Legacy preference events are an adapter-only, process-local compatibility view;
// Java remains the only formal Preferences authority.
const legacyPreferenceEvents = new Map();

const citation = (title, endpoint, status = '已核验') => ({
  title,
  publisher: 'Java Core Backend',
  endpoint,
  url: String(endpoint || ''),
  updatedAt: new Date().toISOString(),
  status,
  note: status === '已核验' ? '字段由 Java Core Backend 返回，动态值以查询时结果为准。' : '当前为用户确认前的保守状态。'
});

function fact(label, value, status, note, citations = []) {
  return { label, value, status, note, citations };
}

/**
 * requestDeviceId - 读取客户端设备标识，用于记录账号历史的最后编辑来源。
 *
 * @param {object} req Node HTTP 请求
 * @returns {string} 脱敏后的设备标识
 */
function requestDeviceId(req) {
  return String(req.headers['x-yuyouzhice-device'] || 'unknown-device').trim().slice(0, 96) || 'unknown-device';
}

/**
 * mapConfig - 返回浏览器地图所需的公开 JS API 配置，不泄露 Web 服务 Key。
 *
 * @returns {object} AMap JS API 状态和加载参数
 */
function mapConfig({ includeCredentials = false } = {}) {
  const key = process.env.AMAP_WEB_JS_KEY || process.env.AMAP_JS_KEY || '';
  const securityJsCode = process.env.AMAP_WEB_JS_SECURITY_CODE || process.env.AMAP_JS_SECURITY_KEY || '';
  return {
    provider: '高德 JS API 2.0',
    keyConfigured: Boolean(key),
    key: includeCredentials ? key || null : null,
    securityJsCode: includeCredentials ? securityJsCode || null : null,
    mode: key ? '浏览器地图已配置' : '路线数据模式'
  };
}

/**
 * historySyncMeta - 为 Java Formal Trip 生成跨设备历史回执。
 *
 * @param {Array<object>} history Java Formal Trip 历史投影
 * @param {object} req Node HTTP 请求
 * @returns {object} 同步范围、版本和最近更新信息
 */
function historySyncMeta(history, req) {
  const latest = history.slice().sort((left, right) => String(right.updatedAt || right.createdAt).localeCompare(String(left.updatedAt || left.createdAt)))[0];
  return {
    scope: 'account',
    authority: 'JAVA_FORMAL_TRIPS',
    serverStored: true,
    crossDeviceReady: true,
    deviceId: requestDeviceId(req),
    historyCount: history.length,
    latestUpdatedAt: latest?.updatedAt || latest?.createdAt || null,
    latestRevision: latest?.syncRevision || 0,
    message: '已保存的正式行程由 Java Core Backend 保存，可在其他设备登录后恢复。',
    syncedAt: new Date().toISOString()
  };
}

/**
 * summarizeFeedback - 将用户反馈聚合为管理员可解释的分析维度。
 *
 * @param {Array<object>} items 已记录的反馈条目
 * @returns {object} 总量、比例、原因、版本、来源与时间趋势
 */
function summarizeFeedback(items = []) {
  const total = items.length;
  const countBy = (key, fallback) => Object.fromEntries([...new Set(items.map((item) => item[key] || fallback))].map((value) => [value, items.filter((item) => (item[key] || fallback) === value).length]));
  const byDay = {};
  for (const item of items) {
    const day = String(item.createdAt || '').slice(0, 10) || '未知日期';
    byDay[day] = (byDay[day] || 0) + 1;
  }
  const measurable = items.filter((item) => Number.isFinite(item.constraintSatisfaction));
  const averageConstraintSatisfaction = measurable.length ? Number((measurable.reduce((sum, item) => sum + item.constraintSatisfaction, 0) / measurable.length).toFixed(2)) : 0;
  return {
    total,
    helpful: items.filter((item) => item.value === 'helpful').length,
    needsWork: items.filter((item) => item.value === 'needs-work').length,
    letters: items.filter((item) => item.value === 'letter').length,
    helpfulRate: total ? Number((items.filter((item) => item.value === 'helpful').length / total).toFixed(2)) : 0,
    needsWorkRate: total ? Number((items.filter((item) => item.value === 'needs-work').length / total).toFixed(2)) : 0,
    averageConstraintSatisfaction,
    byReason: countBy('reason', '未填写'),
    byVersion: countBy('tripVersion', '未知版本'),
    bySourceMode: countBy('sourceMode', '未声明'),
    byDay: Object.fromEntries(Object.entries(byDay).sort(([left], [right]) => left.localeCompare(right))),
    recent: items.slice(-8).reverse()
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

async function listCachedExploreAttractions(category = '') {
  const cacheKey = String(category || '');
  const now = Date.now();
  const cached = exploreCatalogCache.get(cacheKey);
  if (cached?.items && cached.expiresAt > now) return clone(cached.items);
  if (cached?.loading) return clone(await cached.loading);

  const loading = javaCore.listAttractions({ category: cacheKey })
    .then((items) => {
      const normalized = Array.isArray(items) ? items : [];
      exploreCatalogCache.set(cacheKey, {
        items: normalized,
        expiresAt: Date.now() + EXPLORE_CACHE_TTL_MS
      });
      return normalized;
    })
    .catch((error) => {
      // 失败不缓存，下一次请求仍可直接重试 Java Core Backend。
      exploreCatalogCache.delete(cacheKey);
      throw error;
    });

  exploreCatalogCache.set(cacheKey, { loading, expiresAt: 0 });
  return clone(await loading);
}

/**
 * summarizeAttractions - 将 Java 景点目录转换为管理员资产概览。
 *
 * 景点目录仍由 Java Core Backend 负责，BFF 只做展示侧聚合，不复制景点事实或
 * 在 Node 端维护第二份目录。内容完整度只统计结构化字段是否已填充，不能替代
 * 知识文档的核验状态。
 */
function summarizeAttractions(items = []) {
  const contentFields = ['summary', 'intro', 'fit', 'walk', 'duration', 'ticket', 'bestTime'];
  const list = Array.isArray(items) ? items.filter((item) => item && typeof item === 'object') : [];
  const countBy = (values) => {
    const counts = {};
    for (const value of values.filter(Boolean)) counts[value] = (counts[value] || 0) + 1;
    return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right, 'zh-CN')));
  };
  const assets = list.map((item) => {
    const filledFields = contentFields.filter((field) => String(item[field] || '').trim()).length;
    return {
      id: String(item.id || ''),
      name: String(item.displayName || item.name || ''),
      district: String(item.district || ''),
      category: String(item.category || ''),
      indoor: Boolean(item.indoor),
      walkDifficulty: String(item.walkDifficulty || ''),
      duration: String(item.duration || ''),
      summary: String(item.summary || ''),
      tags: Array.isArray(item.tags) ? item.tags.map((tag) => String(tag)) : [],
      contentFieldCount: filledFields,
      contentFieldTotal: contentFields.length,
      contentCoverage: contentFields.length ? Number((filledFields / contentFields.length).toFixed(2)) : 0
    };
  });
  const complete = assets.filter((item) => item.contentFieldCount === item.contentFieldTotal).length;
  const contentCoverage = assets.length
    ? Number((assets.reduce((sum, item) => sum + item.contentCoverage, 0) / assets.length).toFixed(2))
    : 0;
  return {
    available: true,
    source: 'Java Core Backend / attraction',
    total: assets.length,
    indoor: assets.filter((item) => item.indoor).length,
    outdoor: assets.filter((item) => !item.indoor).length,
    districtCount: Object.keys(countBy(assets.map((item) => item.district))).length,
    categoryCount: Object.keys(countBy(assets.map((item) => item.category))).length,
    districts: countBy(assets.map((item) => item.district)),
    categories: countBy(assets.map((item) => item.category)),
    content: {
      complete,
      partial: assets.length - complete,
      coverage: contentCoverage,
      fieldTotal: contentFields.length
    },
    items: assets
  };
}

function json(res, status, payload, { cookies = [] } = {}) {
  const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
  if (cookies.length) headers['set-cookie'] = cookies;
  res.writeHead(status, headers);
  res.end(JSON.stringify(payload));
}

const CHAT_PROXY_TIMEOUT_MS = Math.max(1000, Number(process.env.YUYOUZHICE_JAVA_STREAM_TIMEOUT_MS || 120000));

function writeChatSse(res, event, data) {
  if (res.destroyed || res.writableEnded) return false;
  res.write(`event: ${event}\ndata: ${String(data)}\n\n`);
  return true;
}

async function pipeChatStream(stream, res, requestSignal) {
  const readable = typeof stream.body.getReader === 'function' ? Readable.fromWeb(stream.body) : stream.body;
  let clientAborted = Boolean(requestSignal?.aborted);
  let timedOut = false;
  let doneSeen = false;
  let probe = '';

  const abortForClient = () => {
    clientAborted = true;
    stream.abort?.();
    readable.destroy?.();
    if (!res.writableEnded && !res.destroyed) res.end();
  };
  requestSignal?.addEventListener('abort', abortForClient, { once: true });

  let timer = setTimeout(() => {
    if (clientAborted || doneSeen || res.writableEnded || res.destroyed) return;
    timedOut = true;
    stream.abort?.();
    writeChatSse(res, 'error', 'BFF 对话流等待超时，请重新提问。');
    writeChatSse(res, 'done', 'complete');
    if (!res.writableEnded && !res.destroyed) res.end();
    readable.destroy?.();
  }, CHAT_PROXY_TIMEOUT_MS);

  const resetTimer = () => {
    if (timer) clearTimeout(timer);
    if (!clientAborted && !doneSeen && !res.writableEnded && !res.destroyed) {
      timer = setTimeout(() => {
        if (clientAborted || doneSeen || res.writableEnded || res.destroyed) return;
        timedOut = true;
        stream.abort?.();
        writeChatSse(res, 'error', 'BFF 对话流等待超时，请重新提问。');
        writeChatSse(res, 'done', 'complete');
        if (!res.writableEnded && !res.destroyed) res.end();
        readable.destroy?.();
      }, CHAT_PROXY_TIMEOUT_MS);
    }
  };

  try {
    for await (const chunk of readable) {
      if (clientAborted || res.destroyed || res.writableEnded) break;
      resetTimer();
      const text = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
      probe = (probe + text).slice(-256);
      if (/event:\s*done(?:\r?\n|$)/.test(probe)) doneSeen = true;
      if (!res.writableEnded && !res.destroyed) res.write(chunk);
      if (doneSeen) {
        if (timer) clearTimeout(timer);
        if (!res.writableEnded && !res.destroyed) res.end();
        stream.abort?.();
        readable.destroy?.();
        break;
      }
    }

    if (!clientAborted && !timedOut && !doneSeen && !res.destroyed && !res.writableEnded) {
      writeChatSse(res, 'error', 'Java 对话流提前断开，请重新提问。');
      writeChatSse(res, 'done', 'complete');
      res.end();
    } else if (!res.destroyed && !res.writableEnded) {
      res.end();
    }
  } catch (error) {
    if (!clientAborted && !timedOut && !res.destroyed && !res.writableEnded) {
      console.error(`[BFF] chat stream failed: ${error?.name || 'UnknownError'}`);
      writeChatSse(res, 'error', 'Java 对话流连接中断，请重新提问。');
      writeChatSse(res, 'done', 'complete');
      res.end();
    }
  } finally {
    clearTimeout(timer);
    requestSignal?.removeEventListener('abort', abortForClient);
    stream.cleanup?.();
  }
}

async function body(req) {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}

function tokenExpiresAt(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    return Number.isFinite(payload?.exp) ? Number(payload.exp) * 1000 : null;
  } catch {
    return null;
  }
}

function sessionForRequest(req) {
  let id = requestSessionId(req);
  let compatibility = false;
  if (!id) {
    id = testBearerSessionId(req);
    compatibility = Boolean(id);
  }
  if (!id) return null;
  const session = webSessions.get(id);
  if (!session) return null;
  req.authCompatibility = compatibility;
  req.webSession = session;
  return session;
}

async function authUser(req) {
  const session = sessionForRequest(req);
  if (!session) return null;
  try {
    const data = await javaCore.me(session.javaToken);
    const user = normalizeJavaPrincipal(data);
    if (!user.id || user.status !== 'active') throw new JavaCoreError(401, 'AUTH_UNAUTHENTICATED', '登录状态已失效。');
    req.webSession = webSessions.update(session.id, { user });
    return user;
  } catch {
    webSessions.destroy(session.id);
    req.webSession = null;
    return null;
  }
}

function authSessionFromResult(result) {
  const user = normalizeJavaPrincipal(result?.user || {});
  const token = String(result?.token || '');
  if (!user.id || !token) throw new JavaCoreError(502, 'JAVA_AUTH_INVALID', 'Java Core Backend 未返回有效登录状态。');
  const expiresAt = tokenExpiresAt(token);
  const syntheticAuthority = process.env.YUYOUZHICE_TEST_FIXTURES === '1' || process.env.YUYOUZHICE_TEST_SESSION_COMPAT === '1' || process.env.YUYOUZHICE_JAVA_TEST_STUB === '1';
  if (!expiresAt && !syntheticAuthority) throw new JavaCoreError(502, 'JAVA_AUTH_INVALID', 'Java Core Backend 未返回有效令牌期限。');
  return { user, token, session: webSessions.create({ javaToken: token, user, tokenExpiresAt: expiresAt || Date.now() + SESSION_TTL_MS }) };
}

function authSessionCookies(session) {
  const maxAge = Math.max(0, Math.floor((session.expiresAt - Date.now()) / 1000));
  return [sessionCookie(session.id, maxAge), csrfCookie(session.csrfToken, maxAge)];
}

async function adminUser(req) {
  const user = await authUser(req);
  return user?.role === 'admin' ? user : null;
}

function javaTokenFor(req) {
  return req.webSession?.javaToken || '';
}

function ensureAccountCollections(userId) {
  if (!feedbackByUser.has(userId)) feedbackByUser.set(userId, []);
}

function legacyPreferenceValues(preferences = {}) {
  const values = [];
  for (const interest of Array.isArray(preferences.interests) ? preferences.interests : []) {
    if (String(interest).trim()) values.push(String(interest).trim());
  }
  const walking = String(preferences.walkingTolerance || '').toUpperCase();
  if (walking === 'LOW') values.push('少走路');
  else if (walking === 'HIGH') values.push('步行优先');
  const transport = String(preferences.transportPreference || '').toUpperCase();
  const transportLabels = {
    PUBLIC_TRANSIT: '公共交通优先', WALKING: '步行优先', DRIVING: '驾车优先',
    TAXI: '打车优先', BICYCLE: '骑行优先', MIXED: '混合出行'
  };
  if (transportLabels[transport]) values.push(transportLabels[transport]);
  const diet = String(preferences.dietPreference || '').toUpperCase();
  const dietLabels = { VEGETARIAN: '素食', VEGAN: '纯素', HALAL: '清真', KOSHER: '犹太洁食', ALLERGY: '过敏原避让' };
  if (dietLabels[diet]) values.push(dietLabels[diet]);
  if (preferences.stayArea) values.push(`住宿区域：${preferences.stayArea}`);
  return [...new Set(values)];
}

function legacyPreferencePatch(value, current = {}) {
  const text = String(value || '').trim();
  if (!text) return null;
  const interests = Array.isArray(current.interests) ? [...current.interests] : [];
  const patch = {};
  if (text === '少走路' || text === '不想走太多路') patch.walkingTolerance = 'LOW';
  else if (text === '正常步行' || text === '步行正常') patch.walkingTolerance = 'NORMAL';
  else if (text === '打车优先' || text === '出租车优先') patch.transportPreference = 'TAXI';
  else if (text === '公共交通优先' || text === '地铁优先') patch.transportPreference = 'PUBLIC_TRANSIT';
  else if (text === '步行优先') patch.transportPreference = 'WALKING';
  else if (text === '驾车优先') patch.transportPreference = 'DRIVING';
  else if (['素食', '纯素', '清真', '犹太洁食', '过敏原避让'].includes(text)) {
    patch.dietPreference = { 素食: 'VEGETARIAN', 纯素: 'VEGAN', 清真: 'HALAL', 犹太洁食: 'KOSHER', 过敏原避让: 'ALLERGY' }[text];
  } else if (['公交优先', '公交'].includes(text)) {
    return { unsupported: true };
  } else {
    if (!interests.includes(text)) interests.push(text);
    patch.interests = interests;
  }
  return { patch };
}

const guestSlotsStore = new Map();
const guestPrependPromptStore = globalThis.__guestPrependPromptStore || (globalThis.__guestPrependPromptStore = new Map());

function preferenceResponse(preferences, history = []) {
  const typed = preferences || {};
  const values = legacyPreferenceValues(typed);
  const diningSlots = Array.isArray(typed.legacyMetadata?.diningSlots) ? typed.legacyMetadata.diningSlots : [];
  const attractionSlots = Array.isArray(typed.legacyMetadata?.attractionSlots) ? typed.legacyMetadata.attractionSlots : [];
  return {
    preferences: values,
    formalPreferences: typed,
    diningSlots,
    attractionSlots,
    history: Array.isArray(history) ? history : []
  };
}

function recordLegacyPreferenceEvent(userId, event) {
  const events = legacyPreferenceEvents.get(userId) || [];
  events.push({ ...event, createdAt: new Date().toISOString(), type: 'EXPLICIT_PREFERENCE', source: 'JAVA_PREFERENCES_AUTHORITY' });
  legacyPreferenceEvents.set(userId, events.slice(-50));
  return events;
}

const SAFE_JAVA_ERROR_MESSAGES = Object.freeze({
  AUTH_UNAUTHENTICATED: '登录状态已失效，请重新登录。',
  AUTH_FORBIDDEN: '当前账号没有执行此操作的权限。',
  AUTH_INVALID_REQUEST: '登录请求无效。',
  AUTH_INVALID_CREDENTIALS: '登录信息不匹配。',
  USER_CONFLICT: '该账号已存在，请直接登录。',
  USER_NOT_FOUND: '用户不存在。',
  CONFLICT: '数据版本已变化，请刷新后重试。',
  PREFERENCE_CONFLICT: '偏好版本已变化，请刷新后重试。',
  JAVA_REQUEST_REJECTED: '请求未被 Java Core Backend 接受。'
});

function safeJavaErrorMessage(error, fallback = 'Java Core Backend 请求失败。') {
  if (!(error instanceof JavaCoreError)) return fallback;
  return SAFE_JAVA_ERROR_MESSAGES[error.code] || fallback;
}

function javaErrorResponse(res, error, fallback = 'Java Core Backend 请求失败。') {
  if (!(error instanceof JavaCoreError)) throw error;
  const payload = {
    ok: false,
    code: error.code,
    message: safeJavaErrorMessage(error, fallback)
  };
  if (error.requestId) payload.requestId = String(error.requestId);
  return json(res, error.status || 502, payload);
}

function plannerAdjustmentErrorResponse(res, error, fallback) {
  if (!(error instanceof JavaCoreError)) {
    const requestId = randomUUID();
    const diagnostics = diagnosticError(error);
    console.error(`[BFF][planner-error] ${JSON.stringify({ requestId, ...diagnostics })}`);
    void writeBffDiagnostic('planner-error', { requestId, ...diagnostics });
    return json(res, 502, {
      ok: false,
      code: 'BFF_PLANNER_INTERNAL_ERROR',
      requestId,
      message: '规划服务内部处理失败，请稍后重试。'
    });
  }
  const payload = {
    ok: false,
    code: error.code,
    message: error.code === 'JAVA_REQUEST_REJECTED' ? error.message : safeJavaErrorMessage(error, fallback)
  };
  if (error.details) payload.details = error.details;
  if (error.requestId) payload.requestId = String(error.requestId);
  return json(res, error.status || 502, payload);
}

function candidateValidityError(candidate, candidateError, message) {
  if (candidate?.ok !== false && candidate?.trip) return null;
  if (candidateError instanceof JavaCoreError) return candidateError;
  return new JavaCoreError(502, 'JAVA_CANDIDATE_INVALID', message);
}

function chatModificationKind(message) {
  const text = String(message || '');
  if (/(记住|以后|偏好|默认|习惯)/.test(text)) return 'UPDATE_PREFERENCE';
  if (/(替换|换掉|换一个|移除|删除|加入|添加|调整|改成|不要这个)/.test(text)) return 'MODIFY_PLAN';
  return 'TRAVEL_QA';
}

function findChatTarget(trip, message) {
  const text = String(message || '');
  const stops = (trip?.days || []).flatMap((day) => day.stops || []);
  return stops.find((stop) => [stop.name, stop.displayName, stop.venueId, stop.id]
    .filter(Boolean).some((value) => text.includes(String(value)))) || null;
}

function chatPreferencePatch(message, current = {}) {
  const text = String(message || '');
  if (/少走路|少爬坡|少台阶/.test(text)) return { walkingTolerance: 'LOW' };
  if (/正常步行|步行正常/.test(text)) return { walkingTolerance: 'NORMAL' };
  if (/打车|出租车/.test(text)) return { transportPreference: 'TAXI' };
  if (/公交|地铁|轻轨|公共交通/.test(text)) return { transportPreference: 'PUBLIC_TRANSIT' };
  if (/素食/.test(text)) return { dietPreference: 'VEGETARIAN' };
  if (/清真/.test(text)) return { dietPreference: 'HALAL' };
  const interest = text.match(/(?:喜欢|偏好|想看|想体验)\\s*([^，。；;]+)/)?.[1]?.trim();
  if (interest) return { interests: [...new Set([...(current.interests || []), interest])] };
  return null;
}

function savedTripProjection(formalTrip, versions = []) {
  const formal = formalTrip && typeof formalTrip === 'object' ? formalTrip : {};
  const plan = clone(formal.plan && typeof formal.plan === 'object' ? formal.plan : {});
  const id = String(formal.id || plan.formalTripId || '');
  plan.formalTripId = id;
  plan.savedTripId = id;
  plan.title = String(formal.title || plan.title || '未命名行程');
  plan.version = Number(formal.currentVersion || plan.version || 1);
  return {
    id,
    savedAt: new Date(Number(formal.updatedAt || formal.createdAt || Date.now())).toISOString(),
    trip: plan,
    versionHistory: Array.isArray(versions) ? versions.map((version) => ({
      version: Number(version.versionNumber || version.version || 1),
      savedAt: new Date(Number(version.createdAt || formal.updatedAt || Date.now())).toISOString(),
      label: String(version.changeReason || version.label || '保存版本')
    })) : []
  };
}

function formalTripHistoryProjection(formalTrip) {
  const saved = savedTripProjection(formalTrip);
  const trip = saved.trip;
  return {
    id: saved.id,
    createdAt: saved.savedAt,
    updatedAt: saved.savedAt,
    syncRevision: Number(trip.version || 1),
    lastDeviceId: 'Java Core Backend',
    crossDeviceReady: true,
    prompt: String(trip.prompt || trip.input || '已保存正式行程'),
    constraints: clone(trip.constraints || {}),
    title: String(trip.title || '未命名行程'),
    version: Number(trip.version || 1),
    replanHistory: saved.versionHistory
  };
}

function openFormalTripSession(formalTrip, { userId, deviceId } = {}) {
  const saved = savedTripProjection(formalTrip);
  const trip = clone(saved.trip);
  const now = new Date().toISOString();
  const session = {
    id: `session-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    input: String(trip.prompt || trip.input || ''),
    trip,
    shadow: null,
    candidateSource: clone(trip.sourceStatus || { provider: 'Java Core Backend' }),
    candidateAppliedPreferences: clone(trip.appliedPreferences || {}),
    constraints: clone(trip.constraints || {}),
    preferencesApplied: [],
    createdAt: now,
    updatedAt: now,
    syncRevision: Number(trip.version || 1),
    replanHistory: [],
    feedback: [],
    userId: userId || null,
    deviceId: deviceId || null,
    formalTripId: saved.id,
    chatProposal: null,
    javaSessionId: null,
    sessionAccessToken: '',
    legacyMode: true,
    adjustmentCapability: 'LEGACY'
  };
  sessions.set(session.id, session);
  return session;
}

function plannerCapability(session) {
  const isLegacy = !String(session?.javaSessionId || '').trim();
  return {
    legacyMode: isLegacy,
    adjustmentCapability: isLegacy ? 'LEGACY' : 'V1_PROPOSAL'
  };
}

function tripPdfFilename(title) {
  const safeTitle = String(title || '重庆旅行行程')
    .replace(/[\\/:*?"<>|\u0000-\u001F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80) || '重庆旅行行程';
  return `${safeTitle}-行程手册.pdf`;
}

async function multipartBody(req, maxBytes = 60 * 1024 * 1024) {
  const contentType = String(req.headers['content-type'] || '');
  const match = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!match) throw new Error('缺少 multipart boundary');
  const boundary = match[1] || match[2];
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes) throw new Error('上传文件超过大小限制');
    chunks.push(Buffer.from(chunk));
  }
  const input = Buffer.concat(chunks);
  const delimiter = Buffer.from(`--${boundary}`);
  const separator = Buffer.from('\r\n\r\n');
  const fields = {};
  let file = null;
  let cursor = 0;
  while (cursor < input.length) {
    const partStart = input.indexOf(delimiter, cursor);
    if (partStart < 0) break;
    const afterDelimiter = partStart + delimiter.length;
    if (input.subarray(afterDelimiter, afterDelimiter + 2).toString() === '--') break;
    const headerStart = afterDelimiter + 2;
    const headerEnd = input.indexOf(separator, headerStart);
    if (headerEnd < 0) break;
    const headers = input.subarray(headerStart, headerEnd).toString('utf8');
    const nextPart = input.indexOf(delimiter, headerEnd + separator.length);
    if (nextPart < 0) break;
    const valueEnd = nextPart - 2;
    const value = input.subarray(headerEnd + separator.length, Math.max(headerEnd + separator.length, valueEnd));
    const nameMatch = headers.match(/name="([^"]+)"/i);
    if (!nameMatch) { cursor = nextPart; continue; }
    const name = nameMatch[1];
    const filenameMatch = headers.match(/filename="([^"]*)"/i);
    if (filenameMatch && filenameMatch[1]) {
      const typeMatch = headers.match(/content-type:\s*([^\r\n]+)/i);
      file = { name: filenameMatch[1], type: String(typeMatch?.[1] || 'application/octet-stream').trim(), bytes: value };
    } else {
      fields[name] = value.toString('utf8');
    }
    cursor = nextPart;
  }
  return { fields, file };
}

/**
 * 对话中的“当前行程偏好”只能来自已授权的 BFF 规划草稿，不能直接相信浏览器传参。
 * 它是本次规划的临时快照，不会写入用户长期偏好或 Redis 自动槽位。
 */
function planChatContext(session) {
  const constraints = session?.trip?.constraints;
  const days = Array.isArray(session?.trip?.days) ? session.trip.days : [];
  const currentStops = days.flatMap((day) => Array.isArray(day?.stops) ? day.stops : []).map((stop) => ({
    name: String(stop?.name || '').trim(),
    address: String(stop?.address || '').trim(),
    duration: String(stop?.duration || '').trim(),
    summary: String(stop?.summary || stop?.intro || '').trim(),
    aiGuide: String(stop?.aiGuide || '').trim()
  })).filter((s) => Boolean(s.name)).slice(0, 20);

  const compact = {
    companions: String(constraints?.companions || '').trim(),
    walkingTolerance: String(constraints?.walkingTolerance || '').trim(),
    interests: Array.isArray(constraints?.interests) ? constraints.interests.map((item) => String(item).trim()).filter(Boolean).slice(0, 12) : [],
    transportPreference: String(constraints?.transportPreference || '').trim(),
    dietPreference: String(constraints?.dietPreference || '').trim(),
    stayArea: String(constraints?.stayArea || '').trim(),
    budget: constraints?.budget && typeof constraints.budget === 'object' ? constraints.budget : null,
    currentStops
  };
  return JSON.stringify(compact).slice(0, 3600);
}

// A formal Trip has its own working memory. It is deliberately distinct from
// Java's account-level long-term memories: this snapshot describes only the
// conditions that shaped this specific itinerary and can never overwrite the
// user's confirmed long-term preferences.
function itineraryMemorySnapshot(session) {
  const trip = session?.trip && typeof session.trip === 'object' ? session.trip : {};
  const constraints = trip.constraints && typeof trip.constraints === 'object' ? trip.constraints : (session?.constraints || {});
  return {
    scope: 'ITINERARY',
    formalTripId: String(session?.formalTripId || trip.formalTripId || '').trim() || null,
    tripVersion: Number(trip.version || session?.syncRevision || 1),
    constraints: {
      companions: String(constraints.companions || '').trim(),
      walkingTolerance: String(constraints.walkingTolerance || '').trim(),
      interests: Array.isArray(constraints.interests) ? constraints.interests.map((item) => String(item).trim()).filter(Boolean).slice(0, 12) : [],
      transportPreference: String(constraints.transportPreference || '').trim(),
      dietPreference: String(constraints.dietPreference || '').trim(),
      stayArea: String(constraints.stayArea || '').trim(),
      budget: constraints.budget && typeof constraints.budget === 'object' ? clone(constraints.budget) : null
    },
    appliedPreferences: clone(session?.candidateAppliedPreferences || trip.appliedPreferences || []),
    updatedAt: new Date().toISOString()
  };
}

function hydrateFormalTripWorkspace(session) {
  const userId = String(session?.userId || '').trim();
  const formalTripId = String(session?.formalTripId || '').trim();
  if (!userId || !formalTripId) return null;
  const workspace = persistentStore.getTripWorkspace?.(userId, formalTripId);
  if (!workspace) {
    session.itineraryMemorySnapshot = session.itineraryMemorySnapshot || itineraryMemorySnapshot(session);
    return null;
  }
  session.plannerConversationContext = workspace.plannerConversationContext || null;
  session.itineraryMemorySnapshot = workspace.itineraryMemorySnapshot || itineraryMemorySnapshot(session);
  return workspace;
}

async function persistFormalTripWorkspace(session, patch = {}) {
  const userId = String(session?.userId || '').trim();
  const formalTripId = String(session?.formalTripId || '').trim();
  if (!userId || !formalTripId) return null;
  session.itineraryMemorySnapshot = itineraryMemorySnapshot(session);
  return persistentStore.saveTripWorkspace?.({
    userId,
    formalTripId,
    workspace: {
      plannerConversationContext: session.plannerConversationContext || null,
      itineraryMemorySnapshot: session.itineraryMemorySnapshot,
      ...patch
    }
  });
}

/**
 * Rehydrate a process-local BFF draft after a restart. The browser only
 * knows the opaque BFF id; Java owns the durable Planner Session. The
 * encrypted capability is read only on the server and is immediately checked
 * by Java before the draft is accepted back into the in-memory map.
 */
async function restorePlannerSession(sessionId, req) {
  const id = String(sessionId || '').trim();
  if (!id) return null;
  const current = sessions.get(id);
  if (current) return current;

  const draft = persistentStore.getPlannerDraft?.(id);
  if (!draft) return null;

  const deviceId = requestDeviceId(req);
  if (draft.deviceId && draft.deviceId !== deviceId) {
    console.warn('[BFF][planner-restore-denied]', JSON.stringify({ reason: 'DEVICE_MISMATCH', hasUser: Boolean(draft.userId) }));
    return null;
  }
  const webSession = sessionForRequest(req);
  if (draft.userId && webSession?.user?.id !== draft.userId) {
    console.warn('[BFF][planner-restore-denied]', JSON.stringify({ reason: 'USER_MISMATCH', hasWebSession: Boolean(webSession) }));
    return null;
  }
  if (!draft.javaSessionId) {
    hydrateFormalTripWorkspace(draft);
    sessions.set(id, draft);
    return draft;
  }

  try {
    const restored = await javaCore.getPlannerSession(draft.javaSessionId, {
      token: javaTokenFor(req),
      sessionAccessToken: draft.sessionAccessToken
    });
    if (!restored?.trip) return null;
    const session = {
      ...draft,
      trip: clone(restored.trip),
      syncRevision: Number(restored.syncRevision || restored.currentVersion || draft.syncRevision || 1),
      updatedAt: new Date().toISOString(),
      legacyMode: false,
      adjustmentCapability: 'V1_PROPOSAL'
    };
    hydrateFormalTripWorkspace(session);
    sessions.set(id, session);
    console.info('[BFF][planner-restore]', JSON.stringify({
      restored: true,
      hasJavaPlannerSession: true,
      revision: session.syncRevision,
      hasUser: Boolean(session.userId)
    }));
    return session;
  } catch (error) {
    console.warn('[BFF][planner-restore-failed]', JSON.stringify({
      code: error?.code || 'JAVA_SESSION_UNAVAILABLE',
      status: error?.status || 0,
      hasJavaPlannerSession: true
    }));
    return null;
  }
}

function legacyAdjustmentResponse(sessionId, operation) {
  return {
    ok: false,
    sessionId,
    type: 'LEGACY_ADJUSTMENT_UNSUPPORTED',
    operation,
    legacyMode: true,
    adjustmentCapability: 'LEGACY',
    modified: false,
    message: '当前保存行程没有 Java Planner V1 会话，不支持新版 AI 局部调整。请重新生成行程后再使用预览与确认。'
  };
}

function plannerStopFromReference(trip, reference) {
  const text = String(reference || '').trim();
  if (!text || !trip || typeof trip !== 'object') return null;
  const stops = Array.isArray(trip.days)
    ? trip.days.flatMap((day) => Array.isArray(day?.stops) ? day.stops : [])
    : [];
  const matches = stops.filter((stop) => {
    const name = String(stop?.name || '').trim();
    return name && (name === text || name.includes(text) || text.includes(name));
  });
  return matches.length === 1 ? matches[0] : null;
}

function isBriefPlannerFollowUp(message) {
  const text = String(message || '').trim();
  if (!text || text.length > 28) return false;
  return !/(替换|换成|换为|改成|改为|推荐|景点|行程|室内|同片区|附近|删除|移除|加上|添加|下雨|少走路|重排)/.test(text);
}

function plannerContinuation(session, sourceContext = {}) {
  const fromRequest = sourceContext.pendingClarification && typeof sourceContext.pendingClarification === 'object'
    ? sourceContext.pendingClarification
    : null;
  const stored = session?.plannerConversationContext && typeof session.plannerConversationContext === 'object'
    ? session.plannerConversationContext
    : null;
  return fromRequest || stored;
}

function plannerConversationRequest(input = {}, session, targetSessionId) {
  const sourceContext = input.context && typeof input.context === 'object' ? input.context : {};
  const requestedProposalId = String(sourceContext.activeProposalId ?? input.activeProposalId ?? '').trim() || null;
  const storedProposal = session?.chatProposal && typeof session.chatProposal === 'object'
    ? session.chatProposal
    : null;
  const proposalMatches = storedProposal
    && requestedProposalId
    && String(storedProposal.proposalId || '') === String(requestedProposalId);
  const recoveredTargetStopId = proposalMatches
    ? String(storedProposal.intent?.targetStopId || storedProposal.changedSegments?.[0] || '').trim() || null
    : null;
  let selectedStopId = String(sourceContext.selectedStopId ?? input.selectedStopId ?? '').trim()
    || recoveredTargetStopId
    || null;
  let message = String(input.message || '').trim();
  const continuation = plannerContinuation(session, sourceContext);
  const pendingOperation = String(continuation?.operation || '').trim();
  // “改一下景点”后的“洪崖洞”是上一轮澄清问题的答案，不是新的孤立指令。
  // 当没有页面选中站点时，恢复这份未完成上下文并把简短景点名补成可执行的替换候选请求。
  if (!selectedStopId
      && /^(REPLACE_STOP|SUGGEST_REPLACEMENTS|REPLAN_DAY)$/i.test(pendingOperation)
      && isBriefPlannerFollowUp(message)) {
    const matchedStop = plannerStopFromReference(session?.trip, message);
    if (matchedStop?.id && matchedStop?.name) {
      selectedStopId = String(matchedStop.id);
      message = `请推荐${String(matchedStop.name)}的同片区可替换景点`;
    }
  }
  const selectedStopIds = Array.isArray(sourceContext.selectedStopIds)
    ? sourceContext.selectedStopIds.map((id) => String(id)).filter(Boolean)
    : (Array.isArray(input.selectedStopIds) ? input.selectedStopIds.map((id) => String(id)).filter(Boolean) : []);
  const context = {
    activeDay: Number(sourceContext.activeDay ?? input.activeDay ?? 1),
    selectedStopId,
    activeProposalId: requestedProposalId,
    pinnedStopIds: Array.isArray(sourceContext.pinnedStopIds)
      ? sourceContext.pinnedStopIds.map((id) => String(id)).filter(Boolean)
      : (Array.isArray(input.pinnedStopIds) ? input.pinnedStopIds.map((id) => String(id)).filter(Boolean) : [])
  };
  if (selectedStopIds.length) context.selectedStopIds = selectedStopIds;
  return {
    planId: String(input.planId || session?.id || ''),
    sessionId: String(targetSessionId || ''),
    baseRevision: Number(input.baseRevision || session?.trip?.version || 1),
    message,
    context,
    sessionAccessToken: String(input.sessionAccessToken || session?.sessionAccessToken || ''),
    idempotencyKey: String(input.idempotencyKey || '')
  };
}

function plannerApplyRequest(input = {}, session) {
  return {
    proposalId: String(input.proposalId || ''),
    optionId: String(input.optionId || 'option-1'),
    baseRevision: Number(input.baseRevision || session?.trip?.version || 1),
    forceApply: Boolean(input.forceApply),
    sessionAccessToken: String(input.sessionAccessToken || session?.sessionAccessToken || ''),
    idempotencyKey: String(input.idempotencyKey || '')
  };
}

async function createSession(input = '', {
  constraints: overrides = {},
  candidateUsePreferences = false,
  preferenceDecision = '',
  profilePrependPrompt = '',
  javaToken = '',
  userId = null,
  deviceId = null,
  signal
} = {}) {
  const id = `session-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  let prompt = String(input || '');
  if (candidateUsePreferences && profilePrependPrompt && !prompt.includes(profilePrependPrompt)) {
    prompt = `${profilePrependPrompt}\n${prompt}`;
  }

  // Java owns prompt interpretation, candidate calculation, route data, and
  // quality/source metadata. Node only records the transient observation.
  const candidateStartedAt = performance.now();
  let candidate;
  let candidateError = null;
  const retrievalPromise = retrieveTravelKnowledge({ prompt, constraints: overrides || {}, javaCore, signal });
  try {
    candidate = await javaCore.createPlannerPlan({
      prompt,
      freeText: String(input || prompt),
      constraints: overrides || {},
      usePreferences: Boolean(candidateUsePreferences),
      preferenceDecision: String(preferenceDecision || '')
    }, javaToken, signal);
  } catch (error) {
    candidateError = error;
  }
  const candidateLatencyMs = Math.round(performance.now() - candidateStartedAt);
  const shadow = shadowMetrics.record(compareShadow({
    operation: 'plan',
    candidate,
    candidateLatencyMs,
    candidateError
  }));
  const invalidCandidateError = candidateValidityError(candidate, candidateError, 'Java Shadow 候选未返回有效行程。');
  if (invalidCandidateError) throw invalidCandidateError;

  const trip = clone(candidate.trip);
  const constraints = clone(trip.constraints || overrides || {});
  const retrieval = await retrievalPromise;
  trip.retrieval = { ...retrievalStatus(), ...retrieval, reason: retrieval.reason || '' };
  if (retrieval.ok) {
    trip.citations = [...(trip.citations || []), ...retrieval.citations];
    for (const day of trip.days || []) for (const stop of day.stops || []) {
      stop.citations = [...(stop.citations || []), ...retrieval.citations];
      const retrievalNote = String(retrieval.mode || '').startsWith('Java')
        ? '事实由 Java Core RAG 返回；动态信息仍需运行时复核。'
        : '事实由统一检索边界返回；动态信息仍需运行时复核。';
      stop.facts = [...(stop.facts || []), ...retrieval.facts.map((item) => fact(String(item.label || item.key || '检索事实'), String(item.value || item.text || '已返回'), String(item.status || '已核验'), String(item.note || retrievalNote), retrieval.citations))];
    }
  }
  const appliedPreferences = Array.isArray(candidate.appliedPreferences)
    ? clone(candidate.appliedPreferences)
    : legacyPreferenceValues(candidate.appliedPreferences?.appliedFields || {});
  const session = {
    id,
    input: prompt,
    trip,
    shadow,
    candidateSource: clone(candidate.source || trip.sourceStatus || { provider: 'Java Core Backend' }),
    candidateAppliedPreferences: appliedPreferences,
    constraints,
    preferencesApplied: clone(appliedPreferences),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    syncRevision: 1,
    replanHistory: [],
    feedback: [],
    userId,
    deviceId: deviceId || null,
    formalTripId: null,
    chatProposal: null,
    sessionAccessToken: candidate.sessionAccessToken || '',
    javaSessionId: candidate.sessionId || null,
    legacyMode: !candidate.sessionId,
    adjustmentCapability: candidate.sessionId ? 'V1_PROPOSAL' : 'LEGACY',
    plannerVersion: candidate.plannerVersion || trip.plannerVersion || '1.0.0-v1',
    policyVersion: candidate.policyVersion || trip.policyVersion || '2026.08-v1',
    routeDataStatus: candidate.routeDataStatus || trip.routeDataStatus || 'ESTIMATED',
    explanationSource: candidate.explanationSource || trip.explanationSource || 'TEMPLATE',
    degraded: Boolean(candidate.degraded || trip.degraded),
    degradationReasons: candidate.degradationReasons || trip.degradationReasons || []
  };
  sessions.set(id, session);
  await persistentStore.savePlannerDraft?.(session);
  return session;
}

async function api(req, res, url, requestSignal) {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(String(req.method || '').toUpperCase())) {
    const security = assertMutationSecurity(req, sessionForRequest(req), {
      testCompatibility: process.env.YUYOUZHICE_TEST_FIXTURES === '1' || process.env.YUYOUZHICE_TEST_SESSION_COMPAT === '1'
    });
    if (!security.ok) return json(res, security.status, { ok: false, code: security.code, message: security.message });
  }
  if (req.method === 'GET' && url.pathname === '/api/health') {
    return json(res, 200, { ok: true, service: '渝游智策服务', time: new Date().toISOString(), adapter: JAVA_MAP_ADAPTER, retrieval: retrievalStatus(), map: mapConfig(), storage: persistentStore.storageLabel, auth: revocationStore.status });
  }
  if (req.method === 'GET' && url.pathname === '/api/map-config') {
    return json(res, 200, { ok: true, map: mapConfig({ includeCredentials: true }) });
  }
  if (req.method === 'GET' && url.pathname === '/api/retrieval/status') {
    return json(res, 200, { ok: true, checkedAt: new Date().toISOString(), retrieval: retrievalStatus() });
  }
  if (req.method === 'GET' && url.pathname === '/api/shadow/status') {
    return json(res, 200, { ok: true, shadow: shadowMetrics.status() });
  }
  if (req.method === 'GET' && url.pathname === '/api/admin/rerank/stats') {
    const user = await authUser(req);
    if (!user) return json(res, 401, { ok: false, message: '登录状态已失效，请重新登录。' });
    if (user.role !== 'admin') return json(res, 403, { ok: false, message: '需要管理员权限。' });
    try {
      const stats = await javaCore.ragStats(javaTokenFor(req));
      return json(res, 200, { ok: true, stats: stats?.cacheStats || {}, retrieval: stats?.retrieval || null });
    } catch (error) {
      return javaErrorResponse(res, error, '无法读取 Java Rerank 统计。');
    }
  }
  if (req.method === 'POST' && url.pathname === '/api/admin/rerank/cache/clear') {
    const user = await authUser(req);
    if (!user) return json(res, 401, { ok: false, message: '登录状态已失效，请重新登录。' });
    if (user.role !== 'admin') return json(res, 403, { ok: false, message: '需要管理员权限。' });
    try {
      const result = await javaCore.clearRerankCache(javaTokenFor(req));
      return json(res, 200, { ok: true, result, message: 'Rerank 缓存已清空。' });
    } catch (error) {
      return javaErrorResponse(res, error, 'Rerank 缓存清理失败。');
    }
  }
  if (req.method === 'GET' && url.pathname === '/api/admin/overview') {
    const user = await authUser(req);
    if (!user) return json(res, 401, { ok: false, message: '登录状态已失效，请重新登录。' });
    if (user.role !== 'admin') return json(res, 403, { ok: false, message: '需要管理员权限。' });
    let javaUsers;
    try {
      const listed = await javaCore.listUsers(javaTokenFor(req));
      // Java AdminController returns { total, items }; older adapters used
      // users/content. Accept all known shapes, with Java as the authority.
      const rawUsers = Array.isArray(listed)
        ? listed
        : listed?.items || listed?.users || listed?.content || [];
      javaUsers = rawUsers.map((item) => normalizeJavaPrincipal(item));
    } catch (error) {
      return javaErrorResponse(res, error, '无法读取 Java 用户目录。');
    }
    const users = javaUsers;
    const facts = [];
    const feedbackItems = [...feedbackByUser.entries()]
      .flatMap(([ownerId, items]) => (items || []).map((item) => ({
        ...item,
        scope: 'account',
        ownerId: String(ownerId || '')
      })))
      .sort((left, right) => String(right.createdAt || '').localeCompare(String(left.createdAt || '')));
    const userDirectory = users.map((item) => ({
      ...item,
      createdAt: item.createdAt || null,
      savedTrips: Number.isFinite(Number(item.savedTrips)) ? Number(item.savedTrips) : 0,
      historySessions: null,
      memories: Number.isFinite(Number(item.memories)) ? Number(item.memories) : 0,
      profileConfigured: item.profileConfigured === true,
      feedback: (feedbackByUser.get(item.id) || []).length
    }));
    let attractions = {
      available: false,
      source: 'Java Core Backend / attraction',
      total: null,
      items: [],
      reason: '景点目录暂不可用'
    };
    try {
      const listedAttractions = await javaCore.listAttractions({});
      attractions = summarizeAttractions(listedAttractions);
    } catch (error) {
      void writeBffDiagnostic('admin-attraction-summary-error', diagnosticError(error));
    }
    let analytics = { available: false, dashboard: null, hotQuestions: [], reason: '运营日志暂不可用' };
    try {
      const [dashboard, hotQuestions] = await Promise.all([
        javaCore.analyticsDashboard('today', javaTokenFor(req)),
        javaCore.analyticsHotQuestions('today', 8, javaTokenFor(req))
      ]);
      analytics = {
        available: true,
        dashboard: dashboard || {},
        hotQuestions: Array.isArray(hotQuestions) ? hotQuestions : []
      };
    } catch (error) {
      analytics.reason = '运营日志暂不可用';
      void writeBffDiagnostic('admin-analytics-summary-error', diagnosticError(error));
    }
    const scoredFeedback = feedbackItems.filter((item) => Number.isFinite(Number(item.constraintSatisfaction)));
    const feedbackScore = scoredFeedback.length
      ? scoredFeedback.reduce((total, item) => total + Number(item.constraintSatisfaction), 0) / scoredFeedback.length
      : null;
    const qualityMetrics = {
      available: scoredFeedback.length > 0,
      measuredTrips: scoredFeedback.length,
      avgConstraintSatisfaction: feedbackScore,
      avgCitationCoverage: null,
      avgDataCoverage: Number.isFinite(Number(attractions.content?.coverage)) ? Number(attractions.content.coverage) : null,
      unknownFacts: null,
      dynamicFacts: null
    };
    const knowledge = await knowledgeAdminStatus(javaCore, javaTokenFor(req));
    return json(res, 200, {
      ok: true,
      generatedAt: new Date().toISOString(),
      serviceHealth: { adapter: JAVA_MAP_ADAPTER, storage: persistentStore.storageLabel },
      retrieval: retrievalStatus(),
      metrics: {
        users: users.length,
        travelers: users.filter((item) => item.role === 'traveler').length,
        savedTrips: userDirectory.reduce((total, item) => total + Number(item.savedTrips || 0), 0),
        confirmedMemories: userDirectory.reduce((total, item) => total + Number(item.memories || 0), 0),
        feedback: feedbackItems.length,
        formalTripAggregate: 'JAVA_USER_SUMMARY',
        serviceCallsToday: Number(analytics.dashboard?.serviceCount?.today || 0),
        activeSessionsToday: Number(analytics.dashboard?.activeUsers?.current || 0)
      },
      factStatus: Object.fromEntries([...new Set(facts.map((item) => item.status))].map((status) => [status, facts.filter((item) => item.status === status).length])),
      citationCoverage: facts.length ? Number((facts.filter((item) => item.citations?.length).length / facts.length).toFixed(2)) : 0,
      qualityMetrics,
      feedbackSummary: summarizeFeedback(feedbackItems),
      feedbackItems: feedbackItems.slice(0, 12).map(({ ownerId, ...item }) => ({
        ...item,
        ownerEmail: users.find((candidate) => candidate.id === ownerId)?.email || ''
      })),
      analytics,
      sourceCatalog: JAVA_MAP_ADAPTER.endpoints.map((endpoint) => ({ endpoint, provider: 'Java Core Backend AMap boundary', status: '已登记' })),
      attractions,
      users: userDirectory,
      knowledge,
      rerankCache: knowledge.cacheStats || null
    });
  }
  if (req.method === 'GET' && /^\/api\/admin\/users\/[^/]+$/.test(url.pathname)) {
    const user = await authUser(req);
    if (!user || user.role !== 'admin') return json(res, 403, { ok: false, message: '需要管理员权限。' });
    const userId = decodeURIComponent(url.pathname.split('/').pop());
    try {
      const detail = await javaCore.getUserDetail(javaTokenFor(req), userId);
      return json(res, 200, { ok: true, user: normalizeJavaPrincipal(detail), detail });
    } catch (error) {
      return javaErrorResponse(res, error, '无法读取用户详情。');
    }
  }
  if (req.method === 'GET' && url.pathname === '/api/admin/digital-human') {
    const user = await authUser(req);
    if (!user || user.role !== 'admin') return json(res, 403, { ok: false, message: '需要管理员权限。' });
    try {
      return json(res, 200, { ok: true, digitalHuman: await javaCore.getDigitalHuman(javaTokenFor(req)) });
    } catch (error) {
      return javaErrorResponse(res, error, '无法读取数字人配置。');
    }
  }
  if (req.method === 'PUT' && url.pathname === '/api/admin/digital-human') {
    const user = await authUser(req);
    if (!user || user.role !== 'admin') return json(res, 403, { ok: false, message: '需要管理员权限。' });
    try {
      const updated = await javaCore.updateDigitalHuman(javaTokenFor(req), await body(req));
      return json(res, 200, { ok: true, digitalHuman: updated, message: '数字人配置已更新。' });
    } catch (error) {
      return javaErrorResponse(res, error, '数字人配置更新失败。');
    }
  }
  if (req.method === 'GET' && url.pathname === '/api/admin/digital-human/voices') {
    const user = await authUser(req);
    if (!user || user.role !== 'admin') return json(res, 403, { ok: false, message: '需要管理员权限。' });
    try {
      return json(res, 200, { ok: true, voices: await javaCore.listDigitalHumanVoices(javaTokenFor(req)) });
    } catch (error) {
      return javaErrorResponse(res, error, '无法读取可用音色。');
    }
  }
  if (req.method === 'GET' && url.pathname === '/api/admin/settings') {
    const user = await authUser(req);
    if (!user || user.role !== 'admin') return json(res, 403, { ok: false, message: '需要管理员权限。' });
    try {
      return json(res, 200, { ok: true, settings: await javaCore.getSettings(javaTokenFor(req)) });
    } catch (error) {
      return javaErrorResponse(res, error, '无法读取系统设置。');
    }
  }
  if (req.method === 'PUT' && url.pathname === '/api/admin/settings') {
    const user = await authUser(req);
    if (!user || user.role !== 'admin') return json(res, 403, { ok: false, message: '需要管理员权限。' });
    try {
      const updated = await javaCore.updateSettings(javaTokenFor(req), await body(req));
      return json(res, 200, { ok: true, settings: updated, message: '系统设置已更新。' });
    } catch (error) {
      return javaErrorResponse(res, error, '系统设置更新失败。');
    }
  }
  if (req.method === 'GET' && url.pathname === '/api/admin/knowledge/documents') {
    const user = await authUser(req);
    if (!user || user.role !== 'admin') return json(res, 403, { ok: false, message: '需要管理员权限。' });
    const query = String(url.searchParams.get('query') || url.searchParams.get('q') || '').trim();
    const topic = String(url.searchParams.get('topic') || '').trim();
    const entityId = String(url.searchParams.get('entityId') || '').trim();
    try {
      const docs = await getKnowledgeDocuments(javaCore, javaTokenFor(req), { query, topic, entityId });
      return json(res, 200, { ok: true, documents: docs, total: docs.length });
    } catch (error) {
      return javaErrorResponse(res, error, '无法读取 Java 知识文档。');
    }
  }
  if (req.method === 'POST' && url.pathname === '/api/admin/knowledge/upload') {
    const user = await authUser(req);
    if (!user || user.role !== 'admin') return json(res, 403, { ok: false, message: '需要管理员权限。' });
    try {
      const parsed = await multipartBody(req);
      const fields = parsed.fields || {};
      const file = parsed.file;
      if (!file?.bytes?.length) return json(res, 400, { ok: false, message: '请选择要上传的知识文档。' });
      const title = String(fields.title || file.name || '').trim();
      const category = String(fields.category || 'other').trim();
      if (!title) return json(res, 400, { ok: false, message: '缺少文档标题。' });
      const formData = new FormData();
      formData.append('title', title);
      formData.append('category', category);
      formData.append('tags', String(fields.tags || '').trim());
      formData.append('file', new Blob([file.bytes], { type: file.type }), file.name);
      const created = await createKnowledgeDocument(javaCore, javaTokenFor(req), formData);
      return json(res, 201, { ok: true, document: created, message: '知识文档已上传，Java 将继续完成解析与向量同步。' });
    } catch (error) {
      return javaErrorResponse(res, error, '知识文档上传失败。');
    }
  }
  if (req.method === 'POST' && url.pathname === '/api/admin/knowledge/update') {
    const user = await authUser(req);
    if (!user || user.role !== 'admin') return json(res, 403, { ok: false, message: '需要管理员权限。' });
    const input = await body(req);
    const { docId, title, content } = input;
    if (!docId) return json(res, 400, { ok: false, message: '缺少 docId' });
    try {
      const updated = await updateKnowledgeDocument(javaCore, javaTokenFor(req), docId, { title, content });
      if (!updated?.docId) return json(res, 404, { ok: false, message: '未找到对应文档' });
      return json(res, 200, { ok: true, document: updated, message: '知识文档更新成功' });
    } catch (error) {
      return javaErrorResponse(res, error, '知识文档更新失败。');
    }
  }
  if (req.method === 'POST' && url.pathname === '/api/admin/users/role') {
    const user = await authUser(req);
    if (!user || user.role !== 'admin') return json(res, 403, { ok: false, message: '需要管理员权限。' });
    const input = await body(req);
    const { userId, role } = input;
    if (!userId || !['admin', 'traveler'].includes(role)) return json(res, 400, { ok: false, message: '参数无效' });
    try {
      await javaCore.updateUserRole(javaTokenFor(req), userId, { role: role === 'admin' ? 'ADMIN' : 'USER' });
      return json(res, 200, { ok: true, message: `用户身份已更新为 ${role === 'admin' ? '系统管理员' : '普通旅行者'}` });
    } catch (error) {
      return javaErrorResponse(res, error, '用户身份更新失败。');
    }
  }
  if (req.method === 'POST' && url.pathname === '/api/admin/users/reset') {
    const user = await authUser(req);
    if (!user || user.role !== 'admin') return json(res, 403, { ok: false, message: '需要管理员权限。' });
    return json(res, 409, { ok: false, code: 'ADMIN_RESET_NOT_SUPPORTED', message: '用户数据重置尚未纳入 Java Core Backend 合同，未执行任何 Node 数据删除。' });
  }
  if (req.method === 'POST' && url.pathname === '/api/admin/users/delete') {
    const user = await authUser(req);
    if (!user || user.role !== 'admin') return json(res, 403, { ok: false, message: '需要管理员权限。' });
    const input = await body(req);
    const { userId } = input;
    if (!userId) return json(res, 400, { ok: false, message: '缺少 userId' });
    if (userId === user.id) return json(res, 400, { ok: false, message: '不能删除当前登录的管理员账号' });
    try {
      await javaCore.disableUser(javaTokenFor(req), userId);
      return json(res, 200, { ok: true, message: 'Java 用户账号已完成删除/停用处理；Node legacy store 未删除。' });
    } catch (error) {
      return javaErrorResponse(res, error, '用户账号处理失败。');
    }
  }
  if (req.method === 'GET' && url.pathname === '/api/auth/session') {
    const user = await authUser(req);
    if (!user) return json(res, 200, { ok: true, authenticated: false, anonymous: true, user: null, csrfToken: null });
    return json(res, 200, { ok: true, authenticated: true, anonymous: false, user, csrfToken: req.webSession?.csrfToken || null, expiresAt: req.webSession?.expiresAt || null });
  }
  if (req.method === 'GET' && url.pathname === '/api/session') {
    const user = await authUser(req);
    return json(res, 200, { ok: true, anonymous: !user, user, csrfToken: req.webSession?.csrfToken || null, trip: null, message: user ? '当前已登录。' : '当前为匿名状态，规划后可保存草稿。' });
  }
  if (req.method === 'GET' && url.pathname === '/api/chat/stream') {
    const message = String(url.searchParams.get('message') || '').trim();
    if (!message) return json(res, 400, { ok: false, code: 'CHAT_INVALID_REQUEST', message: '对话内容不能为空。' });
    if (message.length > 4000) return json(res, 413, { ok: false, code: 'CHAT_INVALID_REQUEST', message: '对话内容过长，请分段发送。' });
    const mode = url.searchParams.get('mode') === 'deep' ? 'deep' : 'normal';
    const requestedSessionId = String(url.searchParams.get('sessionId') || '').trim();
    const sessionId = (requestedSessionId || `web-${randomUUID()}`).slice(0, 128);
    const plannerSessionId = String(url.searchParams.get('plannerSessionId') || '').trim().slice(0, 128);
    const tripId = String(url.searchParams.get('tripId') || '').trim().slice(0, 128);
    const currentVersion = String(url.searchParams.get('currentVersion') || '').trim().slice(0, 32);
    const activeDay = String(url.searchParams.get('activeDay') || '').trim().slice(0, 8);
    const activeStopId = String(url.searchParams.get('activeStopId') || '').trim().slice(0, 128);
    const activeStopName = String(url.searchParams.get('activeStopName') || '').trim().slice(0, 128);
    const user = await authUser(req);
    let planContext = '';
    if (plannerSessionId) {
      try {
        // 恢复时会校验当前用户与设备；无法恢复时普通聊天仍可继续，只是不注入行程快照。
        planContext = planChatContext(await restorePlannerSession(plannerSessionId, req));
      } catch (error) {
        console.warn('[BFF][chat-plan-context-unavailable]', JSON.stringify({ reason: error?.code || error?.name || 'UNKNOWN' }));
      }
    }
    console.info('[BFF][chat-route]', JSON.stringify({
      channel: 'chat-stream',
      mode,
      messageLength: message.length,
      authenticated: Boolean(user),
      hasPlannerContext: Boolean(plannerSessionId || tripId),
      hasPlanPreferenceSnapshot: Boolean(planContext),
      hasSelectedStop: Boolean(activeStopId)
    }));
    let stream;
    try {
      stream = await javaCore.chatStream(
        { message, sessionId, mode, plannerSessionId, tripId, currentVersion, activeDay, activeStopId, activeStopName, planContext },
        javaTokenFor(req),
        requestSignal
      );
    } catch (error) {
      return javaErrorResponse(res, error, 'Java 对话模型暂不可用。');
    }
    if (!stream?.body) return json(res, 502, { ok: false, code: 'JAVA_CHAT_STREAM_INVALID', message: 'Java Core Backend 未返回对话流。' });
    res.writeHead(200, {
      'content-type': stream.headers?.get('content-type') || 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-store',
      connection: 'keep-alive',
      'x-chat-owner': user ? 'java-authenticated' : 'java-anonymous'
    });
    await pipeChatStream(stream, res, requestSignal);
    return;
  }
  if (req.method === 'POST' && url.pathname === '/api/chat/proposal') {
    const input = await body(req);
    const session = sessions.get(input.sessionId);
    if (!session) return json(res, 404, { ok: false, message: '规划草稿已失效，请重新生成。' });
    const message = String(input.message || '').trim();
    if (!message) return json(res, 400, { ok: false, message: '请求内容不能为空。' });
    const kind = input.intent || chatModificationKind(message);

    if (kind === 'UPDATE_PREFERENCE') {
      const patch = chatPreferencePatch(message, session.trip?.appliedPreferences?.appliedFields || {})
        || legacyPreferencePatch(message, {})?.patch;
      if (!patch) return json(res, 400, { ok: false, message: '未能识别明确的偏好内容。' });
      const values = legacyPreferenceValues(patch);
      const proposal = {
        type: 'UPDATE_PREFERENCE',
        patch,
        summary: `记住偏好：${values.join('、') || '新偏好'}`,
        reason: message,
        requiresConfirmation: true
      };
      session.chatProposal = proposal;
      return json(res, 200, { ok: true, proposal });
    }

    const targetStop = findChatTarget(session.trip, message);
    const isDelete = /(移除|删除|不要|去掉|取消)/.test(message);
    const candidateStartedAt = performance.now();
    let candidate;
    let candidateError = null;

    try {
      if (targetStop && isDelete) {
        candidate = await javaCore.shadowMutateStops({
          trip: session.trip,
          operation: 'delete',
          targetStopId: targetStop.id
        }, javaTokenFor(req));
      } else if (targetStop) {
        candidate = await javaCore.shadowReplan({
          trip: session.trip,
          targetStopId: targetStop.id,
          reason: message
        }, javaTokenFor(req));
      } else {
        const prefPatch = chatPreferencePatch(message) || {};
        candidate = await javaCore.shadowPlan({
          prompt: `${session.input} ${message}`,
          constraints: { ...(session.trip?.constraints || {}), ...prefPatch }
        }, javaTokenFor(req));
      }
    } catch (error) {
      candidateError = error;
    }

    const candidateLatencyMs = Math.round(performance.now() - candidateStartedAt);
    const shadow = shadowMetrics.record(compareShadow({
      operation: 'chat-proposal', candidate, candidateLatencyMs, candidateError
    }));
    const invalidCandidateError = candidateValidityError(candidate, candidateError, 'Java Shadow 修改方案生成失败。');
    if (invalidCandidateError) {
      if (candidateError instanceof JavaCoreError) return javaErrorResponse(res, candidateError, 'Java Shadow 修改方案生成失败。');
      return json(res, 502, { ok: false, code: invalidCandidateError.code, message: invalidCandidateError.message, shadow });
    }

    let summary = '悠悠已准备一份修改方案';
    let changedSegments = candidate.changedSegments || [];
    if (targetStop && isDelete) {
      summary = `从行程中移除【${targetStop.name}】`;
      changedSegments = [targetStop.id];
    } else if (targetStop) {
      const replacement = candidate.trip?.days?.flatMap((d) => d.stops || []).find((s) => s.id === targetStop.id);
      summary = `将【${targetStop.name}】替换为【${replacement?.name || candidate.replacementVenueId || '推荐景点'}】`;
      changedSegments = [targetStop.id];
    } else {
      summary = `根据“${message}”调整行程安排`;
    }

    const proposal = {
      type: 'MODIFY_PLAN',
      candidate,
      summary,
      reason: message,
      changedSegments,
      requiresConfirmation: true,
      shadow
    };
    session.chatProposal = proposal;
    return json(res, 200, { ok: true, proposal, shadow });
  }
  if (req.method === 'POST' && url.pathname === '/api/chat/proposal/confirm') {
    const input = await body(req);
    const session = sessions.get(input.sessionId);
    if (!session) return json(res, 404, { ok: false, message: '规划草稿已失效，请重新生成。' });
    if (input.confirm === false) {
      session.chatProposal = null;
      return json(res, 200, { ok: true, message: '已取消本次方案调整。' });
    }
    const proposal = session.chatProposal;
    if (!proposal) return json(res, 400, { ok: false, message: '当前没有待确认的方案。' });

    if (proposal.type === 'UPDATE_PREFERENCE') {
      const user = await authUser(req);
      if (!user) {
        session.chatProposal = null;
        return json(res, 200, { ok: true, anonymous: true, message: '当前为未登录状态，偏好已在当前会话生效；登录后可永久保存。' });
      }
      try {
        const current = await javaCore.getPreferences(javaTokenFor(req));
        const updated = await javaCore.mergePreferences(javaTokenFor(req), proposal.patch, current.revision);
        const history = recordLegacyPreferenceEvent(user.id, { value: proposal.summary, action: 'confirmed', mappedFields: Object.keys(proposal.patch) });
        session.chatProposal = null;
        return json(res, 200, { ok: true, ...preferenceResponse(updated, history), message: '偏好已由 Java Preferences Authority 记住。' });
      } catch (error) {
        return javaErrorResponse(res, error, '偏好保存失败。');
      }
    }

    if (proposal.type === 'MODIFY_PLAN') {
      const candidateTrip = clone(proposal.candidate.trip);
      const user = await authUser(req);
      const targetTripId = String(session.formalTripId || input.savedTripId || '').trim();

      if (user && targetTripId) {
        try {
          const current = await javaCore.getTrip(javaTokenFor(req), targetTripId);
          const formal = await javaCore.updateTrip(javaTokenFor(req), targetTripId, {
            plan: candidateTrip,
            title: String(candidateTrip.title || current.title || ''),
            expectedVersion: Number(current.currentVersion),
            idempotencyKey: `chat-confirm-${targetTripId}-${Number(current.currentVersion)}`,
            changeReason: `AI 行程助手：${proposal.summary}`
          });
          const versions = await javaCore.tripVersions(javaTokenFor(req), formal.id);
          const saved = savedTripProjection(formal, versions);
          session.trip = clone(saved.trip);
          session.chatProposal = null;
          session.updatedAt = new Date().toISOString();
          return json(res, 200, {
            ok: true,
            trip: clone(session.trip),
            saved,
            formal: true,
            version: session.trip.version,
            message: '已确认并更新 Java Core Backend 正式行程版本。'
          });
        } catch (error) {
          return javaErrorResponse(res, error, '更新正式行程失败。');
        }
      }

      candidateTrip.version = Number(session.trip?.version || 1) + 1;
      session.trip = candidateTrip;
      session.candidateSource = clone(proposal.candidate.source || session.trip.sourceStatus || { provider: 'Java Core Backend' });
      session.chatProposal = null;
      session.updatedAt = new Date().toISOString();
      return json(res, 200, {
        ok: true,
        trip: clone(session.trip),
        formal: false,
        version: session.trip.version,
        message: '草稿行程已更新。'
      });
    }

    session.chatProposal = null;
    return json(res, 200, { ok: true, message: '操作已完成。' });
  }
  if (req.method === 'POST' && url.pathname === '/api/plan') {
    const input = await body(req);
    const user = await authUser(req);
    const promptText = String(input.prompt || input.message || '').trim();
    console.info('[BFF][planner-create]', JSON.stringify({
      authenticated: Boolean(user),
      role: user?.javaRole || user?.role || 'ANONYMOUS',
      hasUserId: Boolean(user?.id),
      promptLength: promptText.length,
      usePreferences: Boolean(input.usePreferences)
    }));
    let typedPreferences = null;
    if (user && input.usePreferences) {
      try {
        typedPreferences = await javaCore.getPreferences(javaTokenFor(req), requestSignal);
      } catch (error) {
        return javaErrorResponse(res, error, '无法读取 Java Preferences。');
      }
    }
    const storedPreferences = typedPreferences ? legacyPreferenceValues(typedPreferences) : [];
    let session;
    try {
      const guestPrompt = guestPrependPromptStore.get(req.webSession?.id || req.headers?.['x-session-id'] || 'guest') || '';
      session = await createSession(promptText, {
        constraints: input.constraints || {},
        candidateUsePreferences: Boolean(input.usePreferences),
        preferenceDecision: String(input.preferenceDecision || ''),
        profilePrependPrompt: typedPreferences?.legacyMetadata?.profilePrependPrompt || guestPrompt,
        javaToken: javaTokenFor(req),
        userId: user?.id || null,
        deviceId: requestDeviceId(req),
        signal: requestSignal
      });
    } catch (error) {
      return javaErrorResponse(res, error, 'Java Shadow 规划候选失败。');
    }
    // Node retains only a transient browser compatibility session. Java's
    // candidate trip is the returned business result; legacy comparison evidence
    // never writes history or a second Trip authority.
    if (user) session.deviceId = requestDeviceId(req);
    return json(res, 200, {
      ok: true,
      sessionId: session.id,
      javaSessionId: session.javaSessionId || null,
      sessionAccessToken: session.sessionAccessToken || '',
      ...plannerCapability(session),
      trip: clone(session.trip),
      phase: '已生成结构化行程',
      source: session.candidateSource,
      retrieval: session.trip.retrieval,
      appliedPreferences: session.candidateAppliedPreferences,
      plannerVersion: session.plannerVersion || session.trip?.plannerVersion || '1.0.0-v1',
      policyVersion: session.policyVersion || session.trip?.policyVersion || '2026.08-v1',
      routeDataStatus: session.routeDataStatus || session.trip?.routeDataStatus || 'ESTIMATED',
      explanationSource: session.explanationSource || session.trip?.explanationSource || 'TEMPLATE',
      degraded: Boolean(session.degraded || session.trip?.degraded),
      degradationReasons: session.degradationReasons || session.trip?.degradationReasons || [],
      preferenceProposal: storedPreferences.length && !input.preferenceDecision ? { values: storedPreferences, copy: `你之前确认过“${storedPreferences.join('、')}”，本次要继续沿用吗？` } : null,
      shadow: session.shadow
    });
  }
  if (req.method === 'POST' && url.pathname === '/api/planner/conversation') {
    const input = await body(req);
    const sessionId = String(input.sessionId || input.planId || '').trim();
    if (!sessionId) return json(res, 400, { ok: false, message: '缺少 sessionId' });
    const session = await restorePlannerSession(sessionId, req);
    if (!session) return json(res, 404, { ok: false, code: 'PLANNER_SESSION_NOT_FOUND', recoverable: true, message: '规划会话已失效或无法恢复，请重新生成行程或重新打开已保存行程。' });
    const capability = plannerCapability(session);
    if (capability.legacyMode) return json(res, 200, legacyAdjustmentResponse(sessionId, 'conversation'));
    const targetSessionId = String(session?.javaSessionId || session?.sessionId || session?.id || sessionId).trim();
    console.info('[BFF][planner-route]', JSON.stringify({
      channel: 'planner-conversation',
      messageLength: String(input.message || '').trim().length,
      hasJavaPlannerSession: Boolean(targetSessionId),
      hasActiveProposal: Boolean(input.context?.activeProposalId),
      baseRevision: Number(input.baseRevision || session.trip?.version || 1)
    }));
    try {
      const plannerRequest = plannerConversationRequest(input, session, targetSessionId);
      const conversationResult = await javaCore.conversation(targetSessionId, plannerRequest, javaTokenFor(req));
      if (conversationResult?.proposalId) {
        session.chatProposal = clone(conversationResult);
      } else if (conversationResult?.applied) {
        session.chatProposal = null;
      }
      if (conversationResult?.requiresClarification || conversationResult?.type === 'CLARIFICATION' || conversationResult?.type === 'UNKNOWN') {
        session.plannerConversationContext = {
          operation: String(conversationResult.operation || ''),
          activeDay: Number(plannerRequest.context?.activeDay || 1),
          selectedStopId: plannerRequest.context?.selectedStopId || null,
          updatedAt: new Date().toISOString()
        };
      } else {
        session.plannerConversationContext = null;
      }
      session.updatedAt = new Date().toISOString();
      await persistentStore.savePlannerDraft?.(session);
      await persistFormalTripWorkspace(session);
      return json(res, 200, { ...conversationResult, ...capability, sessionId });
    } catch (error) {
      void writeBffDiagnostic('planner-java-error', {
        route: '/api/planner/conversation',
        ...diagnosticError(error)
      });
      return plannerAdjustmentErrorResponse(res, error, 'Java 对话调整失败。');
    }
  }
  if (req.method === 'POST' && url.pathname === '/api/planner/adjust/preview') {
    const input = await body(req);
    const sessionId = String(input.sessionId || input.planId || '').trim();
    if (!sessionId) return json(res, 400, { ok: false, message: '缺少 sessionId' });
    const session = await restorePlannerSession(sessionId, req);
    if (!session) return json(res, 404, { ok: false, code: 'PLANNER_SESSION_NOT_FOUND', recoverable: true, message: '规划会话已失效或无法恢复，请重新生成行程或重新打开已保存行程。' });
    const capability = plannerCapability(session);
    if (capability.legacyMode) return json(res, 200, legacyAdjustmentResponse(sessionId, 'preview'));
    const targetSessionId = String(session?.javaSessionId || session?.sessionId || session?.id || sessionId).trim();
    try {
      const previewResult = await javaCore.previewAdjustment(targetSessionId, plannerConversationRequest(input, session, targetSessionId), javaTokenFor(req));
      return json(res, 200, { ...previewResult, ...capability, sessionId });
    } catch (error) {
      void writeBffDiagnostic('planner-java-error', {
        route: '/api/planner/adjust/preview',
        ...diagnosticError(error)
      });
      return plannerAdjustmentErrorResponse(res, error, 'Java 调整方案预览失败。');
    }
  }
  if (req.method === 'POST' && url.pathname === '/api/planner/adjust/apply') {
    const input = await body(req);
    const sessionId = String(input.sessionId || input.planId || '').trim();
    if (!sessionId) return json(res, 400, { ok: false, message: '缺少 sessionId' });
    const session = await restorePlannerSession(sessionId, req);
    if (!session) return json(res, 404, { ok: false, code: 'PLANNER_SESSION_NOT_FOUND', recoverable: true, message: '规划会话已失效或无法恢复，请重新生成行程或重新打开已保存行程。' });
    const hasAuth = Boolean(sessionForRequest(req)) || Boolean(session?.sessionAccessToken) || Boolean(input.sessionAccessToken);
    if (!hasAuth
      && process.env.YUYOUZHICE_TEST_FIXTURES !== '1'
      && process.env.YUYOUZHICE_TEST_SESSION_COMPAT !== '1') {
      return json(res, 401, { ok: false, code: 'AUTH_UNAUTHENTICATED', message: '请先登录后确认应用行程调整。' });
    }
    const capability = plannerCapability(session);
    if (capability.legacyMode) return json(res, 200, legacyAdjustmentResponse(sessionId, 'apply'));
    const targetSessionId = String(session?.javaSessionId || session?.sessionId || session?.id || sessionId).trim();
    const applyRequest = plannerApplyRequest(input, session);
    try {
      const applyResult = await javaCore.applyAdjustment(targetSessionId, applyRequest, javaTokenFor(req));
      const expectedVersion = Number(applyRequest.baseRevision) + 1;
      const currentVersion = Number(applyResult.currentVersion ?? applyResult.trip?.version);
      if (!Number.isFinite(currentVersion) || currentVersion !== expectedVersion) {
        return json(res, 502, {
          ok: false,
          code: 'PLANNER_REVISION_CONTRACT_INVALID',
          message: 'Java Planner 返回的行程版本不是严格的 Revision +1，未更新当前页面行程。'
        });
      }
      if (applyResult.trip) {
        session.trip = clone(applyResult.trip);
        session.syncRevision = currentVersion;
        session.updatedAt = new Date().toISOString();
        session.chatProposal = null;
        session.plannerConversationContext = null;
        await persistentStore.savePlannerDraft?.(session);
        await persistFormalTripWorkspace(session);
      }
      return json(res, 200, { ...applyResult, ...capability, sessionId, currentVersion, activeProposal: null });
    } catch (error) {
      void writeBffDiagnostic('planner-java-error', {
        route: '/api/planner/adjust/apply',
        ...diagnosticError(error)
      });
      return plannerAdjustmentErrorResponse(res, error, '应用 Java 调整方案失败。');
    }
  }
  if (req.method === 'GET' && url.pathname.startsWith('/api/planner/sessions/')) {
    const id = decodeURIComponent(url.pathname.slice('/api/planner/sessions/'.length));
    const session = await restorePlannerSession(id, req);
    if (!session) return json(res, 404, { ok: false, code: 'PLANNER_SESSION_NOT_FOUND', recoverable: true, message: '规划会话已失效或无法恢复，请重新生成行程或重新打开已保存行程。' });
    const targetSessionId = session?.javaSessionId || id;
    const sessionAccessToken = req.headers['x-plan-session-token'] || session?.sessionAccessToken || '';
    try {
      const sessionResult = await javaCore.getPlannerSession(targetSessionId, { sessionAccessToken, token: javaTokenFor(req) }, javaTokenFor(req));
      return json(res, 200, { ...sessionResult, activeProposal: clone(session.chatProposal) });
    } catch (error) {
      return javaErrorResponse(res, error, '获取规划会话失败。');
    }
  }
  if (req.method === 'POST' && url.pathname.startsWith('/api/planner/sessions/') && url.pathname.endsWith('/dynamic-refresh')) {
    const id = decodeURIComponent(url.pathname.slice('/api/planner/sessions/'.length, -'/dynamic-refresh'.length));
    const session = await restorePlannerSession(id, req);
    if (!session) return json(res, 404, { ok: false, code: 'PLANNER_SESSION_NOT_FOUND', recoverable: true, message: '规划会话已失效或无法恢复，请重新生成行程或重新打开已保存行程。' });
    const targetSessionId = session?.javaSessionId || id;
    const sessionAccessToken = req.headers['x-plan-session-token'] || session?.sessionAccessToken || '';
    try {
      const refreshed = await javaCore.refreshPlannerDynamicData(targetSessionId, { sessionAccessToken, token: javaTokenFor(req) }, javaTokenFor(req));
      if (refreshed?.trip) {
        session.trip = clone(refreshed.trip);
        session.candidateSource = clone(refreshed.source || refreshed.trip.sourceStatus || session.candidateSource);
        session.updatedAt = new Date().toISOString();
        await persistentStore.savePlannerDraft?.(session);
      }
      return json(res, 200, { ...refreshed, ...plannerCapability(session), sessionId: id });
    } catch (error) {
      void writeBffDiagnostic('planner-java-error', { route: '/api/planner/sessions/dynamic-refresh', ...diagnosticError(error) });
      return javaErrorResponse(res, error, '刷新实时天气与地图信息失败。');
    }
  }
  if (req.method === 'GET' && url.pathname === '/api/explore') {
    const query = String(url.searchParams.get('q') || '').trim().toLowerCase();
    const category = String(url.searchParams.get('category') || '').trim();
    try {
      const attractions = await listCachedExploreAttractions(category);
      const items = (Array.isArray(attractions) ? attractions : []).filter((item) => {
        const haystack = [item.name, item.displayName, item.district, item.category, ...(item.tags || []), item.summary]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return !query || haystack.includes(query);
      });
      return json(res, 200, {
        ok: true,
        categories: [...new Set((Array.isArray(attractions) ? attractions : []).map((item) => item.category).filter(Boolean))],
        items
      });
    } catch (error) {
      return javaErrorResponse(res, error, '无法读取 Java Core Backend 景点目录。');
    }
  }
  if (req.method === 'GET' && url.pathname === '/api/search/baidu') {
    const query = String(url.searchParams.get('q') || '').trim();
    const limit = Number(url.searchParams.get('limit') || 10);
    if (!query) {
      return json(res, 200, { ok: true, query: '', results: [] });
    }
    try {
      const result = await javaCore.searchBaidu(query, limit);
      const results = Array.isArray(result) ? result : (Array.isArray(result?.data) ? result.data : []);
      return json(res, 200, { ok: true, query, results });
    } catch (error) {
      return json(res, 200, {
        ok: true,
        query,
        results: [
          {
            title: `在百度中搜索“${query}”的文旅与美食攻略`,
            snippet: `点击前往百度搜索，实时查看【${query}】的最新大众点评、游玩攻略、营业动态与特色风味推荐。`,
            url: `https://www.baidu.com/s?wd=${encodeURIComponent('重庆 ' + query)}`,
            source: '百度全网搜索直达',
            category: '全网资讯',
            thumbnail: 'https://www.baidu.com/favicon.ico'
          }
        ]
      });
    }
  }
  if (req.method === 'GET' && url.pathname === '/api/search/amap') {
    const query = String(url.searchParams.get('q') || '').trim();
    const city = String(url.searchParams.get('city') || '重庆市').trim();
    const category = String(url.searchParams.get('category') || '').trim();
    let types = String(url.searchParams.get('types') || '').trim();
    if (!query) {
      return json(res, 200, { ok: true, query: '', results: [] });
    }
    const categoryConfigs = {
      '自然': {
        types: '110200|110202|110207|110100|110101|110103',
        keywordAppend: '自然风景',
        hasCategorySignal: (q) => /(?:自然|山|森林|峡谷|瀑布|公园|湖|洞|湿地|奇观|地质)/.test(q),
        displayCategory: '自然奇观',
        defaultTag: '自然风光'
      },
      '人文': {
        types: '110300|110205|140100|140200|110400|110201|110203',
        keywordAppend: '文博古迹',
        hasCategorySignal: (q) => /(?:古镇|历史|文化|遗址|古迹|文博|博物|寺|庙|祠|老街|故居)/.test(q),
        displayCategory: '人文历史',
        defaultTag: '文博古迹'
      },
      '夜景': {
        types: '110200|110100|080200',
        keywordAppend: '夜景 观景台',
        hasCategorySignal: (q) => /(?:夜景|江景|观景台|天台|夜市|灯光|两江)/.test(q),
        displayCategory: '山城夜景',
        defaultTag: '夜景打卡'
      },
      '城市': {
        types: '110000|110100|110200|080200',
        keywordAppend: '地标',
        hasCategorySignal: (q) => /(?:地标|中心|广场|步行街|商圈|索道|轻轨|大桥)/.test(q),
        displayCategory: '城市风貌',
        defaultTag: '城市地标'
      },
      '美食': {
        types: '050000|050100|050200|050300|050400',
        keywordAppend: '特色美食',
        hasCategorySignal: (q) => /(?:美食|餐|火锅|吃|菜|馆|串串|鱼|兔|面|小吃|烧烤|酒楼|茶馆|老字号)/.test(q),
        displayCategory: '地道美食',
        defaultTag: '特色美食'
      },
      '文创': {
        types: '140400|140200|140600|110208|110300',
        keywordAppend: '文创艺术',
        hasCategorySignal: (q) => /(?:文创|艺术|美术|创客|文旅|集市|手作)/.test(q),
        displayCategory: '文创街区',
        defaultTag: '文创艺术'
      },
      '休闲': {
        types: '080200|080400|050400|110100',
        keywordAppend: '休闲度假',
        hasCategorySignal: (q) => /(?:休闲|度假|温泉|农家乐|茶舍|茶馆|咖啡|露营|采摘)/.test(q),
        displayCategory: '休闲慢生活',
        defaultTag: '休闲慢生活'
      }
    };

    const currentConfig = categoryConfigs[category];
    if (!types) {
      if (currentConfig) {
        types = currentConfig.types;
      } else if (category === '全部' || !category) {
        types = '110000|050000|080000|140000';
      } else {
        types = '110000';
      }
    }
    try {
      let searchQuery = query;
      if (currentConfig && !currentConfig.hasCategorySignal(query)) {
        searchQuery = `${query} ${currentConfig.keywordAppend}`;
      }
      let result = await javaCore.searchAmap(searchQuery, city, types);
      let rawList = Array.isArray(result) ? result : (Array.isArray(result?.data) ? result.data : []);
      if (rawList.length === 0 && searchQuery !== query) {
        result = await javaCore.searchAmap(query, city, types);
        rawList = Array.isArray(result) ? result : (Array.isArray(result?.data) ? result.data : []);
      }
      if (rawList.length === 0 && types) {
        result = await javaCore.searchAmap(query, city, '');
        rawList = Array.isArray(result) ? result : (Array.isArray(result?.data) ? result.data : []);
      }
      const isClutter = (poi) => {
        const text = `${poi.name || ''} ${poi.address || ''} ${poi.type || ''}`;
        return /(?:火车站|客运站|客运中心|汽车客运|长途汽车站|地铁站|轻轨站|公交站|公交枢纽|飞机场|航站楼|交通设施服务|地名地址信息|政府机构及社会团体|行政地标|汽车销售|汽车维修|摩托车|驾校)/.test(text);
      };
      const filteredList = rawList.filter((poi) => !isClutter(poi));
      const results = filteredList.map((poi) => {
        const isDining = /(?:餐饮|美食|中餐厅|餐馆|火锅|江湖菜|小吃|烧烤|串串|酒楼|茶馆|咖啡|老字号)/.test(poi.type || '')
          || category === '美食';
        const displayCategory = currentConfig ? currentConfig.displayCategory : (isDining ? '美食' : (poi.type?.split(';')[0] || '文旅地标'));
        const defaultTag = currentConfig ? currentConfig.defaultTag : (isDining ? '特色美食' : poi.type?.split(';')[0]);
        return {
          id: `amap-${poi.poiId || poi.id}`,
          poiId: poi.poiId || poi.id,
          name: poi.name || '未知地点',
          displayName: poi.name || '未知地点',
          address: poi.address || '重庆市',
          district: poi.address?.match(/(渝中区|江北区|南岸区|沙坪坝区|九龙坡区|大渡口区|渝北区|巴南区|北碚区|江津区|大足区|武隆区|永川区|合川区|璧山区|铜梁区|潼南区|荣昌区|开州区|梁平区|城口县|丰都县|垫江县|忠县|云阳县|奉节县|巫山县|巫溪县|石柱|秀山|酉阳|彭水)/)?.[0] || '重庆全域',
          category: displayCategory,
          type: poi.type || (isDining ? '餐饮服务' : '风景名胜'),
          isDining,
          photoUrl: poi.photoUrl || '',
          image: poi.photoUrl || '',
          photoTitle: poi.photoTitle || poi.name || '',
          location: poi.coordinate ? `${poi.coordinate.longitude},${poi.coordinate.latitude}` : '',
          coordinate: poi.coordinate || null,
          ticket: isDining ? '人均消费以到店为准' : '以现场公告为准',
          summary: poi.address || poi.type || (isDining ? '高德特色地道餐饮' : '高德地图实时检索地标'),
          fit: isDining ? '适合品味地道风味、聚餐打卡，支持一键安排为行程就餐' : '高德全城实时检索地点，支持加入行程规划或直接导航',
          tags: [defaultTag, poi.type?.split(';')[0], '高德实景'].filter(Boolean),
          source: 'AMAP_WEB_SERVICE'
        };
      });
      return json(res, 200, { ok: true, query, city, total: results.length, results });
    } catch (error) {
      void writeBffDiagnostic('amap-search-error', diagnosticError(error));
      return json(res, 200, { ok: false, query, results: [], message: error?.message || '高德检索服务暂时不可用' });
    }
  }
  if (req.method === 'GET' && url.pathname === '/api/history') {
    const user = await authUser(req);
    if (!user) return json(res, 401, { ok: false, message: '登录后才能查看历史会话。' });
    try {
      const formalTrips = await javaCore.listTrips(javaTokenFor(req));
      const history = (Array.isArray(formalTrips) ? formalTrips : []).map(formalTripHistoryProjection);
      return json(res, 200, { ok: true, sync: historySyncMeta(history, req), sessions: history });
    } catch (error) {
      return javaErrorResponse(res, error, '无法读取 Java Core Backend 正式行程历史。');
    }
  }
  if (req.method === 'GET' && url.pathname.startsWith('/api/history/')) {
    const user = await authUser(req);
    if (!user) return json(res, 401, { ok: false, message: '登录后才能查看历史会话。' });
    const id = decodeURIComponent(url.pathname.slice('/api/history/'.length));
    try {
      const formal = await javaCore.getTrip(javaTokenFor(req), id);
      const session = openFormalTripSession(formal, {
        userId: user.id,
        deviceId: requestDeviceId(req)
      });
      const workspace = hydrateFormalTripWorkspace(session);
      const formalTrips = await javaCore.listTrips(javaTokenFor(req));
      const history = (Array.isArray(formalTrips) ? formalTrips : []).map(formalTripHistoryProjection);
      return json(res, 200, {
        ok: true,
        session: {
          id: session.id,
          trip: clone(session.trip),
          prompt: session.input,
          formalTripId: session.formalTripId,
          ...plannerCapability(session)
        },
        savedTripId: id,
        workspace: workspace ? clone(workspace) : {
          chatMessages: [],
          chatMode: 'chat',
          plannerConversationContext: null,
          itineraryMemorySnapshot: clone(session.itineraryMemorySnapshot || itineraryMemorySnapshot(session))
        },
        ...plannerCapability(session),
        sync: historySyncMeta(history, req)
      });
    } catch (error) {
      return javaErrorResponse(res, error, '无法恢复 Java Core Backend 正式行程。');
    }
  }
  if (req.method === 'GET' && url.pathname.startsWith('/api/attractions/')) {
    const id = decodeURIComponent(url.pathname.slice('/api/attractions/'.length));
    try {
      const attraction = await javaCore.getAttraction(id);
      if (!attraction) return json(res, 404, { ok: false, code: 'JAVA_REQUEST_REJECTED', message: '景点不存在。' });
      const detail = {
        ...attraction,
        attractionId: attraction.id,
        image: attraction.image || `/images/attractions/${encodeURIComponent(attraction.id)}.svg`,
        imageSource: attraction.imageSource || (attraction.image ? '高德 Web Service API' : 'Web 静态景点资产'),
        imageStatus: attraction.imageStatus || (attraction.image ? '已返回' : '静态回退'),
        imageReason: attraction.imageReason || (attraction.image ? '' : 'Java Core Backend 未返回图片，使用 Web 公开景点资产。'),
        actions: { canAdd: true, canReplace: true },
        facts: [
          fact('开放时间', attraction.bestTime || '全天开放', '已核验', '建议在推荐时段游览以获得最佳体验。'),
          fact('门票建议', attraction.ticket || '以现场公告为准', '已核验', '由 Java Core Backend 景点目录提供。'),
          fact('到达方式', attraction.walk || '路线待计算', '动态', '路线由 Java Core Backend Planner / AMap 路径能力提供。')
        ],
        citations: [
          citation('Java Core Backend 景点目录', `/ai/attractions/${attraction.id}`, '已核验'),
          citation('高德 POI 图片查询', '/v5/place/detail', attraction.image ? '已核验' : '未返回图片')
        ]
      };
      return json(res, 200, { ok: true, detail });
    } catch (error) {
      return javaErrorResponse(res, error, '无法读取 Java Core Backend 景点详情。');
    }
  }

  // Planner-session mutations are Java V1 operations. Legacy saved-trip
  // sessions without a Java planner session retain the compatibility fallback.
  if (req.method === 'POST' && url.pathname === '/api/trip/stops') {
    const input = await body(req);
    const session = await restorePlannerSession(input.sessionId, req);
    if (!session) return json(res, 404, { ok: false, message: '规划草稿已失效，请重新生成。' });
    const targetSessionId = String(session.javaSessionId || '').trim();
    if (targetSessionId) {
      const sessionAccessToken = String(input.sessionAccessToken || session.sessionAccessToken || '');
      const candidateStartedAt = performance.now();
      try {
        const result = await javaCore.mutatePlannerStops(targetSessionId, {
          operation: String(input.operation || 'add'),
          attractionId: String(input.attractionId || ''),
          day: input.day,
          targetStopId: String(input.targetStopId || ''),
          stopId: String(input.stopId || ''),
          expectedVersion: Number(input.expectedVersion || session.trip?.version || 1),
          sessionAccessToken
        }, javaTokenFor(req), requestSignal);
        const shadow = shadowMetrics.record(compareShadow({
          operation: 'stops',
          candidate: result,
          candidateLatencyMs: Math.round(performance.now() - candidateStartedAt)
        }));
        if (result?.trip) session.trip = clone(result.trip);
        session.candidateSource = clone(session.trip.sourceStatus || session.candidateSource || { provider: 'Java Core Backend' });
        session.shadow = shadow;
        session.updatedAt = new Date().toISOString();
        await persistentStore.savePlannerDraft?.(session);
        return json(res, 200, {
          ok: true,
          ...result,
          trip: clone(session.trip),
          message: result?.message || 'Java Planner V1 站点变更已应用并持久化。',
          shadow
        });
      } catch (error) {
        return javaErrorResponse(res, error, 'Java Planner V1 站点变更失败。');
      }
    }
    const candidateStartedAt = performance.now();
    let candidate;
    let candidateError = null;
    try {
      candidate = await javaCore.shadowMutateStops({
        trip: session.trip,
        operation: input.operation || 'add',
        attractionId: String(input.attractionId || ''),
        day: input.day,
        targetStopId: String(input.targetStopId || ''),
        stopId: String(input.stopId || ''),
        reason: String(input.reason || '')
      }, javaTokenFor(req));
    } catch (error) {
      candidateError = error;
    }
    const candidateLatencyMs = Math.round(performance.now() - candidateStartedAt);
    const shadow = shadowMetrics.record(compareShadow({
      operation: 'stops', candidate, candidateLatencyMs, candidateError
    }));
    const invalidCandidateError = candidateValidityError(candidate, candidateError, 'Java Shadow 站点候选未返回有效行程。');
    if (invalidCandidateError) {
      if (candidateError instanceof JavaCoreError) return javaErrorResponse(res, candidateError, 'Java Shadow 站点候选失败。');
      return json(res, 502, { ok: false, code: invalidCandidateError.code, message: invalidCandidateError.message, shadow });
    }
    session.trip = clone(candidate.trip);
    session.candidateSource = clone(candidate.source || session.trip.sourceStatus || session.candidateSource || { provider: 'Java Core Backend' });
    session.shadow = shadow;
    session.updatedAt = new Date().toISOString();
    await persistentStore.savePlannerDraft?.(session);
    return json(res, 200, {
      ok: true,
      operation: candidate.operation || input.operation || 'add',
      trip: clone(session.trip),
      changedSegments: candidate.changedSegments || [],
      unchangedStops: candidate.unchangedStops || [],
      message: candidate.message || 'Java Shadow 站点候选已生成，未持久化。',
      shadow
    });
  }

  if (req.method === 'POST' && url.pathname === '/api/replan') {
    const input = await body(req);
    const session = await restorePlannerSession(input.sessionId, req);
    if (!session) return json(res, 404, { ok: false, message: '规划草稿已失效，请重新生成。' });
    const targetStopId = String(input.targetStopId || '');
    const reason = String(input.reason || '');
    const targetSessionId = String(session.javaSessionId || '').trim();
    if (targetSessionId) {
      const sessionAccessToken = String(input.sessionAccessToken || session.sessionAccessToken || '');
      const candidateStartedAt = performance.now();
      try {
        const result = await javaCore.replanPlannerSession(targetSessionId, {
          targetStopId,
          candidateVenueId: String(input.candidateVenueId || ''),
          reason,
          expectedVersion: Number(input.expectedVersion || session.trip?.version || 1),
          sessionAccessToken
        }, javaTokenFor(req), requestSignal);
        const shadow = shadowMetrics.record(compareShadow({
          operation: 'replan',
          candidate: result,
          candidateLatencyMs: Math.round(performance.now() - candidateStartedAt)
        }));
        if (result?.trip) session.trip = clone(result.trip);
        session.candidateSource = clone(session.trip.sourceStatus || session.candidateSource || { provider: 'Java Core Backend' });
        session.shadow = shadow;
        session.updatedAt = new Date().toISOString();
        session.replanHistory.push({ targetStopId, reason, replacedWith: result?.replacementVenueId || '', changedAt: session.updatedAt, source: 'JAVA_PLANNER_V1' });
        await persistentStore.savePlannerDraft?.(session);
        return json(res, 200, {
          ok: true,
          ...result,
          trip: clone(session.trip),
          changedSegments: result?.changedSegments || [targetStopId],
          unchangedStops: result?.unchangedStops || [],
          replacementReason: result?.replacementReason || reason,
          replacementVenueId: result?.replacementVenueId || '',
          memoryProposal: result?.memoryProposal || null,
          message: result?.message || 'Java Planner V1 重规划已应用并持久化。',
          shadow
        });
      } catch (error) {
        return javaErrorResponse(res, error, 'Java Planner V1 重规划失败。');
      }
    }
    const candidateStartedAt = performance.now();
    let candidate;
    let candidateError = null;
    try {
      candidate = await javaCore.shadowReplan({
        trip: session.trip,
        targetStopId,
        candidateVenueId: String(input.candidateVenueId || ''),
        reason
      }, javaTokenFor(req));
    } catch (error) {
      candidateError = error;
    }
    const candidateLatencyMs = Math.round(performance.now() - candidateStartedAt);
    const shadow = shadowMetrics.record(compareShadow({
      operation: 'replan', candidate, candidateLatencyMs, candidateError
    }));
    const invalidCandidateError = candidateValidityError(candidate, candidateError, 'Java Shadow 重规划候选未返回有效行程。');
    if (invalidCandidateError) {
      if (candidateError instanceof JavaCoreError) return javaErrorResponse(res, candidateError, 'Java Shadow 重规划候选失败。');
      return json(res, 502, { ok: false, code: invalidCandidateError.code, message: invalidCandidateError.message, shadow });
    }
    session.trip = clone(candidate.trip);
    session.candidateSource = clone(candidate.source || session.trip.sourceStatus || session.candidateSource || { provider: 'Java Core Backend' });
    session.shadow = shadow;
    session.updatedAt = new Date().toISOString();
    session.replanHistory.push({ targetStopId, reason, replacedWith: candidate.replacementVenueId || '', changedAt: session.updatedAt, source: 'JAVA_SHADOW_CANDIDATE' });
    await persistentStore.savePlannerDraft?.(session);
    return json(res, 200, {
      ok: true,
      trip: clone(session.trip),
      changedSegments: candidate.changedSegments || [targetStopId],
      unchangedStops: candidate.unchangedStops || [],
      replacementReason: candidate.replacementReason || reason,
      replacementVenueId: candidate.replacementVenueId || '',
      memoryProposal: candidate.memoryProposal || null,
      shadow
    });
  }

  if (req.method === 'POST' && url.pathname === '/api/auth/login') {
    const input = await body(req);
    const email = String(input.email || '').trim().toLowerCase();
    if (!email || !input.password) return json(res, 400, { ok: false, message: '请输入邮箱和密码。' });
    let auth;
    try {
      auth = authSessionFromResult(await javaCore.login({ username: email, password: String(input.password) }));
    } catch (error) {
      if (error instanceof JavaCoreError) {
        const errorReason = (error.message && !error.message.includes('Java Core Backend'))
          ? error.message
          : '用户名或密码错误';
        const helpfulHint = errorReason.includes('不存在')
          ? `${errorReason}，若尚未注册请先切换到右上角【注册账号】。`
          : `${errorReason}。`;
        return json(res, error.status || 401, {
          ok: false,
          code: error.code,
          message: `${helpfulHint} 草稿仍保留在当前页面。`
        });
      }
      throw error;
    }
    ensureAccountCollections(auth.user.id);

    // A Shadow draft remains a transient browser-compatibility session after
    // login. It is not copied to Node history or any durable Node Trip store.
    if (input.sessionId) {
      const session = await restorePlannerSession(input.sessionId, req);
      if (session) {
      session.userId = auth.user.id;
      session.deviceId = requestDeviceId(req);
        await persistentStore.savePlannerDraft?.(session);
      }
    }

    const response = { ok: true, user: auth.user, preferences: [], csrfToken: auth.session.csrfToken, message: '登录成功，可以保存当前行程。' };
    if (process.env.YUYOUZHICE_TEST_FIXTURES === '1' || process.env.YUYOUZHICE_TEST_SESSION_COMPAT === '1') response.token = auth.session.id;
    return json(res, 200, response, { cookies: authSessionCookies(auth.session) });
  }
  if (req.method === 'POST' && url.pathname === '/api/auth/register') {
    const input = await body(req);
    const email = String(input.email || '').trim().toLowerCase();
    const password = String(input.password || '');
    if (!/^\S+@\S+\.\S+$/.test(email)) return json(res, 400, { ok: false, message: '请输入有效邮箱。' });
    if (password.length < 6) return json(res, 400, { ok: false, message: '密码至少需要 6 位。' });
    let auth;
    try {
      auth = authSessionFromResult(await javaCore.register({ username: email, password }));
    } catch (error) {
      if (error instanceof JavaCoreError) return javaErrorResponse(res, error, '注册失败。');
      throw error;
    }
    ensureAccountCollections(auth.user.id);

    // Registration only binds the transient Shadow draft to this web session.
    // Formal persistence is performed later through Java's Trip authority.
    if (input.sessionId) {
      const session = await restorePlannerSession(input.sessionId, req);
      if (session) {
      session.userId = auth.user.id;
      session.deviceId = requestDeviceId(req);
        await persistentStore.savePlannerDraft?.(session);
      }
    }

    const response = { ok: true, user: auth.user, csrfToken: auth.session.csrfToken, message: '注册成功，可以保存当前行程。' };
    if (process.env.YUYOUZHICE_TEST_FIXTURES === '1' || process.env.YUYOUZHICE_TEST_SESSION_COMPAT === '1') response.token = auth.session.id;
    return json(res, 201, response, { cookies: authSessionCookies(auth.session) });
  }
  if (req.method === 'POST' && url.pathname === '/api/auth/logout') {
    const session = sessionForRequest(req);
    if (session) {
      try {
        await javaCore.logout(session.javaToken);
      } catch (error) {
        if (error instanceof JavaCoreError && error.status >= 500) return javaErrorResponse(res, error, '注销同步暂不可用，请稍后重试。');
      }
      webSessions.destroy(session.id);
    }
    return json(res, 200, { ok: true, message: '已退出登录。' }, { cookies: [clearSessionCookie(), clearCsrfCookie()] });
  }
  // Formal Trip persistence is delegated to Java. Node adapts only the browser
  // response shape and never writes a second Trip record.
  if (req.method === 'POST' && url.pathname === '/api/trips/save') {
    const user = await authUser(req);
    if (!user) return json(res, 401, { ok: false, message: '请先登录后保存，当前草稿不会丢失。' });
    const input = await body(req);
    if (!input.trip || typeof input.trip !== 'object') return json(res, 400, { ok: false, message: '没有可保存的行程。' });
    const plannerSession = input.plannerSessionId
      ? await restorePlannerSession(String(input.plannerSessionId), req)
      : null;
    const usePlannerSave = plannerSession && !plannerCapability(plannerSession).legacyMode
      && String(plannerSession.javaSessionId || '').trim();
    const targetTripId = String(input.savedTripId || input.tripId || input.trip?.savedTripId || input.trip?.formalTripId || '').trim();
    const candidateStartedAt = performance.now();
    try {
      let formal;
      let isUpdate = false;
      if (usePlannerSave) {
        const saved = await javaCore.savePlannerSession(
          String(plannerSession.javaSessionId),
          { sessionAccessToken: String(plannerSession.sessionAccessToken || '') },
          javaTokenFor(req)
        );
        formal = saved.trip;
        if (!formal || !formal.id) return json(res, 502, { ok: false, code: 'PLANNER_SAVE_CONTRACT_INVALID', message: 'Java Planner 未返回有效正式行程。' });
        plannerSession.formalTripId = formal.id;
        plannerSession.trip = clone(formal.plan || plannerSession.trip);
        plannerSession.trip.formalTripId = formal.id;
        plannerSession.trip.savedTripId = formal.id;
        isUpdate = Boolean(targetTripId || formal.currentVersion > 1);
        await persistentStore.savePlannerDraft?.(plannerSession);
        await persistFormalTripWorkspace(plannerSession);
      } else if (targetTripId) {
        const current = await javaCore.getTrip(javaTokenFor(req), targetTripId);
        formal = await javaCore.updateTrip(javaTokenFor(req), targetTripId, {
          plan: input.trip,
          title: String(input.trip.title || current.title || ''),
          expectedVersion: Number(current.currentVersion),
          idempotencyKey: `web-save-${targetTripId}-${Number(current.currentVersion)}`,
          changeReason: String(input.reason || 'Web BFF 保存行程')
        });
        isUpdate = true;
      } else {
        formal = await javaCore.createTrip(javaTokenFor(req), {
          plan: input.trip,
          title: String(input.trip.title || ''),
          idempotencyKey: `web-create-${requestDeviceId(req)}-${String(input.trip.id || 'draft')}-${Number(input.trip.version || 1)}`
        });
      }
      const versions = await javaCore.tripVersions(javaTokenFor(req), formal.id);
      const saved = savedTripProjection(formal, versions);
      const shadow = shadowMetrics.record(compareShadow({
        operation: 'trip', candidate: { trip: formal.plan },
        candidateLatencyMs: Math.round(performance.now() - candidateStartedAt)
      }));
      return json(res, 200, { ok: true, saved, isUpdate, message: isUpdate ? 'Java Core Backend 已更新正式行程。' : 'Java Core Backend 已保存正式行程。', shadow });
    } catch (error) {
      shadowMetrics.record(compareShadow({
        operation: 'trip',
        candidateLatencyMs: Math.round(performance.now() - candidateStartedAt),
        candidateError: error
      }));
      return javaErrorResponse(res, error, 'Java Core Backend 保存行程失败。');
    }
  }
  // Opening a formal Java Trip creates only a process-local draft session so
  // subsequent edits remain Java candidates. The formal Trip is never copied
  // to Node persistent storage.
  if (req.method === 'POST' && /^\/api\/trips\/[^/]+\/open$/.test(url.pathname)) {
    const user = await authUser(req);
    if (!user) return json(res, 401, { ok: false, message: '请登录后打开已保存行程。' });
    const tripId = decodeURIComponent(url.pathname.split('/')[3]);
    try {
      const restored = await javaCore.openPlannerTrip(tripId, javaTokenFor(req), requestSignal);
      const formal = await javaCore.getTrip(javaTokenFor(req), tripId);
      const session = openFormalTripSession(formal, {
        userId: user.id,
        deviceId: requestDeviceId(req)
      });
      session.javaSessionId = String(restored.sessionId || '');
      session.sessionAccessToken = String(restored.sessionAccessToken || '');
      session.trip = clone(restored.trip || formal.plan || session.trip);
      session.trip.formalTripId = tripId;
      session.trip.savedTripId = tripId;
      session.syncRevision = Number(restored.syncRevision || 1);
      session.legacyMode = false;
      session.adjustmentCapability = 'V1_PROPOSAL';
      const workspace = hydrateFormalTripWorkspace(session);
      await persistentStore.savePlannerDraft?.(session);
      return json(res, 200, {
        ok: true,
        sessionId: session.id,
        javaSessionId: session.javaSessionId,
        sessionAccessToken: session.sessionAccessToken,
        savedTripId: tripId,
        legacyMode: false,
        adjustmentCapability: 'V1_PROPOSAL',
        formalTripVersion: restored.formalTripVersion,
        trip: clone(session.trip),
        workspace: workspace ? clone(workspace) : {
          chatMessages: [],
          chatMode: 'chat',
          plannerConversationContext: null,
          itineraryMemorySnapshot: clone(session.itineraryMemorySnapshot || itineraryMemorySnapshot(session))
        },
        message: 'Java Core Backend 正式行程已恢复为可编辑规划会话。'
      });
    } catch (error) {
      return javaErrorResponse(res, error, '无法打开 Java Core Backend 正式行程。');
    }
  }
  // The workspace is scoped to one authenticated user and one formal Trip.
  // Browser data may update its chat transcript/mode only; continuation and
  // itinerary-memory data are derived server-side from the authorized session.
  if (req.method === 'PUT' && /^\/api\/trips\/[^/]+\/workspace$/.test(url.pathname)) {
    const user = await authUser(req);
    if (!user) return json(res, 401, { ok: false, message: '请登录后保存此行程的对话记录。' });
    const tripId = decodeURIComponent(url.pathname.split('/')[3]);
    const input = await body(req);
    const session = await restorePlannerSession(String(input.sessionId || ''), req);
    if (!session) return json(res, 404, { ok: false, code: 'PLANNER_SESSION_NOT_FOUND', recoverable: true, message: '当前行程会话已失效，请重新打开该行程后再继续对话。' });
    if (String(session.userId || '') !== String(user.id || '') || String(session.formalTripId || '') !== tripId) {
      return json(res, 403, { ok: false, code: 'TRIP_WORKSPACE_FORBIDDEN', message: '当前会话不属于这份行程，无法写入对话记录。' });
    }
    const workspace = await persistFormalTripWorkspace(session, {
      chatMessages: Array.isArray(input.chatMessages) ? input.chatMessages : [],
      chatMode: input.chatMode === 'planner' ? 'planner' : 'chat'
    });
    return json(res, 200, { ok: true, workspace: clone(workspace) });
  }
  if (req.method === 'DELETE' && /^\/api\/trips\/[^/]+$/.test(url.pathname)) {
    const user = await authUser(req);
    if (!user) return json(res, 401, { ok: false, message: '请登录后删除已保存行程。' });
    const tripId = decodeURIComponent(url.pathname.split('/').pop());
    try {
      const current = await javaCore.getTrip(javaTokenFor(req), tripId);
      const deleted = await javaCore.deleteTrip(javaTokenFor(req), tripId, Number(current.currentVersion));
      await persistentStore.deleteTripWorkspace?.(user.id, tripId);
      return json(res, 200, { ok: true, deletedId: deleted?.tripId || tripId, message: 'Java Core Backend 已删除正式行程。' });
    } catch (error) {
      return javaErrorResponse(res, error, 'Java Core Backend 删除行程失败。');
    }
  }
  if (req.method === 'GET' && /^\/api\/trips\/[^/]+\/pdf$/.test(url.pathname)) {
    const user = await authUser(req);
    if (!user) return json(res, 401, { ok: false, message: '请登录后导出行程。' });
    const tripId = decodeURIComponent(url.pathname.split('/')[3]);
    try {
      const trip = await javaCore.getTrip(javaTokenFor(req), tripId);
      const pdf = await javaCore.exportTrip(javaTokenFor(req), tripId);
      const filename = tripPdfFilename(trip?.title || trip?.plan?.title);
      res.writeHead(200, {
        'content-type': pdf.contentType || 'application/pdf',
        'content-disposition': `attachment; filename="trip-guide.pdf"; filename*=UTF-8''${encodeURIComponent(filename)}`,
        'cache-control': 'no-store'
      });
      return res.end(pdf.body);
    } catch (error) {
      return javaErrorResponse(res, error, 'Java Core Backend PDF 导出失败。');
    }
  }
  if (req.method === 'GET' && url.pathname === '/api/trips') {
    const user = await authUser(req);
    if (!user) return json(res, 401, { ok: false, message: '请登录查看已保存行程。' });
    try {
      const formalTrips = await javaCore.listTrips(javaTokenFor(req));
      return json(res, 200, { ok: true, trips: (Array.isArray(formalTrips) ? formalTrips : []).map((trip) => savedTripProjection(trip)) });
    } catch (error) {
      return javaErrorResponse(res, error, '无法读取 Java Core Backend 正式行程。');
    }
  }
  if (req.method === 'POST' && url.pathname === '/api/preferences') {
    const user = await authUser(req);
    if (!user) return json(res, 401, { ok: false, message: '登录后才能记住偏好。' });
    const input = await body(req);
    const value = String(input.value || '').trim();
    if (!value) return json(res, 400, { ok: false, message: '没有可记住的偏好。' });
    try {
      const current = await javaCore.getPreferences(javaTokenFor(req));
      const mapped = legacyPreferencePatch(value, current);
      if (!mapped) return json(res, 400, { ok: false, message: '没有可记住的偏好。' });
      if (mapped.unsupported) return json(res, 400, { ok: false, code: 'PREFERENCE_UNSUPPORTED', message: '该旧偏好没有对应的 Java typed field，已拒绝写入。' });
      const updated = await javaCore.mergePreferences(javaTokenFor(req), mapped.patch, current.revision);
      const history = recordLegacyPreferenceEvent(user.id, { value, action: 'confirmed', mappedFields: Object.keys(mapped.patch) });
      return json(res, 200, { ok: true, ...preferenceResponse(updated, history), message: '偏好已由 Java Preferences Authority 记住。' });
    } catch (error) {
      return javaErrorResponse(res, error, '偏好保存失败。');
    }
  }
  if (req.method === 'GET' && url.pathname === '/api/memories') {
    const user = await authUser(req);
    if (!user) return json(res, 401, { ok: false, message: '登录后才能查看旅行记忆。' });
    try { return json(res, 200, { ok: true, memories: await javaCore.listTravelMemories(javaTokenFor(req)) }); }
    catch (error) { return javaErrorResponse(res, error, '无法读取旅行记忆。'); }
  }
  if (req.method === 'POST' && url.pathname === '/api/memories/candidate') {
    const input = await body(req);
    try {
      return json(res, 200, { ok: true, candidate: await javaCore.suggestTravelMemory({ message: String(input.message || '') }, javaTokenFor(req)) });
    }
    catch (error) { return javaErrorResponse(res, error, '无法识别旅行记忆候选。'); }
  }
  if (req.method === 'POST' && url.pathname === '/api/memories/observe') {
    const user = await authUser(req);
    if (!user) return json(res, 200, { ok: true, message: '访客会话跳过持久记忆整理。' });
    const input = await body(req);
    try {
      await javaCore.captureTravelMemoryObservation({ message: String(input.message || ''), sessionId: String(input.sessionId || '') }, javaTokenFor(req));
      return json(res, 202, { ok: true, message: '已进入后台记忆整理队列。' });
    } catch (error) { return javaErrorResponse(res, error, '无法记录记忆整理线索。'); }
  }
  if (req.method === 'GET' && url.pathname === '/api/memories/candidates') {
    const user = await authUser(req);
    if (!user) return json(res, 401, { ok: false, message: '登录后才能查看记忆建议。' });
    try { return json(res, 200, { ok: true, candidates: await javaCore.listTravelMemoryCandidates(javaTokenFor(req)) }); }
    catch (error) { return javaErrorResponse(res, error, '无法读取记忆建议。'); }
  }
  if (req.method === 'POST' && /^\/api\/memories\/candidates\/[^/]+\/(confirm|dismiss)$/.test(url.pathname)) {
    const user = await authUser(req);
    if (!user) return json(res, 401, { ok: false, message: '登录后才能处理记忆建议。' });
    const [, id, action] = url.pathname.match(/^\/api\/memories\/candidates\/([^/]+)\/(confirm|dismiss)$/) || [];
    try {
      if (action === 'confirm') return json(res, 200, { ok: true, memory: await javaCore.confirmTravelMemoryCandidate(decodeURIComponent(id), javaTokenFor(req)), message: '旅行记忆已确认。' });
      await javaCore.dismissTravelMemoryCandidate(decodeURIComponent(id), javaTokenFor(req));
      return json(res, 200, { ok: true, message: '记忆建议已忽略。' });
    } catch (error) { return javaErrorResponse(res, error, '处理记忆建议失败。'); }
  }
  if (req.method === 'POST' && url.pathname === '/api/memories') {
    const user = await authUser(req);
    if (!user) return json(res, 401, { ok: false, message: '登录后才能保存旅行记忆。' });
    const input = await body(req);
    try { return json(res, 201, { ok: true, memory: await javaCore.createTravelMemory(input, javaTokenFor(req)), message: '旅行记忆已保存。' }); }
    catch (error) { return javaErrorResponse(res, error, '保存旅行记忆失败。'); }
  }
  if (req.method === 'PATCH' && url.pathname.startsWith('/api/memories/')) {
    const user = await authUser(req);
    if (!user) return json(res, 401, { ok: false, message: '登录后才能编辑旅行记忆。' });
    const id = decodeURIComponent(url.pathname.slice('/api/memories/'.length));
    try { return json(res, 200, { ok: true, memory: await javaCore.updateTravelMemory(id, await body(req), javaTokenFor(req)), message: '旅行记忆已更新。' }); }
    catch (error) { return javaErrorResponse(res, error, '更新旅行记忆失败。'); }
  }
  if (req.method === 'DELETE' && url.pathname.startsWith('/api/memories/')) {
    const user = await authUser(req);
    if (!user) return json(res, 401, { ok: false, message: '登录后才能删除旅行记忆。' });
    const id = decodeURIComponent(url.pathname.slice('/api/memories/'.length));
    try { await javaCore.deleteTravelMemory(id, javaTokenFor(req)); return json(res, 200, { ok: true, message: '旅行记忆已删除。' }); }
    catch (error) { return javaErrorResponse(res, error, '删除旅行记忆失败。'); }
  }
  if (req.method === 'GET' && url.pathname === '/api/preferences') {
    const user = await authUser(req);
    if (!user) return json(res, 401, { ok: false, message: '登录后才能查看已确认偏好。' });
    try {
      const current = await javaCore.getPreferences(javaTokenFor(req));
      return json(res, 200, { ok: true, ...preferenceResponse(current, legacyPreferenceEvents.get(user.id) || []) });
    } catch (error) {
      return javaErrorResponse(res, error, '无法读取 Java Preferences。');
    }
  }
  if (req.method === 'DELETE' && url.pathname.startsWith('/api/preferences/')) {
    const user = await authUser(req);
    if (!user) return json(res, 401, { ok: false, message: '登录后才能管理旅行偏好。' });
    const value = decodeURIComponent(url.pathname.slice('/api/preferences/'.length));
    try {
      const current = await javaCore.getPreferences(javaTokenFor(req));
      const next = {
        interests: Array.isArray(current.interests) ? current.interests.filter((item) => String(item) !== value) : [],
        walkingTolerance: current.walkingTolerance,
        budget: current.budget,
        companions: current.companions,
        transportPreference: current.transportPreference,
        dietPreference: current.dietPreference,
        stayArea: current.stayArea,
        legacyMetadata: current.legacyMetadata
      };
      if (value === '少走路' && String(next.walkingTolerance).toUpperCase() === 'LOW') next.walkingTolerance = 'UNSPECIFIED';
      if (value === '打车优先' && String(next.transportPreference).toUpperCase() === 'TAXI') next.transportPreference = 'UNSPECIFIED';
      if (value === '公共交通优先' && String(next.transportPreference).toUpperCase() === 'PUBLIC_TRANSIT') next.transportPreference = 'UNSPECIFIED';
      if (value.startsWith('住宿区域：')) next.stayArea = '';
      const updated = await javaCore.replacePreferences(javaTokenFor(req), next, current.revision);
      const history = recordLegacyPreferenceEvent(user.id, { value, action: 'removed' });
      return json(res, 200, { ok: true, ...preferenceResponse(updated, history), message: `已移除“${value}”偏好。` });
    } catch (error) {
      return javaErrorResponse(res, error, '偏好移除失败。');
    }
  }

  if (req.method === 'GET' && url.pathname === '/api/preferences/prepend-prompt') {
    const user = await authUser(req);
    if (!user) {
      const sessionId = req.webSession?.id || req.headers?.['x-session-id'] || 'guest';
      const prompt = guestPrependPromptStore.get(sessionId) || '';
      return json(res, 200, { ok: true, prependPrompt: prompt, enabled: true });
    }
    try {
      const typedPreferences = await javaCore.getPreferences(javaTokenFor(req));
      let prompt = typedPreferences?.legacyMetadata?.profilePrependPrompt;
      if (!prompt) {
        try {
          const resJava = await javaCore.getPrependPrompt(javaTokenFor(req));
          prompt = resJava?.data?.prependPrompt || resJava?.prependPrompt || '';
        } catch {}
      }
      return json(res, 200, {
        ok: true,
        prependPrompt: prompt || '',
        userCustomizedPrompt: typedPreferences?.legacyMetadata?.userCustomizedPrompt || '',
        enabled: typedPreferences?.legacyMetadata?.travelMemoryEnabled !== false
      });
    } catch (error) {
      return javaErrorResponse(res, error, '无法读取旅行偏好提示词。');
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/preferences/prepend-prompt') {
    const user = await authUser(req);
    const input = await body(req);
    const action = String(input.action || 'save');
    const customText = String(input.prependPrompt || input.userCustomizedPrompt || '').trim();

    if (!user) {
      const sessionId = req.webSession?.id || req.headers?.['x-session-id'] || 'guest';
      guestPrependPromptStore.set(sessionId, customText);
      return json(res, 200, { ok: true, prependPrompt: customText, message: '偏好提示词已保存。' });
    }

    try {
      let updatedPrompt = customText;
      if (action === 'resynthesize') {
        const resJava = await javaCore.updatePrependPrompt({ action: 'resynthesize' }, javaTokenFor(req));
        updatedPrompt = resJava?.data?.prependPrompt || resJava?.prependPrompt || '';
      } else {
        const resJava = await javaCore.updatePrependPrompt({ prependPrompt: customText }, javaTokenFor(req));
        updatedPrompt = resJava?.data?.prependPrompt || resJava?.prependPrompt || customText;
      }
      return json(res, 200, {
        ok: true,
        prependPrompt: updatedPrompt,
        message: action === 'resynthesize' ? '前置提示词已重新生成。' : '前置提示词已保存。'
      });
    } catch (error) {
      return javaErrorResponse(res, error, '保存偏好提示词失败。');
    }
  }

  if (req.method === 'GET' && url.pathname === '/api/preferences/slots') {
    const user = await authUser(req);
    if (!user) {
      const sessionId = req.webSession?.id || req.headers?.['x-session-id'] || 'guest';
      const guestSlots = guestSlotsStore.get(sessionId) || { diningSlots: [], attractionSlots: [] };
      return json(res, 200, { ok: true, diningSlots: guestSlots.diningSlots || [], attractionSlots: guestSlots.attractionSlots || [] });
    }
    try {
      const current = await javaCore.getPreferences(javaTokenFor(req));
      const diningSlots = Array.isArray(current?.legacyMetadata?.diningSlots) ? current.legacyMetadata.diningSlots : [];
      const attractionSlots = Array.isArray(current?.legacyMetadata?.attractionSlots) ? current.legacyMetadata.attractionSlots : [];
      return json(res, 200, { ok: true, diningSlots, attractionSlots });
    } catch (error) {
      return javaErrorResponse(res, error, '无法读取偏好槽位。');
    }
  }
  if (req.method === 'POST' && url.pathname === '/api/preferences/slots') {
    const user = await authUser(req);
    const input = await body(req);
    const slot = String(input.slot || '').trim();
    const tag = String(input.tag || '').trim();
    const action = String(input.action || 'add').trim();
    if (!['dining', 'attraction'].includes(slot)) {
      return json(res, 400, { ok: false, message: '无效的偏好槽位类型。' });
    }
    if (!tag) {
      return json(res, 400, { ok: false, message: '标签内容不能为空。' });
    }
    if (tag.length > 20) {
      return json(res, 400, { ok: false, message: '标签长度不能超过20字。' });
    }

    if (!user) {
      const sessionId = req.webSession?.id || req.headers?.['x-session-id'] || 'guest';
      if (!guestSlotsStore.has(sessionId)) guestSlotsStore.set(sessionId, { diningSlots: [], attractionSlots: [] });
      const guestSlots = guestSlotsStore.get(sessionId);
      const key = slot === 'dining' ? 'diningSlots' : 'attractionSlots';
      let list = [...(guestSlots[key] || [])];
      if (action === 'add') {
        if (!list.includes(tag)) list.push(tag);
      } else {
        list = list.filter((t) => t !== tag);
      }
      guestSlots[key] = list;
      return json(res, 200, {
        ok: true,
        diningSlots: guestSlots.diningSlots || [],
        attractionSlots: guestSlots.attractionSlots || [],
        message: action === 'add' ? `已将【${tag}】加入偏好槽位。` : `已移除【${tag}】。`
      });
    }

    try {
      const current = await javaCore.getPreferences(javaTokenFor(req));
      const currentMeta = { ...(current.legacyMetadata || {}) };
      const currentDining = Array.isArray(currentMeta.diningSlots) ? [...currentMeta.diningSlots] : [];
      const currentAttraction = Array.isArray(currentMeta.attractionSlots) ? [...currentMeta.attractionSlots] : [];

      if (slot === 'dining') {
        if (action === 'add') {
          if (!currentDining.includes(tag)) currentDining.push(tag);
        } else {
          const idx = currentDining.indexOf(tag);
          if (idx !== -1) currentDining.splice(idx, 1);
        }
        currentMeta.diningSlots = currentDining;
      } else {
        if (action === 'add') {
          if (!currentAttraction.includes(tag)) currentAttraction.push(tag);
        } else {
          const idx = currentAttraction.indexOf(tag);
          if (idx !== -1) currentAttraction.splice(idx, 1);
        }
        currentMeta.attractionSlots = currentAttraction;
      }

      const updated = await javaCore.replacePreferences(javaTokenFor(req), {
        ...current,
        legacyMetadata: currentMeta
      }, current.revision);

      const history = recordLegacyPreferenceEvent(user.id, { value: `${slot === 'dining' ? '美食偏好' : '景点偏好'}：${tag}`, action: action === 'add' ? 'added' : 'removed' });
      return json(res, 200, {
        ok: true,
        ...preferenceResponse(updated, history),
        diningSlots: currentDining,
        attractionSlots: currentAttraction,
        message: action === 'add' ? `已将【${tag}】加入${slot === 'dining' ? '美食' : '景点'}偏好！` : `已移除【${tag}】。`
      });
    } catch (error) {
      return javaErrorResponse(res, error, '槽位偏好保存失败。');
    }
  }
  if (req.method === 'GET' && url.pathname === '/api/planner/context') {
    const user = await authUser(req);
    const sessionId = req.webSession?.id || req.headers?.['x-session-id'] || 'guest';
    if (!user) {
      return json(res, 200, {
        ok: true,
        preferences: [],
        memories: [],
        diningSlots: [],
        attractionSlots: [],
        profilePrependPrompt: guestPrependPromptStore.get(sessionId) || '',
        memoryEnabled: false
      });
    }
    try {
      const typedPreferences = await javaCore.getPreferences(javaTokenFor(req));
      const allMemories = await javaCore.listTravelMemories(javaTokenFor(req));
      // 7天滚动过滤：右侧近期记忆流只返回 7 天内的记录
      const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
      const recentMemories = (Array.isArray(allMemories) ? allMemories : []).filter((m) => {
        const ts = Number(m.createdAt || m.created_at || m.updatedAt || m.updated_at || 0);
        return ts === 0 || ts >= sevenDaysAgo;
      });
      return json(res, 200, {
        ok: true,
        preferences: typedPreferences?.preferences || [],
        diningSlots: Array.isArray(typedPreferences?.legacyMetadata?.diningSlots) ? typedPreferences.legacyMetadata.diningSlots : [],
        attractionSlots: Array.isArray(typedPreferences?.legacyMetadata?.attractionSlots) ? typedPreferences.legacyMetadata.attractionSlots : [],
        profilePrependPrompt: typedPreferences?.legacyMetadata?.profilePrependPrompt || '',
        userCustomizedPrompt: typedPreferences?.legacyMetadata?.userCustomizedPrompt || '',
        memories: recentMemories,
        memoryEnabled: typedPreferences?.legacyMetadata?.travelMemoryEnabled !== false
      });
    } catch {
      return json(res, 200, { ok: true, preferences: [], memories: [], diningSlots: [], attractionSlots: [], profilePrependPrompt: '', memoryEnabled: false });
    }
  }
  if (req.method === 'GET' && url.pathname === '/api/profile') {
    const user = await authUser(req);
    if (!user) return json(res, 401, { ok: false, message: '登录后才能查看旅行档案。' });
    try {
      const typedPreferences = await javaCore.getPreferences(javaTokenFor(req));
      const allMemories = await javaCore.listTravelMemories(javaTokenFor(req));
      const memoryCandidates = await javaCore.listTravelMemoryCandidates(javaTokenFor(req));
      const formalTrips = await javaCore.listTrips(javaTokenFor(req));
      const savedTrips = (Array.isArray(formalTrips) ? formalTrips : []).map((trip) => savedTripProjection(trip));

      // 7天滚动过滤：右侧近期记忆流只返回 7 天内的记录
      const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
      const recentMemories = (Array.isArray(allMemories) ? allMemories : []).filter((m) => {
        const ts = Number(m.createdAt || m.created_at || m.updatedAt || m.updated_at || 0);
        return ts === 0 || ts >= sevenDaysAgo;
      });

      return json(res, 200, {
        ok: true,
        user,
        ...preferenceResponse(typedPreferences, legacyPreferenceEvents.get(user.id) || []),
        diningSlots: Array.isArray(typedPreferences?.legacyMetadata?.diningSlots) ? typedPreferences.legacyMetadata.diningSlots : [],
        attractionSlots: Array.isArray(typedPreferences?.legacyMetadata?.attractionSlots) ? typedPreferences.legacyMetadata.attractionSlots : [],
        profilePrependPrompt: typedPreferences?.legacyMetadata?.profilePrependPrompt || '',
        userCustomizedPrompt: typedPreferences?.legacyMetadata?.userCustomizedPrompt || '',
        memories: recentMemories,
        memoryCandidates,
        memoryEnabled: typedPreferences?.legacyMetadata?.travelMemoryEnabled === true,
        memoryLastReviewAt: Number(typedPreferences?.legacyMetadata?.travelMemoryLastReviewAt || 0) || null,
        preferenceHistory: legacyPreferenceEvents.get(user.id) || [],
        trips: savedTrips.map((item) => ({ id: item.id, savedAt: item.savedAt, title: item.trip?.title, version: item.trip?.version || 1, versionHistory: item.versionHistory?.length ? item.versionHistory : [{ version: item.trip?.version || 1, label: '保存版本', reason: '', createdAt: item.savedAt }] })),
        feedback: feedbackByUser.get(user.id) || []
      });
    } catch (error) {
      return javaErrorResponse(res, error, '无法读取 Java 用户档案。');
    }
  }
  if (req.method === 'PUT' && url.pathname === '/api/memory-settings') {
    const user = await authUser(req);
    if (!user) return json(res, 401, { ok: false, message: '登录后才能管理长期旅行记忆。' });
    const input = await body(req);
    const enabled = input.enabled === true;
    try {
      const current = await javaCore.getPreferences(javaTokenFor(req));
      const legacyMetadata = { ...(current.legacyMetadata || {}), travelMemoryEnabled: enabled };
      await javaCore.mergePreferences(javaTokenFor(req), { legacyMetadata }, current.revision);
      return json(res, 200, { ok: true, memoryEnabled: enabled, message: enabled ? '长期旅行记忆已启用。' : '长期旅行记忆已关闭。' });
    } catch (error) {
      return javaErrorResponse(res, error, '长期旅行记忆设置失败。');
    }
  }
  if (req.method === 'POST' && url.pathname === '/api/feedback') {
    const user = await authUser(req);
    const input = await body(req);
    const value = String(input.value || '').trim();
    if (!['helpful', 'needs-work', 'letter'].includes(value)) return json(res, 400, { ok: false, message: '反馈类型不受支持。' });
    const reason = String(input.reason || '').trim();
    if (value === 'letter' && !reason) return json(res, 400, { ok: false, message: '请先写下反馈内容。' });
    const session = sessions.get(String(input.sessionId || ''));
    const sourceTrip = session?.trip;
    const item = {
      value,
      reason: reason.slice(0, 600) || '未填写',
      tripVersion: Number(input.tripVersion || sourceTrip?.version || 1),
      sessionId: String(input.sessionId || ''),
      sourceMode: String(input.sourceMode || sourceTrip?.sourceMode || '未声明'),
      constraintSatisfaction: Number.isFinite(sourceTrip?.qualityMetrics?.constraintSatisfaction?.score) ? sourceTrip.qualityMetrics.constraintSatisfaction.score : null,
      createdAt: new Date().toISOString()
    };
    if (user) {
      const feedback = feedbackByUser.get(user.id) || [];
      feedback.push(item);
      feedbackByUser.set(user.id, feedback);
      await persistentStore.persist();
      return json(res, 200, { ok: true, feedback, scope: 'account', message: value === 'letter' ? '已收到你的来信。' : value === 'helpful' ? '已记录：这份规划对你有帮助。' : '已记录：我们会保留这次改进方向。' });
    }
    if (!session) return json(res, 404, { ok: false, message: '当前匿名规划已失效，请重新生成后再反馈。' });
    session.feedback.push(item);
    return json(res, 200, { ok: true, feedback: session.feedback, scope: 'session', message: value === 'letter' ? '已收到你的来信。' : value === 'helpful' ? '已记录：这份规划对你有帮助。' : '已记录：我们会保留这次改进方向。' });
  }
  return json(res, 404, { ok: false, message: '接口不存在。' });
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf'
};

async function staticFile(req, res, pathname) {
  const relative = pathname.replace(/^\//, '');

  // BFF is intentionally API-first. Only shared attraction images are public;
  // the Vue app owns pages, bundles and its deployment platform's SPA routing.
  if (!relative.startsWith('images/') && !relative.startsWith('images\\')) {
    return json(res, 404, { ok: false, message: '页面或资源不存在。' });
  }
  const full = path.resolve(ROOT, relative);

  // 安全检查：文件必须在项目根目录下且存在
  if (!full.startsWith(ROOT) || !existsSync(full)) {
    // 如果是缺失的图片，友好降级提供 SVG 占位
    if (relative.includes('.png') || relative.includes('.jpg') || relative.includes('.svg')) {
      const fallbackSvg = path.join(ROOT, 'images', 'attraction-hero.svg');
      if (existsSync(fallbackSvg)) {
        const svgContent = await readFile(fallbackSvg);
        res.writeHead(200, { 'content-type': 'image/svg+xml; charset=utf-8', 'cache-control': 'no-cache, max-age=0, must-revalidate' });
        return res.end(svgContent);
      }
    }
    return json(res, 404, { ok: false, message: '页面或资源不存在。' });
  }

  const content = await readFile(full);
  const ext = path.extname(full).toLowerCase();
  // 文件名未带 hash，不能用 immutable 长缓存；但允许浏览器使用 ETag 对未变资源
  // 做 304 校验复用，避免每次刷新都重新下载全部 ESM 模块。
  const fileStat = await stat(full);
  const etag = `W/\"${fileStat.size.toString(16)}-${Math.floor(fileStat.mtimeMs).toString(16)}\"`;
  const headers = {
    'content-type': MIME[ext] || 'application/octet-stream',
    'cache-control': 'no-cache, max-age=0, must-revalidate',
    etag
  };
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, headers);
    return res.end();
  }
  res.writeHead(200, headers);
  res.end(content);
}

export function createAppServer({ port = PORT } = {}) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const requestController = new AbortController();
    const abortRequest = () => requestController.abort();
    const onResponseClose = () => {
      if (!res.writableEnded) requestController.abort();
    };
    req.once('aborted', abortRequest);
    res.once('close', onResponseClose);
    try {
      if (url.pathname.startsWith('/api/')) return await api(req, res, url, requestController.signal);
      if (url.pathname === '/') {
        return json(res, 200, {
          ok: true,
          service: '渝游智策 BFF',
          message: '服务运行正常。前端由独立 Web 应用托管，请通过 /api/* 访问业务接口。',
          health: '/api/health'
        });
      }
      return await staticFile(req, res, url.pathname);
    } catch (error) {
      if (error?.code === 'REQUEST_ABORTED' || req.aborted || res.destroyed) return;
      const errorType = error instanceof Error ? error.name : 'UnknownError';
      const diagnostics = diagnosticError(error);
      const record = { method: req.method, route: url.pathname, ...diagnostics };
      console.error(`[BFF] request failed: ${JSON.stringify(record)}`);
      void writeBffDiagnostic('request-error', record);
      if (!res.headersSent) return json(res, 500, { ok: false, message: '服务出现异常，请稍后重试。' });
    } finally {
      req.removeListener('aborted', abortRequest);
      res.removeListener('close', onResponseClose);
    }
  });
  // 预热不阻塞监听：首屏和认证可以立即可用，目录数据则在后台消化远端连接冷启动。
  server.once('listening', () => {
    void listCachedExploreAttractions().catch((error) => {
      void writeBffDiagnostic('explore-cache-warmup-failed', diagnosticError(error));
    });
  });
  return server.listen(port);
}

export function resetDemoState() {
  sessions.clear();
  webSessions.clear();
  exploreCatalogCache.clear();
  legacyPreferenceEvents.clear();
  revocationStore.clear();
}

if (process.argv.includes('--check')) {
  console.log(JSON.stringify({ ok: true, service: '渝游智策', adapter: JAVA_MAP_ADAPTER, staticEntry: path.join('app', 'index.html') }, null, 2));
} else if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  createAppServer().on('listening', () => console.log(`渝游智策已启动：http://localhost:${PORT}`));
}
