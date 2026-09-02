import { state } from '../../app-core/state.js';
import { deviceId, request } from '../../shared/api/client.js';
import { toast } from '../../shared/ui/toast.js';
import { saveUserPlan, clearUserPlan, saveUserChats, loadUserChats, getTripChatKey } from '../../app-core/user-store.js';
import { persistTripWorkspace } from '../trip-workspace/workspace-service.js';
import { invalidatePageCache, isPageDataFresh, markPageDataFresh } from '../../app-core/page-cache.js';

export async function saveTrip({ renderModals, renderHeader, renderView, loadTripsCallback } = {}) {
  if (!state.trip) return toast('还没有可保存的行程。');
  if (!state.user) {
    state.pendingAfterLogin = 'save';
    state.loginOpen = true;
    if (renderModals) renderModals();
    return;
  }
  try {
    const res = await request('/api/trips/save', {
      method: 'POST',
      body: JSON.stringify({
        trip: state.trip,
        plannerSessionId: state.sessionId || null,
        savedTripId: state.savedTripId || state.trip?.savedTripId || null
      })
    });
    // 归档并同步该草稿的聊天历史至正式行程专属键
    const oldKey = getTripChatKey(null, state.sessionId);
    const savedId = res.saved?.id || res.savedTripId || res.tripId || (res.trip && res.trip.id);
    const newKey = getTripChatKey(savedId, null);
    state.tripChatHistories = { ...loadUserChats(state.user?.id), ...(state.tripChatHistories || {}) };
    if (state.tripChatHistories[oldKey] && !state.tripChatHistories[newKey]) {
      state.tripChatHistories[newKey] = state.tripChatHistories[oldKey];
    }
    if (oldKey !== newKey) delete state.tripChatHistories[oldKey];
    saveUserChats(state.user?.id, state.tripChatHistories);
    if (savedId) {
      await persistTripWorkspace({
        savedTripId: savedId,
        sessionId: state.sessionId,
        chatMessages: state.tripChatHistories[newKey] || [],
        chatMode: state.chatMode
      }, { immediate: true });
    }
    clearUserPlan(state.user?.id);

    // 正式行程写入会影响“我的行程”“旅行档案”和会话记录；仅失效这些数据页，
    // 不触碰当前聊天、地图或其它已加载页面。
    invalidatePageCache('trips', 'profile', 'history');
    state.savedTrips = null;

    state.trip = null;
    state.sessionId = null;
    state.savedTripId = null;
    state.view = 'trips';
    toast(res.message || '行程已成功保存！');
    if (renderHeader) renderHeader();
    if (renderView) renderView();
    if (loadTripsCallback) await loadTripsCallback();
  } catch (error) {
    toast(error.message);
  }
}

export async function openSavedTrip(id, { renderLoader, render, scheduleTripMap } = {}) {
  if (!state.user) return toast('请先登录后打开已保存行程。');
  state.loading = true;
  if (renderLoader) renderLoader();
  try {
    const data = await request(`/api/trips/${encodeURIComponent(id)}/open`, { method: 'POST' });
    state.sessionId = data.sessionId;
    state.savedTripId = data.savedTripId || id;
    state.legacyMode = Boolean(data.legacyMode);
    state.adjustmentCapability = data.adjustmentCapability || (state.legacyMode ? 'LEGACY' : 'V1_PROPOSAL');
    state.sessionAccessToken = data.sessionAccessToken || null;
    state.activeProposal = null;
    state.plannerProposalDockOpen = false;
    state.selectedOptionId = 'option-1';
    state.selectedStopId = null;
    if (state.selectedStopIds instanceof Set) state.selectedStopIds.clear();
    state.suggestionDismissed = false;
    state.trip = data.trip;
    state.trip.savedTripId = state.savedTripId;
    state.prompt = data.trip?.prompt || data.trip?.input || state.prompt;
    state.view = 'planning';

    // 还原该行程专属的历史对话记录，实现打开时无缝继续之前的对话
    const tripChatKey = getTripChatKey(data.savedTripId || id, data.sessionId);
    state.chatSessionId = tripChatKey;
    state.tripChatHistories = { ...loadUserChats(state.user?.id), ...(state.tripChatHistories || {}) };
    const workspace = data.workspace && typeof data.workspace === 'object' ? data.workspace : {};
    const localMessages = state.tripChatHistories[tripChatKey] || [];
    const remoteMessages = Array.isArray(workspace.chatMessages) ? workspace.chatMessages : [];
    // A just-finished local write can be ahead of the server by a few hundred
    // milliseconds. Keep the longer transcript and immediately heal storage.
    state.chatMessages = remoteMessages.length >= localMessages.length ? remoteMessages : localMessages;
    state.chatMode = workspace.chatMode === 'planner' ? 'planner' : 'chat';
    state.itineraryMemorySnapshot = workspace.itineraryMemorySnapshot || null;
    state.chatMeta = null;
    state.chatProposal = null;
    state.tripChatHistories[tripChatKey] = state.chatMessages;
    saveUserChats(state.user?.id, state.tripChatHistories);
    if (localMessages.length > remoteMessages.length) {
      await persistTripWorkspace({}, { immediate: true });
    }

    // 持久化当前用户的活动规划状态为该打开的行程（无敏感凭据）
    saveUserPlan(state.user?.id, {
      trip: state.trip,
      sessionId: state.sessionId,
      savedTripId: state.savedTripId,
      prompt: state.prompt,
      view: 'planning',
      chatMode: state.chatMode
    });

    toast(data.message || '已打开正式行程，可继续调整。');
  } catch (error) {
    toast(error.message);
  } finally {
    state.loading = false;
    if (render) render();
    if (scheduleTripMap) scheduleTripMap();
  }
}

