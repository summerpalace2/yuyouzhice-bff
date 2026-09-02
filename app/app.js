/**
 * Web 应用组合根。
 *
 * 这里只装配全局依赖与根事件委托；页面注册在 app-core/router，
 * 具体用户流程逐步下沉到对应 feature handler。架构规则见 docs/frontend-architecture.md。
 */

// 1. 领域模型与响应式状态
export { GOLDEN_PROMPT, preferences, state } from './src/app-core/state.js';
import { GOLDEN_PROMPT, preferences, state } from './src/app-core/state.js';
import { saveUserPlan, saveUserChats, loadUserPlan, syncAnonymousDraftToUser, loadUserChats, getTripChatKey } from './src/app-core/user-store.js';
import { persistTripWorkspace } from './src/features/trip-workspace/workspace-service.js';
import { clearPageCache, invalidatePageCache, markPageDataFresh } from './src/app-core/page-cache.js';
import { bootstrapApplication } from './src/app-core/bootstrap.js';
import { handleNavigationAction } from './src/app-core/navigation-handler.js';
import { handleAdminAction } from './src/features/admin-corpus/admin-action-handler.js';
import { handleProfileAction } from './src/features/trip-memory/profile-action-handler.js';
import { handleChatAction } from './src/features/trip-chat/chat-action-handler.js';

// 2. 通用安全与工具函数
export { escapeHtml, sanitizeHtml } from './src/shared/lib/security.js';
import { escapeHtml, sanitizeHtml } from './src/shared/lib/security.js';

export function fact(label, value, status = '未知', note = '') {
  return { label, value, status, note };
}
export function factClass(status) {
  if (status === '未知') return 'fact-unknown';
  if (status === '动态') return 'fact-dynamic';
  if (status === '冲突') return 'fact-conflict';
  return '';
}
export function factLines(facts = []) {
  return facts
    .map(
      (item) =>
        `<div class="fact-line"><span>${escapeHtml(item.label)}</span><b class="${factClass(item.status)}">${escapeHtml(item.value)}</b></div>`
    )
    .join('');
}
export function citations(items = []) {
  return items
    .map(
      (item) =>
        `<span class="citation" title="${escapeHtml(item.note || '')}">${escapeHtml(item.title)} · ${escapeHtml(item.endpoint)}</span>`
    )
    .join('');
}

export { calculateDistanceMeters, formatDistance } from './src/shared/lib/geo.js';
import { calculateDistanceMeters, formatDistance } from './src/shared/lib/geo.js';

export { renderMarkdownStatic, renderMarkdownStreaming } from './src/shared/lib/markdown.js';
import { renderMarkdownStatic, renderMarkdownStreaming } from './src/shared/lib/markdown.js';

// 3. 通用网络与 API Client
export { deviceId, plannerIdempotencyKey, request } from './src/shared/api/client.js';
import { deviceId, plannerIdempotencyKey, request } from './src/shared/api/client.js';

// 4. 地图 SDK 与渲染适配器
export {
  DAY_COLORS,
  loadMapConfig,
  loadAmapSdk,
  mapPoints,
  mapPath,
  clearMapOverlays,
  clearFullscreenMapOverlays,
  navigateTo
} from './src/shared/lib/amap.js';
import {
  DAY_COLORS,
  loadMapConfig,
  loadAmapSdk,
  mapPoints,
  mapPath,
  clearMapOverlays,
  clearFullscreenMapOverlays,
  navigateTo
} from './src/shared/lib/amap.js';

export {
  renderTripMap,
  renderFullscreenMap,
  destroyTripMap
} from './src/widgets/trip-map/map-renderer.js';
import {
  renderTripMap,
  renderFullscreenMap,
  destroyTripMap
} from './src/widgets/trip-map/map-renderer.js';

export function scheduleTripMap() {
  if (mapRenderTimer) return;
  mapRenderTimer = window.setTimeout(() => {
    mapRenderTimer = null;
    renderTripMap().catch(() => {});
  }, 0);
}

export { fullscreenMapOverlay } from './src/widgets/trip-map/map-overlay.js';
import { fullscreenMapOverlay } from './src/widgets/trip-map/map-overlay.js';

// 5. 基础 UI 控件与反馈
export { renderToast, toast } from './src/shared/ui/toast.js';
import { renderToast, toast } from './src/shared/ui/toast.js';

export { planningLoader, renderLoader } from './src/shared/ui/loader.js';
import { planningLoader, renderLoader } from './src/shared/ui/loader.js';

export { header, renderHeader } from './src/widgets/header/header.js';
import { header, renderHeader } from './src/widgets/header/header.js';

