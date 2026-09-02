/**
 * java-core-client.mjs
 *
 * Core responsibility: server-to-server delegation from the Web BFF to the
 * Java Core Backend. Production authentication never falls back to the Node
 * user store. The in-memory authority below is synthetic-only test support.
 */

import { randomBytes } from 'node:crypto';
import './env.mjs';
import { ATTRACTIONS_DATA } from './attractions-data.mjs';

export const LOCAL_JAVA_CORE_URL = 'http://localhost:8080';
export const DEPLOYED_JAVA_CORE_URL = 'https://ggysummer.zeabur.app';

/**
 * 解析 Web BFF 到 Java Core 的唯一服务地址。
 *
 * 浏览器继续只请求同源 `/api`，由 BFF 持有认证与接口编排。不能把前端的
 * `/api` 基址直接改成 8080：Java 的公开契约是 `/ai/...`，而登录会话、
 * CSRF、行程保存等网页契约仍由 BFF 提供。显式环境变量永远优先，方便未来
 * 更换部署地址或做灰度发布。
 */
export function resolveJavaCoreUrl(env = process.env) {
  const explicit = String(env.CORE_BACKEND_URL || env.YUYOUZHICE_JAVA_CORE_URL || '').trim();
  if (explicit) return explicit.replace(/\/$/, '');

  const deployed = String(env.NODE_ENV || '').toLowerCase() === 'production'
    || Boolean(env.ZEABUR || env.ZEABUR_PROJECT_ID || env.ZEABUR_SERVICE_ID || env.VERCEL || env.RAILWAY_ENVIRONMENT);
  return deployed ? DEPLOYED_JAVA_CORE_URL : LOCAL_JAVA_CORE_URL;
}

// CORE_BACKEND_URL is the canonical Web BFF -> Java Core setting. In a local
// runtime it falls back to 8080; in a hosted runtime it selects Zeabur.
const JAVA_CORE_URL = resolveJavaCoreUrl();
const JAVA_TIMEOUT_MS = Math.max(250, Number(process.env.YUYOUZHICE_JAVA_TIMEOUT_MS || 60000));
const TEST_STUB_ENABLED = process.env.YUYOUZHICE_JAVA_TEST_STUB === '1'
  || (process.env.YUYOUZHICE_TEST_FIXTURES === '1' && process.env.YUYOUZHICE_JAVA_TEST_STUB !== '0');

export class JavaCoreError extends Error {
  constructor(status, code, message, details = null) {
    super(message);
    this.name = 'JavaCoreError';
    this.status = Number(status) || 503;
    this.code = String(code || `JAVA_${this.status}`);
    this.details = details;
  }
}

function javaRoleToLegacy(role) {
  return role === 'ADMIN' || role === 'SUPER_ADMIN' ? 'admin' : 'traveler';
}

export function normalizeJavaPrincipal(data = {}) {
  const source = data?.user && typeof data.user === 'object' ? data.user : data;
  const role = String(source.role || 'USER').toUpperCase();
  return {
    id: String(source.userId || source.id || ''),
    name: String(source.nickname || source.name || source.username || '重庆旅行者'),
    email: String(source.email || source.username || '').trim().toLowerCase(),
    role: javaRoleToLegacy(role),
    javaRole: role,
    status: String(source.status || 'active').toLowerCase(),
    savedTrips: Number.isFinite(Number(source.savedTrips)) ? Number(source.savedTrips) : null,
    memories: Number.isFinite(Number(source.memories)) ? Number(source.memories) : null,
    profileConfigured: source.profileConfigured === true
  };
}

function authResult(data = {}) {
  const source = data?.user && typeof data.user === 'object' ? data.user : data;
  return { user: normalizeJavaPrincipal(source), token: String(data?.token || source?.token || '') };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function plannerConversationBody(request = {}) {
  const sourceContext = request.context && typeof request.context === 'object' ? request.context : {};
  const selectedStopIds = Array.isArray(sourceContext.selectedStopIds)
    ? sourceContext.selectedStopIds.map((id) => String(id)).filter(Boolean)
    : (Array.isArray(request.selectedStopIds) ? request.selectedStopIds.map((id) => String(id)).filter(Boolean) : []);
  const context = {
    activeDay: Number(sourceContext.activeDay ?? request.activeDay ?? 1),
    selectedStopId: sourceContext.selectedStopId ?? request.selectedStopId ?? null,
    activeProposalId: sourceContext.activeProposalId ?? request.activeProposalId ?? null,
    pinnedStopIds: Array.isArray(sourceContext.pinnedStopIds)
      ? sourceContext.pinnedStopIds.map((id) => String(id)).filter(Boolean)
      : (Array.isArray(request.pinnedStopIds) ? request.pinnedStopIds.map((id) => String(id)).filter(Boolean) : [])
  };
  if (selectedStopIds.length) context.selectedStopIds = selectedStopIds;
  return {
    planId: request.planId ? String(request.planId) : undefined,
    sessionId: request.sessionId ? String(request.sessionId) : undefined,
    baseRevision: Number(request.baseRevision || 1),
    message: String(request.message || ''),
    context,
    sessionAccessToken: String(request.sessionAccessToken || ''),
    idempotencyKey: String(request.idempotencyKey || '')
  };
}

function applyAdjustmentBody(request = {}) {
  return {
    proposalId: String(request.proposalId || ''),
    optionId: String(request.optionId || 'option-1'),
    baseRevision: Number(request.baseRevision || 1),
    forceApply: Boolean(request.forceApply),
    sessionAccessToken: String(request.sessionAccessToken || ''),
    idempotencyKey: String(request.idempotencyKey || '')
  };
}

function unwrapEnvelope(response, body) {
  const envelope = body && typeof body === 'object' ? body : {};
  const code = Number(envelope.code);
  const success = envelope.success !== false && (!Number.isFinite(code) || code < 400);
  if (!response.ok || !success) {
    const status = response.status >= 400 ? response.status : (Number.isFinite(code) && code >= 400 ? code : 502);
    const mapped = status === 401 ? 'AUTH_UNAUTHENTICATED'
      : status === 403 ? 'AUTH_FORBIDDEN'
        : status === 409 ? 'CONFLICT'
          : status >= 500 ? 'JAVA_BACKEND_UNAVAILABLE' : 'JAVA_REQUEST_REJECTED';
    throw new JavaCoreError(status, mapped, String(envelope.message || 'Java Core Backend 请求失败。'), envelope.data || null);
  }
  return envelope.data === undefined ? envelope : envelope.data;
}

function canRetryJavaRequest(path, method) {
  if (String(method).toUpperCase() === 'GET') return true;
  // 正式保存以“规划会话 + 版本”为幂等键；Java 已保证重复提交不会创建第二份行程。
  // 仅为这条已证明幂等的写路径重试，禁止把任意 POST/PUT/DELETE 变成盲目重放。
  return String(method).toUpperCase() === 'POST'
    && /^\/ai\/planner\/v1\/sessions\/[^/]+\/save$/.test(String(path));
}

function retryDelay(attempt) {
  return new Promise((resolve) => setTimeout(resolve, 150 * (attempt + 1)));
}

async function requestJavaTransport(path, { method = 'GET', body, token, headers = {}, accept = 'application/json', signal, multipart = false } = {}, decode) {
  const controller = new AbortController();
  const onCallerAbort = () => controller.abort(signal?.reason);
  if (signal?.aborted) controller.abort(signal.reason);
  else if (signal) signal.addEventListener('abort', onCallerAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), JAVA_TIMEOUT_MS);
  try {
    const requestHeaders = { accept, ...headers };
    if (body !== undefined && !multipart) requestHeaders['content-type'] = 'application/json';
    if (token) requestHeaders.authorization = `Bearer ${token}`;
    const maxAttempts = canRetryJavaRequest(path, method) ? 2 : 1;
    let response;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      try {
        response = await fetch(`${JAVA_CORE_URL}${path}`, {
          method,
          headers: requestHeaders,
          body: body === undefined ? undefined : (multipart ? body : JSON.stringify(body)),
          signal: controller.signal
        });
        if (response.status < 500 || attempt === maxAttempts - 1) break;
        await response.body?.cancel?.();
      } catch (error) {
        if (error?.name === 'AbortError' && signal?.aborted) {
          throw new JavaCoreError(499, 'REQUEST_ABORTED', '客户端请求已取消。');
        }
        if (attempt === maxAttempts - 1) {
          throw new JavaCoreError(503, 'JAVA_BACKEND_UNAVAILABLE', error?.name === 'AbortError' ? 'Java Core Backend 请求超时。' : 'Java Core Backend 不可用。');
        }
      }
      await retryDelay(attempt);
    }
    try {
      return await decode(response);
    } catch (error) {
      if (error?.name === 'AbortError' && signal?.aborted) {
        throw new JavaCoreError(499, 'REQUEST_ABORTED', '客户端请求已取消。');
      }
      throw error;
    }
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onCallerAbort);
  }
}