export async function loadTrips(renderViewCallback, { force = false } = {}) {
  if (!state.user) return;
  if (!force && Array.isArray(state.savedTrips) && isPageDataFresh('trips')) return state.savedTrips;
  try {
    const data = await request('/api/trips');
    state.savedTrips = data.trips || [];
    markPageDataFresh('trips');
    if (state.view === 'trips' && renderViewCallback) renderViewCallback();
    return state.savedTrips;
  } catch (error) {
    toast(error.message);
  }
}

export async function deleteTrip(id, { renderModals, updateTripsInDOM, loadTripsCallback } = {}) {
  if (!state.user) return toast('请先登录后删除行程。');
  const previousTrips = state.savedTrips;
  state.savedTrips = Array.isArray(state.savedTrips)
    ? state.savedTrips.filter((item) => String(item.id) !== String(id))
    : state.savedTrips;
  state.deleteConfirm = null;
  if (renderModals) renderModals();
  if (updateTripsInDOM) updateTripsInDOM();
  toast('已从当前列表移除，正在后台删除。');
  try {
    await request(`/api/trips/${encodeURIComponent(id)}`, { method: 'DELETE' });
    const tripChatKey = getTripChatKey(id, null);
    state.tripChatHistories = { ...loadUserChats(state.user?.id), ...(state.tripChatHistories || {}) };
    delete state.tripChatHistories[tripChatKey];
    saveUserChats(state.user?.id, state.tripChatHistories);
    if (String(state.savedTripId || '') === String(id)) {
      state.savedTripId = null;
      state.itineraryMemorySnapshot = null;
    }
    markPageDataFresh('trips');
    invalidatePageCache('profile', 'history');
    toast('已删除这条行程。');
  } catch (error) {
    state.savedTrips = previousTrips;
    if (updateTripsInDOM) updateTripsInDOM();
    else if (loadTripsCallback) await loadTripsCallback();
    toast(error.message);
  }
}

export async function exportTripPdf(id) {
  if (!state.user) return toast('请先登录后导出行程。');
  try {
    const response = await fetch(`/api/trips/${encodeURIComponent(id)}/pdf`, {
      credentials: 'same-origin',
      headers: {
        'x-yuyouzhice-device': deviceId(),
        ...(state.csrfToken ? { 'x-yuyouzhice-csrf': state.csrfToken } : {})
      }
    });
    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.message || 'PDF 导出失败');
    }
    const blob = await response.blob();
    const href = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = href;
    link.download = tripPdfFilename(id);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.setTimeout(() => URL.revokeObjectURL(href), 1000);
    toast('PDF 已生成并开始下载。');
  } catch (error) {
    toast(error.message);
  }
}

function tripPdfFilename(id) {
  const saved = (state.savedTrips || []).find((item) => String(item?.id || '') === String(id));
  const title = saved?.trip?.title
    || (String(state.savedTripId || '') === String(id) ? state.trip?.title : '')
    || '重庆旅行行程';
  const safeTitle = String(title)
    .replace(/[\\/:*?"<>|\u0000-\u001F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80) || '重庆旅行行程';
  return `${safeTitle}-行程手册.pdf`;
}
