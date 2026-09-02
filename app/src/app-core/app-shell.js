import { state } from './state.js';
import { views } from './router.js';
import { restoreViewSnapshot, stashViewSnapshot } from './page-cache.js';
import { homeView } from '../pages/home-page.js';
import { renderHeader } from '../widgets/header/header.js';
import { renderLoader } from '../shared/ui/loader.js';
import { renderModals } from '../widgets/modals/modal-container.js';
import { renderToast } from '../shared/ui/toast.js';
import { floatingAdminReturnBtn } from '../features/admin-corpus/admin-service.js';
import { floatingChatDock, floatingPlannerProposalDock } from '../features/trip-chat/chat-panel.js';
import { scheduleTripMap, destroyTripMap, renderFullscreenMap } from '../widgets/trip-map/map-renderer.js';

let fullscreenMapRenderTimer = null;

// 只在本地开发环境记录根视图替换次数，便于定位“点一下就闪”的回归；生产不写入 window。
function recordLocalViewMount() {
  if (typeof window === 'undefined' || !['localhost', '127.0.0.1'].includes(window.location.hostname)) return;
  const stats = window.__yuyouzhiceRenderStats || {
    viewMounts: 0,
    firstMountedAt: performance.now(),
    lastView: ''
  };
  stats.viewMounts += 1;
  stats.lastMountedAt = performance.now();
  stats.lastView = state.view;
  window.__yuyouzhiceRenderStats = stats;
}

export function renderAppShell(app) {
  if (!document.getElementById('view-mount')) {
    const target = app || document.querySelector('#app');
    if (target) {
      target.innerHTML = `
        <div id="topbar-mount"></div>
        <div id="loader-mount"></div>
        <div id="view-mount"></div>
        <div id="floating-btn-mount"></div>
        <div id="modal-mount"></div>
        <div id="toast-mount"></div>
      `;
    }
  }
}

export function renderView() {
  const mount = document.getElementById('view-mount');
  if (!mount) return;
  recordLocalViewMount();
  // 只有 AI 规划的分阶段任务才允许锁定整页；普通保存、详情读取等异步请求
  // 可能只更新局部区域，不能因遗留的 loading 布尔值让整份行程失去点击能力。
  mount.className = state.loading && state.loadingPhase ? 'loading' : '';
  const previousView = mount.dataset.activeView || '';
  const nextView = state.view;
  if (previousView && previousView !== nextView) stashViewSnapshot(previousView, mount);
  mount.dataset.activeView = nextView;
  if (previousView !== nextView && restoreViewSnapshot(nextView, mount)) return;
  const viewFn = views[state.view] || homeView;
  mount.innerHTML = viewFn();
}

export function renderFloatingBtn() {
  const mount = document.getElementById('floating-btn-mount');
  if (!mount) return;
  if (state.view !== 'planning' || !state.trip) state.chatDockOpen = false;
  if (state.view !== 'planning' || !state.trip) state.plannerProposalDockOpen = false;
  mount.innerHTML = `${floatingAdminReturnBtn()}${floatingChatDock()}<div id="planner-proposal-dock-root" class="planner-proposal-dock-root ${state.chatDockOpen ? 'with-chat' : ''}">${floatingPlannerProposalDock()}</div>`;
}

/**
 * 主渲染协调器：精准分层局部挂载
 */
export function render() {
  renderAppShell();
  renderHeader();
  renderLoader();
  renderView();
  renderFloatingBtn();
  renderModals();
  renderToast();

  if (state.view === 'planning' && state.trip) {
    if (state.mapFullscreen) {
      if (fullscreenMapRenderTimer) window.clearTimeout(fullscreenMapRenderTimer);
      fullscreenMapRenderTimer = window.setTimeout(() => renderFullscreenMap().catch((error) => console.warn('全屏地图暂时不可用。', error)), 0);
    } else {
      scheduleTripMap();
    }
  } else {
    destroyTripMap();
  }
}