async function requestJava(path, options = {}) {
  return requestJavaTransport(path, options, async (response) => {
    let payload = {};
    try { payload = await response.json(); } catch { payload = {}; }
    return unwrapEnvelope(response, payload);
  });
}

async function requestJavaBytes(path, options = {}) {
  return requestJavaTransport(path, { ...options, accept: 'application/pdf, application/json' }, async (response) => {
    if (!response.ok) {
      let payload = {};
      try { payload = await response.json(); } catch { payload = {}; }
      return unwrapEnvelope(response, payload);
    }
    return {
      contentType: response.headers.get('content-type') || 'application/octet-stream',
      body: Buffer.from(await response.arrayBuffer())
    };
  });
}

async function requestJavaStream(path, options = {}) {
  const { token, signal } = options;
  const controller = new AbortController();
  const onCallerAbort = () => controller.abort(signal?.reason);
  if (signal?.aborted) controller.abort(signal.reason);
  else if (signal) signal.addEventListener('abort', onCallerAbort, { once: true });

  // This deadline covers response headers only. The BFF owns the body
  // lifetime and calls cleanup() after the SSE pipe has finished.
  const timer = setTimeout(() => controller.abort(), JAVA_TIMEOUT_MS);
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onCallerAbort);
  };
  const abort = () => controller.abort();

  try {
    let response;
    try {
      response = await fetch(`${JAVA_CORE_URL}${path}`, {
        method: 'GET',
        headers: {
          accept: 'text/event-stream',
          ...(token ? { authorization: `Bearer ${token}` } : {})
        },
        signal: controller.signal
      });
    } catch (error) {
      cleanup();
      if (error?.name === 'AbortError' && signal?.aborted) {
        throw new JavaCoreError(499, 'REQUEST_ABORTED', '客户端请求已取消。');
      }
      throw new JavaCoreError(503, 'JAVA_BACKEND_UNAVAILABLE', error?.name === 'AbortError'
        ? 'Java Core Backend 请求超时。' : 'Java Core Backend 不可用。');
    }

    clearTimeout(timer);
    if (!response.ok) {
      let payload = {};
      try { payload = await response.json(); } catch {}
      cleanup();
      return unwrapEnvelope(response, payload);
    }
    if (!response.body) {
      cleanup();
      throw new JavaCoreError(502, 'JAVA_CHAT_STREAM_INVALID', 'Java Core Backend 未返回对话流。');
    }
    return { body: response.body, headers: response.headers, status: response.status, cleanup, abort };
  } catch (error) {
    cleanup();
    throw error;
  }
}

