import { state } from '../../app-core/state.js';
import { deviceId, plannerIdempotencyKey, request } from '../../shared/api/client.js';
import { renderMarkdownStreaming } from '../../shared/lib/markdown.js';
import { toast } from '../../shared/ui/toast.js';
import { renderChatInDOM } from './chat-panel.js';
import { saveUserChats, saveUserPlan, getGuestChatSessionId, getTripChatKey } from '../../app-core/user-store.js';
import { persistTripWorkspace } from '../trip-workspace/workspace-service.js';

let activeChatAbortController = null;

function persistChatUiState() {
  if (!state.chatSessionId) return;
  state.tripChatHistories = state.tripChatHistories || {};
  state.tripChatHistories[state.chatSessionId] = state.chatMessages;
  saveUserChats(state.user?.id, state.tripChatHistories);
  void persistTripWorkspace();
}

function persistPlannerUiState() {
  if (!state.trip) return;
  saveUserPlan(state.user?.id, {
    trip: state.trip,
    sessionId: state.sessionId,
    savedTripId: state.savedTripId,
    prompt: state.prompt,
    view: 'planning',
    activeProposal: state.activeProposal,
    selectedOptionId: state.selectedOptionId || 'option-1'
  });
}

function persistConversationUiState() {
  persistChatUiState();
  persistPlannerUiState();
}

async function queueTravelMemoryObservation(message) {
  if (!state.user || state.view === 'planning' && state.chatMode === 'planner') return;
  try {
    await request('/api/memories/observe', { method: 'POST', body: JSON.stringify({ message, sessionId: state.chatSessionId || '' }) });
    const result = await request('/api/memories/candidates');
    state.memoryCandidate = Array.isArray(result.candidates) ? result.candidates[0] || null : null;
  } catch {
    // Background memory review is auxiliary and must never make chat fail.
  }
}

export function cancelChatMessage({ renderView } = {}) {
  if (!activeChatAbortController) return;
  activeChatAbortController.abort();
  activeChatAbortController = null;
  state.chatLoading = false;
  const latest = state.chatMessages.at(-1);
  if (latest?.role === 'assistant' && latest.pending) {
    latest.pending = false;
    latest.content = latest.content || '本次回复已停止，你可以继续提问。';
  }
  persistChatUiState();
  renderChatInDOM({ scrollToBottom: false }, renderView);
  toast('已停止本次回复。');
}

export async function readChatStream(message, sessionId, mode, context = {}, onEvent, signal) {
  if (typeof context === 'function') {
    onEvent = context;
    context = {};
  }
  const params = new URLSearchParams({
    message,
    sessionId,
    mode,
    plannerSessionId: String(context.plannerSessionId || ''),
    tripId: String(context.tripId || ''),
    currentVersion: String(context.currentVersion || ''),
    activeDay: String(context.activeDay || ''),
    activeStopId: String(context.activeStopId || ''),
    activeStopName: String(context.activeStopName || '')
  });
  let response;
  try {
    response = await fetch(`/api/chat/stream?${params.toString()}`, {
      method: 'GET',
      credentials: 'same-origin',
      headers: { accept: 'text/event-stream', 'x-yuyouzhice-device': deviceId() },
      signal
    });
  } catch (netErr) {
    if (netErr?.name === 'AbortError') throw netErr;
    throw Object.assign(new Error('网络连接异常，无法连接到 Java 对话模型。'), { status: 0, cause: netErr });
  }
  if (!response.ok) {
    let payload = {};
    try { payload = await response.json(); } catch {}
    throw Object.assign(new Error(payload.message || 'Java 对话模型暂不可用。'), { status: response.status, data: payload });
  }
  if (!response.body) throw new Error('Java Core Backend 未返回对话流。');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let eventName = 'message';
  let eventData = [];
  let doneSeen = false;
  const dispatch = () => {
    if (!eventData.length) return;
    const dispatchedEvent = eventName || 'message';
    const raw = eventData.join('\n');
    if (dispatchedEvent === 'done') doneSeen = true;
    if (typeof onEvent === 'function') onEvent(dispatchedEvent, raw);
    eventName = 'message';
    eventData = [];
  };

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (line === '') dispatch();
      else if (line.startsWith('event:')) eventName = line.slice(6).trim();
      else if (line.startsWith('data:')) eventData.push(line.slice(5).replace(/^ /, ''));
      // SSE comments/ids are intentionally ignored by the browser renderer.
    }
    if (doneSeen) {
      await reader.cancel();
      return;
    }
    if (done) break;
  }
  if (buffer) {
    if (buffer.startsWith('data:')) eventData.push(buffer.slice(5).replace(/^ /, ''));
  }
  dispatch();
  if (!doneSeen) {
    throw new Error('Java 对话流提前结束，未收到完成事件。');
  }
}

