import { state } from '../../app-core/state.js';
import { request } from '../../shared/api/client.js';
import { toast } from '../../shared/ui/toast.js';
import { loadUserPlan, loadUserChats, saveUserChats, getGuestChatSessionId, getTripChatKey } from '../../app-core/user-store.js';
import { clearPageCache } from '../../app-core/page-cache.js';

export async function restoreAuthSession(renderCallbacks = {}) {
  try {
    const data = await request('/api/auth/session');
    if (data.authenticated) {
      state.user = data.user;
      state.csrfToken = data.csrfToken || null;
    } else {
      state.user = null;
      state.csrfToken = null;
      state.view = 'guest-chat';
    }

    // 恢复该用户（或匿名访客）的独立活动规划与对应聊天记录
    const activePlan = loadUserPlan(state.user?.id);
    if (activePlan && activePlan.trip) {
    state.trip = activePlan.trip;
    state.sessionId = activePlan.sessionId;
    state.savedTripId = activePlan.savedTripId;
    state.chatMode = activePlan.chatMode === 'planner' ? 'planner' : 'chat';
    state.prompt = activePlan.prompt || state.prompt;
      state.activeProposal = activePlan.activeProposal || null;
      state.selectedOptionId = activePlan.selectedOptionId || 'option-1';
      if (activePlan.view && state.user) state.view = activePlan.view;
    } else if (state.user && state.view === 'guest-chat') {
      state.view = 'home';
    }
    state.tripChatHistories = loadUserChats(state.user?.id);
    const guestChat = !state.user && state.view === 'guest-chat';
    const chatKey = guestChat
      ? getGuestChatSessionId()
      : getTripChatKey(state.savedTripId, state.sessionId);
    // 兼容旧版本：匿名聊天曾错误使用通用 default 键。仅首次打开游客页时
    // 迁移到当前浏览器的独立游客会话，避免刷新后“看似丢失”历史。
    if (guestChat && !state.tripChatHistories[chatKey]
        && Array.isArray(state.tripChatHistories.default) && state.tripChatHistories.default.length) {
      state.tripChatHistories[chatKey] = state.tripChatHistories.default;
      delete state.tripChatHistories.default;
      saveUserChats(null, state.tripChatHistories);
    }
    state.chatSessionId = chatKey;
    state.chatMessages = state.tripChatHistories[chatKey] || [];

    if (renderCallbacks.renderHeader) renderCallbacks.renderHeader();
    if (renderCallbacks.renderView) renderCallbacks.renderView();
    if (renderCallbacks.renderFloatingBtn) renderCallbacks.renderFloatingBtn();
    if (state.user?.role === 'admin' && renderCallbacks.health) await renderCallbacks.health();
  } catch {
    state.user = null;
    state.csrfToken = null;
  }
}

export async function logout(renderCallback) {
  if (state.user) {
    try { await request('/api/auth/logout', { method: 'POST' }); } catch { }
  }
  state.csrfToken = null;
  clearPageCache();
  state.user = null;
  state.savedTrips = null;
  state.historySessions = null;
  state.historySync = null;
  state.profile = null;
  state.trip = null;
  state.sessionId = null;
  state.savedTripId = null;
  state.itineraryMemorySnapshot = null;
  state.tripChatHistories = loadUserChats(null);
  state.chatSessionId = getGuestChatSessionId();
  state.chatMessages = state.tripChatHistories[state.chatSessionId] || [];
  state.selectedStopId = null;
  if (state.selectedStopIds instanceof Set) state.selectedStopIds.clear();
  state.chatMode = 'chat';
  state.view = 'guest-chat';
  toast('已安全退出登录。');
  if (renderCallback) renderCallback();
}