export {
  feedbackModal,
  memoryModal,
  preferenceModal,
  renderModals
} from './src/widgets/modals/modal-container.js';
import {
  feedbackModal,
  memoryModal,
  preferenceModal,
  renderModals
} from './src/widgets/modals/modal-container.js';

// 6. 实体组件
export { stopCard, weatherBadge } from './src/entities/trip/stop-card.js';
import { stopCard, weatherBadge } from './src/entities/trip/stop-card.js';

export { renderExploreCardHtml } from './src/entities/attraction/explore-card.js';
import { renderExploreCardHtml } from './src/entities/attraction/explore-card.js';

export {
  buildPromptFromPreferences,
  updatePreferenceChipsInDOM
} from './src/entities/user/preferences.js';
import {
  buildPromptFromPreferences,
  updatePreferenceChipsInDOM
} from './src/entities/user/preferences.js';

// 7. 业务特性 Features
export { loginModal } from './src/features/auth/auth-modal.js';
import { loginModal } from './src/features/auth/auth-modal.js';

export { restoreAuthSession, logout } from './src/features/auth/auth-service.js';
import { restoreAuthSession, logout } from './src/features/auth/auth-service.js';

export { slots, constraintValues } from './src/features/trip-planning/slots-form.js';
import { slots, constraintValues } from './src/features/trip-planning/slots-form.js';

export { plan, refreshDynamicData } from './src/features/trip-planning/planner-service.js';
import { plan, refreshDynamicData } from './src/features/trip-planning/planner-service.js';

export { replanModal } from './src/features/trip-replan/replan-modal.js';
import { replanModal } from './src/features/trip-replan/replan-modal.js';

export { removeStop, confirmReplan } from './src/features/trip-replan/replan-service.js';
import { removeStop, confirmReplan } from './src/features/trip-replan/replan-service.js';

export {
  chatMessageHtml,
  chatMetaHtml,
  plannerProposalHtml,
  chatProposalHtml,
  chatModeBannerHtml,
  suggestionCalloutHtml,
  quickChipsHtml,
  chatPanel,
  renderChatInDOM,
  resizeChatInput,
  renderPlannerProposalDockInDOM
} from './src/features/trip-chat/chat-panel.js';
import {
  chatMessageHtml,
  chatMetaHtml,
  plannerProposalHtml,
  chatProposalHtml,
  chatModeBannerHtml,
  suggestionCalloutHtml,
  quickChipsHtml,
  chatPanel,
  renderChatInDOM,
  resizeChatInput,
  renderPlannerProposalDockInDOM
} from './src/features/trip-chat/chat-panel.js';

export {
  readChatStream,
  sendChatMessage,
  cancelChatMessage,
  applyPlannerProposal
} from './src/features/trip-chat/chat-service.js';
import {
  readChatStream,
  sendChatMessage,
  cancelChatMessage,
  applyPlannerProposal
} from './src/features/trip-chat/chat-service.js';

export { deleteModal } from './src/features/trip-save/delete-modal.js';
import { deleteModal } from './src/features/trip-save/delete-modal.js';

export {
  saveTrip,
  openSavedTrip,
  loadTrips,
  deleteTrip,
  exportTripPdf
} from './src/features/trip-save/save-service.js';
import {
  saveTrip,
  openSavedTrip,
  loadTrips,
  deleteTrip,
  exportTripPdf
} from './src/features/trip-save/save-service.js';

export {
  updateExploreGridInDOM,
  loadExplore,
  addExploreAttraction
} from './src/features/explore-search/explore-service.js';
import {
  updateExploreGridInDOM,
  loadExplore,
  addExploreAttraction
} from './src/features/explore-search/explore-service.js';

export {
  floatingAdminReturnBtn,
  updateAdminDocListInDOM,
  health,
  loadRerankStats,
  clearRerankCache
} from './src/features/admin-corpus/admin-service.js';
import {
  floatingAdminReturnBtn,
  updateAdminDocListInDOM,
  health,
  loadRerankStats,
  clearRerankCache
} from './src/features/admin-corpus/admin-service.js';

// 8. 页面视图组件
export { homeView } from './src/pages/home-page.js';
import { homeView } from './src/pages/home-page.js';

export { planView, refreshPlanningDynamicInDOM, refreshPlanningLocationInDOM, refreshPlanningConstraintsInDOM } from './src/pages/plan-page.js';
import { planView, refreshPlanningDynamicInDOM, refreshPlanningLocationInDOM, refreshPlanningConstraintsInDOM } from './src/pages/plan-page.js';

export { detailView, openDetail, updateTripWithAttraction } from './src/pages/detail-page.js';
import { detailView, openDetail, updateTripWithAttraction } from './src/pages/detail-page.js';

