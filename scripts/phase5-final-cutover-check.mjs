import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

const port = 4325;
const base = `http://127.0.0.1:${port}`;
const adminEmail = 'phase5-final-admin@example.invalid';
const adminPassword = 'phase5-final-synthetic-credential';
const server = spawn(process.execPath, ['server/index.mjs'], {
  env: {
    ...process.env,
    PORT: String(port),
    YUYOUZHICE_MEMORY: '1',
    YUYOUZHICE_JAVA_TEST_STUB: '1',
    YUYOUZHICE_TEST_ADMIN_EMAIL: adminEmail,
    YUYOUZHICE_TEST_ADMIN_PASSWORD: adminPassword
  },
  stdio: 'ignore'
});

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let cookie = '';
let csrf = '';

function collectCookies(response) {
  const values = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : (response.headers.get('set-cookie') || '').split(/,(?=[^;]+=)/);
  const jar = new Map(cookie.split(';').map((item) => item.trim().split('=').slice(0, 2)).filter(([key, value]) => key && value));
  for (const value of values) {
    const [pair] = value.split(';');
    const index = pair.indexOf('=');
    if (index > 0) jar.set(pair.slice(0, index), pair.slice(index + 1));
  }
  cookie = [...jar.entries()].filter(([, value]) => value !== '').map(([key, value]) => `${key}=${value}`).join('; ');
}

async function call(path, { method = 'GET', body, withCookie = true, csrfHeader = false, origin = `http://127.0.0.1:${port}`, headers = {} } = {}) {
  const requestHeaders = { accept: 'application/json', ...headers };
  if (body !== undefined) requestHeaders['content-type'] = 'application/json';
  if (withCookie && cookie) requestHeaders.cookie = cookie;
  if (origin) requestHeaders.origin = origin;
  if (csrfHeader && csrf) requestHeaders['x-yuyouzhice-csrf'] = csrf;
  const response = await fetch(`${base}${path}`, { method, headers: requestHeaders, body: body === undefined ? undefined : JSON.stringify(body) });
  collectCookies(response);
  const data = response.headers.get('content-type')?.includes('application/json') ? await response.json() : null;
  return { response, data };
}

try {
  await wait(250);
  const login = await call('/api/auth/login', { method: 'POST', body: { email: adminEmail, password: adminPassword } });
  assert.equal(login.response.status, 200);
  assert.equal(login.data.ok, true);
  assert.equal(login.data.token, undefined, 'production-shaped Java test authority must not expose a token field');
  assert.equal(login.data.user.role, 'admin');
  assert.match(cookie, /__Host-yuyouzhice_session=/);
  assert.match(cookie, /__Host-yuyouzhice_csrf=/);
  csrf = login.data.csrfToken;
  assert.ok(csrf);

  const session = await call('/api/auth/session');
  assert.equal(session.data.authenticated, true);
  assert.equal(session.data.user.id, login.data.user.id);
  assert.equal(session.data.csrfToken, csrf);

  const missingCsrf = await call('/api/preferences', { method: 'POST', body: { value: '少走路' } });
  assert.equal(missingCsrf.response.status, 403);
  assert.equal(missingCsrf.data.code, 'CSRF_REJECTED');

  const badOrigin = await call('/api/preferences', { method: 'POST', body: { value: '少走路' }, csrfHeader: true, origin: 'https://evil.example.invalid' });
  assert.equal(badOrigin.response.status, 403);
  assert.equal(badOrigin.data.code, 'ORIGIN_REJECTED');

  const preference = await call('/api/preferences', { method: 'POST', body: { value: '少走路' }, csrfHeader: true });
  assert.equal(preference.response.status, 200);
  assert.ok(preference.data.formalPreferences);
  assert.ok(preference.data.preferences.includes('少走路'));
  assert.equal(preference.data.formalPreferences.walkingTolerance, 'LOW');

  const oldToken = await call('/api/trips', { headers: { authorization: 'Bearer eyJzdWIiOiJvbGQifQ.old-node-signature' }, withCookie: false, origin: null });
  assert.equal(oldToken.response.status, 401);

  const logout = await call('/api/auth/logout', { method: 'POST', csrfHeader: true });
  assert.equal(logout.response.status, 200);
  const afterLogout = await call('/api/auth/session');
  assert.equal(afterLogout.data.authenticated, false);

  console.log('Phase 5 Final Cutover checks passed: Java delegation, opaque HttpOnly session, CSRF, Origin, old-token rejection, logout');
} finally {
  server.kill();
}