export function shouldUsePlannerChannel(input) {
  if (state.view !== 'planning') return false;
  // 路由由用户在右上角明确选择。规划模式的每一轮都走 Java Planner，
  // 避免选中站点后再用关键词猜测，导致后续追问掉回普通 SSE 流。
  if (state.chatMode === 'planner') return true;
  return false;
}

function setPlannerChatMeta(response = {}) {
  state.chatMeta = {
    channel: 'planner',
    hasProposal: Boolean(response.proposalId)
  };
}

function friendlyPlannerError(error) {
  if (error?.status === 401) return '行程规划需要登录，请先登录后再试。';
  if (error?.status === 404 || error?.data?.code === 'PLANNER_SESSION_NOT_FOUND') {
    return '当前规划会话需要重新建立，行程草稿仍然保留。';
  }
  if (error?.status === 409) return '行程刚刚发生变化，请刷新当前行程后再试。';
  return '这次规划暂时没有返回结果。你可以切换到聊天模式继续咨询，或稍后重试。';
}

function chatErrorText(raw) {
  if (raw && typeof raw === 'object') {
    return [raw.code, raw.message, raw.error, raw.detail].filter(Boolean).join(' ');
  }
  const text = String(raw || '');
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed === 'string') return parsed;
    if (parsed && typeof parsed === 'object') return chatErrorText(parsed);
  } catch {}
  return text;
}

function isEmptyChatResult(raw) {
  return /未返回(?:完整)?内容|没有返回(?:完整)?内容|未能完成本次回答|空回复|无内容|empty(?:\s+response|\s+content)|no\s+content/i.test(chatErrorText(raw));
}

function chatUnknownReply(activeStopName = '') {
  const target = activeStopName ? `“${activeStopName}”` : '这条问题';
  return `我暂时没有查到${target}的完整资料。你可以换个问法，或者告诉我更关心开放时间、交通、亮点还是适合人群，我再继续帮你查。`;
}

function classifyChatFailure(error) {
  const status = Number(error?.status || 0);
  const detail = chatErrorText(error?.data || error?.message || error);
  if (status === 401) {
    return { kind: 'auth', message: '聊天功能需要登录，请先登录后再试。' };
  }
  if (status === 403) {
    return { kind: 'auth', message: '当前账号暂时没有使用聊天服务的权限，请联系管理员。' };
  }
  if (isEmptyChatResult(detail)) {
    return { kind: 'unknown', message: chatUnknownReply() };
  }
  if (status === 408 || status === 504 || /超时|timeout|连接中断|网络连接异常|提前结束|未收到完成事件/i.test(detail)) {
    return { kind: 'temporary', message: '我刚才查询得有点慢，暂时还没拿到完整结果。你可以稍后重试，或者换个更具体的问题。' };
  }
  return { kind: 'temporary', message: '我刚才没有拿到完整回答。你可以稍后重试，也可以换个更具体的问法。' };
}

