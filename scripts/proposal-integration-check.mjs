import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { spawnPhase5bFixtureServer, PHASE5B_FIXTURE_ADMIN_EMAIL, PHASE5B_FIXTURE_ADMIN_PASSWORD } from './phase5b-test-fixture.mjs';

const webPort = 4326;
const javaPort = 4327;
const webBase = `http://127.0.0.1:${webPort}`;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForServer(url) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.status === 200) return;
    } catch {}
    await wait(100);
  }
  throw new Error(`测试服务未启动：${url}`);
}

async function responseJson(response) {
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}

async function fixtureRequest(path, options = {}) {
  const headers = {
    origin: webBase,
    'x-yuyouzhice-device': 'proposal-integration-check',
    ...(options.body ? { 'content-type': 'application/json' } : {}),
    ...(options.headers || {})
  };
  return fetch(`${webBase}${path}`, { ...options, headers });
}

async function checkJavaClientPaths() {
  const seen = [];
  const javaServer = createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    seen.push({
      method: req.method,
      path: req.url,
      authorization: req.headers.authorization,
      planToken: req.headers['x-plan-session-token'],
      body: raw ? JSON.parse(raw) : null
    });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ data: { ok: true } }));
  });
  await new Promise((resolve) => javaServer.listen(javaPort, '127.0.0.1', resolve));
  const previousUrl = process.env.CORE_BACKEND_URL;
  const previousStub = process.env.YUYOUZHICE_JAVA_TEST_STUB;
  process.env.CORE_BACKEND_URL = `http://127.0.0.1:${javaPort}`;
  process.env.YUYOUZHICE_JAVA_TEST_STUB = '0';
  try {
    const { createJavaCoreClient } = await import(`../server/java-core-client.mjs?proposal-check=${Date.now()}`);
    const client = createJavaCoreClient();
    const request = {
      sessionId: 'java-session-1',
      planId: 'web-session-1',
      baseRevision: 7,
      message: '今天下雨，少安排室外景点',
      activeDay: 2,
      selectedStopId: 'day2-stop-1',
      activeProposalId: 'proposal-old',
      pinnedStopIds: ['day2-stop-2'],
      context: {
        activeDay: 2,
        selectedStopId: 'day2-stop-1',
        activeProposalId: 'proposal-old',
        pinnedStopIds: ['day2-stop-2']
      },
      sessionAccessToken: 'plan-session-token',
      idempotencyKey: 'proposal-idempotency-1',
      proposedTrip: { mustNotReachJava: true },
      venueId: 'must-not-replace-optionId'
    };
    await client.conversation('java-session-1', request, 'java-jwt');
    await client.previewAdjustment('java-session-1', request, 'java-jwt');
    await client.applyAdjustment('java-session-1', {
      proposalId: 'proposal-1',
      optionId: 'option-2',
      baseRevision: 7,
      sessionAccessToken: 'plan-session-token',
      idempotencyKey: 'proposal-apply-1',
      proposedTrip: { mustNotReachJava: true },
      venueId: 'must-not-replace-optionId'
    }, 'java-jwt');
    await client.openPlannerTrip('trip-restore-1', 'java-jwt');

    assert.deepEqual(seen.map((item) => item.path), [
      '/ai/planner/v1/sessions/java-session-1/conversation',
      '/ai/planner/v1/sessions/java-session-1/adjust/preview',
      '/ai/planner/v1/sessions/java-session-1/adjust/apply',
      '/ai/planner/v1/trips/trip-restore-1/open'
    ], 'Java client 必须使用正式 Planner 路径');
    for (const item of seen) {
      assert.equal(item.method, 'POST');
      assert.equal(item.authorization, 'Bearer java-jwt');
    }
    for (const item of seen.slice(0, 3)) {
      assert.equal(item.planToken, 'plan-session-token');
      assert.equal(item.body.proposedTrip, undefined, 'Java client 不得上传 proposedTrip');
      assert.equal(item.body.venueId, undefined, 'Java client 不得用 venueId 替代 optionId');
    }
    assert.equal(seen[3].planToken, undefined, '正式 Trip 打开只能依赖 Java 用户身份，不携带旧会话能力令牌');
    assert.equal(seen[3].body, null, '正式 Trip 打开不能上传客户端 Trip 快照');
    const conversationBody = seen[0].body;
    assert.equal(conversationBody.baseRevision, 7);
    assert.equal(conversationBody.message, request.message);
    assert.deepEqual(conversationBody.context, {
      activeDay: 2,
      selectedStopId: 'day2-stop-1',
      activeProposalId: 'proposal-old',
      pinnedStopIds: ['day2-stop-2']
    });
    const applyBody = seen[2].body;
    assert.equal(applyBody.proposalId, 'proposal-1');
    assert.equal(applyBody.optionId, 'option-2');
    assert.equal(applyBody.baseRevision, 7);
    assert.equal(applyBody.idempotencyKey, 'proposal-apply-1');
  } finally {
    if (previousUrl === undefined) delete process.env.CORE_BACKEND_URL;
    else process.env.CORE_BACKEND_URL = previousUrl;
    if (previousStub === undefined) delete process.env.YUYOUZHICE_JAVA_TEST_STUB;
    else process.env.YUYOUZHICE_JAVA_TEST_STUB = previousStub;
    await new Promise((resolve) => javaServer.close(resolve));
  }
}

