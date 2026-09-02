import { state } from '../../app-core/state.js';

/**
 * 获取或生成唯一的设备客户端指纹，用于会话同步与审计
 */
export function deviceId() {
  const storageKey = 'yuyouzhice-device-id';
  try {
    let value = window.localStorage.getItem(storageKey);
    if (!value) {
      value = `device-${crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
      window.localStorage.setItem(storageKey, value);
    }
    return value;
  } catch {
    return 'browser-session';
  }
}

/**
 * 生成规划幂等键
 */
export function plannerIdempotencyKey(prefix = 'planner') {
  const suffix = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${suffix}`;
}

/**
 * 通用网络请求封装：浏览器只携带 HttpOnly Cookie，不保存或发送 Java JWT。
 */
export async function request(path, options = {}) {
  const method = String(options.method || 'GET').toUpperCase();
  const isMultipart = typeof FormData !== 'undefined' && options.body instanceof FormData;
  const headers = {
    ...(isMultipart ? {} : { 'content-type': 'application/json' }),
    'x-yuyouzhice-device': deviceId(),
    ...(options.headers || {})
  };
  if (state.csrfToken && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) && !headers['x-yuyouzhice-csrf']) {
    headers['x-yuyouzhice-csrf'] = state.csrfToken;
  }
  let response;
  try {
    response = await fetch(path, { ...options, credentials: 'same-origin', headers });
  } catch (netErr) {
    if (netErr?.name === 'AbortError') throw netErr;
    throw Object.assign(new Error('网络连接异常，请检查后端服务是否正常运行。'), { status: 0, cause: netErr });
  }
  let data = {};
  try {
    data = await response.json();
  } catch {
    data = { ok: false, message: response.ok ? '服务响应格式异常' : `服务出现异常 (HTTP ${response.status})` };
  }
  if (!response.ok) throw Object.assign(new Error(data.message || '请求失败'), { data, status: response.status });
  return data;
}
