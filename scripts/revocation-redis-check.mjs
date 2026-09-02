/**
 * revocation-redis-check.mjs
 *
 * 核心职责：用本地 RESP 测试桩验证两个服务进程共享 Redis TTL Token 撤销状态。
 * 该脚本不需要真实 Redis，也不会读取或写入用户现有 Redis 数据。
 */

import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const tempDir = await mkdtemp(path.join(os.tmpdir(), 'yuyouzhice-revocation-redis-'));
const dataFile = path.join(tempDir, 'store.json');
const authSecret = 'revocation-check-secret-01234567890123456789';

function parseRequest(buffer) {
  if (buffer[0] !== 42) return null;
  const firstLineEnd = buffer.indexOf('\r\n');
  if (firstLineEnd < 0) return null;
  const count = Number(buffer.subarray(1, firstLineEnd).toString());
  let offset = firstLineEnd + 2;
  const args = [];
  for (let index = 0; index < count; index += 1) {
    if (buffer[offset] !== 36) return null;
    const lengthEnd = buffer.indexOf('\r\n', offset);
    if (lengthEnd < 0) return null;
    const length = Number(buffer.subarray(offset + 1, lengthEnd).toString());
    const valueStart = lengthEnd + 2;
    const valueEnd = valueStart + length;
    if (buffer.length < valueEnd + 2) return null;
    args.push(buffer.subarray(valueStart, valueEnd).toString());
    offset = valueEnd + 2;
  }
  return { args, offset };
}

async function startRedisStub() {
  const values = new Map();
  const server = createServer((socket) => {
    let buffer = Buffer.alloc(0);
    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      while (true) {
        const request = parseRequest(buffer);
        if (!request) return;
        buffer = buffer.subarray(request.offset);
        const [rawCommand, ...args] = request.args;
        const command = String(rawCommand || '').toUpperCase();
        if (command === 'AUTH' || command === 'SELECT') {
          socket.write('+OK\r\n');
          continue;
        }
        if (command === 'SET') {
          const ttlIndex = args.findIndex((item) => String(item).toUpperCase() === 'EX');
          const ttl = ttlIndex >= 0 ? Number(args[ttlIndex + 1]) : 0;
          values.set(args[0], { value: args[1], expiresAt: ttl ? Date.now() + ttl * 1000 : Infinity });
          socket.write('+OK\r\n');
          continue;
        }
        if (command === 'EXISTS') {
          const record = values.get(args[0]);
          if (record && record.expiresAt <= Date.now()) values.delete(args[0]);
          socket.write(`:${values.has(args[0]) ? 1 : 0}\r\n`);
          continue;
        }
        socket.write('-ERR unsupported test command\r\n');
      }
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, port: server.address().port };
}

function startApp(port, redisPort) {
  const child = spawn(process.execPath, ['server/index.mjs'], {
    env: {
      ...process.env,
      PORT: String(port),
      YUYOUZHICE_DATA_FILE: dataFile,
      YUYOUZHICE_AUTH_SECRET: authSecret,
      YUYOUZHICE_REVOKE_STORE: 'redis',
      YUYOUZHICE_REDIS_HOST: '127.0.0.1',
      YUYOUZHICE_REDIS_PORT: String(redisPort),
      YUYOUZHICE_REDIS_DATABASE: '0',
      YUYOUZHICE_REDIS_PASSWORD: '',
      YUYOUZHICE_REDIS_SSL: 'false',
      YUYOUZHICE_TOKEN_TTL_MS: '60000',
      YUYOUZHICE_JAVA_TEST_STUB: '1',
      YUYOUZHICE_TEST_SESSION_COMPAT: '1',
      YUYOUZHICE_TEST_ADMIN_EMAIL: 'phase5-final-revocation-admin@example.invalid',
      YUYOUZHICE_TEST_ADMIN_PASSWORD: 'phase5-final-revocation-synthetic-credential'
    },
    stdio: ['ignore', 'ignore', 'pipe']
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
  child.diagnosticOutput = () => stderr;
  return child;
}

async function freePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function ready(base, child) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`服务提前退出：${child.diagnosticOutput()}`);
    try {
      const response = await fetch(`${base}/api/health`);
      if (response.ok) return response.json();
    } catch { /* 服务尚未监听 */ }
    await wait(50);
  }
  throw new Error(`服务未启动：${base} ${child.diagnosticOutput()}`);
}

async function call(base, requestPath, options = {}) {
  const response = await fetch(`${base}${requestPath}`, options);
  const data = response.headers.get('content-type')?.includes('application/json') ? await response.json() : null;
  return { response, data };
}

const redis = await startRedisStub();
let first;
let second;
try {
  const portA = await freePort();
  const baseA = `http://127.0.0.1:${portA}`;
  first = startApp(portA, redis.port);
  const healthA = await ready(baseA, first);
  if (healthA.auth?.provider !== 'Redis' || !healthA.auth.configured) throw new Error('服务没有报告 Redis 撤销存储已配置');

  const email = 'phase5-final-revocation-admin@example.invalid';
  const password = 'phase5-final-revocation-synthetic-credential';
  const registered = await call(baseA, '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
  if (registered.response.status !== 200) throw new Error(`登录失败：${registered.data?.message || registered.response.status}`);
  const oldHeaders = { authorization: `Bearer ${registered.data.token}` };
  const beforeLogout = await call(baseA, '/api/trips', { headers: oldHeaders });
  if (beforeLogout.response.status !== 200) throw new Error('注销前 Token 不能访问账号数据');
  const logout = await call(baseA, '/api/auth/logout', { method: 'POST', headers: oldHeaders });
  if (logout.response.status !== 200 || !logout.data?.ok) throw new Error(`注销失败：${logout.data?.message || logout.response.status}`);
  first.kill();

  const portB = await freePort();
  const baseB = `http://127.0.0.1:${portB}`;
  second = startApp(portB, redis.port);
  await ready(baseB, second);
  const afterLogout = await call(baseB, '/api/trips', { headers: oldHeaders });
  if (afterLogout.response.status !== 401) throw new Error('第二个进程仍接受第一个进程已注销的 Token');
  const newLogin = await call(baseB, '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
  if (newLogin.response.status !== 200) throw new Error(`重新登录失败：${newLogin.data?.message || newLogin.response.status}`);
  const afterRelogin = await call(baseB, '/api/trips', { headers: { authorization: `Bearer ${newLogin.data.token}` } });
  if (afterRelogin.response.status !== 200) throw new Error('新 Token 未能正常访问账号数据');
  console.log('Redis 撤销同步验收通过：进程 A 注销 → 进程 B 拒绝旧 Token → 新 Token 正常可用');
} finally {
  first?.kill();
  second?.kill();
  await new Promise((resolve) => redis.server.close(resolve));
  await rm(tempDir, { recursive: true, force: true });
}
