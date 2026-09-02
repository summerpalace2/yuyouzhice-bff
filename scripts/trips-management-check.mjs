import {
  PHASE5B_FIXTURE_ADMIN_EMAIL,
  PHASE5B_FIXTURE_ADMIN_PASSWORD,
  spawnPhase5bFixtureServer
} from './phase5b-test-fixture.mjs';

const port = 4315;
const server = spawnPhase5bFixtureServer(port);
const base = `http://127.0.0.1:${port}`;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function call(path, options = {}) {
  const response = await fetch(`${base}${path}`, options);
  const data = response.headers.get('content-type')?.includes('application/json') ? await response.json() : null;
  return { response, data };
}

try {
  await wait(180);
  const login = await call('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: PHASE5B_FIXTURE_ADMIN_EMAIL, password: PHASE5B_FIXTURE_ADMIN_PASSWORD }) });
  if (!login.data?.token) throw new Error('登录没有返回会话令牌');
  const headers = { 'content-type': 'application/json', authorization: `Bearer ${login.data.token}` };
  const firstPlan = await call('/api/plan', { method: 'POST', headers, body: JSON.stringify({ prompt: '周六下午到重庆，周日晚上离开，带父母，希望少走路。' }) });
  const secondPlan = await call('/api/plan', { method: 'POST', headers, body: JSON.stringify({ prompt: '周一到重庆，周二离开，喜欢博物馆和夜景。' }) });
  const firstSaved = await call('/api/trips/save', { method: 'POST', headers, body: JSON.stringify({ trip: firstPlan.data.trip }) });
  const secondSaved = await call('/api/trips/save', { method: 'POST', headers, body: JSON.stringify({ trip: secondPlan.data.trip }) });
  const firstId = firstSaved.data.saved.id;
  const secondId = secondSaved.data.saved.id;

  const pdfResponse = await fetch(`${base}/api/trips/${firstId}/pdf`, { headers: { authorization: `Bearer ${login.data.token}` } });
  const pdf = Buffer.from(await pdfResponse.arrayBuffer());
  if (pdfResponse.status !== 200 || !pdfResponse.headers.get('content-type')?.includes('application/pdf') || pdf.subarray(0, 8).toString() !== '%PDF-1.4') throw new Error('PDF 导出不是有效的 PDF 响应');
  const disposition = pdfResponse.headers.get('content-disposition') || '';
  if (!disposition.includes("filename*=UTF-8''") || disposition.includes(firstId)) throw new Error('PDF 下载文件名没有使用行程标题');
  if (!pdf.includes(Buffer.from('/STSong-Light')) || !pdf.includes(Buffer.from('6e1d6e38'))) throw new Error('PDF 没有返回中文 TripPlan 内容流');

  const deleted = await call(`/api/trips/${firstId}`, { method: 'DELETE', headers });
  const remaining = await call('/api/trips', { headers });
  if (!deleted.data?.ok || remaining.data.trips.length !== 1 || remaining.data.trips[0].id !== secondId) throw new Error('删除没有只影响目标行程');
  const unauthenticated = await call(`/api/trips/${secondId}`, { method: 'DELETE' });
  if (unauthenticated.response.status !== 401) throw new Error('未登录删除没有被拦截');
  console.log('我的行程管理验收通过：真实保存 → 有效 PDF → 删除目标记录且保留其它记录');
} finally {
  server.kill();
}
