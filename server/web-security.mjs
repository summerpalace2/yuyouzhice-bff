import { randomBytes, timingSafeEqual } from 'node:crypto';

export const SESSION_COOKIE_NAME = '__Host-yuyouzhice_session';
export const CSRF_HEADER_NAME = 'x-yuyouzhice-csrf';
export const CSRF_COOKIE_NAME = '__Host-yuyouzhice_csrf';
const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function configuredOrigins() {
  const raw = String(process.env.YUYOUZHICE_WEB_ORIGINS || '').trim();
  if (raw) return new Set(raw.split(',').map((item) => item.trim()).filter(Boolean));
  const port = String(process.env.PORT || '3000');
  return new Set([
    `http://localhost:${port}`,
    `http://127.0.0.1:${port}`,
    `https://localhost:${port}`,
    `https://127.0.0.1:${port}`
  ]);
}

function parseUrlOrigin(value) {
  try { return new URL(String(value)).origin; } catch { return ''; }
}

export function parseCookies(header = '') {
  const cookies = {};
  for (const part of String(header || '').split(';')) {
    const index = part.indexOf('=');
    if (index <= 0) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) cookies[key] = decodeURIComponent(value);
  }
  return cookies;
}

export function cookieValue(req, name) {
  return parseCookies(req.headers.cookie || '')[name] || '';
}

export function serializeCookie(name, value, { maxAge, httpOnly = false, sameSite = 'Lax', secure = true, path = '/', domain } = {}) {
  const parts = [`${name}=${encodeURIComponent(String(value ?? ''))}`, `Path=${path}`, `SameSite=${sameSite}`];
  if (secure) parts.push('Secure');
  if (httpOnly) parts.push('HttpOnly');
  if (domain) parts.push(`Domain=${domain}`);
  if (Number.isFinite(maxAge)) parts.push(`Max-Age=${Math.max(0, Math.floor(maxAge))}`);
  return parts.join('; ');
}

export function sessionCookie(sessionId, maxAgeSeconds) {
  return serializeCookie(SESSION_COOKIE_NAME, sessionId, { httpOnly: true, sameSite: 'Lax', secure: true, path: '/', maxAge: maxAgeSeconds });
}

export function clearSessionCookie() {
  return serializeCookie(SESSION_COOKIE_NAME, '', { httpOnly: true, sameSite: 'Lax', secure: true, path: '/', maxAge: 0 });
}

export function csrfCookie(token, maxAgeSeconds) {
  return serializeCookie(CSRF_COOKIE_NAME, token, { httpOnly: false, sameSite: 'Lax', secure: true, path: '/', maxAge: maxAgeSeconds });
}

export function clearCsrfCookie() {
  return serializeCookie(CSRF_COOKIE_NAME, '', { httpOnly: false, sameSite: 'Lax', secure: true, path: '/', maxAge: 0 });
}

export function csrfTokenMatches(expected, actual) {
  const left = Buffer.from(String(expected || ''));
  const right = Buffer.from(String(actual || ''));
  return left.length > 0 && left.length === right.length && timingSafeEqual(left, right);
}

export function requestSessionId(req) {
  return cookieValue(req, SESSION_COOKIE_NAME);
}

export function requestCsrfToken(req) {
  return String(req.headers[CSRF_HEADER_NAME] || req.headers[CSRF_HEADER_NAME.toLowerCase()] || '');
}

export function originAllowed(req) {
  const allowlist = configuredOrigins();
  const originHeader = String(req.headers.origin || '').trim();
  if (originHeader) return allowlist.has(parseUrlOrigin(originHeader));
  const referer = String(req.headers.referer || '').trim();
  if (referer) return allowlist.has(parseUrlOrigin(referer));
  return false;
}

export function isMutation(req) {
  return MUTATION_METHODS.has(String(req.method || '').toUpperCase());
}

export function assertMutationSecurity(req, session, { testCompatibility = false } = {}) {
  if (!isMutation(req)) return { ok: true };
  if (testCompatibility) return { ok: true, compatibility: true };
  // Anonymous mutations carry no authenticated Cookie authority and are not
  // CSRF-bearing account writes; authenticated Cookie mutations remain strict.
  if (!session && !req.headers.origin && !req.headers.referer) return { ok: true, anonymous: true };
  if (!originAllowed(req)) return { ok: false, status: 403, code: 'ORIGIN_REJECTED', message: '请求来源未通过安全校验。' };
  if (!session) return { ok: true, anonymous: true };
  const presented = requestCsrfToken(req);
  if (!csrfTokenMatches(session.csrfToken, presented)) return { ok: false, status: 403, code: 'CSRF_REJECTED', message: '请求安全令牌无效或已缺失。' };
  return { ok: true };
}

export function testBearerSessionId(req) {
  if (String(process.env.YUYOUZHICE_TEST_FIXTURES || '') !== '1' && String(process.env.YUYOUZHICE_TEST_SESSION_COMPAT || '') !== '1') return '';
  const value = String(req.headers.authorization || '');
  return value.startsWith('Bearer ') ? value.slice(7).trim() : '';
}

export function createCsrfToken() {
  return randomBytes(24).toString('base64url');
}