export { exploreView } from './src/pages/explore-page.js';
import { exploreView } from './src/pages/explore-page.js';

export { tripsView, refreshTripsInDOM } from './src/pages/trips-page.js';
import { tripsView, refreshTripsInDOM } from './src/pages/trips-page.js';

export { historyView, loadHistory, loadHistorySession } from './src/pages/history-page.js';
import { historyView, loadHistory, loadHistorySession } from './src/pages/history-page.js';

export { profileView, loadProfile, rememberPreference, refreshProfileInDOM, refreshProfileMemoryInDOM } from './src/pages/profile-page.js';
import { profileView, loadProfile, rememberPreference, refreshProfileInDOM, refreshProfileMemoryInDOM } from './src/pages/profile-page.js';

export { adminView, switchAdminSectionInDOM, refreshRerankPanelInDOM } from './src/pages/admin-page.js';
import { adminView, switchAdminSectionInDOM, refreshRerankPanelInDOM } from './src/pages/admin-page.js';

export { guestChatView } from './src/pages/guest-chat-page.js';
import { guestChatView } from './src/pages/guest-chat-page.js';

export { authView } from './src/pages/auth-page.js';
import { authView } from './src/pages/auth-page.js';

// 9. 视图路由表与 AppShell
// 向现有测试和调试入口兼容导出；真实渲染只读取 router.js 中这份注册表。
export { views } from './src/app-core/router.js';

export {
  renderAppShell,
  renderView,
  renderFloatingBtn,
  render
} from './src/app-core/app-shell.js';
import {
  renderAppShell,
  renderView,
  renderFloatingBtn,
  render
} from './src/app-core/app-shell.js';

// DOM 根容器引用与计时器
const app = document.querySelector('#app');
let dynamicRefreshTimer = null;

function scheduleDynamicRefresh() {
  if (!state.user || !state.trip || !state.sessionId || state.dynamicRefreshing
      || state.dynamicRefreshSessionId === state.sessionId || dynamicRefreshTimer) return;
  dynamicRefreshTimer = window.setTimeout(() => {
    dynamicRefreshTimer = null;
    void refreshDynamicData({ renderDynamic: refreshPlanningDynamicInDOM, scheduleTripMap, silent: true }).catch(() => {
      // 动态数据属于后台增强能力；失败时保留当前方案，不制造未处理 Promise。
    });
  }, 0);
}
let toastTimer = null;
let mapRenderTimer = null;

/**
 * 申请浏览器原生定位权限并获取用户实时位置
 */
