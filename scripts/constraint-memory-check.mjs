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
  if (!response.ok) throw new Error(`${path}: ${data.message}`);
  return data;
}
const jsonHeaders = { 'content-type': 'application/json' };

try {
  await wait(500);
  const edited = await call('/api/plan', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ prompt: '重庆旅行', constraints: { companions: '带父母', walkingTolerance: '低', budget: '普通', interests: ['城市', '室内'] } }) });
  if (edited.trip.constraints.budget !== '普通' || !edited.trip.constraints.interests.includes('室内')) throw new Error('Constraint Review 修改没有进入下一次规划');

  const login = await call('/api/auth/login', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ email: PHASE5B_FIXTURE_ADMIN_EMAIL, password: PHASE5B_FIXTURE_ADMIN_PASSWORD }) });
  const authHeaders = { ...jsonHeaders, authorization: `Bearer ${login.token}` };
  await call('/api/preferences', { method: 'POST', headers: authHeaders, body: JSON.stringify({ value: '少走路' }) });
  const proposed = await call('/api/plan', { method: 'POST', headers: authHeaders, body: JSON.stringify({ prompt: '周末重庆人文游' }) });
  if (proposed.preferenceProposal !== null || proposed.appliedPreferences.length) throw new Error('usePreferences=false 时不应读取 Java formal Preferences');

  const reused = await call('/api/plan', { method: 'POST', headers: authHeaders, body: JSON.stringify({ prompt: '周末重庆人文游', usePreferences: true, preferenceDecision: 'use' }) });
  if (!reused.appliedPreferences.includes('少走路') || reused.trip.constraints.walkingTolerance !== 'LOW') throw new Error('沿用偏好没有进入 Java typed 规划约束');

  const ignored = await call('/api/plan', { method: 'POST', headers: authHeaders, body: JSON.stringify({ prompt: '周末重庆人文游', usePreferences: false, preferenceDecision: 'ignore' }) });
  if (ignored.appliedPreferences.length || ignored.trip.constraints.walkingTolerance === '低') throw new Error('忽略偏好仍然污染了本次规划约束');
  console.log('Constraint Review 与偏好复用验收通过：编辑生效 → 提案出现 → 沿用/忽略分支隔离');
} finally {
  server.kill();
}