function createTestStub() {
  const users = new Map();
  const tokens = new Map();
  const preferences = new Map();
  const travelMemories = new Map();
  const memoryObservations = new Map();
  const memoryCandidates = new Map();
  const formalTrips = new Map();
  let sequence = 1;
  const fixtureEmail = String(process.env.YUYOUZHICE_TEST_ADMIN_EMAIL || 'phase5b-admin@example.invalid').trim().toLowerCase();
  const fixturePassword = String(process.env.YUYOUZHICE_TEST_ADMIN_PASSWORD || 'phase5b-test-admin-credential-only');
  const fixture = {
    userId: 'test-admin-fixture',
    username: fixtureEmail,
    nickname: 'Phase 5B synthetic admin',
    role: 'ADMIN',
    status: 'active',
    password: fixturePassword
  };
  users.set(fixture.username, fixture);

  function publicUser(user) {
    return { userId: user.userId, username: user.username, email: user.username, nickname: user.nickname, role: user.role, status: user.status };
  }
  function issue(user) {
    const token = `java-test-${randomBytes(18).toString('base64url')}`;
    tokens.set(token, user.userId);
    return token;
  }
  function userByToken(token) {
    const userId = tokens.get(token);
    const user = [...users.values()].find((item) => item.userId === userId);
    if (!user || user.status !== 'active') throw new JavaCoreError(401, 'AUTH_UNAUTHENTICATED', '登录状态已失效。');
    return user;
  }
  function ensurePreference(userId) {
    if (!preferences.has(userId)) preferences.set(userId, {
      userId,
      schemaVersion: 1,
      revision: 0,
      interests: [],
      walkingTolerance: 'UNSPECIFIED',
      budget: { level: 'UNSPECIFIED', maxAmount: null, currency: 'CNY' },
      companions: 'UNSPECIFIED',
      transportPreference: 'UNSPECIFIED',
      dietPreference: 'UNSPECIFIED',
      stayArea: '',
      legacyMetadata: {},
      createdAt: 0,
      updatedAt: 0
    });
    return preferences.get(userId);
  }
  function memoriesFor(userId) {
    if (!travelMemories.has(userId)) travelMemories.set(userId, []);
    return travelMemories.get(userId);
  }
  function observationsFor(userId) { if (!memoryObservations.has(userId)) memoryObservations.set(userId, []); return memoryObservations.get(userId); }
  function candidatesFor(userId) { if (!memoryCandidates.has(userId)) memoryCandidates.set(userId, []); return memoryCandidates.get(userId); }
  function suggestMemoryCandidate(message = '') {
    const text = String(message || '').trim();
    if (!text || /(今天|明天|后天|今晚|这次|本次|当前|这一趟|这趟|当天)/.test(text)) return null;
    if (!/(记住|以后|默认|通常|习惯|总是|一直|经常|一般|更喜欢|偏爱|不喜欢|不吃|不喝|过敏|怕晒|怕热|受不了|优先|首选|我|我们|家里)/.test(text)) return null;
    if (/(轮椅|无障碍|婴儿车|腿脚不便|行动不便)/.test(text)) return { category: 'ACCESSIBILITY', content: '出行需要无障碍、少台阶与便于休息的安排', confidence: 0.95 };
    if (/(少走路|不想走太多|少爬坡|轻松一点|不爱走路|体力.*有限)/.test(text)) return { category: 'PACE', content: '偏好少走路，优先平路、电梯与短步行', confidence: 0.93 };
    if (/(过敏|忌口|清真|素食|纯素)/.test(text)) return { category: 'DIET', content: '饮食有明确限制，需要优先确认可选餐食', confidence: 0.96 };
    if (/(不吃辣|少辣|清淡|不吃香菜|不吃.*海鲜)/.test(text)) return { category: 'DIET', content: '饮食偏好清淡，尽量少辣并避开明确忌口', confidence: 0.92 };
    if (/(打车|出租车|网约车)/.test(text)) return { category: 'TRANSPORT', content: '出行时优先打车或网约车', confidence: 0.91 };
    if (/(地铁|公交|公共交通)/.test(text)) return { category: 'TRANSPORT', content: '出行时更愿意使用公共交通', confidence: 0.86 };
    if (/(预算|省钱|性价比|免费)/.test(text)) return { category: 'BUDGET', content: '出行时重视预算与性价比', confidence: 0.85 };
    if (/(怕晒|怕热|雨天|下雨.*室内|避暑)/.test(text)) return { category: 'WEATHER', content: '行程更在意天气体感，优先阴凉、室内或可避雨安排', confidence: 0.87 };
    if (/(不喜欢早起|睡到自然醒|晚起)/.test(text)) return { category: 'TIME', content: '出行节奏不宜太早，偏好从容安排', confidence: 0.84 };
    if (/(酒店.*安静|住宿.*安静|住得.*方便)/.test(text)) return { category: 'STAY', content: '住宿更看重安静与交通便利', confidence: 0.82 };
    if (/(情侣|对象|爱人|两个人)/.test(text)) return { category: 'COMPANION', content: '通常以情侣出游方式安排行程', confidence: 0.84 };
    if (/(带娃|孩子|亲子)/.test(text)) return { category: 'COMPANION', content: '出行时常需要兼顾亲子体验', confidence: 0.84 };
    if (/(父母|长辈|老人)/.test(text)) return { category: 'COMPANION', content: '出行时常需要兼顾长辈的舒适度', confidence: 0.84 };
    if (/(博物馆|美术馆|展览|人文|历史|古迹)/.test(text)) return { category: 'INTEREST', content: '偏爱人文历史与室内文化场馆', confidence: 0.87 };
    if (/(夜景|江景)/.test(text)) return { category: 'INTEREST', content: '喜欢山城夜景与江景体验', confidence: 0.84 };
    if (/(拍照|摄影|出片)/.test(text)) return { category: 'INTEREST', content: '旅行时重视拍照与景观视角', confidence: 0.83 };
    if (/(自然|徒步|爬山|山水)/.test(text)) return { category: 'INTEREST', content: '偏爱自然山水与户外景观', confidence: 0.81 };
    return null;
  }
  function applyPatch(current, patch, replace = false) {
    const next = replace ? { ...ensurePreference(current.userId) } : { ...current };
    const fields = ['interests', 'walkingTolerance', 'budget', 'companions', 'transportPreference', 'dietPreference', 'stayArea', 'legacyMetadata'];
    for (const field of fields) {
      if (Object.prototype.hasOwnProperty.call(patch || {}, field)) next[field] = patch[field];
      else if (replace) {
        if (field === 'interests') next[field] = [];
        else if (field === 'budget') next[field] = { level: 'UNSPECIFIED', maxAmount: null, currency: 'CNY' };
        else if (field === 'legacyMetadata') next[field] = {};
        else if (field === 'stayArea') next[field] = '';
        else next[field] = 'UNSPECIFIED';
      }
    }
    next.revision = Number(current.revision || 0) + 1;
    next.updatedAt = Date.now();
    if (!current.createdAt) next.createdAt = next.updatedAt;
    preferences.set(current.userId, next);
    return next;
  }
  function shadowPlan({ prompt = '', constraints = {}, usePreferences = false } = {}, token) {
    const promptText = String(prompt || '');
    const user = usePreferences && token ? userByToken(token) : null;
    const preference = user ? ensurePreference(user.userId) : null;
    const preferenceFields = {};
    const appliedFields = {};
    if (preference && preference.walkingTolerance !== 'UNSPECIFIED') {
      preferenceFields.walkingTolerance = preference.walkingTolerance;
      appliedFields.walkingTolerance = preference.walkingTolerance;
    }
    if (preference && preference.transportPreference !== 'UNSPECIFIED') {
      preferenceFields.transportPreference = preference.transportPreference;
      appliedFields.transportPreference = preference.transportPreference;
    }
    if (preference && preference.dietPreference !== 'UNSPECIFIED') {
      preferenceFields.dietPreference = preference.dietPreference;
      appliedFields.dietPreference = preference.dietPreference;
    }
    if (preference && preference.stayArea) {
      preferenceFields.stayArea = preference.stayArea;
      appliedFields.stayArea = preference.stayArea;
    }
    if (preference?.interests?.length) {
      preferenceFields.interests = [...preference.interests];
      appliedFields.interests = [...preference.interests];
    }
    const transportPreference = String(constraints.transportPreference || preferenceFields.transportPreference || '');
    const routePreference = /公交|地铁|公共交通|PUBLIC_TRANSIT/.test(transportPreference)
      ? 'transit'
      : (/打车|驾车|TAXI|DRIVING/.test(transportPreference) ? 'driving' : 'walking');
    const effective = {
      companions: constraints.companions || (/父母|长辈/.test(promptText) ? '带父母' : ''),
      walkingTolerance: constraints.walkingTolerance || (/少走路/.test(promptText) ? '少走路' : '正常'),
      ...preferenceFields,
      ...constraints,
      rawPrompt: promptText
    };
    const recommendationReason = transportPreference
      ? `Java Shadow 测试推荐 · 交通偏好：${transportPreference}`
      : 'Java Shadow 测试推荐';
    const stops = [
      { id: 'day1-jiefangbei', stableStopId: 'day1-jiefangbei', entityId: 'cq-jiefangbei', venueId: 'cq-jiefangbei', name: '解放碑步行街', time: '14:30', duration: '约 90 分钟', matchedConstraints: [], recommendationReason, routePreference, walkingInfo: { status: '未知' }, facts: [], citations: [], mapContext: { polyline: [], routeFromPrevious: null } },
      { id: 'day1-hongyadong', stableStopId: 'day1-hongyadong', entityId: 'cq-hongyadong', venueId: 'cq-hongyadong', name: '洪崖洞', time: '19:30', duration: '约 90 分钟', matchedConstraints: [], recommendationReason, routePreference, walkingInfo: { status: '未知' }, facts: [], citations: [], mapContext: { polyline: [], routeFromPrevious: null } }
    ];
    return {
      ok: true,
      persisted: false,
      shadow: true,
      phase: '已生成结构化行程',
      constraints: effective,
      appliedPreferences: {
        appliedFields,
        preferenceRevision: preference?.revision || 0,
        preferenceSchemaVersion: preference?.schemaVersion || 1,
        fingerprint: usePreferences ? 'java-test-shadow-preferences' : 'java-test-shadow'
      },
      trip: {
        id: 'draft-cq-shadow',
        version: 1,
        title: 'Java Shadow 测试行程',
        constraints: effective,
        planContext: {
          startingArea: String(effective.stayArea || ''),
          routePreference,
          foodGuidance: String(effective.dietPreference || '')
        },
        days: [{ day: 1, date: '旅行第1天', dateLabel: '第1天 · Java Shadow', stops }],
        sourceStatus: {
          provider: 'Java Core Backend test stub',
          fallback: true,
          citationCoverage: 0,
          poiResolved: 0,
          poiTotal: stops.length,
          weatherAvailable: false,
          routeResolved: 0,
          routePairs: Math.max(0, stops.length - 1),
          dataCoverage: 0
        },
        retrieval: { mode: 'java-test-shadow', facts: [], citations: [] },
        qualityMetrics: {
          constraintSatisfaction: { score: 1, satisfied: 0, total: 0, checks: [] },
          citationCoverage: 0,
          dataCoverage: { overall: 0, poi: 0, routes: 0, weather: 0 },
          unknownFactCount: 0,
          dynamicFactCount: 0,
          totalFactCount: 0
        },
        versionHistory: [{ version: 1, label: '初始规划', changedSegments: [] }]
      }
    };
  }
  const plannerSessions = new Map();
  const plannerProposals = new Map();
  const testProposalTtlMs = Math.max(1, Number(process.env.YUYOUZHICE_TEST_PROPOSAL_TTL_MS || 900000));

  function formalTrip(user, request = {}) {
    const sourcePlan = request.plan && typeof request.plan === 'object' ? request.plan : request;
    const now = Date.now();
    const id = `trip-test-${sequence++}`;
    const plan = clone(sourcePlan || {});
    plan.formalTripId = id;
    const trip = { id, ownerId: user.userId, title: String(request.title || plan.title || '未命名行程'), status: 'ACTIVE', currentVersion: 1, createdAt: now, updatedAt: now, plan };
    formalTrips.set(id, trip);
    return trip;
  }
  function ownedTrip(token, tripId) {
    const user = userByToken(token);
    const trip = formalTrips.get(String(tripId || ''));
    if (!trip || trip.ownerId !== user.userId) throw new JavaCoreError(404, 'JAVA_REQUEST_REJECTED', '行程不存在。');
    return { user, trip };
  }
  return {
    async register({ username, password }) {
      const normalized = String(username || '').trim().toLowerCase();
      if (!normalized || !password) throw new JavaCoreError(400, 'AUTH_INVALID_REQUEST', '用户名和密码不能为空');
      if (users.has(normalized)) throw new JavaCoreError(409, 'USER_CONFLICT', '该邮箱已注册，请直接登录。');
      const user = { userId: `java-test-user-${sequence++}`, username: normalized, nickname: '重庆旅行者', role: 'USER', status: 'active', password: String(password) };
      users.set(normalized, user);
      return { user: publicUser(user), token: issue(user) };
    },
    async login({ username, password }) {
      const normalized = String(username || '').trim().toLowerCase();
      const user = users.get(normalized);
      if (!user || user.password !== String(password || '') || user.status !== 'active') throw new JavaCoreError(401, 'AUTH_INVALID_CREDENTIALS', '登录信息不匹配。');
      return { user: publicUser(user), token: issue(user) };
    },
    async logout(token) {
      if (token) tokens.delete(token);
      return null;
    },
    async me(token) { return publicUser(userByToken(token)); },
    async getPreferences(token) { return ensurePreference(userByToken(token).userId); },
    async mergePreferences(token, patch, expectedRevision) {
      const user = userByToken(token);
      const current = ensurePreference(user.userId);
      if (expectedRevision !== undefined && expectedRevision !== null && Number(expectedRevision) !== current.revision) throw new JavaCoreError(409, 'PREFERENCE_CONFLICT', '偏好版本冲突。', { expectedRevision, currentRevision: current.revision });
      return applyPatch(current, patch, false);
    },
    async replacePreferences(token, patch, expectedRevision) {
      const user = userByToken(token);
      const current = ensurePreference(user.userId);
      if (expectedRevision !== undefined && expectedRevision !== null && Number(expectedRevision) !== current.revision) throw new JavaCoreError(409, 'PREFERENCE_CONFLICT', '偏好版本冲突。', { expectedRevision, currentRevision: current.revision });
      return applyPatch(current, patch, true);
    },
    async clearPreferences(token, expectedRevision) {
      const user = userByToken(token);
      const current = ensurePreference(user.userId);
      if (expectedRevision !== undefined && expectedRevision !== null && Number(expectedRevision) !== current.revision) throw new JavaCoreError(409, 'PREFERENCE_CONFLICT', '偏好版本冲突。', { expectedRevision, currentRevision: current.revision });
      return applyPatch(current, {}, true);
    },
    async chatStream({ message = '', sessionId = 'default', mode = 'normal', plannerSessionId = '', tripId = '', currentVersion = '', planContext = '' } = {}) {
      const text = String(message || '');
      const intent = /(替换|换掉|移除|删除|加入|添加|调整|改成)/.test(text) ? 'MODIFY_PLAN'
        : (/(记住|偏好|喜欢|不喜欢|默认)/.test(text) ? 'UPDATE_PREFERENCE' : 'TRAVEL_QA');
      const payload = {
        provider: 'Java test stub',
        generation: { status: 'fixture', provider: 'Java test stub', model: 'synthetic-only' },
        assistant: { intent, requiresConfirmation: ['MODIFY_PLAN', 'UPDATE_PREFERENCE'].includes(intent), plannerSessionId, tripId, currentVersion },
        retrieval: { status: 'fixture', mode: mode === 'deep' ? 'Java 深度 RAG（fixture）' : 'Java 本地知识回退（fixture）', verified: false, reason: '合成测试流，不代表实时模型或 Qdrant。', citations: [] }
      };
      const chunks = [
        `event: meta\ndata: ${JSON.stringify(payload)}\n\n`,
        `event: text\ndata: ${JSON.stringify(`（fixture）已收到：${String(message).slice(0, 120)}`)}\n\n`,
        'event: done\ndata: {}\n\n'
      ];
      return new Response(chunks.join(''), { headers: { 'content-type': 'text/event-stream; charset=UTF-8' } });
    },
    async ragRetrieve({ query, city = '重庆', constraints = {}, deep = false } = {}) {
      return {
        ok: true,
        mode: deep ? 'Java 深度 RAG' : 'Java Qdrant 语义检索',
        source: 'Java test stub',
        verified: true,
        reason: '',
        provider: 'Java Core Backend',
        vectorSearch: {
          provider: 'Java test stub',
          collection: 'test-production-v2',
          resultCount: 1,
          rerankProvider: 'Java test stub'
        },
        vectorStore: {
          provider: 'Java-managed Qdrant',
          configured: true,
          directFromNode: false,
          verified: true,
          indexedDocuments: 1
        },
        facts: [{
          label: 'Java RAG 测试事实',
          value: `query=${String(query || '')}; city=${String(city || '')}; constraints=${JSON.stringify(constraints || {})}`,
          status: '已核验',
          note: '由 Java RAG 测试边界返回。',
          citations: [{
            title: 'Java RAG test stub',
            publisher: 'Java Core Backend',
            endpoint: '/ai/rag/retrieve',
            url: '/ai/rag/retrieve',
            status: '已核验'
          }]
        }],
        citations: [{
          title: 'Java RAG test stub',
          publisher: 'Java Core Backend',
          endpoint: '/ai/rag/retrieve',
          url: '/ai/rag/retrieve',
          status: '已核验'
        }]
      };
    },
    async ragStats() {
      return {
        totalChunks: 1,
        sourceCount: 1,
        cacheStats: {},
        retrieval: {
          configured: true,
          provider: 'Java Core Backend',
          owner: 'Java',
          embedding: { provider: 'Java EmbeddingModel', directFromNode: false },
          vectorStore: { provider: 'Java-managed Qdrant', configured: true, directFromNode: false, verified: true, indexedDocuments: 1 },
          fallback: { provider: 'Java kb_document', directFromNode: false },
          contract: { verified: true }
        }
      };
    },
    async analyticsDashboard() {
      return {
        serviceCount: { total: 18, today: 6, week: 18, trend: '+20.0%' },
        activeUsers: { current: 4, peakToday: 4 },
        hotQuestionsTop10: [
          { rank: 1, question: '重庆下雨天适合去哪里？', count: 3 },
          { rank: 2, question: '少走路的两天路线怎么安排？', count: 2 }
        ],
        emotionDistribution: { positive: 0.8, neutral: 0.2, negative: 0 }
      };
    },
    async analyticsHotQuestions() {
      return [
        { rank: 1, question: '重庆下雨天适合去哪里？', count: 3 },
        { rank: 2, question: '少走路的两天路线怎么安排？', count: 2 }
      ];
    },
    async clearRerankCache(token) {
      userByToken(token);
      return { message: 'Rerank 三级缓存已清空（测试桩）' };
    },
    shadowPlan,
    async shadowReplan({ trip, targetStopId, candidateVenueId = '', reason = '' } = {}) {
      const next = clone(trip || shadowPlan().trip);
      const stops = (next.days || []).flatMap((day) => day.stops || []);
      const target = stops.find((stop) => stop.id === targetStopId || stop.stableStopId === targetStopId);
      if (!target) throw new JavaCoreError(400, 'JAVA_REQUEST_REJECTED', '未在当前行程中找到要替换的站点。');
      const replacementId = candidateVenueId || 'cq-grand-theatre';
      if (replacementId !== 'cq-grand-theatre' && stops.some((stop) => stop !== target && stop.venueId === replacementId)) {
        throw new JavaCoreError(400, 'JAVA_REQUEST_REJECTED', '候选景点已存在于当前行程，不能造成重复。');
      }
      target.venueId = replacementId;
      target.entityId = replacementId;
      target.name = replacementId === 'cq-grand-theatre' ? '重庆大剧院江岸夜景' : replacementId;
      target.recommendationReason = `Java Shadow 重规划：${reason}`;
      next.version = Number(next.version || 1) + 1;
      return { ok: true, persisted: false, shadow: true, trip: next, changedSegments: [target.id], unchangedStops: stops.filter((stop) => stop !== target).map((stop) => stop.id), replacementReason: reason, replacementVenueId: replacementId };
    },
    async shadowMutateStops({ trip, operation = 'add', attractionId = '', day = 1, targetStopId = '', stopId = '' } = {}) {
      const next = clone(trip || shadowPlan().trip);
      const days = Array.isArray(next.days) ? next.days : [];
      const targetDay = days.find((item) => Number(item.day) === Number(day)) || days[0];
      const stops = days.flatMap((item) => item.stops || []);
      let changedId = targetStopId || stopId;
      if (operation === 'delete' || operation === 'remove') {
        const sourceDay = days.find((item) => (item.stops || []).some((stop) => stop.id === changedId || stop.stableStopId === changedId));
        const index = sourceDay?.stops?.findIndex((stop) => stop.id === changedId || stop.stableStopId === changedId) ?? -1;
        if (!sourceDay || index < 0) throw new JavaCoreError(400, 'JAVA_REQUEST_REJECTED', '未在当前行程中找到要移除的站点。');
        sourceDay.stops.splice(index, 1);
      } else if (operation === 'replace') {
        const target = stops.find((stop) => stop.id === targetStopId || stop.stableStopId === targetStopId);
        if (!target) throw new JavaCoreError(400, 'JAVA_REQUEST_REJECTED', '未找到要替换的站点。');
        target.venueId = attractionId;
        target.entityId = attractionId;
        target.name = attractionId;
        changedId = target.id;
      } else {
        if (!targetDay || !attractionId || stops.some((stop) => stop.venueId === attractionId)) throw new JavaCoreError(400, 'JAVA_REQUEST_REJECTED', '景点已在当前行程中或目标日期不存在。');
        changedId = `day${targetDay.day}-added-${attractionId}-shadow`;
        targetDay.stops.push({ id: changedId, stableStopId: changedId, venueId: attractionId, entityId: attractionId, name: attractionId, facts: [], citations: [], mapContext: { polyline: [], routeFromPrevious: null } });
      }
      next.version = Number(next.version || 1) + 1;
      return { ok: true, persisted: false, shadow: true, operation, trip: next, changedSegments: [changedId] };
    },
    async listAttractions({ category = '' } = {}) {
      return ATTRACTIONS_DATA
        .filter((attraction) => !category || attraction.category === category)
        .map(clone);
    },
    async getAttraction(attractionId) {
      const attraction = ATTRACTIONS_DATA.find((item) => item.id === String(attractionId || ''));
      if (!attraction) throw new JavaCoreError(404, 'JAVA_REQUEST_REJECTED', '景点不存在。');
      return clone(attraction);
    },
    async listTrips(token) {
      const user = userByToken(token);
      return [...formalTrips.values()].filter((trip) => trip.ownerId === user.userId).map(clone);
    },
    async getTrip(token, tripId) { return clone(ownedTrip(token, tripId).trip); },
    async createTrip(token, request = {}) { return clone(formalTrip(userByToken(token), request)); },
    async updateTrip(token, tripId, request = {}) {
      const { trip } = ownedTrip(token, tripId);
      if (Number(request.expectedVersion) !== trip.currentVersion) throw new JavaCoreError(409, 'CONFLICT', '行程版本已变化，请刷新后重试。', { tripId, expectedVersion: request.expectedVersion, currentVersion: trip.currentVersion });
      const plan = clone(request.plan && typeof request.plan === 'object' ? request.plan : request);
      plan.formalTripId = trip.id;
      trip.plan = plan;
      trip.title = String(request.title || plan.title || trip.title);
      trip.currentVersion += 1;
      trip.updatedAt = Date.now();
      return clone(trip);
    },
    async deleteTrip(token, tripId, expectedVersion) {
      const { trip } = ownedTrip(token, tripId);
      if (Number(expectedVersion) !== trip.currentVersion) throw new JavaCoreError(409, 'CONFLICT', '行程版本已变化，请刷新后重试。', { tripId, expectedVersion, currentVersion: trip.currentVersion });
      formalTrips.delete(trip.id);
      return { tripId: trip.id, currentVersion: trip.currentVersion };
    },
    async exportTrip(token, tripId) {
      ownedTrip(token, tripId);
      return { contentType: 'application/pdf', body: Buffer.from('%PDF-1.4\n/STSong-Light\n6e1d6e38\n% Java test Trip export\n%%EOF\n') };
    },
    async tripVersions(token, tripId) {
      const { trip } = ownedTrip(token, tripId);
      return [{ id: `trip-version-test-${trip.currentVersion}`, tripId: trip.id, versionNumber: trip.currentVersion, snapshot: clone(trip.plan), createdAt: trip.updatedAt, changeReason: '测试版本' }];
    },
    async listKnowledgeDocuments(token, { query = '', topic = '', entityId = '' } = {}) {
      userByToken(token);
      return { total: 0, page: 1, size: 100, items: [], query, topic, entityId };
    },
    async updateKnowledgeDocument(token, docId, body = {}) {
      const user = userByToken(token);
      if (!['ADMIN', 'SUPER_ADMIN'].includes(user.role)) throw new JavaCoreError(403, 'AUTH_FORBIDDEN', '需要管理员权限。');
      return { id: String(docId), ...body };
    },
    async listUsers(token) {
      const user = userByToken(token);
      if (!['ADMIN', 'SUPER_ADMIN'].includes(user.role)) throw new JavaCoreError(403, 'AUTH_FORBIDDEN', '需要管理员权限。');
      return { users: [...users.values()].map(publicUser), total: users.size, page: 1, size: users.size };
    },
    async updateUserRole(token, userId, body) {
      const actor = userByToken(token);
      if (!['ADMIN', 'SUPER_ADMIN'].includes(actor.role)) throw new JavaCoreError(403, 'AUTH_FORBIDDEN', '需要管理员权限。');
      const target = [...users.values()].find((item) => item.userId === String(userId));
      if (!target) throw new JavaCoreError(404, 'USER_NOT_FOUND', '用户不存在');
      target.role = String(body?.role || target.role).toUpperCase();
      if (body?.status) target.status = String(body.status).toLowerCase();
      return null;
    },
    async disableUser(token, userId) { return this.updateUserRole(token, userId, { status: 'disabled' }); },
    async getUserDetail(token, userId) {
      const user = userByToken(token);
      if (!['ADMIN', 'SUPER_ADMIN'].includes(user.role)) throw new JavaCoreError(403, 'AUTH_FORBIDDEN', '需要管理员权限。');
      const target = [...users.values()].find((item) => item.userId === String(userId));
      if (!target) throw new JavaCoreError(404, 'USER_NOT_FOUND', '用户不存在');
      return publicUser(target);
    },
    async getDigitalHuman(token) {
      const user = userByToken(token);
      if (!['ADMIN', 'SUPER_ADMIN'].includes(user.role)) throw new JavaCoreError(403, 'AUTH_FORBIDDEN', '需要管理员权限。');
      return { name: '渝游智策助手', voiceId: '106', language: 'zh', greeting: '你好，欢迎来到重庆，我是渝游智策的重庆智慧文旅 AI 决策助手', enabled: true };
    },
    async updateDigitalHuman(token, body = {}) {
      const user = userByToken(token);
      if (!['ADMIN', 'SUPER_ADMIN'].includes(user.role)) throw new JavaCoreError(403, 'AUTH_FORBIDDEN', '需要管理员权限。');
      return { ok: true, ...body };
    },
    async listDigitalHumanVoices(token) {
      const user = userByToken(token);
      if (!['ADMIN', 'SUPER_ADMIN'].includes(user.role)) throw new JavaCoreError(403, 'AUTH_FORBIDDEN', '需要管理员权限。');
      return [
        { id: '106', name: '度博文', gender: '男', style: '专业讲解风，最适合景区导游', isDefault: true, languages: ['zh', 'en'] },
        { id: '0', name: '度小美', gender: '女', style: '自然流畅，通用', isDefault: false, languages: ['zh', 'en'] },
        { id: '1', name: '度小宇', gender: '男', style: '沉稳大气，适合讲解', isDefault: false, languages: ['zh', 'en'] }
      ];
    },
    async getSettings(token) {
      const user = userByToken(token);
      if (!['ADMIN', 'SUPER_ADMIN'].includes(user.role)) throw new JavaCoreError(403, 'AUTH_FORBIDDEN', '需要管理员权限。');
      return { siteName: '渝游智策 · 重庆智慧文旅', defaultLanguage: 'zh', ttsEnabled: true, asrEnabled: true, knowledgeSyncEnabled: true, maxUploadSizeMb: 50 };
    },
    async updateSettings(token, body = {}) {
      const user = userByToken(token);
      if (!['ADMIN', 'SUPER_ADMIN'].includes(user.role)) throw new JavaCoreError(403, 'AUTH_FORBIDDEN', '需要管理员权限。');
      return { ok: true, ...body };
    },
    async createPlannerPlan(request = {}, token) {
      const planRes = shadowPlan(request, token);
      const sessionId = `session-stub-${sequence++}`;
      const sessionAccessToken = `plan-token-${sequence++}`;
      const trip = clone(planRes.trip);
      trip.plannerVersion = '1.0.0-v1';
      trip.policyVersion = '2026.08-v1';
      trip.routeDataStatus = 'ESTIMATED';
      trip.explanationSource = 'TEMPLATE';
      trip.degraded = false;
      trip.degradationReasons = [];
      plannerSessions.set(sessionId, { sessionId, trip, currentVersion: 1, sessionAccessToken });
      return {
        ok: true,
        sessionId,
        sessionAccessToken,
        syncRevision: 1,
        trip,
        plannerVersion: '1.0.0-v1',
        policyVersion: '2026.08-v1',
        routeDataStatus: 'ESTIMATED',
        explanationSource: 'TEMPLATE',
        degraded: false,
        degradationReasons: [],
        appliedPreferences: planRes.appliedPreferences || {}
      };
    },
    async getPlannerSession(sessionId, { sessionAccessToken } = {}, token) {
      const session = plannerSessions.get(String(sessionId || ''));
      if (!session) throw new JavaCoreError(404, 'JAVA_REQUEST_REJECTED', '规划会话不存在或无权访问。');
      return {
        ok: true,
        sessionId: session.sessionId,
        currentVersion: session.currentVersion,
        syncRevision: session.currentVersion,
        trip: clone(session.trip),
        plannerVersion: '1.0.0-v1',
        routeDataStatus: 'ESTIMATED',
        degraded: false
      };
    },
    async listTravelMemories(token) { return clone(memoriesFor(userByToken(token).userId)); },
    async suggestTravelMemory({ message = '' } = {}, token) {
      userByToken(token);
      return suggestMemoryCandidate(message);
    },
    async captureTravelMemoryObservation({ message = '', sessionId = '' } = {}, token) {
      const user = userByToken(token); const text = String(message || '').trim();
      const candidate = await this.suggestTravelMemory({ message: text }, token);
      if (candidate) {
        const now = Date.now();
        observationsFor(user.userId).push({ id: `obs-stub-${sequence++}`, content: text, sessionId: String(sessionId || ''), status: 'REVIEWED', createdAt: now });
        const prefs = ensurePreference(user.userId);
        if (prefs.legacyMetadata?.travelMemoryEnabled === true && !candidatesFor(user.userId).some((item) => item.status === 'PENDING' && item.content === candidate.content)) {
          candidatesFor(user.userId).unshift({ id: `candidate-stub-${sequence++}`, ...candidate, sourceRef: 'fixture-observation', status: 'PENDING', createdAt: now, updatedAt: now });
          applyPatch(prefs, { legacyMetadata: { ...(prefs.legacyMetadata || {}), travelMemoryLastReviewAt: now } }, false);
        }
      }
      return {};
    },
    async listTravelMemoryCandidates(token) { return clone(candidatesFor(userByToken(token).userId)); },
    async confirmTravelMemoryCandidate(id, token) {
      const user = userByToken(token); const item = candidatesFor(user.userId).find((candidate) => candidate.id === id && candidate.status === 'PENDING');
      if (!item) throw new JavaCoreError(404, 'JAVA_REQUEST_REJECTED', '记忆候选不存在。');
      item.status = 'CONFIRMED'; item.updatedAt = Date.now();
      return this.createTravelMemory({ content: item.content, category: item.category, sourceType: 'CHAT_CONFIRMED' }, token);
    },
    async dismissTravelMemoryCandidate(id, token) { const user = userByToken(token); const item = candidatesFor(user.userId).find((candidate) => candidate.id === id); if (item) { item.status = 'DISMISSED'; item.updatedAt = Date.now(); } return {}; },
    async createTravelMemory(input = {}, token) {
      const user = userByToken(token); const now = Date.now();
      const item = { id: `mem-stub-${sequence++}`, category: String(input.category || 'CUSTOM'), content: String(input.content || ''), sourceType: String(input.sourceType || 'CHAT_CONFIRMED'), sourceRef: '', status: 'CONFIRMED', confidence: 0.9, createdAt: now, updatedAt: now };
      memoriesFor(user.userId).unshift(item); return clone(item);
    },
    async updateTravelMemory(id, input = {}, token) {
      const user = userByToken(token); const item = memoriesFor(user.userId).find((memory) => memory.id === id);
      if (!item) throw new JavaCoreError(404, 'JAVA_REQUEST_REJECTED', '旅行记忆不存在或无权修改');
      item.content = String(input.content || item.content); item.category = String(input.category || item.category); item.sourceType = 'USER_EDIT'; item.confidence = 1; item.updatedAt = Date.now(); return clone(item);
    },
    async deleteTravelMemory(id, token) { const user = userByToken(token); travelMemories.set(user.userId, memoriesFor(user.userId).filter((memory) => memory.id !== id)); return {}; },
    async refreshPlannerDynamicData(sessionId, { sessionAccessToken } = {}, token) {
      const session = plannerSessions.get(String(sessionId || ''));
      if (!session) throw new JavaCoreError(404, 'JAVA_REQUEST_REJECTED', '规划会话不存在或无权访问。');
      return {
        ok: true,
        sessionId: session.sessionId,
        currentVersion: session.currentVersion,
        syncRevision: session.currentVersion,
        trip: clone(session.trip),
        dynamicRefresh: { mode: '测试桩', poiResolved: 0, routeResolved: 0, weatherDaysResolved: 0, fallback: true },
        plannerVersion: '1.0.0-v1',
        routeDataStatus: 'ESTIMATED',
        degraded: false
      };
    },
    async replanPlannerSession(sessionId, request = {}, token) {
      const session = plannerSessions.get(String(sessionId || ''));
      if (!session) throw new JavaCoreError(404, 'JAVA_REQUEST_REJECTED', '规划会话不存在或无权访问。');
      if (request.expectedVersion !== undefined && Number(request.expectedVersion) !== session.currentVersion) {
        throw new JavaCoreError(409, 'CONFLICT', '规划版本已变化，请基于最新行程重新操作。', { expectedVersion: request.expectedVersion, currentVersion: session.currentVersion });
      }
      const candidate = await this.shadowReplan({
        trip: session.trip,
        targetStopId: request.targetStopId,
        candidateVenueId: request.candidateVenueId || '',
        reason: request.reason || ''
      }, token);
      const nextVersion = session.currentVersion + 1;
      candidate.trip.version = nextVersion;
      session.trip = clone(candidate.trip);
      session.currentVersion = nextVersion;
      return {
        ok: true,
        persisted: true,
        sessionId: session.sessionId,
        currentVersion: nextVersion,
        trip: clone(session.trip),
        changedSegments: candidate.changedSegments || [],
        unchangedStops: candidate.unchangedStops || [],
        replacementReason: candidate.replacementReason || request.reason || '',
        replacementVenueId: candidate.replacementVenueId || request.candidateVenueId || '',
        plannerVersion: '1.0.0-v1',
        message: '行程重规划已成功应用并持久化。'
      };
    },
    async mutatePlannerStops(sessionId, request = {}, token) {
      const session = plannerSessions.get(String(sessionId || ''));
      if (!session) throw new JavaCoreError(404, 'JAVA_REQUEST_REJECTED', '规划会话不存在或无权访问。');
      if (request.expectedVersion !== undefined && Number(request.expectedVersion) !== session.currentVersion) {
        throw new JavaCoreError(409, 'CONFLICT', '规划版本已变化，请基于最新行程重新操作。', { expectedVersion: request.expectedVersion, currentVersion: session.currentVersion });
      }
      const candidate = await this.shadowMutateStops({
        trip: session.trip,
        operation: request.operation || 'add',
        attractionId: request.attractionId || '',
        day: request.day,
        targetStopId: request.targetStopId || '',
        stopId: request.stopId || ''
      }, token);
      const nextVersion = session.currentVersion + 1;
      candidate.trip.version = nextVersion;
      session.trip = clone(candidate.trip);
      session.currentVersion = nextVersion;
      return {
        ok: true,
        persisted: true,
        sessionId: session.sessionId,
        currentVersion: nextVersion,
        operation: candidate.operation || request.operation || 'add',
        trip: clone(session.trip),
        changedSegments: candidate.changedSegments || [],
        unchangedStops: candidate.unchangedStops || [],
        plannerVersion: '1.0.0-v1',
        message: '行程站点变更已成功应用并持久化。'
      };
    },
    async conversation(sessionId, request = {}, token) {
      return this.previewAdjustment(sessionId, request, token);
    },
    async plannerConversation(sessionId, request = {}, token) {
      return this.conversation(sessionId, request, token);
    },
    async previewAdjustment(sessionId, request = {}, token) {
      const session = plannerSessions.get(String(sessionId || ''));
      if (!session) throw new JavaCoreError(404, 'JAVA_REQUEST_REJECTED', '规划会话不存在或无权访问。');
      const message = String(request.message || '').trim();
      if (!message) {
        return { ok: true, requiresClarification: true, clarificationQuestion: '请输入您的调整要求或对景点的提问。', modified: false };
      }
      if (/(门票|几点|怎么走|介绍|历史)/.test(message) || message.endsWith('？') || message.endsWith('?')) {
        return { ok: true, type: 'PLACE_QUESTION', answer: '关于该景点信息：开放时间 09:00 - 17:00，推荐游览约90分钟。', message: '关于该景点信息：开放时间 09:00 - 17:00，推荐游览约90分钟。', modified: false };
      }
      const proposalId = `prop-stub-${sequence++}`;
      const candidateReplacements = [
        { optionId: 'option-1', name: '重庆大剧院江岸夜景', venueId: 'cq-grand-theatre', summary: '隔江远眺洪崖洞与千厮门大桥全景', duration: '约 90 分钟', walkDifficulty: '低', fit: '长辈同行' },
        { optionId: 'option-2', name: '弹子石老街', venueId: 'cq-danzi-shi', summary: '十里老街重温开埠岁月', duration: '约 90 分钟', walkDifficulty: '低', fit: '长辈同行' }
      ];
      const proposedTrip1 = clone(session.trip);
      const proposedTrip2 = clone(session.trip);
      if (proposedTrip1.days?.[0]?.stops?.[0]) {
        proposedTrip1.days[0].stops[0].name = '重庆大剧院江岸夜景';
        proposedTrip1.days[0].stops[0].venueId = 'cq-grand-theatre';
        proposedTrip1.days[0].stops[0].entityId = 'cq-grand-theatre';
      }
      if (proposedTrip2.days?.[0]?.stops?.[0]) {
        proposedTrip2.days[0].stops[0].name = '弹子石老街';
        proposedTrip2.days[0].stops[0].venueId = 'cq-danzi-shi';
        proposedTrip2.days[0].stops[0].entityId = 'cq-danzi-shi';
      }
      const optionPlans = { 'option-1': proposedTrip1, 'option-2': proposedTrip2 };
      plannerProposals.set(proposalId, {
        proposalId,
        sessionId,
        baseRevision: Number(request.baseRevision || session.currentVersion),
        optionPlans,
        proposedTrip: proposedTrip1,
        candidateReplacements,
        changedSegments: [proposedTrip1.days?.[0]?.stops?.[0]?.id || 'day1-s1'],
        unchangedStops: [],
        feasible: true,
        reasonCodes: [],
        alternatives: [],
        expiresAt: Date.now() + testProposalTtlMs
      });
      return {
        ok: true,
        feasible: true,
        proposalId,
        sessionId,
        baseRevision: Number(request.baseRevision || session.currentVersion),
        candidateReplacements,
        proposedTrip: proposedTrip1,
        changedSegments: [proposedTrip1.days?.[0]?.stops?.[0]?.id || 'day1-s1'],
        unchangedStops: [],
        verification: { feasible: true },
        plannerVersion: '1.0.0-v1',
        message: '调整方案已生成预览，请确认后应用。'
      };
    },
    async applyAdjustment(sessionId, request = {}, token) {
      const session = plannerSessions.get(String(sessionId || ''));
      if (!session) throw new JavaCoreError(404, 'JAVA_REQUEST_REJECTED', '规划会话不存在或无权访问。');
      const prop = plannerProposals.get(String(request.proposalId || ''));
      if (!prop || Number(prop.expiresAt || 0) <= Date.now()) {
        if (prop) plannerProposals.delete(String(request.proposalId || ''));
        throw new JavaCoreError(400, 'JAVA_REQUEST_REJECTED', '调整提案不存在或已过期。');
      }
      if (Number(request.baseRevision) !== session.currentVersion) {
        throw new JavaCoreError(409, 'CONFLICT', '规划版本已变化，请基于最新行程重新操作。');
      }
      const optionId = String(request.optionId || 'option-1');
      if (!Object.prototype.hasOwnProperty.call(prop.optionPlans, optionId)) {
        throw new JavaCoreError(400, 'JAVA_REQUEST_REJECTED', '所选调整方案不存在或已过期。');
      }
      const chosenTrip = clone(prop.optionPlans[optionId]);
      const nextVersion = session.currentVersion + 1;
      chosenTrip.version = nextVersion;
      session.trip = chosenTrip;
      session.currentVersion = nextVersion;
      plannerProposals.delete(request.proposalId);
      return {
        ok: true,
        applied: true,
        sessionId,
        currentVersion: nextVersion,
        trip: chosenTrip,
        changedSegments: prop.changedSegments,
        unchangedStops: prop.unchangedStops,
        plannerVersion: '1.0.0-v1',
        message: '行程调整已成功应用并持久化。'
      };
    },
    async savePlannerSession(sessionId, { sessionAccessToken } = {}, token) {
      const session = plannerSessions.get(String(sessionId || ''));
      if (!session) throw new JavaCoreError(404, 'JAVA_REQUEST_REJECTED', '规划会话不存在。');
      const user = userByToken(token);
      const existingId = String(session.trip?.formalTripId || '');
      if (existingId && formalTrips.has(existingId)) {
        const formal = formalTrips.get(existingId);
        if (formal.ownerId !== user.userId) throw new JavaCoreError(404, 'JAVA_REQUEST_REJECTED', '行程不存在。');
        formal.plan = clone(session.trip);
        formal.plan.formalTripId = formal.id;
        formal.title = String(formal.plan.title || formal.title);
        formal.currentVersion += 1;
        formal.updatedAt = Date.now();
        session.trip.formalTripId = formal.id;
        return { ok: true, tripId: formal.id, trip: clone(formal), currentVersion: formal.currentVersion };
      }
      const formal = formalTrip(user, { plan: session.trip });
      session.trip.formalTripId = formal.id;
      return { ok: true, tripId: formal.id, trip: formal, currentVersion: formal.currentVersion };
    },
    async openPlannerTrip(tripId, token) {
      const { trip } = ownedTrip(token, tripId);
      const sessionId = `session-stub-${sequence++}`;
      const sessionAccessToken = `plan-token-${sequence++}`;
      const restoredTrip = clone(trip.plan || {});
      restoredTrip.formalTripId = trip.id;
      restoredTrip.sourceTripId = trip.id;
      restoredTrip.sourceTripVersion = trip.currentVersion;
      restoredTrip.plannerSessionRestoreSource = 'RESTORED_FROM_TRIP';
      plannerSessions.set(sessionId, { sessionId, trip: restoredTrip, currentVersion: 1, sessionAccessToken });
      return {
        ok: true,
        sessionId,
        sessionAccessToken,
        syncRevision: 1,
        trip: restoredTrip,
        formalTripId: trip.id,
        formalTripVersion: trip.currentVersion,
        restoredFromTrip: true,
        adjustmentCapability: 'V1_PROPOSAL',
        legacyMode: false
      };
    }
  };

}

