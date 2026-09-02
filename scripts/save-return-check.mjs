import {
  PHASE5B_FIXTURE_ADMIN_EMAIL,
  PHASE5B_FIXTURE_ADMIN_PASSWORD,
  spawnPhase5bFixtureServer
} from './phase5b-test-fixture.mjs';

const port = 4314;
const server = spawnPhase5bFixtureServer(port);
const base = `http://127.0.0.1:${port}`;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function call(path, options = {}) {
  const response = await fetch(`${base}${path}`, options);
  const data = await response.json();
  return { response, data };
}

try {
  await wait(180);
  const page = await fetch(`${base}/`).then((response) => response.text());
  if (!page.includes('<div id="app"></div>') || !/src="\/app\.js(?:\?[^\"]*)?"/.test(page)) throw new Error('真实页面入口没有加载前端应用');

  const draft = await call('/api/plan', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: '周六下午到重庆，周日晚上离开，带父母，希望少走路，预算有限。' }) });
  if (!draft.data.trip?.title || !draft.data.sessionId) throw new Error('匿名规划没有返回可保存的草稿');

  const failed = await call('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'wrong@example.com', password: 'wrong' }) });
  if (failed.response.status !== 401 || !failed.data.message.includes('草稿')) throw new Error('错误登录没有明确保留草稿');

  const login = await call('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: PHASE5B_FIXTURE_ADMIN_EMAIL, password: PHASE5B_FIXTURE_ADMIN_PASSWORD }) });
  if (!login.data.token) throw new Error('正确登录没有返回会话令牌');
  const headers = { 'content-type': 'application/json', authorization: `Bearer ${login.data.token}` };
  const saved = await call('/api/trips/save', { method: 'POST', headers, body: JSON.stringify({ trip: draft.data.trip }) });
  const trips = await call('/api/trips', { headers });
  if (!saved.data.ok || trips.data.trips.length !== 1 || trips.data.trips[0].trip.title !== draft.data.trip.title) throw new Error('登录后保存与我的行程读取失败');

  console.log('保存回跳契约通过：匿名草稿 → 登录失败保留 → 登录成功保存 → 我的行程读取');
} finally {
  server.kill();
}
