import { state } from '../../app-core/state.js';
import { escapeHtml } from '../../shared/lib/security.js';

export function fullscreenMapOverlay() {
  if (!state.mapFullscreen || !state.trip) return '';
  const trip = state.trip;
  const mapStops = trip.days.flatMap((day) => day.stops).filter((stop) => stop.location);

  return `
    <div class="fullscreen-map-overlay" id="fullscreen-map-modal">
      <div class="fullscreen-map-header">
        <div class="fullscreen-header-left">
          <span class="fullscreen-map-title">${escapeHtml(trip.title)} · 全屏路线导航</span>
          <span class="intel-badge">已定位 ${mapStops.length} 处机位</span>
        </div>
        <div class="map-day-tabs" style="margin:0;">
          <button class="map-tab ${state.selectedMapDay === 0 ? 'active' : ''}" data-action="map-day" data-day="0">全景路线</button>
          ${trip.days.map((d) => `
            <button class="map-tab ${state.selectedMapDay === d.day ? 'active' : ''}" data-action="map-day" data-day="${d.day}">第${d.day}天</button>
          `).join('')}
        </div>
        <button class="primary" data-action="close-fullscreen-map">退出全屏</button>
      </div>
      <div id="fullscreen-trip-map" class="fullscreen-map-canvas"></div>
    </div>
  `;
}
