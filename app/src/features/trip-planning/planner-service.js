import { state } from '../../app-core/state.js';
import { request } from '../../shared/api/client.js';
import { toast } from '../../shared/ui/toast.js';
import { saveUserPlan, saveUserChats, loadUserChats, getTripChatKey } from '../../app-core/user-store.js';
import { invalidatePageCache } from '../../app-core/page-cache.js';

export async function plan({
  constraints = {},
  usePreferences = false,
  preferenceDecision = '',
  preserveSavedTripId = false,
  renderView,
  renderHeader,
  renderLoader,
  render,
  scheduleTripMap
} = {}) {
  if (!state.user) {
    state.view = 'auth';
    state.authMode = 'login';
    state.loginError = '';
    if (renderHeader) renderHeader();
    if (renderView) renderView();
    if (renderLoader) renderLoader();
    toast('AI 完整规划需要先登录，请登录后继续。');
    return;
  }
  if (!preserveSavedTripId) {
    state.savedTripId = null;
    state.itineraryMemorySnapshot = null;
  }
  state.prompt = document.querySelector('#prompt-input')?.value || state.prompt;
  state.loading = true;
  state.loadingPhase = '理解旅行条件';
  state.view = 'planning';
  if (renderView) renderView();
  if (renderHeader) renderHeader();
  if (renderLoader) renderLoader();

  const phaseTimer = window.setInterval(() => {
    const phases = ['理解旅行条件', '检索可信信息', '组合路线', '生成方案'];
    const index = phases.indexOf(state.loadingPhase);
    if (index >= 0 && index < phases.length - 1) {
      state.loadingPhase = phases[index + 1];
      if (renderLoader) renderLoader();
    }
  }, 600);

  try {
    const data = await request('/api/plan', {
      method: 'POST',
      body: JSON.stringify({
        prompt: state.prompt,
        freeText: state.prompt,
        constraints,
        usePreferences,
        preferenceDecision
      })
    });
    state.sessionId = data.sessionId;
    state.sessionAccessToken = data.sessionAccessToken || null;
    state.legacyMode = Boolean(data.legacyMode);
    state.adjustmentCapability = data.adjustmentCapability || (state.legacyMode ? 'LEGACY' : 'V1_PROPOSAL');
    state.trip = data.trip;
    state.plannerVersion = data.plannerVersion || data.trip?.plannerVersion || '1.0.0-v1';
    state.policyVersion = data.policyVersion || data.trip?.policyVersion || '2026.08-v1';
    state.routeDataStatus = data.routeDataStatus || data.trip?.routeDataStatus || 'ESTIMATED';
    state.explanationSource = data.explanationSource || data.trip?.explanationSource || 'TEMPLATE';
    state.degraded = Boolean(data.degraded || data.trip?.degraded);
    state.degradationReasons = data.degradationReasons || data.trip?.degradationReasons || [];
    state.activeProposal = null;
    state.plannerProposalDockOpen = false;
    state.selectedStopId = null;
    if (state.selectedStopIds instanceof Set) state.selectedStopIds.clear();
    state.pinnedStopIds = new Set();
    state.selectedOptionId = 'option-1';
    state.suggestionDismissed = false;
    state.preferenceProposal = data.preferenceProposal;

    // 为每个规划独立绑定唯一聊天会话键，并与各用户独立存储隔离
    const tripChatKey = getTripChatKey(state.savedTripId, data.sessionId);
    state.chatSessionId = tripChatKey;
    state.tripChatHistories = { ...loadUserChats(state.user?.id), ...(state.tripChatHistories || {}) };
    state.chatMessages = state.tripChatHistories[tripChatKey] || [];
    state.chatMeta = null;
    state.chatProposal = null;
    state.tripChatHistories[tripChatKey] = state.chatMessages;

    // 持久化当前用户的规划状态与聊天记录（绝不保存敏感凭据）
    saveUserPlan(state.user?.id, {
      trip: state.trip,
      sessionId: state.sessionId,
      savedTripId: state.savedTripId,
      prompt: state.prompt,
      view: 'planning'
    });
    saveUserChats(state.user?.id, state.tripChatHistories);
    // 新规划已写入服务端历史会话；返回历史页时必须读取最新列表。
    invalidatePageCache('history');

    toast(usePreferences ? '已沿用长期偏好生成定制行程。' : '专属行程已生成！支持地图分天切换与自由微调。');
  } catch (error) {
    if (!state.trip) state.view = 'home';
    toast(error.message);
  } finally {
    window.clearInterval(phaseTimer);
    state.loading = false;
    state.loadingPhase = '';
    if (render) render();
    if (scheduleTripMap) scheduleTripMap();
  }
}

/** Refreshes volatile provider data without changing the itinerary revision. */
export async function refreshDynamicData({ render, renderDynamic, scheduleTripMap, silent = false } = {}) {
  if (!state.user || !state.trip || !state.sessionId || state.dynamicRefreshing) return false;
  state.dynamicRefreshing = true;
  if (renderDynamic) renderDynamic();
  try {
    const data = await request(`/api/planner/sessions/${encodeURIComponent(state.sessionId)}/dynamic-refresh`, {
      method: 'POST'
    });
    if (data.trip) {
      state.trip = data.trip;
      state.dynamicRefreshSessionId = state.sessionId;
      saveUserPlan(state.user?.id, {
        trip: state.trip,
        sessionId: state.sessionId,
        savedTripId: state.savedTripId,
        prompt: state.prompt,
        view: 'planning'
      });
    }
    if (!silent) {
      const resolved = Number(data.dynamicRefresh?.weatherDaysResolved || 0);
      toast(resolved > 0 ? `已刷新 ${resolved} 天天气与地图动态数据。` : '已发起实时查询；当前日期暂未获得可用天气预报。');
    }
    return true;
  } catch (error) {
    if (!silent) toast(error.message || '刷新实时数据失败。');
    return false;
  } finally {
    state.dynamicRefreshing = false;
    if (renderDynamic) {
      renderDynamic();
      if (scheduleTripMap) scheduleTripMap();
    } else if (render) {
      render();
    }
  }
}
