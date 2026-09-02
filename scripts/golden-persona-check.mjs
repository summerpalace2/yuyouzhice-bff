import { spawn } from 'node:child_process';

const port = 4313;
const server = spawn(process.execPath, ['server/index.mjs'], { env: { ...process.env, YUYOUZHICE_MEMORY: '1', YUYOUZHICE_JAVA_TEST_STUB: '1', PORT: String(port) }, stdio: 'ignore' });
const base = `http://127.0.0.1:${port}`;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function call(path, options = {}) {
  const response = await fetch(`${base}${path}`, options);
  const data = await response.json();
  if (!response.ok) throw new Error(`${path}: ${data.message}`);
  return data;
}

try {
  // 服务启动时间受机器负载影响，专项验收需要等到真实 HTTP 监听完成再开始请求。
  await wait(500);
  const plan = await call('/api/plan', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: '周六下午到重庆，周日晚上离开，带父母，希望少走路，预算有限，喜欢城市、人文和夜景。' })
  });
  const constraints = plan.trip?.constraints;
  if (!constraints || constraints.companions !== '带父母' || !['少走路', 'LOW'].includes(constraints.walkingTolerance)) throw new Error('Java candidate 没有返回同行/步行 typed 约束');
  if (!constraints.rawPrompt?.includes('周六下午') || !constraints.rawPrompt?.includes('周日晚上')) throw new Error('Java candidate 没有保留原始规划输入');
  const requiredStopFields = ['stableStopId', 'entityId', 'walkingInfo', 'facts', 'citations', 'mapContext'];
  for (const field of requiredStopFields) if (plan.trip.days[0].stops.some((stop) => stop[field] === undefined)) throw new Error(`Java candidate Stop 缺少字段：${field}`);
  if (!plan.trip.days?.length || plan.trip.days.some((day) => !day.date)) throw new Error('Java candidate TripPlan 缺少日期字段');

  const originalStops = plan.trip.days.flatMap((day) => day.stops);
  const target = originalStops.find((stop) => stop.id === 'day1-hongyadong');
  const replan = await call('/api/replan', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: plan.sessionId, targetStopId: target.id, reason: '少走路' })
  });
  const updatedStops = replan.trip.days.flatMap((day) => day.stops);
  const replacement = updatedStops.find((stop) => stop.id === target.id);
  if (replacement.name !== '重庆大剧院江岸夜景' || replacement.time !== target.time) throw new Error('少走路没有生成匹配原因的局部替换');
  const unchanged = updatedStops.filter((stop) => stop.id !== target.id);
  if (unchanged.length !== originalStops.length - 1 || unchanged.some((stop) => originalStops.find((before) => before.id === stop.id)?.name !== stop.name)) throw new Error('局部重规划修改了目标站点之外的内容');
  console.log('Golden Persona 验收通过：结构化约束 → 匹配原因替换 → 其余站点保持不变');
} finally {
  server.kill();
}
