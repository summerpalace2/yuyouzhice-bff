import { spawnPhase5bFixtureServer } from './phase5b-test-fixture.mjs';

const port = 4311;
const server = spawnPhase5bFixtureServer(port);
const base = `http://127.0.0.1:${port}`;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function get(path, options) { const response = await fetch(`${base}${path}`, options); const data = await response.json(); if (!response.ok) throw new Error(`${path}: ${data.message}`); return data; }
try {
  await wait(180);
  const home = await fetch(`${base}/`); if (!home.ok) throw new Error('首页不可访问');
  const plan = await get('/api/plan', { method: 'POST', headers: { 'content-type': 'application/json', origin: `http://127.0.0.1:${port}` }, body: JSON.stringify({ prompt: '两人周末重庆旅行，少走路，想拍照和吃本地菜。' }) });
  if (!plan.trip?.days?.length || !plan.sessionId) throw new Error('规划结果缺少行程结构');
  const replan = await get('/api/replan', { method: 'POST', headers: { 'content-type': 'application/json', origin: `http://127.0.0.1:${port}` }, body: JSON.stringify({ sessionId: plan.sessionId, targetStopId: 'day1-hongyadong', reason: '少走路' }) });
  if (replan.changedSegments.length !== 1 || replan.unchangedStops.length < 1 || replan.shadow?.java?.succeeded !== true) throw new Error('Java Shadow 局部重规划边界不正确');
  const detail = await get('/api/attractions/cq-museum');
  if (!detail.detail?.image || !detail.detail?.actions?.canAdd) throw new Error('景点详情缺少图片或行程操作能力');
  const added = await get('/api/trip/stops', { method: 'POST', headers: { 'content-type': 'application/json', origin: `http://127.0.0.1:${port}` }, body: JSON.stringify({ sessionId: plan.sessionId, attractionId: 'cq-museum', day: 1, operation: 'add' }) });
  if (added.operation !== 'add' || !added.trip.days[0].stops.some((stop) => stop.venueId === 'cq-museum' && stop.id.includes('added'))) throw new Error('景点详情加入行程失败');
  console.log('端到端主链通过：匿名规划 → 局部重规划 → 其余站点保持不变');
} finally { server.kill(); }