async function checkWebProposalFlow() {
  const server = spawnPhase5bFixtureServer(webPort, { YUYOUZHICE_TEST_PROPOSAL_TTL_MS: '2000' });
  let cookie = '';
  let fixtureError = '';
  server.stderr?.on('data', (chunk) => { fixtureError += String(chunk); });
  server.once('error', (error) => { fixtureError += error.message; });
  try {
    await waitForServer(`${webBase}/`);
    const planResult = await fixtureRequest('/api/plan', {
      method: 'POST',
      body: JSON.stringify({ prompt: '周末带父母游重庆，少走路。' })
    }).then(responseJson);
    assert.equal(planResult.response.status, 200);
    const plan = planResult.payload;
    assert.equal(plan.adjustmentCapability, 'V1_PROPOSAL');
    assert.equal(plan.legacyMode, false);
    assert.ok(plan.javaSessionId, '新 Planner session 必须返回 javaSessionId');

    const sessionId = plan.sessionId;
    const sessionAccessToken = plan.sessionAccessToken;
    const baseRevision = Number(plan.trip.version || 1);
    const conversationBody = {
      sessionId,
      planId: sessionId,
      sessionAccessToken,
      baseRevision,
      message: '请替换当前选中的景点',
      activeDay: 1,
      selectedStopId: 'day1-jiefangbei',
      activeProposalId: null,
      pinnedStopIds: ['day1-hongyadong'],
      idempotencyKey: 'bff-conversation-1'
    };

    const conversationResult = await fixtureRequest('/api/planner/conversation', {
      method: 'POST',
      body: JSON.stringify(conversationBody)
    }).then(responseJson);
    assert.equal(conversationResult.response.status, 200);
    const conversation = conversationResult.payload;
    assert.ok(conversation.proposalId, 'conversation 必须返回正式 Proposal');
    assert.equal(conversation.legacyMode, false);
    assert.equal(conversation.adjustmentCapability, 'V1_PROPOSAL');
    assert.ok(Array.isArray(conversation.candidateReplacements) && conversation.candidateReplacements.length >= 2, 'Proposal 至少返回两个候选');
    assert.equal(conversation.candidateReplacements[0].optionId, 'option-1');

    const beforePreview = await fixtureRequest(`/api/planner/sessions/${encodeURIComponent(sessionId)}`).then(responseJson);
    const previewResult = await fixtureRequest('/api/planner/adjust/preview', {
      method: 'POST',
      body: JSON.stringify({
        ...conversationBody,
        message: '今天下雨，少安排室外景点',
        idempotencyKey: 'bff-preview-rain-1'
      })
    }).then(responseJson);
    assert.equal(previewResult.response.status, 200);
    assert.ok(previewResult.payload.proposalId);
    const afterPreview = await fixtureRequest(`/api/planner/sessions/${encodeURIComponent(sessionId)}`).then(responseJson);
    assert.deepEqual(afterPreview.payload.trip, beforePreview.payload.trip, 'Preview 不得修改 Web/Java 当前 trip');
    assert.equal(afterPreview.payload.currentVersion, beforePreview.payload.currentVersion, 'Preview 不得修改 revision');

    const applyResult = await fixtureRequest('/api/planner/adjust/apply', {
      method: 'POST',
      body: JSON.stringify({
        sessionId,
        proposalId: conversation.proposalId,
        optionId: 'option-2',
        baseRevision,
        sessionAccessToken,
        idempotencyKey: 'bff-apply-option-2-1'
      })
    }).then(responseJson);
    assert.equal(applyResult.response.status, 200);
    assert.equal(applyResult.payload.currentVersion, baseRevision + 1, 'Apply 必须严格 Revision +1');
    assert.equal(applyResult.payload.trip.version, baseRevision + 1);
    assert.equal(applyResult.payload.trip.days[0].stops[0].name, '弹子石老街', 'Apply 必须真正使用 option-2');
    assert.equal(applyResult.payload.trip.days[0].stops[1].name, plan.trip.days[0].stops[1].name, '未目标站点不得被修改');

    const conflictProposal = await fixtureRequest('/api/planner/adjust/preview', {
      method: 'POST',
      body: JSON.stringify({
        sessionId,
        baseRevision: baseRevision + 1,
        message: '换一个景点',
        sessionAccessToken,
        idempotencyKey: 'bff-preview-conflict-1'
      })
    }).then(responseJson);
    const conflict = await fixtureRequest('/api/planner/adjust/apply', {
      method: 'POST',
      body: JSON.stringify({
        sessionId,
        proposalId: conflictProposal.payload.proposalId,
        optionId: 'option-1',
        baseRevision,
        sessionAccessToken,
        idempotencyKey: 'bff-apply-conflict-1'
      })
    }).then(responseJson);
    assert.equal(conflict.response.status, 409, '过期 revision 必须返回 409');
    assert.equal(conflict.payload.code, 'CONFLICT');

    const missingProposal = await fixtureRequest('/api/planner/adjust/apply', {
      method: 'POST',
      body: JSON.stringify({
        sessionId,
        proposalId: 'proposal-does-not-exist',
        optionId: 'option-1',
        baseRevision: baseRevision + 1,
        sessionAccessToken,
        idempotencyKey: 'bff-apply-missing-1'
      })
    }).then(responseJson);
    assert.equal(missingProposal.response.status, 400);
    assert.match(missingProposal.payload.message, /不存在|过期/);

    const loginResult = await fixtureRequest('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: PHASE5B_FIXTURE_ADMIN_EMAIL, password: PHASE5B_FIXTURE_ADMIN_PASSWORD })
    }).then(async (result) => ({ ...(await responseJson(result)), headers: result.headers }));
    assert.equal(loginResult.response.status, 200);
    const setCookie = loginResult.headers.get('set-cookie') || '';
    cookie = setCookie.split(';')[0];
    assert.ok(cookie, 'Legacy 流程测试需要 Web session cookie');
    const csrfToken = loginResult.payload.csrfToken;
    const authHeaders = { cookie, 'x-yuyouzhice-csrf': csrfToken };
    const saveResult = await fixtureRequest('/api/trips/save', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ trip: plan.trip })
    }).then(responseJson);
    assert.equal(saveResult.response.status, 200);
    const savedTripId = saveResult.payload.savedTripId || saveResult.payload.tripId || saveResult.payload.saved?.id || saveResult.payload.trip?.id;
    assert.ok(savedTripId, '保存流程必须返回正式行程 ID');
    const openResult = await fixtureRequest(`/api/trips/${encodeURIComponent(savedTripId)}/open`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({})
    }).then(responseJson);
    assert.equal(openResult.response.status, 200);
    assert.equal(openResult.payload.legacyMode, false);
    assert.equal(openResult.payload.adjustmentCapability, 'V1_PROPOSAL');
    assert.ok(openResult.payload.javaSessionId, '重开正式行程必须返回新的 Java PlannerSession');
    assert.equal(openResult.payload.trip.formalTripId, savedTripId);

    const workspaceMessages = [
      { role: 'user', content: '这份行程的专属对话' },
      { role: 'assistant', content: '已记录到当前正式行程。' }
    ];
    const workspaceWrite = await fixtureRequest(`/api/trips/${encodeURIComponent(savedTripId)}/workspace`, {
      method: 'PUT',
      headers: authHeaders,
      body: JSON.stringify({
        sessionId: openResult.payload.sessionId,
        chatMode: 'planner',
        chatMessages: workspaceMessages
      })
    }).then(responseJson);
    assert.equal(workspaceWrite.response.status, 200, '正式行程必须允许保存自己的对话工作区');
    assert.deepEqual(workspaceWrite.payload.workspace.chatMessages.map((item) => item.content), workspaceMessages.map((item) => item.content));
    const workspaceDenied = await fixtureRequest('/api/trips/not-this-trip/workspace', {
      method: 'PUT',
      headers: authHeaders,
      body: JSON.stringify({ sessionId: openResult.payload.sessionId, chatMessages: workspaceMessages })
    }).then(responseJson);
    assert.equal(workspaceDenied.response.status, 403, '一个行程会话不能写入其他行程的工作区');
    const workspaceReopen = await fixtureRequest(`/api/trips/${encodeURIComponent(savedTripId)}/open`, {
      method: 'POST', headers: authHeaders, body: JSON.stringify({})
    }).then(responseJson);
    assert.equal(workspaceReopen.response.status, 200);
    assert.equal(workspaceReopen.payload.workspace.chatMode, 'planner', '重新打开必须恢复该正式行程自己的对话模式');
    assert.deepEqual(workspaceReopen.payload.workspace.chatMessages.map((item) => item.content), workspaceMessages.map((item) => item.content), '重新打开必须恢复该正式行程自己的聊天记录');

    const reopenedBaseRevision = Number(openResult.payload.trip.version || 1);
    const reopenedConversation = await fixtureRequest('/api/planner/conversation', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        sessionId: openResult.payload.sessionId,
        baseRevision: reopenedBaseRevision,
        sessionAccessToken: openResult.payload.sessionAccessToken,
        message: '第二天太赶了，少排一个',
        context: { activeDay: 2, selectedStopId: null, activeProposalId: null, pinnedStopIds: ['day1-hongyadong'] }
      })
    }).then(responseJson);
    assert.equal(reopenedConversation.response.status, 200);
    assert.ok(reopenedConversation.payload.proposalId, '重开后必须能再次生成 Proposal');

    const reopenedPreview = await fixtureRequest(`/api/planner/sessions/${encodeURIComponent(openResult.payload.sessionId)}`, { headers: authHeaders }).then(responseJson);
    const reopenedApply = await fixtureRequest('/api/planner/adjust/apply', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        sessionId: openResult.payload.sessionId,
        proposalId: reopenedConversation.payload.proposalId,
        optionId: 'option-1',
        baseRevision: reopenedBaseRevision,
        sessionAccessToken: openResult.payload.sessionAccessToken
      })
    }).then(responseJson);
    assert.equal(reopenedApply.response.status, 200);
    assert.equal(reopenedApply.payload.currentVersion, reopenedBaseRevision + 1);
    const reopenedAfterApply = await fixtureRequest(`/api/planner/sessions/${encodeURIComponent(openResult.payload.sessionId)}`, { headers: authHeaders }).then(responseJson);
    assert.notDeepEqual(reopenedAfterApply.payload.trip, reopenedPreview.payload.trip, 'Apply 必须修改恢复后的 PlannerSession');

    const resaved = await fixtureRequest('/api/trips/save', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        plannerSessionId: openResult.payload.sessionId,
        savedTripId,
        trip: reopenedApply.payload.trip
      })
    }).then(responseJson);
    assert.equal(resaved.response.status, 200);
    assert.equal(resaved.payload.saved?.id, savedTripId, '恢复会话保存必须更新原 Trip');
    assert.equal(resaved.payload.saved?.trip?.version, 2, '再次保存必须生成同一 Trip 的新版本');

    const expiringProposal = await fixtureRequest('/api/planner/conversation', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        sessionId: openResult.payload.sessionId,
        baseRevision: reopenedApply.payload.currentVersion,
        sessionAccessToken: openResult.payload.sessionAccessToken,
        message: '换一个景点',
        context: { activeDay: 1, selectedStopId: 'day1-jiefangbei', activeProposalId: null, pinnedStopIds: ['day1-hongyadong'] }
      })
    }).then(responseJson);
    assert.ok(expiringProposal.payload.proposalId);
    await wait(2100);
    const expired = await fixtureRequest('/api/planner/adjust/apply', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        sessionId: openResult.payload.sessionId,
        proposalId: expiringProposal.payload.proposalId,
        optionId: 'option-1',
        baseRevision: reopenedApply.payload.currentVersion,
        sessionAccessToken: openResult.payload.sessionAccessToken
      })
    }).then(responseJson);
    assert.equal(expired.response.status, 400);
    assert.match(expired.payload.message, /不存在|过期/);

    const appSource = await readFile(new URL('../app/app.js', import.meta.url), 'utf8');
    for (const marker of [
      'data-action="select-option"',
      'data-action="confirm-planner-proposal"',
      "'/api/planner/conversation'",
      "optionId: state.selectedOptionId || 'option-1'",
      '`/api/trips/${encodeURIComponent(id)}/open`',
      'state.selectedStopId',
      'state.activeDay',
      '409 Conflict',
      'state.activeProposal = null',
      "adjustmentCapability === 'LEGACY'"
    ]) assert.ok(appSource.includes(marker), `app.js 缺少 Proposal 行为契约：${marker}`);
  } finally {
    server.kill();
  }
}

await checkJavaClientPaths();
await checkWebProposalFlow();
console.log('Proposal Integration 检查通过：conversation→Proposal→option 选择→Apply、Preview 无副作用、Revision +1、409、真实 TTL 过期、正式 Trip 重开恢复会话及回存同一 TripVersion 均已覆盖。');