export async function sendChatMessage({ renderView, scheduleTripMap, inputOverride, preserveInput = false } = {}) {
  const inputEl = document.querySelector('#chat-input');
  const hasInputOverride = typeof inputOverride === 'string';
  const input = String(hasInputOverride ? inputOverride : ((inputEl ? inputEl.value : state.chatInput) || state.chatInput || '')).trim();
  if (!input || state.chatLoading) return;
  if (input.length > 4000) return toast('对话内容过长，请分段发送。');
  let usePlannerChannel = false;
  try {
    // 在写入 pending/loading 状态前完成路由判断，避免前置异常遗留永久 loading。
    usePlannerChannel = shouldUsePlannerChannel(input);
  } catch (error) {
    console.error('Chat channel routing failed', error);
    toast('聊天请求初始化失败，请重试。');
    return;
  }
  state.chatRoute = usePlannerChannel ? 'planner' : 'chat';
  console.info('[CHAT_ROUTE]', {
    channel: state.chatRoute,
    messageLength: input.length,
    hasPlannerSession: Boolean(state.sessionId),
    hasSelectedStop: Boolean(state.selectedStopId)
  });
  const tripChatKey = !state.user && state.view === 'guest-chat'
    ? getGuestChatSessionId()
    : (state.chatSessionId || getTripChatKey(state.savedTripId, state.sessionId));
  state.chatSessionId = tripChatKey;
  state.chatMessages.push({ role: 'user', content: input });
  const assistant = { role: 'assistant', content: '', pending: true, retryMessage: input };
  state.chatMessages.push(assistant);
  if (!hasInputOverride || !preserveInput) {
    state.chatInput = '';
    if (inputEl) inputEl.value = '';
  }
  state.chatMeta = null;
  state.tripChatHistories = state.tripChatHistories || {};
  state.tripChatHistories[tripChatKey] = state.chatMessages;
  persistChatUiState();
  activeChatAbortController?.abort();
  activeChatAbortController = new AbortController();
  state.chatLoading = true;
  renderChatInDOM({ scrollToBottom: true }, renderView);
  const activeStop = state.trip?.days?.flatMap((day) => day.stops || [])
    .find((stop) => stop.id === state.selectedStopId);
  const activeStopName = activeStop?.name || '';

  // 1. 详情页规划微调会话通道：全量自然语言统一路由至服务端语义处理入口，不再通过前端关键词正则拦截
  if (usePlannerChannel) {
    if (!state.sessionId) {
      assistant.content = '当前行程的局部调整会话已失效。请从“我的行程”重新打开这份行程后再调整；也可以切换到聊天继续咨询。';
      assistant.error = '当前行程暂时无法进入局部调整';
      assistant.offerChatMode = true;
      assistant.pending = false;
      state.chatLoading = false;
      persistConversationUiState();
      renderChatInDOM({ scrollToBottom: true }, renderView);
      toast('当前行程需要重新打开后才能局部调整。');
      return;
    }
    if (state.legacyMode || state.adjustmentCapability === 'LEGACY' || state.trip?.plannerVersion === 'legacy-v0') {
      const isAdjustmentIntent = /(不想去|换一个|替换|换掉|有没有替换|有替换方案吗|换个地方|推荐其他|删除|去掉|移除|下雨|雨天|避雨|太赶|太累|少推荐|少安排|加上|添加|加入|换成第|选第|应用方案|改|重新排|重排)/.test(input);
      if (isAdjustmentIntent) {
        state.activeProposal = null;
        assistant.content = '当前保存行程暂时不能生成调整预览。你可以切换到聊天模式继续咨询，或重新生成一份行程。';
        assistant.offerChatMode = true;
        assistant.pending = false;
        state.chatLoading = false;
        persistConversationUiState();
        renderChatInDOM({ scrollToBottom: true }, renderView);
        toast('传统基准规划模式下已禁用 AI 局部调整。');
        return;
      }
    }

    try {
      const convRes = await request('/api/planner/conversation', {
        method: 'POST',
        signal: activeChatAbortController.signal,
        body: JSON.stringify({
          sessionId: state.sessionId,
          planId: state.sessionId,
          baseRevision: state.trip ? Number(state.trip.version || 1) : 1,
          message: input,
          context: {
            activeDay: Number(state.activeDay || 1),
            selectedStopId: state.selectedStopId || null,
            selectedStopIds: Array.from(state.selectedStopIds || []),
            activeProposalId: state.activeProposal ? state.activeProposal.proposalId : null,
            pinnedStopIds: Array.from(state.pinnedStopIds || [])
          },
          sessionAccessToken: state.sessionAccessToken || '',
          idempotencyKey: plannerIdempotencyKey('planner-conversation')
        })
      });
      setPlannerChatMeta(convRes);

      if (convRes.legacyMode || convRes.adjustmentCapability === 'LEGACY') {
        state.legacyMode = true;
        state.adjustmentCapability = 'LEGACY';
        state.activeProposal = null;
        state.selectedOptionId = 'option-1';
        assistant.content = convRes.message || '当前保存行程不支持新版 AI 局部调整，请重新生成 V1 行程。';
        assistant.pending = false;
        state.chatLoading = false;
        persistConversationUiState();
        renderChatInDOM({ scrollToBottom: true }, renderView);
        toast('当前保存行程处于 Legacy 模式，已禁用新版 AI 局部调整。');
        return;
      }
      state.legacyMode = false;
      state.adjustmentCapability = convRes.adjustmentCapability || 'V1_PROPOSAL';

      // QA 问答类型响应
      if (convRes.type === 'PLACE_QUESTION' || convRes.operation === 'QA') {
        assistant.content = String(convRes.answer || convRes.message || '').trim()
          || chatUnknownReply(activeStopName);
        assistant.pending = false;
        state.chatLoading = false;
        persistConversationUiState();
        renderChatInDOM({ scrollToBottom: true }, renderView);
        return;
      }

      // 仅变更选项选中态，不直接修改行程
      if (convRes.type === 'PROPOSAL_OPTION_SELECTED' || convRes.operation === 'OPTION_SELECT') {
        if (convRes.selectedOptionId) {
          state.selectedOptionId = convRes.selectedOptionId;
          document.querySelectorAll('.candidate-option-card').forEach((el) => {
            const isThis = el.dataset.optionId === convRes.selectedOptionId;
            el.classList.toggle('selected', isThis);
            const radio = el.querySelector('input[type="radio"]');
            if (radio) radio.checked = isThis;
          });
        }
        assistant.content = convRes.message || '已为您选中国方案。请在下方方案卡片中点击【确认应用】以生效。';
        assistant.pending = false;
        state.chatLoading = false;
        persistConversationUiState();
        renderChatInDOM({ scrollToBottom: true }, renderView);
        return;
      }

      // 单轮精准澄清响应
      if (convRes.requiresClarification || convRes.type === 'CLARIFICATION' || convRes.type === 'UNKNOWN') {
        assistant.content = convRes.clarificationQuestion || convRes.message || '请补充具体景点信息。';
        assistant.pending = false;
        state.chatLoading = false;
        persistConversationUiState();
        renderChatInDOM({ scrollToBottom: true }, renderView);
        return;
      }

      // 生成了 Proposal 预览方案卡片
      if (convRes.proposalId) {
        state.activeProposal = convRes;
        state.selectedOptionId = 'option-1';
        state.plannerProposalDockOpen = true;
        state.suggestionDismissed = false;
        assistant.content = convRes.message || (convRes.feasible ? '已为你生成调整方案预览，请打开独立方案窗口查看。' : '这次调整不太建议，我已准备好坚持当前选择或换其他方案。');
        assistant.pending = false;
        state.chatLoading = false;
        persistConversationUiState();
        renderChatInDOM({ scrollToBottom: true }, renderView);
        return;
      }

      // 确认应用成功后更新行程
      if (convRes.applied && convRes.trip) {
        state.trip = convRes.trip;
        state.activeProposal = null;
        state.plannerProposalDockOpen = false;
        state.selectedStopId = null;
        if (state.selectedStopIds instanceof Set) state.selectedStopIds.clear();
        state.suggestionDismissed = false;
        saveUserPlan(state.user?.id, {
          trip: state.trip,
          sessionId: state.sessionId,
          savedTripId: state.savedTripId,
          prompt: state.prompt,
          view: 'planning',
          activeProposal: null,
          selectedOptionId: state.selectedOptionId || 'option-1'
        });
        persistChatUiState();
        assistant.content = convRes.message || '调整方案已成功应用并生成新版本！';
        assistant.pending = false;
        state.chatLoading = false;
        toast(`行程调整已应用！当前为第 ${convRes.currentVersion || convRes.trip.version} 版`);
        if (renderView) renderView();
        if (scheduleTripMap) scheduleTripMap();
        return;
      }

      // Planner 返回了未带 Proposal 的正常结果时也在规划通道内收口，
      // 不再继续落入普通聊天流，避免出现“后端模型未返回内容”。
      assistant.content = convRes.answer || convRes.message || '规划请求已收到，请补充具体的景点或调整目标。';
      assistant.pending = false;
      state.chatLoading = false;
      persistConversationUiState();
      renderChatInDOM({ scrollToBottom: true }, renderView);
      return;
    } catch (err) {
      const sessionUnavailable = err?.status === 404
        && (err.data?.code === 'PLANNER_SESSION_NOT_FOUND' || err.data?.recoverable === true);
      if (sessionUnavailable) {
        const message = '当前规划会话已过期，但行程草稿仍保留。请重新生成行程，或从“我的行程”重新打开已保存行程。';
        state.activeProposal = null;
        state.sessionAccessToken = null;
        state.sessionId = null;
        state.legacyMode = false;
        state.adjustmentCapability = 'V1_PROPOSAL';
        assistant.error = '规划会话需要恢复';
        assistant.offerChatMode = true;
        assistant.content = message;
        assistant.pending = false;
        state.chatLoading = false;
        saveUserPlan(state.user?.id, {
          trip: state.trip,
          sessionId: null,
          savedTripId: state.savedTripId,
          prompt: state.prompt,
          view: 'planning'
        });
        toast(message);
        persistConversationUiState();
        renderChatInDOM({ scrollToBottom: true }, renderView);
        return;
      }
      const expired = err.status === 400 && /过期|不存在|expired/i.test(`${err.message || ''} ${err.data?.code || ''}`);
      if (expired) {
        state.activeProposal = null;
        state.selectedOptionId = 'option-1';
        assistant.content = '调整方案已过期，请重新发送调整要求生成新的预览。';
        assistant.pending = false;
        state.chatLoading = false;
        persistConversationUiState();
        toast(assistant.content);
        renderChatInDOM({ scrollToBottom: true }, renderView);
        return;
      }
      if (err.status === 409) {
        toast('行程版本已在其他操作中更新（409 Conflict），正在重新加载最新行程...');
        state.activeProposal = null;
        try {
          const reloaded = await request(`/api/planner/sessions/${encodeURIComponent(state.sessionId)}`);
          if (reloaded.trip) state.trip = reloaded.trip;
        } catch {}
        if (renderView) renderView();
        persistConversationUiState();
        return;
      }
      if (err?.name === 'AbortError') {
        assistant.pending = false;
        assistant.content = assistant.content || '本次回复已停止，你可以继续提问。';
        state.chatLoading = false;
        activeChatAbortController = null;
        persistConversationUiState();
        renderChatInDOM({ scrollToBottom: true }, renderView);
        return;
      }
      const plannerError = friendlyPlannerError(err);
      assistant.error = plannerError;
      assistant.content = '这次规划没有生成结果。你可以切换到聊天模式继续咨询，或稍后重试。';
      assistant.offerChatMode = true;
      assistant.pending = false;
      state.chatLoading = false;
      activeChatAbortController = null;
      persistConversationUiState();
      renderChatInDOM({ scrollToBottom: true }, renderView);
      toast(plannerError);
      return;
    }
  }

  // 2. 通用问答与兜底流式通道
  try {
    let assistantMeta = null;
    // 用户看到的是“聊天模式”，底层聊天检索统一走 Agentic RAG 深度链路。
    await readChatStream(input, state.chatSessionId, 'deep', {
      plannerSessionId: state.sessionId || '',
      tripId: state.savedTripId || '',
      currentVersion: state.trip?.version || '',
      activeDay: state.activeDay || '',
      activeStopId: activeStop?.id || '',
      activeStopName: activeStop?.name || ''
    }, (eventName, raw) => {
      if (eventName === 'meta') {
        try {
          state.chatMeta = JSON.parse(raw);
          assistantMeta = state.chatMeta?.assistant || null;
        } catch {
          state.chatMeta = { retrieval: { reason: raw } };
        }
        renderChatInDOM({ scrollToBottom: false }, renderView);
      } else if (eventName === 'message' || eventName === 'text') {
        let text = raw;
        try {
          const parsed = JSON.parse(raw);
          if (typeof parsed === 'string') text = parsed;
        } catch {}
        assistant.content += text;
        assistant.pending = true;

        const transcript = document.querySelector('.chat-panel .chat-transcript');
        if (transcript) {
          const lastMsg = transcript.querySelector('.chat-message-assistant:last-child .chat-message-content');
          if (lastMsg) {
            lastMsg.innerHTML = renderMarkdownStreaming(assistant.content);
            const isNearBottom = transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight < 120;
            if (isNearBottom) {
              transcript.scrollTop = transcript.scrollHeight;
            }
          }
        }
      } else if (eventName === 'sentiment') {
        assistant.sentiment = raw;
      } else if (eventName === 'error') {
        const failure = classifyChatFailure(raw);
        assistant.failureKind = failure.kind;
        if (failure.kind === 'unknown') {
          // “查不到资料”是正常的内容结果，不把用户推进红色错误态。
          delete assistant.error;
          assistant.content = assistant.content || chatUnknownReply(activeStopName);
        } else {
          assistant.error = failure.kind === 'auth' ? failure.message : '本次查询暂时未完成';
          assistant.content = assistant.content || failure.message;
        }
        assistant.offerAdjustmentMode = false;
        assistant.pending = false;
        renderChatInDOM({ scrollToBottom: true }, renderView);
      }
    }, activeChatAbortController.signal);
  } catch (error) {
    assistant.pending = false;
    if (error?.name === 'AbortError') {
      assistant.content = assistant.content || '本次回复已停止，你可以继续提问。';
      return;
    }
    const failure = classifyChatFailure(error);
    assistant.failureKind = failure.kind;
    if (failure.kind === 'unknown') {
      delete assistant.error;
      assistant.content = assistant.content || chatUnknownReply(activeStopName);
    } else {
      assistant.error = failure.kind === 'auth' ? failure.message : '本次查询暂时未完成';
      assistant.content = assistant.content || failure.message;
      toast(failure.message);
    }
    assistant.offerAdjustmentMode = false;
  } finally {
    assistant.pending = false;
    activeChatAbortController = null;
    state.chatLoading = false;
    if (!assistant.content.trim() && !assistant.error) {
      assistant.content = chatUnknownReply(activeStopName);
    }
    if (!assistant.error && !assistant.pending) await queueTravelMemoryObservation(input);
    persistChatUiState();
    renderChatInDOM({ scrollToBottom: true }, renderView);
    window.setTimeout(() => document.querySelector('#chat-input')?.focus(), 0);
  }
}

