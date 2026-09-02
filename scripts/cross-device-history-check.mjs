import {
  PHASE5B_FIXTURE_ADMIN_EMAIL,
  PHASE5B_FIXTURE_ADMIN_PASSWORD,
  spawnPhase5bFixtureServer
} from './phase5b-test-fixture.mjs';

const portA = 4323;
const portB = 4324;
const baseA = `http://127.0.0.1:${portA}`;
const baseB = `http://127.0.0.1:${portB}`;
const jsonHeaders = { 'content-type': 'application/json' };
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function call(base, pathName, options = {}) {
  const response = await fetch(`${base}${pathName}`, options);
  const data = await response.json();
  if (!response.ok) throw new Error(`${pathName}: ${data.message || response.status}`);
  return data;
}

let serverA;
let serverB;
try {
  serverA = spawnPhase5bFixtureServer(portA);
  await wait(220);
  const loginA = await call(baseA, '/api/auth/login', {
    method: 'POST', headers: jsonHeaders,
    body: JSON.stringify({ email: PHASE5B_FIXTURE_ADMIN_EMAIL, password: PHASE5B_FIXTURE_ADMIN_PASSWORD })
  });
  const headersA = {
    ...jsonHeaders,
    authorization: `Bearer ${loginA.token}`,
    'x-yuyouzhice-device': 'device-a'
  };
  const plan = await call(baseA, '/api/plan', {
    method: 'POST', headers: headersA,
    body: JSON.stringify({ prompt: '重庆周末旅行，少走路。' })
  });
  const historyA = await call(baseA, '/api/history', { headers: headersA });
  if (historyA.sessions.length !== 0 || historyA.sync.authority !== 'JAVA_FORMAL_TRIPS') {
    throw new Error('设备 A 将未保存的 Shadow 草稿写入了跨设备历史');
  }

  serverA.kill();
  serverA = null;
  serverB = spawnPhase5bFixtureServer(portB);
  await wait(220);
  const loginB = await call(baseB, '/api/auth/login', {
    method: 'POST', headers: jsonHeaders,
    body: JSON.stringify({ email: PHASE5B_FIXTURE_ADMIN_EMAIL, password: PHASE5B_FIXTURE_ADMIN_PASSWORD })
  });
  const headersB = {
    ...jsonHeaders,
    authorization: `Bearer ${loginB.token}`,
    'x-yuyouzhice-device': 'device-b'
  };
  const historyB = await call(baseB, '/api/history', { headers: headersB });
  if (historyB.sessions.length !== 0 || historyB.sync.authority !== 'JAVA_FORMAL_TRIPS') {
    throw new Error('设备 B 读取到了 Node 持久化的 Shadow 草稿');
  }

  const replanResponse = await fetch(`${baseB}/api/replan`, {
    method: 'POST', headers: headersB,
    body: JSON.stringify({
      sessionId: plan.sessionId,
      targetStopId: 'day1-hongyadong',
      reason: '少走路'
    })
  });
  if (replanResponse.status !== 404) {
    throw new Error('设备 B 意外恢复了设备 A 的临时 Shadow 会话');
  }
  console.log('跨设备 Shadow 会话边界验收通过：未保存草稿不写入 Node 历史，进程/设备切换后不能恢复。');
} finally {
  serverA?.kill();
  serverB?.kill();
}
