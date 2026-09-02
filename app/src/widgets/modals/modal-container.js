import { state } from '../../app-core/state.js';
import { escapeHtml } from '../../shared/lib/security.js';
import { loginModal } from '../../features/auth/auth-modal.js';
import { replanModal } from '../../features/trip-replan/replan-modal.js';
import { deleteModal } from '../../features/trip-save/delete-modal.js';
import { fullscreenMapOverlay } from '../trip-map/map-overlay.js';
import { renderFullscreenMap } from '../trip-map/map-renderer.js';
import { adminOverlays } from '../../pages/admin-page.js';

let fullscreenMapRenderTimer = null;

export function feedbackModal() {
  if (!state.feedbackOpen) return '';
  const prompts = ['走路太多，希望更轻松', '时间衔接不合适', '想多安排夜景', '想吃更地道的火锅', '希望增加室内景点'];
  return `
    <div class="modal-wrap feedback-letter-wrap">
      <div class="modal feedback-letter-modal">
        <div class="feedback-letter-head"><span>给渝游智策的一封信</span><button class="modal-close" data-action="close-feedback" aria-label="关闭">×</button></div>
        <h2>这次行程，哪里还可以更好？</h2>
        <p>你的描述会进入管理员收件箱，仅用于改进产品；不会自动改写你的长期旅行记忆。</p>
        <textarea id="feedback-letter-input" class="feedback-letter-input" maxlength="600" placeholder="例如：第二天下午的景点距离有点远，想换成室内、少走路的安排。">${escapeHtml(state.feedbackDraft || '')}</textarea>
        <div class="feedback-letter-quick"><span>快速填充</span>${prompts.map((prompt) => `
            <button class="chip" data-action="feedback-fill" data-content="${escapeHtml(prompt)}">${escapeHtml(prompt)}</button>
          `).join('')}
        </div>
        <div class="modal-actions">
          <button class="secondary" data-action="close-feedback">暂不发送</button>
          <button class="primary" data-action="feedback-submit">发送这封信</button>
        </div>
      </div>
    </div>
  `;
}

export function memoryModal() {
  if (!state.memoryProposal) return '';
  return `
    <div class="modal-wrap">
      <div class="modal">
        <h2>记住这个偏好吗？</h2>
        <p>${escapeHtml(state.memoryProposal.copy)} 记住后，之后的规划会优先参考；仅本次则不会写入偏好。</p>
        <div class="modal-actions">
          <button class="secondary" data-action="memory-once">仅本次有效</button>
          <button class="primary" data-action="memory-save">记住偏好</button>
        </div>
      </div>
    </div>
  `;
}

export function preferenceModal() {
  if (!state.preferenceProposal) return '';
  return `
    <div class="modal-wrap">
      <div class="modal">
        <h2>沿用已确认偏好吗？</h2>
        <p>${escapeHtml(state.preferenceProposal.copy)} 只有选择“沿用”，它才会进入这次规划；选择忽略不会修改长期偏好。</p>
        <div class="modal-actions">
          <button class="secondary" data-action="preference-ignore">本次忽略</button>
          <button class="primary" data-action="preference-use">沿用偏好</button>
        </div>
      </div>
    </div>
  `;
}

/**
 * 局部更新：仅渲染弹窗层，不触碰底层页面 DOM
 */
export function renderModals() {
  const mount = document.getElementById('modal-mount');
  if (!mount) return;
  mount.innerHTML = `
    ${loginModal()}
    ${replanModal()}
    ${memoryModal()}
    ${preferenceModal()}
    ${deleteModal()}
    ${feedbackModal()}
    ${adminOverlays()}
    ${fullscreenMapOverlay()}
  `;
  if (state.mapFullscreen && state.trip) {
    if (fullscreenMapRenderTimer) window.clearTimeout(fullscreenMapRenderTimer);
    fullscreenMapRenderTimer = window.setTimeout(() => renderFullscreenMap().catch((error) => console.warn('全屏地图暂时不可用。', error)), 0);
  }
}
