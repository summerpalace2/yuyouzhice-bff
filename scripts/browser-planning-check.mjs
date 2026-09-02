import { spawnPhase5bFixtureServer } from './phase5b-test-fixture.mjs';

const port = 4315;
const server = spawnPhase5bFixtureServer(port);
const base = `http://127.0.0.1:${port}`;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
try {
  await wait(500);
  const home = await fetch(`${base}/`).then((response) => response.text());
  if (!home.includes('渝游智策') || !home.includes('重庆') || !home.includes('app.js?v=')) throw new Error('首页静态入口缺少产品语义或前端资源版本标记');
  // 规划代码已按职责拆分，静态边界检查也必须读取真实模块集合，不能反向要求
  // 所有行为重新塞回 app.js。
  const frontendSources = await Promise.all([
    '/app.js',
    '/src/app-core/router.js',
    '/src/pages/plan-page.js',
    '/src/features/trip-planning/slots-form.js',
    '/src/features/trip-planning/planner-service.js',
    '/src/features/trip-replan/replan-service.js',
    '/src/features/explore-search/explore-service.js',
    '/src/shared/lib/amap.js',
    '/src/widgets/trip-map/map-renderer.js',
    '/src/shared/ui/loader.js',
    '/src/features/trip-chat/chat-service.js'
  ].map((path) => fetch(`${base}${path}`).then((response) => response.text())));
  const app = frontendSources.join('\n');
  if (!app.includes('function fact(') || !app.includes('edit-constraints') || !app.includes('name="stayArea"') || !app.includes('name="transportPreference"') || !app.includes('name="dietPreference"') || !app.includes('理解旅行条件') || !app.includes('检索可信信息') || !app.includes('组合路线') || !app.includes('生成方案')) throw new Error('前端事实 helper、完整 Slots 编辑字段或规划阶段加载缺失');
  if (!app.includes('detail: detailView') || !app.includes('function scheduleTripMap') || !app.includes('let toastTimer = null') || app.includes("state.toast = ''; if (!state.loginOpen")) throw new Error('前端视图映射、地图调度或稳定渲染契约缺失');
  const forbiddenBrowserMarkers = [
    'ATTRACTIONS_LIST',
    'getReplanCandidate',
    'candidateVenueId',
    'Qdrant',
    'DashScope',
    'Bearer',
    ':8080'
  ];
  const leakedMarker = forbiddenBrowserMarkers.find((marker) => app.includes(marker));
  if (leakedMarker) throw new Error(`浏览器仍包含共享业务或直连后端标记：${leakedMarker}`);
  if (!app.includes("request('/api/plan'") || !app.includes("request('/api/replan'") || !app.includes("request(`/api/explore?") || !app.includes('loadAmapSdk') || !app.includes('new AMap.Polyline')) throw new Error('浏览器 BFF 规划/重规划/探索或地图展示边界缺失');
  if (!app.includes("/api/chat/stream") || !app.includes('text/event-stream') || !app.includes('chatMeta')) throw new Error('浏览器没有通过 BFF 展示流式对话状态');
  const chatPanelSource = await fetch(`${base}/src/features/trip-chat/chat-panel.js`).then((response) => response.text());
  if (!chatPanelSource.includes('floatingChatDock') || !chatPanelSource.includes('open-chat-dock') || !chatPanelSource.includes('chat-dock-trigger') || !chatPanelSource.includes('chat-dock-panel')) throw new Error('规划页缺少仅规划页显示的 AI 悬浮聊天窗契约');
  if (!chatPanelSource.includes('>聊天<') || !chatPanelSource.includes('>局部调整<') || !chatPanelSource.includes('plannerProposalDockOpen') || !chatPanelSource.includes('planner-proposal-dock')) throw new Error('AI 聊天/局部调整模式或独立方案悬浮窗契约缺失');
  if (chatPanelSource.includes('chat-meta-pill') || chatPanelSource.includes('<div class="quick-chips-mount">')) throw new Error('聊天窗仍暴露内部通道状态或快捷按钮占位');
  if (chatPanelSource.includes('调整方案存在硬约束冲突（不可行）') || chatPanelSource.includes('NO_FEASIBLE_REPLACEMENT')) throw new Error('用户可见方案 UI 仍暴露内部冲突状态');
  if (!chatPanelSource.includes('<textarea') || !chatPanelSource.includes('resizeChatInput') || !chatPanelSource.includes('Shift + Enter')) throw new Error('聊天输入缺少多行与 Shift+Enter 换行契约');
  const plan = await fetch(`${base}/api/plan`, { method: 'POST', headers: { 'content-type': 'application/json', origin: `http://127.0.0.1:${port}` }, body: JSON.stringify({ prompt: '周六下午到重庆，周日晚上离开，带父母，希望少走路。', constraints: { stayArea: '解放碑', transportPreference: '公交优先', dietPreference: '本地菜优先' } }) }).then((response) => response.json());
  if (!plan.trip?.constraints || plan.trip.constraints.companions !== '带父母') throw new Error('规划接口没有返回结构化约束');
  if (plan.trip.constraints.stayArea !== '解放碑' || plan.trip.constraints.transportPreference !== '公交优先' || plan.trip.constraints.dietPreference !== '本地菜优先') throw new Error(`完整约束没有进入规划结果：${JSON.stringify(plan.trip.constraints)}`);
  if (plan.trip.planContext?.startingArea !== '解放碑' || plan.trip.planContext?.routePreference !== 'transit' || !plan.trip.planContext?.foodGuidance?.includes('本地菜')) throw new Error(`住宿/交通/饮食约束没有进入决策上下文：${JSON.stringify(plan.trip.planContext)}`);
  const decisionStops = plan.trip.days?.flatMap((day) => day.stops || []) || [];
  if (!decisionStops.some((stop) => stop.recommendationReason?.includes('交通偏好：公交优先')) || !decisionStops.some((stop) => stop.routePreference === 'transit')) throw new Error('约束没有落到站点推荐理由或路线偏好');
  if (!plan.trip.retrieval?.mode || !plan.trip.sourceStatus || typeof plan.trip.sourceStatus.citationCoverage !== 'number') throw new Error('TripPlan 缺少检索与 Citation Coverage 契约');
  if (!plan.trip.qualityMetrics?.constraintSatisfaction || typeof plan.trip.qualityMetrics.dataCoverage?.overall !== 'number') throw new Error('TripPlan 缺少质量指标契约');
  if (!plan.trip.days.flatMap((day) => day.stops).every((stop) => stop.mapContext && Array.isArray(stop.citations))) throw new Error('Stop 缺少 MapContext 或 Citation');
  const detail = await fetch(`${base}/api/attractions/cq-hongyadong`).then((response) => response.json());
  const detailPayload = detail.detail || {};
  const truthfulMediaState = Boolean(detailPayload.image)
    || (Boolean(detailPayload.imageStatus) && Boolean(detailPayload.imageReason));
  if (!truthfulMediaState || !detailPayload.imageSource || !detailPayload.actions?.canAdd) throw new Error('景点详情没有绑定图片来源状态或加入行程操作');
  const chatResponse = await fetch(`${base}/api/chat/stream?message=${encodeURIComponent('重庆周末怎么安排')}&sessionId=browser-check&mode=deep`, { headers: { accept: 'text/event-stream' } });
  const chatStream = await chatResponse.text();
  if (!chatResponse.ok || !chatStream.includes('event: meta') || !chatStream.includes('event: text') || !chatStream.includes('event: done')) throw new Error('浏览器 BFF 没有转发 Java SSE 对话元数据与文本');

  // Verify Chat proposal generation and confirmation flow
  const proposalRes = await fetch(`${base}/api/chat/proposal`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: `http://127.0.0.1:${port}` },
    body: JSON.stringify({ sessionId: plan.sessionId, message: '把解放碑换成其他江景' })
  }).then((r) => r.json());
  if (!proposalRes.ok || !proposalRes.proposal?.candidate || !proposalRes.proposal.requiresConfirmation) {
    throw new Error(`Chat Proposal 生成失败：${JSON.stringify(proposalRes)}`);
  }

  const confirmRes = await fetch(`${base}/api/chat/proposal/confirm`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: `http://127.0.0.1:${port}` },
    body: JSON.stringify({ sessionId: plan.sessionId, confirm: true })
  }).then((r) => r.json());
  if (!confirmRes.ok || !confirmRes.trip || confirmRes.trip.version <= plan.trip.version) {
    throw new Error(`Chat Proposal 确认失败：${JSON.stringify(confirmRes)}`);
  }

  console.log('浏览器 Planning 主链检查通过：静态入口 → 前端 helper → 结构化规划 → Slots 编辑入口 → 图片/对话状态 → Chat Proposal/Confirm 闭环');
} finally {
  server.kill();
}