function createHttpClient() {
  return {
    register: ({ username, password }) => requestJava('/ai/auth/register', { method: 'POST', body: { username, password } }).then(authResult),
    login: ({ username, password }) => requestJava('/ai/auth/login', { method: 'POST', body: { username, password } }).then(authResult),
    logout: (token) => requestJava('/ai/auth/logout', { method: 'POST', token }),
    me: (token) => requestJava('/ai/auth/me', { token }).then(normalizeJavaPrincipal),
    getPreferences: (token, signal) => requestJava('/ai/preferences', { token, signal }),
    mergePreferences: (token, patch, expectedRevision) => requestJava('/ai/preferences', { method: 'POST', token, body: { ...patch, expectedRevision } }),
    replacePreferences: (token, patch, expectedRevision) => requestJava('/ai/preferences', { method: 'PUT', token, body: { ...patch, expectedRevision } }),
    clearPreferences: (token, expectedRevision) => requestJava('/ai/preferences', { method: 'DELETE', token, body: { expectedRevision } }),
    listTravelMemories: (token, signal) => requestJava('/ai/memories', { token, signal }),
    captureTravelMemoryObservation: (input = {}, token, signal) => requestJava('/ai/memories/observations', { method: 'POST', token, signal, body: input }),
    listTravelMemoryCandidates: (token, signal) => requestJava('/ai/memories/candidates', { token, signal }),
    confirmTravelMemoryCandidate: (id, token, signal) => requestJava(`/ai/memories/candidates/${encodeURIComponent(id)}/confirm`, { method: 'POST', token, signal }),
    dismissTravelMemoryCandidate: (id, token, signal) => requestJava(`/ai/memories/candidates/${encodeURIComponent(id)}/dismiss`, { method: 'POST', token, signal }),
    suggestTravelMemory: (input = {}, token, signal) => requestJava('/ai/memories/candidate', { method: 'POST', token, signal, body: input }),
    createTravelMemory: (input = {}, token, signal) => requestJava('/ai/memories', { method: 'POST', token, signal, body: input }),
    updateTravelMemory: (id, input = {}, token, signal) => requestJava(`/ai/memories/${encodeURIComponent(id)}`, { method: 'PATCH', token, signal, body: input }),
    deleteTravelMemory: (id, token, signal) => requestJava(`/ai/memories/${encodeURIComponent(id)}`, { method: 'DELETE', token, signal }),
    chatStream: ({ message = '', sessionId = 'default', mode = 'normal', plannerSessionId = '', tripId = '', currentVersion = '', activeDay = '', activeStopId = '', activeStopName = '', planContext = '' } = {}, token, signal) => {
      const params = new URLSearchParams({
        message: String(message),
        sessionId: String(sessionId),
        mode: mode === 'deep' ? 'deep' : 'normal',
        plannerSessionId: String(plannerSessionId || ''),
        tripId: String(tripId || ''),
        currentVersion: String(currentVersion || ''),
        activeDay: String(activeDay || ''),
        activeStopId: String(activeStopId || ''),
        activeStopName: String(activeStopName || ''),
        planContext: String(planContext || '')
      });
      return requestJavaStream(`/ai/chat/stream?${params.toString()}`, { token, signal });
    },
    ragRetrieve: ({ query, city = '重庆', constraints = {}, deep = false, signal } = {}, token) => requestJava('/ai/rag/retrieve', { method: 'POST', token, signal, body: { query, city, constraints, deep } }),
    ragStats: (token) => requestJava('/ai/rag/stats', { token }),
    analyticsDashboard: (period = 'today', token) => requestJava(`/ai/analytics/dashboard?period=${encodeURIComponent(period)}`, { token }),
    analyticsHotQuestions: (period = 'today', topN = 8, token) => requestJava(`/ai/analytics/hot-questions?period=${encodeURIComponent(period)}&topN=${Math.max(1, Math.min(20, Number(topN) || 8))}`, { token }),
    clearRerankCache: (token) => requestJava('/ai/admin/cache/clear', { method: 'POST', token }),
    createPlannerPlan: (request = {}, token, signal) => requestJava('/ai/planner/v1/plan', {
      method: 'POST',
      token,
      signal,
      headers: request.sessionAccessToken ? { 'x-plan-session-token': request.sessionAccessToken } : {},
      body: request
    }),
    getPlannerSession: (sessionId, { token, sessionAccessToken, signal } = {}) => requestJava(`/ai/planner/v1/sessions/${encodeURIComponent(sessionId)}`, {
      token,
      signal,
      headers: sessionAccessToken ? { 'x-plan-session-token': sessionAccessToken } : {}
    }),
    refreshPlannerDynamicData: (sessionId, { token, sessionAccessToken, signal } = {}) => requestJava(`/ai/planner/v1/sessions/${encodeURIComponent(sessionId)}/dynamic-refresh`, {
      method: 'POST',
      token,
      signal,
      headers: sessionAccessToken ? { 'x-plan-session-token': sessionAccessToken } : {}
    }),
    openPlannerTrip: (tripId, token, signal) => requestJava(`/ai/planner/v1/trips/${encodeURIComponent(tripId)}/open`, {
      method: 'POST',
      token,
      signal
    }),
    replanPlannerSession: (sessionId, request = {}, token, signal) => requestJava(`/ai/planner/v1/sessions/${encodeURIComponent(sessionId)}/replan`, {
      method: 'POST',
      token,
      signal,
      headers: request.sessionAccessToken ? { 'x-plan-session-token': request.sessionAccessToken } : {},
      body: request
    }),
    mutatePlannerStops: (sessionId, request = {}, token, signal) => requestJava(`/ai/planner/v1/sessions/${encodeURIComponent(sessionId)}/stops`, {
      method: 'POST',
      token,
      signal,
      headers: request.sessionAccessToken ? { 'x-plan-session-token': request.sessionAccessToken } : {},
      body: request
    }),
    conversation: (sessionId, request = {}, token, signal) => {
      const body = plannerConversationBody(request);
      return requestJava(`/ai/planner/v1/sessions/${encodeURIComponent(sessionId)}/conversation`, {
        method: 'POST',
        token,
        signal,
        headers: body.sessionAccessToken ? { 'x-plan-session-token': body.sessionAccessToken } : {},
        body
      });
    },
    plannerConversation: (sessionId, request = {}, token, signal) => {
      const body = plannerConversationBody(request);
      return requestJava(`/ai/planner/v1/sessions/${encodeURIComponent(sessionId)}/conversation`, {
        method: 'POST',
        token,
        signal,
        headers: body.sessionAccessToken ? { 'x-plan-session-token': body.sessionAccessToken } : {},
        body
      });
    },
    previewAdjustment: (sessionId, request = {}, token, signal) => {
      const body = plannerConversationBody(request);
      return requestJava(`/ai/planner/v1/sessions/${encodeURIComponent(sessionId)}/adjust/preview`, {
        method: 'POST',
        token,
        signal,
        headers: body.sessionAccessToken ? { 'x-plan-session-token': body.sessionAccessToken } : {},
        body
      });
    },
    applyAdjustment: (sessionId, request = {}, token, signal) => {
      const body = applyAdjustmentBody(request);
      return requestJava(`/ai/planner/v1/sessions/${encodeURIComponent(sessionId)}/adjust/apply`, {
        method: 'POST',
        token,
        signal,
        headers: body.sessionAccessToken ? { 'x-plan-session-token': body.sessionAccessToken } : {},
        body
      });
    },
    savePlannerSession: (sessionId, { sessionAccessToken } = {}, token, signal) => requestJava(`/ai/planner/v1/sessions/${encodeURIComponent(sessionId)}/save`, {
      method: 'POST',
      token,
      signal,
      headers: sessionAccessToken ? { 'x-plan-session-token': sessionAccessToken } : {}
    }),
    shadowPlan: ({ prompt = '', constraints = {}, usePreferences = false, signal } = {}, token) => requestJava('/ai/planner/v1/shadow', {
      method: 'POST', token, signal, body: { prompt, constraints, usePreferences }
    }),
    shadowReplan: ({ trip, targetStopId, candidateVenueId = '', reason = '' } = {}, token) => requestJava('/ai/planner/v1/shadow/replan', {
      method: 'POST', token, body: { trip, targetStopId, candidateVenueId, reason }
    }),
    shadowMutateStops: ({ trip, operation = 'add', attractionId = '', day, targetStopId = '', stopId = '', reason = '' } = {}, token) => requestJava('/ai/planner/v1/shadow/stops', {
      method: 'POST', token, body: { trip, operation, attractionId, day, targetStopId, stopId, reason }
    }),
    listAttractions: ({ district = '', category = '' } = {}) => {
      const params = new URLSearchParams();
      if (district) params.set('district', district);
      if (category) params.set('category', category);
      const query = params.toString();
      return requestJava(`/ai/attractions${query ? `?${query}` : ''}`);
    },
    getAttraction: (attractionId) => requestJava(`/ai/attractions/${encodeURIComponent(attractionId)}`),
    listTrips: (token) => requestJava('/ai/trips', { token }),
    getTrip: (token, tripId) => requestJava(`/ai/trips/${encodeURIComponent(tripId)}`, { token }),
    createTrip: (token, request) => requestJava('/ai/trips', { method: 'POST', token, body: request }),
    updateTrip: (token, tripId, request) => requestJava(`/ai/trips/${encodeURIComponent(tripId)}`, { method: 'PUT', token, body: request }),
    deleteTrip: (token, tripId, expectedVersion) => requestJava(`/ai/trips/${encodeURIComponent(tripId)}`, { method: 'DELETE', token, body: { expectedVersion } }),
    exportTrip: (token, tripId) => requestJavaBytes(`/ai/trips/${encodeURIComponent(tripId)}/export`, { token }),
    tripVersions: (token, tripId) => requestJava(`/ai/trips/${encodeURIComponent(tripId)}/versions`, { token }),
    listKnowledgeDocuments: (token, { query = '', topic = '', entityId = '' } = {}) => {
      const params = new URLSearchParams({ keyword: query, category: topic, entityId, page: '1', size: '100' });
      return requestJava(`/ai/knowledge?${params.toString()}`, { token });
    },
    createKnowledgeDocument: (token, formData) => requestJava('/ai/knowledge', {
      method: 'POST', token, body: formData, multipart: true
    }),
    updateKnowledgeDocument: (token, docId, body = {}) => requestJava(`/ai/rag/knowledge/${encodeURIComponent(docId)}`, { method: 'PUT', token, body }),
    listUsers: (token) => requestJava('/ai/admin/users?page=1&size=100', { token }),
    getUserDetail: (token, userId) => requestJava(`/ai/admin/users/${encodeURIComponent(userId)}`, { token }),
    updateUserRole: (token, userId, body) => requestJava(`/ai/admin/users/${encodeURIComponent(userId)}/role`, { method: 'PUT', token, body }),
    disableUser: (token, userId) => requestJava(`/ai/admin/users/${encodeURIComponent(userId)}`, { method: 'DELETE', token }),
    getDigitalHuman: (token) => requestJava('/ai/admin/digital-human', { token }),
    updateDigitalHuman: (token, body = {}) => requestJava('/ai/admin/digital-human', { method: 'PUT', token, body }),
    listDigitalHumanVoices: (token) => requestJava('/ai/admin/digital-human/voices', { token }),
    getSettings: (token) => requestJava('/ai/admin/settings', { token }),
    updateSettings: (token, body = {}) => requestJava('/ai/admin/settings', { method: 'PUT', token, body })
  };
}

export function createJavaCoreClient() {
  return TEST_STUB_ENABLED ? createTestStub() : createHttpClient();
}

export const javaCoreConfig = {
  baseUrl: JAVA_CORE_URL,
  timeoutMs: JAVA_TIMEOUT_MS,
  testStub: TEST_STUB_ENABLED
};
