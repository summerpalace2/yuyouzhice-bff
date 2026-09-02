import { spawn } from 'node:child_process';

const port = 4325;
// 该契约测试固定覆盖“无 JS Key”回退分支；服务端 Web Service Key 不受影响。
const server = spawn(process.execPath, ['server/index.mjs'], {
  env: {
    ...process.env,
    YUYOUZHICE_MEMORY: '1',
    YUYOUZHICE_JAVA_TEST_STUB: '1',
    PORT: String(port),
    AMAP_JS_KEY: '',
    AMAP_JS_SECURITY_KEY: '',
    AMAP_WEB_JS_KEY: '',
    AMAP_WEB_JS_SECURITY_CODE: ''
  },
  stdio: 'ignore'
});
const base = `http://127.0.0.1:${port}`;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function json(path, options) { const response = await fetch(`${base}${path}`, options); const data = await response.json(); if (!response.ok) throw new Error(`${path}: ${data.message}`); return data; }

try {
  await wait(500);
  const config = await json('/api/map-config');
  if (config.map.keyConfigured || config.map.mode !== '路线数据模式') throw new Error('无 JS Key 时地图回退状态不正确');
  const health = await json('/api/health');
  if (health.map.key !== null || health.map.securityJsCode !== null) throw new Error('健康接口泄露了浏览器地图凭据');
  const plan = await json('/api/plan', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: '周末重庆夜景，少走路。' }) });
  const stops = plan.trip.days.flatMap((day) => day.stops);
  if (!stops.every((stop) => stop.mapContext && Array.isArray(stop.mapContext.polyline))) throw new Error('TripPlan 没有完整 MapContext');
  const app = await fetch(`${base}/app.js`).then((response) => response.text());
  if (!app.includes('id="trip-map"') || !app.includes('loadAmapSdk') || !app.includes('new AMap.Polyline') || !app.includes('路线数据模式')) throw new Error('前端地图渲染器或回退文案缺失');
  if (app.includes('process.env.AMAP_KEY') || app.includes('AMAP_KEY=')) throw new Error('前端疑似混入服务端 Web 服务 Key');
  console.log('地图渲染验收通过：MapContext → 无 JS Key 回退 → AMap Marker/Polyline 渲染器契约');
} finally {
  server.kill();
}
