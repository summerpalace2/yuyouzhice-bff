import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  PHASE5B_FIXTURE_ADMIN_EMAIL,
  PHASE5B_FIXTURE_ADMIN_PASSWORD,
  PHASE5B_FIXTURE_TRAVELER_PASSWORD,
  spawnPhase5bFixtureServer
} from './phase5b-test-fixture.mjs';

const port = 4313;
const server = spawnPhase5bFixtureServer(port);
const base = `http://127.0.0.1:${port}`;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitForServer() {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${base}/api/health`);
      if (response.ok) return;
    } catch { }
    await wait(80);
  }
  throw new Error('Admin Console 测试桩启动超时');
}

async function call(requestPath, options = {}) {
  const response = await fetch(`${base}${requestPath}`, options);
  const data = await response.json();
  return { response, data };
}

try {
  const appSource = readFileSync(path.join(process.cwd(), 'app', 'app.js'), 'utf8');
  const adminPageSource = readFileSync(path.join(process.cwd(), 'app', 'src', 'pages', 'admin-page.js'), 'utf8');
  const navigationSource = readFileSync(path.join(process.cwd(), 'app', 'src', 'app-core', 'navigation-handler.js'), 'utf8');
  const adminActionSource = readFileSync(path.join(process.cwd(), 'app', 'src', 'features', 'admin-corpus', 'admin-action-handler.js'), 'utf8');
  const modalSource = readFileSync(path.join(process.cwd(), 'app', 'src', 'widgets', 'modals', 'modal-container.js'), 'utf8');
  const frontendSource = `${appSource}\n${adminPageSource}\n${navigationSource}`;
  for (const marker of ['用户管理 · 只读', 'Knowledge Registry', 'enter-planner-test']) {
    if (!frontendSource.includes(marker)) throw new Error(`Admin Console 前端缺少管理面板：${marker}`);
  }
  if (!adminPageSource.includes('ACCOUNT DIRECTORY') || !adminPageSource.includes('data-admin-user-list')) {
    throw new Error('账号目录未使用可局部更新的全宽列表结构');
  }
  if (adminPageSource.includes('来源登记表')) {
    throw new Error('来源登记表不应出现在账号管理区');
  }
  const deleteActionSource = adminActionSource.split("if (action === 'delete-user')")[1]?.split("if (action === 'cancel-user-action')")[0] || '';
  if (!deleteActionSource.includes('removeUserRow') || deleteActionSource.includes('loadAdminHealth')) {
    throw new Error('账号停用未使用局部乐观更新，或成功后仍触发全量管理刷新');
  }
  if (!appSource.includes("doHealth({ renderAfterLoad: false })")) {
    throw new Error('管理员登录后的后台健康检查仍会重绘当前规划工作区');
  }
  if (!modalSource.includes('adminOverlays()')) {
    throw new Error('管理员详情弹窗未挂载到独立 modal 层');
  }
  await waitForServer();
  const anonymous = await call('/api/admin/overview');
  if (anonymous.response.status !== 401) throw new Error('未登录管理员接口没有返回 401');
  const anonymousCacheStats = await call('/api/admin/rerank/stats');
  if (anonymousCacheStats.response.status !== 401) throw new Error('未登录 Rerank 管理接口没有返回 401');

  const traveler = await call('/api/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'admin-check-traveler@example.com', password: PHASE5B_FIXTURE_TRAVELER_PASSWORD, name: '验收游客' })
  });
  const travelerOverview = await call('/api/admin/overview', { headers: { authorization: `Bearer ${traveler.data.token}` } });
  if (travelerOverview.response.status !== 403) throw new Error('普通游客可以访问管理员接口');

  const login = await call('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: PHASE5B_FIXTURE_ADMIN_EMAIL, password: PHASE5B_FIXTURE_ADMIN_PASSWORD })
  });
  if (!login.data.ok || login.data.user?.role !== 'admin') throw new Error('测试 fixture 管理员登录失败');
  const adminPlan = await call('/api/plan', {
    method: 'POST',
    headers: { authorization: `Bearer ${login.data.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: '管理员规划测试：周末重庆旅行，少走路，多安排室内景点。' })
  });
  if (adminPlan.response.status !== 200 || !adminPlan.data.ok || !adminPlan.data.javaSessionId || adminPlan.data.legacyMode) {
    throw new Error(`管理员无法创建 Java Planner 会话：${JSON.stringify({ status: adminPlan.response.status, code: adminPlan.data.code, message: adminPlan.data.message })}`);
  }
  const overview = await call('/api/admin/overview', { headers: { authorization: `Bearer ${login.data.token}` } });
  if (overview.response.status !== 200 || !overview.data.ok) throw new Error('管理员概览接口失败');

  const users = overview.data.users || [];
  const sensitiveKeys = users.flatMap((user) => Object.keys(user)).filter((key) => /password|salt|token|secret|hash/i.test(key));
  if (sensitiveKeys.length) throw new Error(`用户目录泄露敏感字段：${sensitiveKeys.join(', ')}`);
  const knowledge = overview.data.knowledge || {};
  if (knowledge.embedding?.provider !== 'Java EmbeddingModel') throw new Error('管理员概览未报告 Java Embedding owner');
  if (knowledge.vectorStore?.provider !== 'Java-managed Qdrant' || knowledge.vectorStore?.directFromNode !== false) throw new Error('管理员概览未报告 Java Qdrant owner');
  if (!Array.isArray(knowledge.sourceRegister)) throw new Error('Java 知识来源登记返回格式错误');
  if (overview.data.retrieval?.provider !== 'Java Core Backend') throw new Error('管理员概览 retrieval provider 不是 Java');
  const attractions = overview.data.attractions || {};
  if (attractions.available !== true || attractions.total < 1 || !Array.isArray(attractions.items)) throw new Error('管理员概览未接入 Java 景点项目目录');
  if (attractions.content?.fieldTotal < 1 || typeof attractions.content?.coverage !== 'number') throw new Error('管理员概览未返回景点结构化内容覆盖率');
  const cacheStats = await call('/api/admin/rerank/stats', { headers: { authorization: `Bearer ${login.data.token}` } });
  if (cacheStats.response.status !== 200 || !cacheStats.data.ok) throw new Error('管理员 Rerank 统计接口失败');
  const cacheClear = await call('/api/admin/rerank/cache/clear', {
    method: 'POST',
    headers: { authorization: `Bearer ${login.data.token}`, 'content-type': 'application/json' },
    body: '{}'
  });
  if (cacheClear.response.status !== 200 || !cacheClear.data.ok) throw new Error('管理员 Rerank 缓存清理接口失败');
  console.log(`Admin Console 验收通过：脱敏用户 ${users.length}，Java Embedding/Qdrant/knowledge boundary 已报告`);
} finally {
  server.kill();
}