export async function applyPlannerProposal({ renderView, scheduleTripMap } = {}) {
  if (!state.activeProposal) return;
  if (state.legacyMode || state.adjustmentCapability === 'LEGACY') {
    state.activeProposal = null;
    toast('当前保存行程处于 Legacy 模式，不支持新版 AI 局部调整。');
    renderChatInDOM({ scrollToBottom: false }, renderView);
    return;
  }
  const baseRevision = Number(state.activeProposal.baseRevision || state.trip?.version || 1);
  const expectedVersion = baseRevision + 1;
  state.chatLoading = true;
  renderChatInDOM({ scrollToBottom: false }, renderView);
  try {
    const res = await request('/api/planner/adjust/apply', {
      method: 'POST',
      body: JSON.stringify({
        sessionId: state.sessionId,
        proposalId: state.activeProposal.proposalId,
        optionId: state.selectedOptionId || 'option-1',
        baseRevision,
        forceApply: true,
        sessionAccessToken: state.sessionAccessToken || '',
        idempotencyKey: plannerIdempotencyKey('planner-apply')
      })
    });
    const currentVersion = Number(res.currentVersion ?? res.trip?.version);
    if (!res.trip || currentVersion !== expectedVersion) {
      throw Object.assign(new Error('服务端返回的行程版本不是严格的 Revision +1，已保留当前行程。'), { status: 502 });
    }
    state.trip = res.trip;
    state.activeProposal = null;
    state.plannerProposalDockOpen = false;
    state.selectedStopId = null;
    state.suggestionDismissed = false;
    state.plannerVersion = res.plannerVersion || state.trip?.plannerVersion || state.plannerVersion;
    saveUserPlan(state.user?.id, {
      trip: state.trip,
      sessionId: state.sessionId,
      savedTripId: state.savedTripId,
      prompt: state.prompt,
      view: 'planning'
    });
    toast(`已成功应用调整！当前为第 ${currentVersion} 版`);
    if (renderView) renderView();
    if (scheduleTripMap) scheduleTripMap();
  } catch (error) {
    const expired = error.status === 400 && /过期|不存在|expired/i.test(`${error.message || ''} ${error.data?.code || ''}`);
    const sessionUnavailable = error?.status === 404
      && (error.data?.code === 'PLANNER_SESSION_NOT_FOUND' || error.data?.recoverable === true);
    if (sessionUnavailable) {
      const message = '当前规划会话已过期，但行程草稿仍保留。请重新生成行程，或从“我的行程”重新打开已保存行程。';
      state.activeProposal = null;
      state.sessionAccessToken = null;
      state.sessionId = null;
      state.legacyMode = false;
      state.adjustmentCapability = 'V1_PROPOSAL';
      saveUserPlan(state.user?.id, {
        trip: state.trip,
        sessionId: null,
        savedTripId: state.savedTripId,
        prompt: state.prompt,
        view: 'planning'
      });
      toast(message);
      renderChatInDOM({ scrollToBottom: false }, renderView);
    } else if (error.status === 409) {
      toast('行程版本已在其他操作中更新（409 Conflict），正在重新加载最新行程...');
      state.activeProposal = null;
      if (state.sessionId) {
        try {
          const latest = await request(`/api/planner/sessions/${encodeURIComponent(state.sessionId)}`);
          if (latest.trip) state.trip = latest.trip;
          state.legacyMode = Boolean(latest.legacyMode);
          state.adjustmentCapability = latest.adjustmentCapability || (state.legacyMode ? 'LEGACY' : 'V1_PROPOSAL');
        } catch {}
      }
      if (renderView) renderView();
    } else if (expired) {
      state.activeProposal = null;
      state.selectedOptionId = 'option-1';
      toast('调整方案已过期，请重新发送调整要求生成新的预览。');
      renderChatInDOM({ scrollToBottom: false }, renderView);
    } else {
      toast(error?.status === 401 ? '行程规划需要登录，请先登录后再试。' : '这次方案暂时没有应用成功，请重新生成预览后再试。');
    }
  } finally {
    state.chatLoading = false;
    renderChatInDOM({ scrollToBottom: false }, renderView);
  }
}
