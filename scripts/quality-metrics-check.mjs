import {
  PHASE5B_FIXTURE_ADMIN_EMAIL,
  PHASE5B_FIXTURE_ADMIN_PASSWORD,
  spawnPhase5bFixtureServer
} from './phase5b-test-fixture.mjs';

const port = 4321;
const server = spawnPhase5bFixtureServer(port);
const base = `http://127.0.0.1:${port}`;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function plan(prompt, constraints) {
  const response = await fetch(`${base}/api/plan`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt, constraints }) });
  return response.json();
}

try {
  await wait(250);
  const complete = await plan('周六下午到重庆，周日晚上离开，带父母，希望少走路，预算有限，喜欢城市、人文和夜景。');
  const quality = complete.trip?.qualityMetrics;
  const sourceStatus = complete.trip?.sourceStatus;
  if (!quality?.constraintSatisfaction || typeof quality.constraintSatisfaction.score !== 'number') throw new Error(`Java candidate 缺少约束质量指标：${JSON.stringify(quality?.constraintSatisfaction)}`);
  if (typeof quality.citationCoverage !== 'number' || typeof quality.dataCoverage?.overall !== 'number') throw new Error('Java candidate 缺少 Citation/Data Coverage 指标');
  if (typeof quality.unknownFactCount !== 'number' || sourceStatus?.provider !== 'Java Core Backend test stub') throw new Error('质量指标没有明确由 Java candidate 提供');

  const partial = await plan('周末重庆旅行，预算有限，喜欢夜景。', { durationDays: 9 });
  if (!partial.trip?.qualityMetrics || partial.trip.sourceStatus?.provider !== 'Java Core Backend test stub') throw new Error('第二个 Java candidate 没有返回原生质量/来源指标');

  const login = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: PHASE5B_FIXTURE_ADMIN_EMAIL, password: PHASE5B_FIXTURE_ADMIN_PASSWORD }) }).then((response) => response.json());
  const admin = await fetch(`${base}/api/admin/overview`, { headers: { authorization: `Bearer ${login.token}` } }).then((response) => response.json());
  if (!admin.ok || !admin.qualityMetrics || admin.qualityMetrics.available !== false || admin.qualityMetrics.avgConstraintSatisfaction !== null) throw new Error('管理员概览不应伪造 Node 质量指标汇总');
  const app = await fetch(`${base}/app.js`).then((response) => response.text());
  if (!app.includes('约束满足') || !app.includes('实时数据覆盖') || !app.includes('未知事实')) throw new Error('前端没有展示质量指标');
  console.log(`Java-owned 质量指标验收通过：约束得分 ${quality.constraintSatisfaction.score}，未知事实 ${quality.unknownFactCount}，实时覆盖 ${Math.round(quality.dataCoverage.overall * 100)}%`);
} finally {
  server.kill();
}