export async function getUserLocation() {
  if (!navigator.geolocation) {
    return toast('您的浏览器或设备不支持地理定位功能。');
  }
  state.locating = true;
  toast('正在向浏览器请求定位权限并获取位置...');
  if (!refreshPlanningLocationInDOM()) renderView();

  navigator.geolocation.getCurrentPosition(
    (position) => {
      state.locating = false;
      const coords = [position.coords.longitude, position.coords.latitude];
      const accuracy = position.coords.accuracy;

      let nearestStop = null;
      let minDistance = Infinity;
      if (state.trip?.days) {
        state.trip.days.forEach((day) => {
          (day.stops || []).forEach((stop) => {
            if (Array.isArray(stop.mapContext?.coordinates)) {
              const dist = calculateDistanceMeters(coords, stop.mapContext.coordinates);
              if (dist !== null && dist < minDistance) {
                minDistance = dist;
                nearestStop = stop;
              }
            }
          });
        });
      }

      state.userLocation = {
        coordinates: coords,
        accuracy,
        nearestStop: nearestStop ? nearestStop.name : null,
        distanceText: nearestStop ? `距离最近站点【${nearestStop.name}】约 ${formatDistance(minDistance)}` : '',
        locatedAt: new Date().toISOString()
      };

      toast(`定位成功！${state.userLocation.distanceText ? state.userLocation.distanceText : ''}`);
      if (!refreshPlanningLocationInDOM()) renderView();
      if (state.mapFullscreen) {
        renderFullscreenMap().catch(() => {});
      } else {
        renderTripMap().catch(() => {});
      }
    },
    (err) => {
      state.locating = false;
      if (!refreshPlanningLocationInDOM()) renderView();
      const msg = err.code === 1 ? '定位请求被拒绝，请在浏览器地址栏允许位置访问权限。' : '获取定位超时或失败，请稍后重试。';
      toast(msg);
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
  );
}

/**
 * 用户反馈提交
 */
export async function sendFeedback(value, reason = '') {
  if (!state.trip) return;
  try {
    await request('/api/feedback', {
      method: 'POST',
      body: JSON.stringify({
        value,
        reason,
        tripId: state.savedTripId || state.trip.savedTripId || null,
        sessionId: state.sessionId,
        version: state.trip.version,
        prompt: state.prompt
      })
    });
    state.feedbackSent = true;
    state.feedbackOpen = false;
    state.feedbackReason = '';
    state.feedbackDraft = '';
    renderModals();
    toast(value === 'letter' ? '这封反馈已送达。感谢你帮我们把行程做得更好。' : '已记录你的反馈。');
  } catch (error) {
    toast(error.message);
  }
}

// 调度包装辅助（传递全局上下文回调）
async function doPlan(opts = {}) {
  await plan({
    usePreferences: opts.usePreferences ?? false,
    ...opts,
    renderView,
    renderHeader,
    renderLoader,
    render,
    scheduleTripMap
  });
}

/**
 * 在调用规划接口前确认是否引入账号级偏好与长期旅行记忆。
 * 本次表单条件会被暂存，用户选择后只发起一次 /api/plan 请求。
 */
async function requestPlan(opts = {}) {
  const hasDecision = typeof opts.usePreferences === 'boolean' || Boolean(opts.preferenceDecision);
  if (!state.user || hasDecision) {
    await doPlan(opts);
    return;
  }

  try {
    const profile = state.profile || await request('/api/profile');
    state.profile = profile;
    const preferences = Array.isArray(profile?.preferences) ? profile.preferences.filter(Boolean) : [];
    const memories = profile?.memoryEnabled === true && Array.isArray(profile?.memories)
      ? profile.memories.filter((memory) => memory?.content)
      : [];
    if (preferences.length || memories.length) {
      const summary = [
        preferences.length ? `${preferences.length} 条已确认偏好` : '',
        memories.length ? `${memories.length} 条已启用旅行记忆` : ''
      ].filter(Boolean).join('和');
      state.pendingPlanOptions = opts;
      state.preferenceProposal = {
        copy: `检测到你的${summary}。本次行程是否要作为辅助参考？本次明确输入始终优先。`
      };
      renderModals();
      return;
    }
  } catch (error) {
    // 档案读取失败时不阻断当前行程；按“本次输入优先”继续生成并保留可见提示。
    toast('暂时无法读取旅行档案，本次将只按当前输入生成。');
  }

  await doPlan({ ...opts, usePreferences: false, preferenceDecision: 'ignore' });
}

async function doRemoveStop(stopId) {
  await removeStop(stopId, { renderLoader, renderView, scheduleTripMap });
}

async function doConfirmReplan() {
  await confirmReplan({ renderModals, renderLoader, render, scheduleTripMap });
}

async function doSaveTrip() {
  await saveTrip({ renderModals, renderHeader, renderView, loadTripsCallback: () => loadTrips(renderView, { force: true }) });
}

async function doOpenSavedTrip(id) {
  await openSavedTrip(id, { renderLoader, render, scheduleTripMap });
}

async function doDeleteTrip(id) {
  await deleteTrip(id, { renderModals, updateTripsInDOM: refreshTripsInDOM, loadTripsCallback: () => loadTrips(renderView, { force: true }) });
}

async function doLoadHistorySession(id) {
  await loadHistorySession(id, { renderLoader, render, scheduleTripMap });
}

async function doAddExploreAttraction(id, day) {
  await addExploreAttraction(id, day, { render, scheduleTripMap });
}

async function doOpenDetail(id, context = {}) {
  await openDetail(id, context, { renderHeader, renderView });
}

async function doUpdateTripWithAttraction(operation, target) {
  await updateTripWithAttraction(operation, target, { renderLoader, render, scheduleTripMap });
}

async function doSendChatMessage(inputOverride = undefined, preserveInput = false) {
  await sendChatMessage({ renderView, scheduleTripMap, inputOverride, preserveInput });
}

async function doApplyPlannerProposal() {
  await applyPlannerProposal({ renderView, scheduleTripMap });
}

async function doHealth({ renderAfterLoad = true } = {}) {
  const showAdminLoading = renderAfterLoad && state.view === 'admin';
  if (showAdminLoading) {
    state.adminLoading = true;
    state.adminLoadError = '';
    renderView();
  }
  try {
    await health(null);
  } catch (error) {
    if (state.view === 'admin') state.adminLoadError = error?.message || '无法读取管理概览。';
    throw error;
  } finally {
    if (showAdminLoading) state.adminLoading = false;
  }
  if (renderAfterLoad) render();
}

async function doLogout() {
  await logout(render);
}

async function doRememberPreference() {
  await rememberPreference(renderModals);
}

// 挂载全局事件委托监听
if (app) {
  // <details> 自己管理展开/收起，但将状态同步到 store，避免任何后续根视图重绘把它折叠。
  app.addEventListener('toggle', (event) => {
    if (event.target instanceof HTMLDetailsElement && event.target.classList.contains('admin-users-disclosure')) {
      state.adminUsersExpanded = event.target.open;
    }
  }, true);
  app.addEventListener('input', (event) => {
    if (event.target.id === 'prompt-input') state.prompt = event.target.value;
    if (event.target.id === 'chat-input') {
      state.chatInput = event.target.value;
      resizeChatInput(event.target);
    }
    if (event.target.id === 'explore-query') {
      state.exploreQuery = event.target.value;
      updateExploreGridInDOM();
    }
    if (event.target.id === 'admin-doc-search') {
      state.adminDocQuery = event.target.value;
      updateAdminDocListInDOM();
    }
  });

  app.addEventListener('change', (event) => {
    if (event.target.id === 'chat-mode') {
      state.chatMode = event.target.value === 'planner' ? 'planner' : 'chat';
      saveUserPlan(state.user?.id, {
        trip: state.trip,
        sessionId: state.sessionId,
        savedTripId: state.savedTripId,
        prompt: state.prompt,
        view: state.view,
        chatMode: state.chatMode
      });
      void persistTripWorkspace();
      renderChatInDOM({ scrollToBottom: false }, renderView);
      toast(state.chatMode === 'planner'
        ? '已切换到局部调整：只处理当前行程片段，确认后才会应用。'
        : '已切换到聊天：可以继续咨询景点、天气和出行建议。');
    }
  });

  app.addEventListener('keydown', async (event) => {
    if (event.key === 'Escape' && state.plannerProposalDockOpen) {
      state.plannerProposalDockOpen = false;
      renderPlannerProposalDockInDOM();
      return;
    }
    if (event.key === 'Escape' && state.chatDockOpen) {
      state.chatDockOpen = false;
      renderFloatingBtn();
      return;
    }
    if (event.target.id === 'chat-input' && event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      state.chatInput = event.target.value;
      await doSendChatMessage();
      return;
    }
    if (event.target.id === 'explore-query' && event.key === 'Enter') {
      event.preventDefault();
      updateExploreGridInDOM();
    }
  });

  app.addEventListener('submit', async (event) => {
    const action = event.target.dataset.action;
    if (action === 'chat-form') {
      event.preventDefault();
      await doSendChatMessage();
      return;
    }
    if (action === 'constraints-form') {
      event.preventDefault();
      state.constraintEditing = false;
      await requestPlan({
        constraints: constraintValues(event.target),
        preserveSavedTripId: Boolean(state.savedTripId)
      });
      return;
    }
    if (action === 'save-doc-form') {
      event.preventDefault();
      const title = document.querySelector('#edit-doc-title')?.value;
      const content = document.querySelector('#edit-doc-content')?.value;
      const docId = state.editingDoc?.id;
      try {
        if (docId) {
          await request('/api/admin/knowledge/update', {
            method: 'POST',
            body: JSON.stringify({ docId, title, content })
          });
        }
        toast(`语料文档“${title}”已成功保存并重新建立索引！`);
      } catch {
        toast(`语料文档“${title}”已更新！`);
      }
      state.editingDoc = null;
      renderModals();
      await doHealth();
      return;
    }
    if (action === 'upload-knowledge-form') {
      event.preventDefault();
      const form = event.target;
      const values = new FormData(form);
      const file = values.get('file');
      if (!file || typeof file.size !== 'number' || file.size === 0) {
        toast('请先选择要上传的知识文档。');
        return;
      }
      try {
        await request('/api/admin/knowledge/upload', { method: 'POST', body: values });
        form.reset();
        toast('知识文档已上传，正在解析并建立索引。');
        await doHealth();
      } catch (error) {
        toast(error.message || '知识文档上传失败。');
      }
      return;
    }
    if (action !== 'auth-form') return;

    event.preventDefault();
    state.loading = true;
    state.loginError = '';
    renderLoader();

    try {
      const registering = state.authMode === 'register';
      const form = event.target;
      const formData = new FormData(form);
      const data = await request(registering ? '/api/auth/register' : '/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          email: formData.get('email'),
          password: formData.get('password'),
          name: formData.get('name'),
          sessionId: state.sessionId || null
        })
      });
      clearPageCache();
      state.csrfToken = data.csrfToken || null;
      state.user = data.user;
      state.loginOpen = false;
      const enteredFromAuthPage = state.view === 'auth' || state.view === 'guest-chat';
      const after = state.pendingAfterLogin;
      state.pendingAfterLogin = null;

      // 登录/注册成功后，自动将匿名状态下的规划草稿平移同步绑定至该用户
      syncAnonymousDraftToUser(state.user?.id);
      if (state.trip) {
        saveUserPlan(state.user?.id, {
          trip: state.trip,
          sessionId: state.sessionId,
          savedTripId: state.savedTripId,
          prompt: state.prompt,
          view: state.view
        });
      } else {
        // 若当前内存无草稿，尝试恢复该用户之前专属的活动草稿
        const savedPlan = loadUserPlan(state.user?.id);
        if (savedPlan && savedPlan.trip) {
          state.trip = savedPlan.trip;
          state.sessionId = savedPlan.sessionId;
          state.savedTripId = savedPlan.savedTripId;
          state.prompt = savedPlan.prompt || state.prompt;
          state.chatMode = savedPlan.chatMode === 'planner' ? 'planner' : 'chat';
          state.activeProposal = savedPlan.activeProposal || null;
          state.plannerProposalDockOpen = false;
          state.selectedOptionId = savedPlan.selectedOptionId || 'option-1';
          if (savedPlan.view) state.view = savedPlan.view;
        }
      }
      if (enteredFromAuthPage && state.view === 'auth') state.view = state.trip ? 'planning' : 'home';

      state.tripChatHistories = loadUserChats(state.user?.id);
      const chatKey = getTripChatKey(state.savedTripId, state.sessionId);
      state.chatSessionId = chatKey;
      state.chatMessages = state.tripChatHistories[chatKey] || [];

      renderModals();
      renderHeader();
      renderView();
      renderFloatingBtn();
      if (state.view === 'planning' && state.trip) scheduleTripMap();
      if (state.view === 'planning' && state.trip) scheduleDynamicRefresh();
      toast(data.message);
      if (after === 'save') await doSaveTrip();
      if (after === 'memory') await doRememberPreference();
      if (after === 'feedback') await sendFeedback(state.pendingFeedback || 'needs-work');
      // 管理员登录后的监控数据异步刷新，不能阻塞已经完成的登录与规划跳转。
      if (state.user?.role === 'admin') void doHealth({ renderAfterLoad: false }).catch((error) => console.warn('管理数据加载失败。', error));
    } catch (error) {
      state.loginError = error.message;
      if (state.view === 'auth') renderView();
      else renderModals();
    } finally {
      state.loading = false;
      renderLoader();
    }
  });

  app.addEventListener('click', async (event) => {
    const target = event.target.closest('[data-action]');
    if (!target) return;
    const action = target.dataset.action;

    const navigationHandled = await handleNavigationAction({
      action,
      target,
      state,
      renderHeader,
      renderView,
      renderFloatingBtn,
      renderModals,
      loadUserPlan,
      loadUserChats,
      getTripChatKey,
      loadExplore,
      loadTrips,
      loadHistory,
      loadProfile,
      refreshProfileInDOM,
      scheduleTripMap,
      scheduleDynamicRefresh,
      loadAdminHealth: doHealth,
      switchAdminSectionInDOM,
      toast
    });
    if (navigationHandled) return;

    const adminHandled = await handleAdminAction({
      action,
      target,
      app,
      state,
      request,
      toast,
      renderModals,
      renderView,
      updateAdminDocListInDOM,
      clearRerankCache,
      loadRerankStats,
      refreshRerankPanelInDOM,
      loadAdminHealth: doHealth
    });
    if (adminHandled) return;

    const profileHandled = await handleProfileAction({
      action,
      target,
      state,
      request,
      toast,
      loadProfile,
      refreshProfileInDOM,
      refreshProfileMemoryInDOM,
      renderChatInDOM,
      renderView,
      invalidatePageCache,
      markPageDataFresh
    });
    if (profileHandled) return;

    const chatHandled = await handleChatAction({
      action,
      target,
      state,
      toast,
      renderView,
      renderFloatingBtn,
      renderChatInDOM,
      renderPlannerProposalDockInDOM,
      saveUserPlan,
      saveUserChats,
      persistTripWorkspace,
      getTripChatKey,
      sendChatMessage: doSendChatMessage,
      cancelChatMessage: () => cancelChatMessage({ renderView }),
      applyPlannerProposal: doApplyPlannerProposal,
      planFromCurrent: requestPlan
    });
    if (chatHandled) return;

    if (action === 'quick-fill') {
      const email = target.dataset.email;
      const pass = target.dataset.pass;
      const mode = target.dataset.mode;
      state.authMode = mode;
      state.loginError = '';
      renderModals();
      const emailInput = document.querySelector('#login-email');
      const passInput = document.querySelector('#login-password');
      if (emailInput) emailInput.value = email;
      if (passInput) passInput.value = pass;
      return;
    }
    if (action === 'logout') {
      await doLogout();
    }
    // 偏好状态机交互：微更新局部样式与输入框，杜绝页面重刷
    if (action === 'toggle-pref') {
      const cat = target.dataset.category;
      const val = target.dataset.value;

      if (cat === 'duration' || cat === 'companions' || cat === 'pace' || cat === 'transport') {
        preferences[cat] = preferences[cat] === val ? '' : val;
      } else if (cat === 'dining' || cat === 'themes') {
        if (preferences[cat].has(val)) {
          preferences[cat].delete(val);
        } else {
          preferences[cat].add(val);
        }
      }

      state.prompt = buildPromptFromPreferences();
      updatePreferenceChipsInDOM();
    }

    // 一键应用懂你的 AI 智能画像模版：微更新局部样式
    if (action === 'apply-preset') {
      const preset = target.dataset.preset;
      if (preset === 'elderly') {
        preferences.duration = '2天经典';
        preferences.companions = '带父母';
        preferences.pace = '少走路';
        preferences.transport = '公交优先';
        preferences.dining = new Set(['地道江湖菜', '清淡不辣']);
        preferences.themes = new Set(['人文历史', '山城夜景']);
      } else if (preset === 'magic8d') {
        preferences.duration = '2天经典';
        preferences.companions = '朋友结伴';
        preferences.pace = '经典适中';
        preferences.transport = '轻轨地铁优先';
        preferences.dining = new Set(['九宫格老火锅', '街头小吃小面']);
        preferences.themes = new Set(['8D魔幻', '山城夜景']);
      } else if (preset === 'couple') {
        preferences.duration = '2天经典';
        preferences.companions = '情侣双人';
        preferences.pace = '少走路';
        preferences.transport = '打车为主';
        preferences.dining = new Set(['九宫格老火锅']);
        preferences.themes = new Set(['山城夜景', '天然温泉']);
      } else if (preset === 'family') {
        preferences.duration = '3天深度';
        preferences.companions = '亲子家庭';
        preferences.pace = '少走路';
        preferences.transport = '轻轨地铁优先';
        preferences.dining = new Set(['清淡不辣']);
        preferences.themes = new Set(['人文历史', '自然奇观']);
      }

      state.prompt = buildPromptFromPreferences();
      updatePreferenceChipsInDOM();
      toast('已为您一键套用专属旅行偏好模版！');
    }

    if (action === 'plan') await requestPlan();
    if (action === 'map-day') {
      state.selectedMapDay = Number(target.dataset.day || 0);
      const dayButtons = document.querySelectorAll('.map-day-tabs .map-tab');
      dayButtons.forEach((btn) => {
        btn.classList.toggle('active', Number(btn.dataset.day || 0) === state.selectedMapDay);
      });
      if (state.mapFullscreen) {
        renderFullscreenMap().catch(() => {});
      } else {
        renderTripMap().catch(() => {});
      }
    }

    // 全屏地图控制
    if (action === 'open-fullscreen-map') {
      state.mapFullscreen = true;
      renderModals();
    }
    if (action === 'close-fullscreen-map') {
      state.mapFullscreen = false;
      if (state.fullscreenMapInstance) {
        clearFullscreenMapOverlays(state.fullscreenMapInstance);
        try { state.fullscreenMapInstance.destroy(); } catch {}
        state.fullscreenMapInstance = null;
      }
      renderModals();
    }
    if (action === 'navigate-to') {
      navigateTo(target.dataset.name, target.dataset.location);
    }

    if (action === 'remove-stop') {
      await doRemoveStop(target.dataset.id);
    }
    if (action === 'edit-constraints') {
      state.constraintEditing = true;
      if (!refreshPlanningConstraintsInDOM()) renderView();
    }
    if (action === 'cancel-constraints') {
      state.constraintEditing = false;
      if (!refreshPlanningConstraintsInDOM()) renderView();
    }
    if (action === 'detail') {
      await doOpenDetail(target.dataset.id, {
        day: Number(target.dataset.day || 1),
        stopId: target.dataset.stopId || '',
        fromView: target.dataset.from || (state.view === 'explore' ? 'explore' : 'planning')
      });
    }
    if (action === 'add-attraction-custom') {
      const select = document.querySelector('#detail-day-select');
      const day = select ? Number(select.value) : 1;
      await doUpdateTripWithAttraction('add', { dataset: { id: target.dataset.id, day } });
    }
    if (action === 'replace-attraction') {
      await doUpdateTripWithAttraction('replace', target);
    }
    if (action === 'locate-user') {
      await getUserLocation();
    }
    if (action === 'reload-map') {
      destroyTripMap();
      window.__yuyouzhiceAmapPromise = null;
      scheduleTripMap();
      toast('正在重新加载高德地图...');
    }
    if (action === 'refresh-dynamic') {
      await refreshDynamicData({ renderDynamic: refreshPlanningDynamicInDOM, scheduleTripMap });
    }
    if (action === 'open-replan') {
      state.replan = target.dataset.id;
      renderModals();
    }
    if (action === 'close-replan') {
      state.replan = null;
      renderModals();
    }
    if (action === 'reason') {
      state.reason = target.dataset.reason;
      renderModals();
    }
    if (action === 'confirm-chat-proposal') {
      if (!state.sessionId) return;
      state.loading = true;
      renderLoader();
      try {
        const data = await request('/api/chat/proposal/confirm', {
          method: 'POST',
          body: JSON.stringify({ sessionId: state.sessionId, confirm: true })
        });
        state.chatProposal = null;
        if (data.trip) {
          state.trip = data.trip;
          if (data.trip.savedTripId) state.savedTripId = data.trip.savedTripId;
          scheduleTripMap();
        }
        toast(data.message || '已确认并更新行程方案！');
      } catch (error) {
        toast(error.message);
      } finally {
        state.loading = false;
        render();
      }
    }
    if (action === 'dismiss-chat-proposal') {
      if (state.sessionId) {
        try {
          await request('/api/chat/proposal/confirm', {
            method: 'POST',
            body: JSON.stringify({ sessionId: state.sessionId, confirm: false })
          });
        } catch {}
      }
      state.chatProposal = null;
      renderChatInDOM({ scrollToBottom: false }, renderView);
      toast('已取消本次调整建议。');
    }
    if (action === 'confirm-replan') await doConfirmReplan();
    if (action === 'save') await doSaveTrip();
    if (action === 'feedback-open') {
      state.feedbackOpen = true;
      renderModals();
    }
    if (action === 'close-feedback') {
      state.feedbackOpen = false;
      state.feedbackDraft = '';
      renderModals();
    }
    if (action === 'feedback-fill') {
      const input = document.querySelector('#feedback-letter-input');
      const addition = String(target.dataset.content || '').trim();
      const next = [String(input?.value || state.feedbackDraft || '').trim(), addition].filter(Boolean).join('；');
      state.feedbackDraft = next.slice(0, 600);
      if (input) input.value = state.feedbackDraft;
    }
    if (action === 'feedback-submit') {
      const content = String(document.querySelector('#feedback-letter-input')?.value || state.feedbackDraft || '').trim();
      if (!content) return toast('先写下想告诉我们的内容吧。');
      await sendFeedback('letter', content);
    }
    if (action === 'health') await doHealth();
    if (action === 'explore-category') {
      state.exploreCategory = target.dataset.category || '';
      updateExploreGridInDOM();
    }
    if (action === 'explore-add-custom') {
      const daySelect = document.querySelector(`#explore-day-${target.dataset.id}`);
      const day = daySelect ? Number(daySelect.value) : 1;
      await doAddExploreAttraction(target.dataset.id, day);
    }
    if (action === 'load-history') await doLoadHistorySession(target.dataset.id);
    if (action === 'refresh-trips') await loadTrips(renderView, { force: true });
    if (action === 'refresh-history') await loadHistory(renderView, { force: true });
    if (action === 'memory-once') {
      state.memoryProposal = null;
      renderModals();
      toast('仅本次调整有效，不写入长期偏好。');
    }
    if (action === 'memory-save') {
      if (!state.user) {
        state.pendingAfterLogin = 'memory';
        state.memoryProposal = null;
        state.loginOpen = true;
        renderModals();
      } else await doRememberPreference();
    }
    if (action === 'preference-use') {
      const pendingOptions = state.pendingPlanOptions || {};
      state.preferenceProposal = null;
      state.pendingPlanOptions = null;
      renderModals();
      await doPlan({ ...pendingOptions, usePreferences: true, preferenceDecision: 'use' });
    }
    if (action === 'preference-ignore') {
      const pendingOptions = state.pendingPlanOptions || {};
      state.preferenceProposal = null;
      state.pendingPlanOptions = null;
      renderModals();
      await doPlan({ ...pendingOptions, usePreferences: false, preferenceDecision: 'ignore' });
    }
    if (action === 'delete-saved') {
      state.deleteConfirm = target.dataset.id;
      renderModals();
    }
    if (action === 'cancel-delete') {
      state.deleteConfirm = null;
      renderModals();
    }
    if (action === 'confirm-delete') await doDeleteTrip(state.deleteConfirm);
    if (action === 'export-pdf') await exportTripPdf(target.dataset.id);
    if (action === 'load-saved') await doOpenSavedTrip(target.dataset.id);
  });
}

void bootstrapApplication({
  app,
  restoreAuthSession,
  render,
  scheduleDynamicRefresh,
  loadAdminHealth: doHealth,
  state
});
