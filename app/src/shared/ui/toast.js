import { state } from '../../app-core/state.js';
import { escapeHtml } from '../lib/security.js';

let toastTimer = null;

/**
 * 局部更新：仅渲染 Toast 气泡，不刷新任何其他区域
 */
export function renderToast() {
  const mount = document.getElementById('toast-mount');
  if (!mount) return;
  mount.innerHTML = state.toast ? `<div class="toast">${escapeHtml(state.toast)}</div>` : '';
}

/**
 * 轻量级 Toast 弹出（0ms 局部 DOM 挂载，完全不触发视图重绘）
 */
export function toast(message) {
  state.toast = message;
  if (toastTimer) window.clearTimeout(toastTimer);
  renderToast();
  toastTimer = window.setTimeout(() => {
    toastTimer = null;
    state.toast = '';
    renderToast();
  }, 2600);
}
