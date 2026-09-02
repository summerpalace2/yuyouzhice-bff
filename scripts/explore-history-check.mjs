import {
  PHASE5B_FIXTURE_ADMIN_EMAIL,
  PHASE5B_FIXTURE_ADMIN_PASSWORD,
  spawnPhase5bFixtureServer
} from './phase5b-test-fixture.mjs';

const port = 4318;
const server = spawnPhase5bFixtureServer(port);
const base = `http://127.0.0.1:${port}`;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const jsonHeaders = { 'content-type': 'application/json' };

async function call(path, options = {}) {
  const response = await fetch(`${base}${path}`, options);
  const data = await response.json();
  return { response, data };
}

try {
  await wait(250);
  const explore = await call('/api/explore?category=夜景');
  if (!explore.data.items.length || explore.data.items.some((item) => item.category !== '夜景')) throw new Error('Explore 分类筛选失败');
  const search = await call('/api/explore?q=室内');
  if (!search.data.items.some((item) => item.id === 'cq-museum')) throw new Error('Explore 关键词筛选失败');
  const anonymousHistory = await call('/api/history');
  if (anonymousHistory.response.status !== 401) throw new Error('匿名访问历史会话没有被拦截');

  const login = await call('/api/auth/login', {
    method: 'POST', headers: jsonHeaders,
    body: JSON.stringify({ email: PHASE5B_FIXTURE_ADMIN_EMAIL, password: PHASE5B_FIXTURE_ADMIN_PASSWORD })
  });
  const authHeaders = { ...jsonHeaders, authorization: `Bearer ${login.data.token}` };
  const plan = await call('/api/plan', {
    method: 'POST', headers: authHeaders,
    body: JSON.stringify({ prompt: '周末重庆夜景，少走路。' })
  });
  const unsavedHistory = await call('/api/history', { headers: authHeaders });
  if (unsavedHistory.data.sessions.length !== 0) throw new Error('Shadow 草稿被写入了 Node 或正式历史');

  const saved = await call('/api/trips/save', {
    method: 'POST', headers: authHeaders,
    body: JSON.stringify({ trip: plan.data.trip })
  });
  const savedTripId = saved.data.saved?.id;
  if (!savedTripId) throw new Error('Java Formal Trip 保存失败');

  const history = await call('/api/history', { headers: authHeaders });
  if (
    history.data.sync?.authority !== 'JAVA_FORMAL_TRIPS'
    || !history.data.sessions.some((item) => item.id === savedTripId)
  ) {
    throw new Error('历史没有投影 Java Formal Trip');
  }

  const restored = await call(`/api/history/${encodeURIComponent(savedTripId)}`, { headers: authHeaders });
  if (!restored.data.session?.id || restored.data.session.id === savedTripId || restored.data.savedTripId !== savedTripId) {
    throw new Error('Java Formal Trip 没有恢复为临时 Shadow 会话');
  }
  const target = restored.data.session.trip.days[0].stops.find((stop) => stop.id === 'day1-hongyadong');
  const replanned = await call('/api/replan', {
    method: 'POST', headers: authHeaders,
    body: JSON.stringify({ sessionId: restored.data.session.id, targetStopId: target.id, reason: '少走路' })
  });
  if (replanned.data.shadow?.java?.succeeded !== true) throw new Error('恢复后重规划没有使用 Java Shadow 候选');

  const updated = await call('/api/trips/save', {
    method: 'POST', headers: authHeaders,
    body: JSON.stringify({ trip: replanned.data.trip, savedTripId })
  });
  if (updated.data.isUpdate !== true || updated.data.saved?.id !== savedTripId) {
    throw new Error('恢复后保存没有更新原 Java Formal Trip');
  }
  console.log('Explore 与正式行程历史验收通过：分类/搜索 → Shadow 不持久化 → Java 保存 → 恢复临时会话 → Java 更新');
} finally {
  server.kill();
}
