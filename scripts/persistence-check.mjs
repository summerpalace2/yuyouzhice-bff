/**
 * persistence-check.mjs
 *
 * 核心职责：验证 Node 适配层的跨进程边界、偏好/身份不落入 Node 存储、Token 失效行为。
 * Java Formal Trip 的保存、读取和更新由 Java Shadow 集成验收覆盖；本脚本使用进程内 Java stub，不能模拟 Java 数据库重启持久化。
 * 主要导出：无，作为 npm 验收脚本运行。
 */

import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const tempDir = await mkdtemp(path.join(os.tmpdir(), 'yuyouzhice-persistence-'));
const dataFile = path.join(tempDir, 'store.json');
const portA = 4316;
const portB = 4317;
const testAuthSecret = 'phase5a-persistence-test-secret-0123456789';
const testPassword = 'phase5b-test-user-credential-only';

function start(port, tokenTtl = '') {
  return spawn(process.execPath, ['server/index.mjs'], { env: { ...process.env, PORT: String(port), YUYOUZHICE_MEMORY: '0', YUYOUZHICE_DATA_FILE: dataFile, YUYOUZHICE_AUTH_SECRET: testAuthSecret, YUYOUZHICE_JAVA_TEST_STUB: '1', YUYOUZHICE_TEST_SESSION_COMPAT: '1', YUYOUZHICE_TEST_ADMIN_EMAIL: 'phase5-final-persistence-admin@example.invalid', YUYOUZHICE_TEST_ADMIN_PASSWORD: testPassword, ...(tokenTtl ? { YUYOUZHICE_TOKEN_TTL_MS: tokenTtl } : {}) }, stdio: 'ignore' });
}

async function waitForServer(base) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try { const response = await fetch(`${base}/api/health`); if (response.ok) return; } catch { /* 服务尚未监听 */ }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`服务未启动：${base}`);
}

async function call(base, requestPath, options = {}) {
  const response = await fetch(`${base}${requestPath}`, options);
  const data = response.headers.get('content-type')?.includes('application/json') ? await response.json() : null;
  if (!response.ok) throw new Error(`${requestPath}: ${data?.message || response.status}`);
  return data;
}

let firstServer;
let secondServer;
try {
  // 首个进程完成 Java candidate save；过期行为和 Node 进程边界在第二个进程单独验证。
  firstServer = start(portA, '10000');
  const firstBase = `http://127.0.0.1:${portA}`;
  await waitForServer(firstBase);
  const email = 'phase5-final-persistence-admin@example.invalid';
  const register = await call(firstBase, '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: testPassword }) });
  const headers = { 'content-type': 'application/json', authorization: `Bearer ${register.token}` };
  const tamperedToken = 'old-node-header.old-node-signature';
  const tamperedResponse = await fetch(`${firstBase}/api/trips`, { headers: { authorization: `Bearer ${tamperedToken}` } });
  if (tamperedResponse.status !== 401) throw new Error('签名被篡改的 Token 仍可访问账号数据');
  const plan = await call(firstBase, '/api/plan', { method: 'POST', headers, body: JSON.stringify({ prompt: '重庆三天旅行，少走路。' }) });
  if (!plan.trip?.days?.length || plan.trip.days.some((day) => !day.date)) throw new Error('Java candidate 没有生成有效的 TripPlan 天数');
  const persistedAfterPlan = JSON.parse(await readFile(dataFile, 'utf8'));
  const plannerDraft = persistedAfterPlan.plannerDrafts?.[plan.sessionId];
  if (!plannerDraft?.javaSessionId || !plannerDraft.sessionAccessTokenEncrypted) throw new Error('BFF 规划会话映射未持久化或未加密保存会话凭证');
  if (Object.prototype.hasOwnProperty.call(plannerDraft, 'sessionAccessToken')
      || JSON.stringify(plannerDraft).includes(String(plan.sessionAccessToken))) {
    throw new Error('持久化规划映射包含明文 sessionAccessToken');
  }
  const saved = await call(firstBase, '/api/trips/save', { method: 'POST', headers, body: JSON.stringify({ trip: plan.trip }) });
  await call(firstBase, '/api/preferences', { method: 'POST', headers, body: JSON.stringify({ value: '少走路' }) });
  firstServer.kill();

  secondServer = start(portB, '1000');
  const secondBase = `http://127.0.0.1:${portB}`;
  await waitForServer(secondBase);
  const login = await call(secondBase, '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: testPassword }) });
  const secondHeaders = { 'content-type': 'application/json', authorization: `Bearer ${login.token}` };
  const restoredWithOldToken = await fetch(`${secondBase}/api/trips`, { headers });
  if (restoredWithOldToken.status !== 401) throw new Error('旧的进程内 opaque Web session 不应跨进程复用');
  const trips = await call(secondBase, '/api/trips', { headers: secondHeaders });
  if (trips.trips.length !== 0) throw new Error('Node 不应从本地存储恢复 Java Formal Trip 副本');
  await new Promise((resolve) => setTimeout(resolve, 1100));
  const expired = await fetch(`${secondBase}/api/trips`, { headers: secondHeaders });
  if (expired.status !== 401) throw new Error('过期令牌仍可读取行程');
  const renewedLogin = await call(secondBase, '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: testPassword }) });
  const renewedHeaders = { 'content-type': 'application/json', authorization: `Bearer ${renewedLogin.token}` };
  let disk = {};
  try {
    disk = JSON.parse(await readFile(dataFile, 'utf8'));
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  if (
    (disk.users || []).length !== 0
    || Object.keys(disk.preferencesByUser || {}).length !== 0
    || Object.keys(disk.tripsByUser || {}).length !== 0
    || Object.keys(disk.historyByUser || {}).length !== 0
  ) {
    throw new Error('Node legacy identity, Preferences, or Formal Trip authority was written during cutover');
  }
  const logoutResponse = await fetch(`${secondBase}/api/auth/logout`, { method: 'POST', headers: { authorization: `Bearer ${renewedLogin.token}` } });
  if (!logoutResponse.ok) throw new Error('退出登录接口失败');
  const afterLogout = await fetch(`${secondBase}/api/trips`, { headers: renewedHeaders });
  if (afterLogout.status !== 401) throw new Error('退出后旧令牌仍可读取行程');
  console.log('持久化边界验收通过：Node 不持有 Java Formal Trip 副本，身份/偏好不写入 Node，opaque session 与 Token 失效行为正确。');
} finally {
  firstServer?.kill();
  secondServer?.kill();
  await rm(tempDir, { recursive: true, force: true });
}
