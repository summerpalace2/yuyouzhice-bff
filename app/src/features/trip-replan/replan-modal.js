import { state } from '../../app-core/state.js';
import { escapeHtml } from '../../shared/lib/security.js';

export function replanModal() {
  if (!state.replan) return '';
  const reasons = ['少走路', '下雨了', '想换室内', '时间变少', '看夜景', '体验美食'];
  const targetStop = state.trip?.days?.flatMap((d) => d.stops)?.find((s) => s.id === state.replan || s.stableStopId === state.replan);

  return `
    <div class="modal-wrap">
      <div class="modal replan-preview-modal">
        <h2>局部智能重规划</h2>
        <p>当前调整站点：<strong>${escapeHtml(targetStop?.name || '当前站点')}</strong>。选择调整理由后，由服务端重新计算替代站点。</p>

        <div class="replan-reason-section">
          <label class="section-sub-label">调整理由：</label>
          <div class="reason-grid">
            ${reasons.map((reason) => `
              <button class="chip ${state.reason === reason ? 'selected' : ''}" data-action="reason" data-reason="${reason}">${reason}</button>
            `).join('')}
          </div>
        </div>

        <div class="notice">替代景点、路线与推荐依据将由 Java/BFF 返回；浏览器不在本地选择或排序候选。</div>

        <div class="modal-actions replan-modal-actions">
          <div class="replan-action-right">
            <button class="secondary" data-action="close-replan">取消</button>
            <button class="primary" data-action="confirm-replan">提交重规划</button>
          </div>
        </div>
      </div>
    </div>
  `;
}
