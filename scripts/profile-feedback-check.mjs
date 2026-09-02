import {
  PHASE5B_FIXTURE_ADMIN_EMAIL,
  PHASE5B_FIXTURE_ADMIN_PASSWORD,
  spawnPhase5bFixtureServer
} from './phase5b-test-fixture.mjs';

const port = 4316;
const server = spawnPhase5bFixtureServer(port);
const base = `http://127.0.0.1:${port}`;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const jsonHeaders = { 'content-type': 'application/json' };
async function call(path, options = {}) {
  const response = await fetch(`${base}${path}`, options);
  const data = await response.json();
  if (!response.ok) throw new Error(`${path}: ${data.message}`);
  return data;
}

try {
  await wait(250);
  const draft = await call('/api/plan', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ prompt: '周末重庆夜景，少走路。' }) });
  const anonymousFeedback = await call('/api/feedback', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ sessionId: draft.sessionId, value: 'helpful', tripVersion: draft.trip.version }) });
  if (anonymousFeedback.scope !== 'session') throw new Error('匿名反馈没有保留在当前 Session');

  const login = await call('/api/auth/login', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ email: PHASE5B_FIXTURE_ADMIN_EMAIL, password: PHASE5B_FIXTURE_ADMIN_PASSWORD }) });
  const authHeaders = { ...jsonHeaders, authorization: `Bearer ${login.token}` };
  await call('/api/preferences', { method: 'POST', headers: authHeaders, body: JSON.stringify({ value: '少走路' }) });
  const plan = await call('/api/plan', { method: 'POST', headers: authHeaders, body: JSON.stringify({ prompt: '周末重庆夜景。' }) });
  const target = plan.trip.days[0].stops.find((stop) => stop.id === 'day1-hongyadong');
  const replanned = await call('/api/replan', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ sessionId: plan.sessionId, targetStopId: target.id, reason: '少走路' }) });
  await call('/api/feedback', { method: 'POST', headers: authHeaders, body: JSON.stringify({ value: 'needs-work', reason: '走路太多', sessionId: plan.sessionId, tripVersion: replanned.trip.version }) });
  await call('/api/feedback', { method: 'POST', headers: authHeaders, body: JSON.stringify({ value: 'letter', reason: '希望第二天下午多安排一个室内景点。', sessionId: plan.sessionId, tripVersion: replanned.trip.version }) });
  const memorySettings = await call('/api/memory-settings', { method: 'PUT', headers: authHeaders, body: JSON.stringify({ enabled: true }) });
  if (memorySettings.memoryEnabled !== true) throw new Error('长期记忆启用状态没有保存');
  await call('/api/memories/observe', { method: 'POST', headers: authHeaders, body: JSON.stringify({ message: '以后出去玩尽量少走路，也少爬坡。', sessionId: plan.sessionId }) });
  const candidateList = await call('/api/memories/candidates', { headers: authHeaders });
  const memoryCandidate = candidateList.candidates?.[0];
  if (memoryCandidate?.category !== 'PACE') throw new Error('后台记忆整理没有生成待确认候选');
  await call(`/api/memories/candidates/${encodeURIComponent(memoryCandidate.id)}/confirm`, { method: 'POST', headers: authHeaders });
  await call('/api/trips/save', { method: 'POST', headers: authHeaders, body: JSON.stringify({ trip: replanned.trip }) });
  const profile = await call('/api/profile', { headers: authHeaders });
  if (!profile.preferences.includes('少走路') || !profile.preferenceHistory.some((item) => item.type === 'EXPLICIT_PREFERENCE')) throw new Error('旅行档案没有返回偏好或偏好历史');
  if (!profile.feedback.some((item) => item.value === 'needs-work')) throw new Error('账户反馈没有进入 Feedback Analytics 数据');
  if (!profile.feedback.some((item) => item.value === 'letter' && item.reason.includes('室内景点'))) throw new Error('写信反馈没有进入账户档案');
  if (profile.memoryEnabled !== true || !profile.memories.some((item) => item.category === 'PACE')) throw new Error('旅行档案没有返回长期记忆启用状态或确认结果');
  if (!profile.feedback.some((item) => item.reason === '走路太多' && item.sourceMode)) throw new Error('反馈没有保留原因或来源模式');
  const overview = await call('/api/admin/overview', { headers: authHeaders });
  if (overview.feedbackSummary?.byReason?.['走路太多'] !== 1 || overview.feedbackSummary?.byVersion?.[String(replanned.trip.version)] !== 2) throw new Error('管理员反馈分析没有按原因/版本聚合');
  if (!profile.trips[0]?.versionHistory?.length || !profile.trips[0].versionHistory.every((item) => item.version && item.label)) throw new Error('Java Formal Trip 没有返回版本历史');
  const removed = await call('/api/preferences/%E5%B0%91%E8%B5%B0%E8%B7%AF', { method: 'DELETE', headers: authHeaders });
  if (removed.preferences.includes('少走路') || !removed.history.some((item) => item.action === 'removed')) throw new Error('偏好移除没有更新当前档案与历史记录');
  console.log('P1 旅行档案验收通过：匿名反馈 → 偏好历史 → 版本历史 → 写信反馈 → 长期记忆开关');
} finally {
  server.kill();
}
