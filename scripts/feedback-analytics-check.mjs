import {
  PHASE5B_FIXTURE_ADMIN_EMAIL,
  PHASE5B_FIXTURE_ADMIN_PASSWORD,
  spawnPhase5bFixtureServer
} from './phase5b-test-fixture.mjs';

const port = 4322;
const server = spawnPhase5bFixtureServer(port);
const base = `http://127.0.0.1:${port}`;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const headers = { 'content-type': 'application/json' };
async function call(path, options = {}) { const response = await fetch(`${base}${path}`, options); const data = await response.json(); if (!response.ok) throw new Error(`${path}: ${data.message}`); return data; }

try {
  await wait(250);
  const draft = await call('/api/plan', { method: 'POST', headers, body: JSON.stringify({ prompt: '重庆周末夜景，少走路。' }) });
  const anonymous = await call('/api/feedback', { method: 'POST', headers, body: JSON.stringify({ sessionId: draft.sessionId, value: 'needs-work', reason: '走路太多', tripVersion: draft.trip.version }) });
  if (anonymous.scope !== 'session' || anonymous.feedback[0].reason !== '走路太多' || !anonymous.feedback[0].sourceMode) throw new Error('匿名反馈没有保留分析维度');
  const login = await call('/api/auth/login', { method: 'POST', headers, body: JSON.stringify({ email: PHASE5B_FIXTURE_ADMIN_EMAIL, password: PHASE5B_FIXTURE_ADMIN_PASSWORD }) });
  const authHeaders = { ...headers, authorization: `Bearer ${login.token}` };
  const accountFeedback = await call('/api/feedback', { method: 'POST', headers: authHeaders, body: JSON.stringify({ value: 'helpful', reason: '整体合适', sessionId: draft.sessionId, tripVersion: draft.trip.version }) });
  if (accountFeedback.scope !== 'account' || !accountFeedback.feedback.some((item) => item.reason === '整体合适')) throw new Error('登录反馈没有持久化');
  await call('/api/feedback', { method: 'POST', headers: authHeaders, body: JSON.stringify({ value: 'letter', reason: '希望晚间行程更从容。', sessionId: draft.sessionId, tripVersion: draft.trip.version }) });
  const overview = await call('/api/admin/overview', { headers: authHeaders });
  const summary = overview.feedbackSummary;
  if (summary.total !== 2 || summary.helpful !== 1 || summary.letters !== 1 || summary.needsWork !== 0 || summary.byReason['整体合适'] !== 1 || summary.byReason['希望晚间行程更从容。'] !== 1 || summary.byVersion[String(draft.trip.version)] !== 2) throw new Error(`反馈聚合不正确：${JSON.stringify(summary)}`);
  const modalSource = await fetch(`${base}/src/widgets/modals/modal-container.js`).then((response) => response.text());
  if (!modalSource.includes('给渝游智策的一封信') || !modalSource.includes('feedback-submit') || !modalSource.includes('快速填充')) throw new Error('写信反馈 UI 入口缺失');
  console.log('Feedback Analytics 验收通过：来信 → 版本 → 来源 → 管理员聚合');
} finally {
  server.kill();
}
