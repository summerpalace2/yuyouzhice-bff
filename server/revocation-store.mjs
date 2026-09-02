/**
 * revocation-store.mjs
 *
 * 核心职责：为认证 Token 提供进程内回退和可选的 Redis TTL 撤销存储。
 * 主要导出：createRevocationStore、revocationStatus。
 */

import { createHash } from 'node:crypto';
import { createConnection } from 'node:net';
import { connect as createTlsConnection } from 'node:tls';
import './env.mjs';

const REDIS_MODE = String(process.env.YUYOUZHICE_REVOKE_STORE || 'memory').trim().toLowerCase();
const REDIS_REQUESTED = REDIS_MODE === 'redis';
const REDIS_TIMEOUT_MS = Math.max(500, Number(process.env.YUYOUZHICE_REDIS_TIMEOUT_MS || 1200));
const REDIS_PREFIX = String(process.env.YUYOUZHICE_REDIS_KEY_PREFIX || 'yuyouzhice:revoked:').trim();

function redisConfig() {
  const configuredUrl = String(process.env.YUYOUZHICE_REDIS_URL || '').trim();
  if (configuredUrl) {
    const parsed = new URL(configuredUrl);
    return {
      host: parsed.hostname,
      port: Number(parsed.port || 6379),
      password: decodeURIComponent(parsed.password || ''),
      database: parsed.pathname.replace(/^\//, '')
        || String(process.env.YUYOUZHICE_REDIS_DATABASE || process.env.REDIS_DATABASE || ''),
      tls: parsed.protocol === 'rediss:'
    };
  }
  const host = String(process.env.YUYOUZHICE_REDIS_HOST || process.env.REDIS_HOST || '').trim();
  if (!host) return null;
  const tlsValue = String(process.env.YUYOUZHICE_REDIS_SSL || process.env.REDIS_SSL || '').trim().toLowerCase();
  return {
    host,
    port: Number(process.env.YUYOUZHICE_REDIS_PORT || process.env.REDIS_PORT || 6379),
    password: String(process.env.YUYOUZHICE_REDIS_PASSWORD || process.env.REDIS_PASSWORD || ''),
    database: String(process.env.YUYOUZHICE_REDIS_DATABASE || process.env.REDIS_DATABASE || ''),
    tls: tlsValue === 'true' || tlsValue === '1'
  };
}

const CONFIG = REDIS_REQUESTED ? redisConfig() : null;

function encodeCommand(args) {
  const parts = [`*${args.length}\r\n`];
  for (const arg of args) {
    const value = Buffer.from(String(arg), 'utf8');
    parts.push(`$${value.length}\r\n`, value, '\r\n');
  }
  return Buffer.concat(parts.map((part) => Buffer.isBuffer(part) ? part : Buffer.from(part, 'utf8')));
}

function parseReply(buffer) {
  if (!buffer.length) return null;
  const marker = String.fromCharCode(buffer[0]);
  const lineEnd = buffer.indexOf('\r\n');
  if (lineEnd < 0) return null;
  if (marker === '+' || marker === '-' || marker === ':') {
    return { value: marker === ':' ? Number(buffer.subarray(1, lineEnd).toString()) : buffer.subarray(1, lineEnd).toString(), offset: lineEnd + 2, error: marker === '-' };
  }
  if (marker === '$') {
    const length = Number(buffer.subarray(1, lineEnd).toString());
    if (length < 0) return { value: null, offset: lineEnd + 2 };
    const end = lineEnd + 2 + length + 2;
    if (buffer.length < end) return null;
    return { value: buffer.subarray(lineEnd + 2, lineEnd + 2 + length).toString(), offset: end };
  }
  throw new Error(`Redis 响应类型不支持：${marker}`);
}

async function redisCommand(args) {
  if (!CONFIG) throw new Error('Redis 撤销存储未配置');
  const commands = [];
  if (CONFIG.password) commands.push(['AUTH', CONFIG.password]);
  if (CONFIG.database) commands.push(['SELECT', CONFIG.database]);
  commands.push(args);
  const expectedReplies = commands.length;
  return new Promise((resolve, reject) => {
    const socket = CONFIG.tls
      ? createTlsConnection({ host: CONFIG.host, port: CONFIG.port, servername: CONFIG.host, rejectUnauthorized: true })
      : createConnection({ host: CONFIG.host, port: CONFIG.port });
    let buffer = Buffer.alloc(0);
    let replyCount = 0;
    let finalReply;
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      error ? reject(error) : resolve(value);
    };
    const timer = setTimeout(() => finish(new Error('Redis 撤销存储请求超时')), REDIS_TIMEOUT_MS);
    socket.once(CONFIG.tls ? 'secureConnect' : 'connect', () => {
      socket.write(Buffer.concat(commands.map(encodeCommand)));
    });
    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      try {
        while (replyCount < expectedReplies) {
          const reply = parseReply(buffer);
          if (!reply) return;
          buffer = buffer.subarray(reply.offset);
          if (reply.error) throw new Error(`Redis 命令失败：${reply.value}`);
          finalReply = reply.value;
          replyCount += 1;
        }
        clearTimeout(timer);
        finish(null, finalReply);
      } catch (error) {
        clearTimeout(timer);
        finish(error);
      }
    });
    socket.once('error', (error) => { clearTimeout(timer); finish(error); });
    socket.once('close', () => { clearTimeout(timer); if (!settled) finish(new Error('Redis 连接已关闭')); });
  });
}

function tokenKey(token) {
  return `${REDIS_PREFIX}${createHash('sha256').update(token).digest('hex')}`;
}

export function revocationStatus() {
  return {
    mode: REDIS_REQUESTED ? 'Redis TTL 撤销存储' : '进程内撤销存储',
    configured: Boolean(CONFIG),
    provider: CONFIG ? 'Redis' : REDIS_REQUESTED ? 'unconfigured' : 'memory',
    failClosed: REDIS_REQUESTED,
    note: CONFIG
      ? '注销状态通过 Redis TTL 在实例间同步。'
      : REDIS_REQUESTED
        ? '已请求 Redis，但连接配置缺失；认证请求将按失败关闭处理。'
        : '未启用 Redis，注销状态只在当前进程生效。'
  };
}

export function createRevocationStore() {
  const localRevoked = new Map();
  const cleanup = () => {
    const now = Date.now();
    for (const [token, expiresAt] of localRevoked) if (expiresAt <= now) localRevoked.delete(token);
  };
  return {
    status: revocationStatus(),
    async isRevoked(token) {
      cleanup();
      if (localRevoked.has(token)) return true;
      if (!REDIS_REQUESTED) return false;
      if (!CONFIG) return true;
      try { return Number(await redisCommand(['EXISTS', tokenKey(token)])) === 1; } catch { return true; }
    },
    async revoke(token, ttlSeconds) {
      const expiresAt = Date.now() + ttlSeconds * 1000;
      localRevoked.set(token, expiresAt);
      if (!REDIS_REQUESTED) return { ok: true, distributed: false };
      if (!CONFIG) return { ok: false, distributed: false };
      try {
        await redisCommand(['SET', tokenKey(token), '1', 'EX', String(Math.max(1, ttlSeconds))]);
        return { ok: true, distributed: true };
      } catch {
        return { ok: false, distributed: false };
      }
    },
    clear() { localRevoked.clear(); }
  };
}
