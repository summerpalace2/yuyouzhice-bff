import { spawn } from 'node:child_process';
import { createServer } from 'node:net';

// This integration check exercises the Java-owned provider boundary. Node must
// not require or forward an AMap Web Service key itself.
const javaBase = String(process.env.CORE_BACKEND_URL || process.env.YUYOUZHICE_JAVA_CORE_URL || 'http://127.0.0.1:8080').replace(/\/$/, '');
const port = await new Promise((resolve, reject) => {
  const probe = createServer();
  probe.once('error', reject);
  probe.listen(0, '127.0.0.1', () => {
    const selectedPort = probe.address().port;
    probe.close(() => resolve(selectedPort));
  });
});

const server = spawn(process.execPath, ['server/index.mjs'], {
  env: {
    ...process.env,
    YUYOUZHICE_MEMORY: '1',
    PORT: String(port),
    CORE_BACKEND_URL: javaBase,
    AMAP_WEB_SERVICE_KEY: '',
    AMAP_WEB_JS_KEY: '',
    AMAP_WEB_JS_SECURITY_CODE: '',
    AMAP_KEY: '',
    AMAP_JS_KEY: '',
    AMAP_JS_SECURITY_KEY: ''
  },
  stdio: ['ignore', 'pipe', 'pipe']
});
const base = `http://127.0.0.1:${port}`;
const ready = new Promise((resolve, reject) => {
  server.once('error', reject);
  server.stderr?.on('data', (chunk) => process.stderr.write(chunk));
  server.stdout?.on('data', (chunk) => { if (chunk.toString().includes('已启动')) resolve(); });
});
async function call(path, options) {
  const response = await fetch(`${base}${path}`, options);
  const data = await response.json();
  if (!response.ok) throw new Error(`${path}: ${data.message || '请求失败'}`);
  return data;
}

try {
  await Promise.race([ready, new Promise((_, reject) => setTimeout(() => reject(new Error('测试服务启动超时')), 5000))]);
  const health = await call('/api/health');
  if (health.adapter.provider !== 'Java Core Backend AMap boundary') throw new Error('Web BFF 未声明 Java-owned AMap boundary');
  if (health.adapter.keyConfigured !== false) throw new Error('Node health 不应声明或读取 AMap Web Service Key');

  const plan = await call('/api/plan', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: '周六下午到重庆，周日晚上离开，带父母，希望少走路，预算有限，喜欢城市、人文和夜景。' })
  });
  const status = plan.trip?.sourceStatus || {};
  const stops = plan.trip?.days?.flatMap((day) => day.stops || []) || [];
  if (!status || typeof status !== 'object') throw new Error('Java candidate 没有返回 sourceStatus');
  if (!('fallback' in status) || !('poiResolved' in status) || !('routeResolved' in status)) {
    throw new Error(`Java candidate 缺少 AMap provider 状态：${JSON.stringify(status)}`);
  }
  if (!stops.length || !stops.every((stop) => stop.mapContext && Array.isArray(stop.mapContext.polyline))) {
    throw new Error('Java candidate 没有返回完整 MapContext');
  }
  const dynamic = !status.fallback;
  if (dynamic && (!stops.some((stop) => stop.amapPoiId && stop.location) || !stops.some((stop) => stop.routeFromPrevious && stop.routeFromPrevious.fallback === false))) {
    throw new Error(`Java-owned 动态 POI/路线字段不完整：${JSON.stringify(status)}`);
  }

  const detail = await call('/api/attractions/cq-hongyadong');
  const detailCitation = detail.detail?.citations?.find((item) => String(item.publisher || '').includes('Java Core Backend'));
  if (!detailCitation) throw new Error('景点详情没有声明 Java Core Backend source boundary');

  const replan = await call('/api/replan', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: plan.sessionId, targetStopId: 'day1-hongyadong', reason: '少走路' })
  });
  if (!replan.trip?.sourceStatus || !replan.trip?.days?.length) throw new Error('Java-owned 局部重规划没有返回 sourceStatus/TripPlan');
  console.log(JSON.stringify({ ok: true, provider: health.adapter.provider, sourceMode: plan.trip.sourceMode, dynamic, poiResolved: status.poiResolved, routeResolved: status.routeResolved }));
} finally {
  if (!server.killed) server.kill();
}
