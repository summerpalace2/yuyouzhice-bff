import { state } from '../../app-core/state.js';
import { escapeHtml } from '../../shared/lib/security.js';

export function deleteModal() {
  if (!state.deleteConfirm) return '';
  const item = state.savedTrips?.find((trip) => trip.id === state.deleteConfirm);
  return `
    <div class="modal-wrap">
      <div class="modal">
        <h2>删除这条行程？</h2>
        <p>${escapeHtml(item?.trip?.title || '这条已保存行程')} 将从当前账号中永久移除。</p>
        <div class="modal-actions">
          <button class="secondary" data-action="cancel-delete">取消</button>
          <button class="danger" data-action="confirm-delete">确认删除</button>
        </div>
      </div>
    </div>
  `;
}
