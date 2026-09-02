import { state } from '../../app-core/state.js';
import { escapeHtml } from '../../shared/lib/security.js';

export function stopCard(stop, dayNumber) {
  const route = stop.routeFromPrevious;
  const routeChip = route?.selected?.summary
    ? `${route.selectedMode || '路线'} ${route.selected.summary}`
    : (stop.walk ? `路线 ${stop.walk}` : '路线待计算');

  const ticketLabel = stop.ticket || '免费开放 · 无需预约';
  const durationLabel = stop.duration || '约 90 分钟';
  const selectedStopIds = state.selectedStopIds instanceof Set
    ? state.selectedStopIds
    : new Set(state.selectedStopId ? [state.selectedStopId] : []);
  const isSelected = selectedStopIds.has(stop.id) || state.selectedStopId === stop.id;
  const isPinned = Boolean(state.pinnedStopIds && state.pinnedStopIds.has(stop.id));

  return `
    <article class="stop ${isSelected ? 'selected-stop-card' : ''} ${isPinned ? 'pinned-stop-card' : ''}" data-stop-id="${escapeHtml(stop.id)}">
      <div class="stop-icon tone-${escapeHtml(stop.tone)}">${escapeHtml(stop.icon)}</div>
      <div class="stop-body">
        <div class="stop-meta">
          <span class="stop-time-text">${escapeHtml(stop.time)} · ${escapeHtml(stop.district)} · 建议游玩 ${escapeHtml(durationLabel)}</span>
          ${isSelected ? '<span class="chip chip-selected">✓ 已选中</span>' : ''}
          ${isPinned ? '<span class="chip chip-pinned">📌 已固定</span>' : ''}
        </div>
        <h3>${escapeHtml(stop.name)}</h3>
        <p>${escapeHtml(stop.summary)}</p>
        <div class="notice recommendation-reason">推荐依据：${escapeHtml(stop.recommendationReason || '暂无推荐依据')}</div>
        <div class="chip-row">
          <span class="chip chip-ticket">门票 ${escapeHtml(ticketLabel.split('·')[0].trim())}</span>
          <span class="chip chip-time">游玩 ${escapeHtml(durationLabel)}</span>
          <span class="chip chip-transit">${escapeHtml(routeChip)}</span>
        </div>
      </div>
      <div class="stop-actions">
        <button class="secondary mini-btn ${isSelected ? 'active-btn' : ''}" data-action="select-stop" data-id="${escapeHtml(stop.id)}" data-name="${escapeHtml(stop.name)}" data-day="${dayNumber}">
          ${isSelected ? '取消选中' : '选中此站'}
        </button>
        <button class="ghost mini-btn ${isPinned ? 'active-btn' : ''}" data-action="toggle-pin-stop" data-id="${escapeHtml(stop.id)}" data-name="${escapeHtml(stop.name)}">
          ${isPinned ? '取消固定' : '📌 固定'}
        </button>
        <button class="ghost mini-btn" data-action="detail" data-id="${escapeHtml(stop.venueId)}" data-stop-id="${escapeHtml(stop.id)}" data-day="${dayNumber}" data-from="planning">详情</button>
        <button class="ghost mini-btn" data-action="navigate-to" data-name="${escapeHtml(stop.name)}" data-location="${escapeHtml(stop.location || '')}">到这去</button>
        <button class="danger-mini" data-action="remove-stop" data-id="${escapeHtml(stop.id)}">移除</button>
      </div>
    </article>
  `;
}

export function weatherBadge(day) {
  const weather = day && day.weather && typeof day.weather === 'object' ? day.weather : null;
  const status = String(weather?.status || '未知');
  const value = String(weather?.value || '不可用·待确认');
  const note = String(weather?.note || 'Java 尚未返回可核验的天气结果。');
  const dynamic = status === '动态';
  return `<span class="weather-badge ${dynamic ? 'weather-live' : 'weather-unavailable'}" title="${escapeHtml(note)}">${escapeHtml(value)}${dynamic ? ' · 高德' : ' · 可刷新'}</span>`;
}
