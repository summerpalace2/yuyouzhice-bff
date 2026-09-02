import {
  PHASE5B_FIXTURE_ADMIN_EMAIL,
  PHASE5B_FIXTURE_ADMIN_PASSWORD,
  spawnPhase5bFixtureServer
} from './phase5b-test-fixture.mjs';

const port = 4312;
const server = spawnPhase5bFixtureServer(port);
const base = `http://127.0.0.1:${port}`;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function call(path, options = {}) { const response = await fetch(`${base}${path}`, options); const data = await response.json(); return { response, data }; }
async function waitForServer() {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${base}/api/health`);
      if (response.ok) return;
    } catch { }
    await wait(80);
  }
  throw new Error('认证流程测试桩启动超时');
}
try {
  await waitForServer();
  const draft = await call('/api/plan', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: '重庆两天一夜' }) });
  const failed = await call('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'wrong@example.com', password: 'wrong' }) });
  if (failed.response.status !== 401 || !failed.data.message.includes('草稿')) throw new Error('登录失败没有明确保留草稿');
  const login = await call('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: PHASE5B_FIXTURE_ADMIN_EMAIL, password: PHASE5B_FIXTURE_ADMIN_PASSWORD }) });
  const headers = { 'content-type': 'application/json', authorization: `Bearer ${login.data.token}` };
  const saved = await call('/api/trips/save', { method: 'POST', headers, body: JSON.stringify({ trip: draft.data.trip }) });
  const trips = await call('/api/trips', { headers });
  if (!saved.data.ok || trips.data.trips.length !== 1) throw new Error('登录后保存与我的行程读取失败');
  console.log('登录回跳主链通过：失败保留草稿 → 成功登录 → 保存 → 我的行程');
} finally { server.kill(); }
