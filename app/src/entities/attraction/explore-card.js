import { state } from '../../app-core/state.js';
import { escapeHtml } from '../../shared/lib/security.js';

export function renderExploreCardHtml(item) {
  const img = `/images/attractions/${item.id}.svg`;
  const alreadyInTrip = state.trip?.days?.some((d) => d.stops.some((s) => s.venueId === item.id));
  const totalDays = state.trip?.days?.length || 2;

  return `
    <article class="panel explore-card">
      <div class="explore-card-thumb" style="background-image:url('${escapeHtml(img)}')">
        <span class="explore-cat-badge">${escapeHtml(item.category)}</span>
      </div>
      <div class="explore-card-body">
        <div class="eyebrow">${escapeHtml(item.district)} · ${escapeHtml(item.ticket.split('·')[0])}</div>
        <h3>${escapeHtml(item.name)}</h3>
        <p>${escapeHtml(item.summary)}</p>
        <div class="chip-row">
          ${(item.tags || []).map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join('')}
        </div>
        <div class="notice explore-fit">${escapeHtml(item.fit)}</div>
        <div class="modal-actions explore-actions">
          <button class="ghost" data-action="detail" data-id="${escapeHtml(item.id)}" data-from="explore">查看详情</button>
          ${state.trip ? `
            <div class="explore-add-wrap">
              <select class="explore-day-select" id="explore-day-${escapeHtml(item.id)}">
                ${Array.from({ length: totalDays }, (_, i) => `<option value="${i + 1}">第${i + 1}天</option>`).join('')}
              </select>
              <button class="primary ${alreadyInTrip ? 'button-secondary' : ''}" data-action="explore-add-custom" data-id="${escapeHtml(item.id)}">
                ${alreadyInTrip ? '继续加入' : '加入行程'}
              </button>
            </div>
          ` : ''}
        </div>
      </div>
    </article>
  `;
}
