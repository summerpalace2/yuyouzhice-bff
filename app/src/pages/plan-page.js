import { state } from '../app-core/state.js';
import { escapeHtml } from '../shared/lib/security.js';
import { slots } from '../features/trip-planning/slots-form.js';
import { stopCard, weatherBadge } from '../entities/trip/stop-card.js';

function userLocationRowHtml() {
  if (!state.userLocation) return '';
  return `
    <div class="intel-row user-location-row" data-user-location-row>
      <strong>我的相对位置</strong>
      <p>当前设备坐标：${state.userLocation.coordinates[0].toFixed(4)}, ${state.userLocation.coordinates[1].toFixed(4)}（${escapeHtml(state.userLocation.distanceText || '已标出相对位置')}）</p>
    </div>
  `;
}

/**
 * 天气和定位只影响行程页中的少数节点。避免后台实时刷新重新挂载整个规划页、地图和聊天面板。
 */
export function refreshPlanningDynamicInDOM() {
  if (state.view !== 'planning' || !state.trip) return false;
  const refreshButton = document.querySelector('[data-dynamic-refresh-button]');
  if (refreshButton) {
    refreshButton.disabled = Boolean(state.dynamicRefreshing);
    refreshButton.textContent = state.dynamicRefreshing ? '刷新实时信息中…' : '刷新天气';
  }
  state.trip.days.forEach((day) => {
    const badge = document.querySelector(`[data-weather-day="${day.day}"]`);
    if (badge) badge.innerHTML = weatherBadge(day);
  });
  return true;
}

export function refreshPlanningLocationInDOM() {
  if (state.view !== 'planning' || !state.trip) return false;
  const button = document.querySelector('[data-location-button]');
  if (button) {
    button.textContent = state.locating ? '定位中...' : (state.userLocation ? '已定位' : '我的定位');
    button.classList.toggle('active', Boolean(state.userLocation));
    button.disabled = Boolean(state.locating);
  }
  document.querySelector('[data-user-location-row]')?.remove();
  if (state.userLocation) {
    document.querySelector('.map-intel-card .intel-header')?.insertAdjacentHTML('afterend', userLocationRowHtml());
  }
  return true;
}

export function refreshPlanningConstraintsInDOM() {
  if (state.view !== 'planning' || !state.trip) return false;
  const mount = document.getElementById('constraint-slot-mount');
  if (!mount) return false;
  mount.innerHTML = slots(state.trip.constraints, state.constraintEditing);
  return true;
}

export function planView() {
  if (!state.trip) {
    return `
      <main class="page shell">
        <div class="panel trip-empty">
          <div>
            <div class="empty-symbol">行</div>
            <h2>还没有行程草稿</h2>
            <p class="muted">先从首页输入你的重庆旅行需求并开始规划。</p>
            <button class="primary" data-action="go" data-view="home">返回首页开始规划</button>
          </div>
        </div>
      </main>
    `;
  }

  const trip = state.trip;
  const mapStops = trip.days.flatMap((day) => day.stops).filter((stop) => stop.location);
  const totalDays = trip.days.length;
  const currentRouteStatus = state.routeDataStatus || trip.routeDataStatus || 'ESTIMATED';

  return `
    <main class="page shell">
      <div class="section-title">
        <div>
          <div class="eyebrow">专属定制方案 · 可自由微调</div>
          <h2>${escapeHtml(trip.title)}</h2>
          <p>
            ${escapeHtml(trip.subtitle)} · 第 ${trip.version} 版
            ${currentRouteStatus === 'ESTIMATED' ? '<span class="planner-version-pill" style="margin-left:8px;">部分通行时间建议出发前确认</span>' : ''}
          </p>
        </div>
        <div class="section-actions">
          <button class="secondary" data-action="refresh-dynamic" data-dynamic-refresh-button ${state.dynamicRefreshing ? 'disabled' : ''} title="仅支持高德可返回预报日期；日期必须是有效的行程日期，景点级天气仍以当地实况为准">${state.dynamicRefreshing ? '刷新实时信息中…' : '刷新天气'}</button>
          <button class="secondary" data-action="feedback-open">写封反馈</button>
          <button class="primary" data-action="save">保存行程</button>
        </div>
      </div>

      <div class="workspace-grid">
        <div id="constraint-slot-mount">${slots(trip.constraints, state.constraintEditing)}</div>

        <section class="panel">
          <div class="plan-header">
            <div>
              <h2>行程安排详情</h2>
              <p>共 ${totalDays} 天行程 · 已自动去重与路线优化</p>
            </div>
            <div style="display:flex;gap:6px;align-items:center;">
              <span class="status-pill">${currentRouteStatus === 'ESTIMATED' ? '出行前确认路线' : '路线信息已更新'}</span>
              ${currentRouteStatus === 'ESTIMATED' ? '<span class="planner-version-pill">路线待确认</span>' : ''}
            </div>
          </div>

          ${trip.planContext ? `
            <div class="strategy-cards-cluster">
              <div class="strategy-card">
                <div class="strategy-card-title">交通衔接策略</div>
                <div class="strategy-card-desc">${escapeHtml(trip.planContext.routeStrategy)}</div>
              </div>
              <div class="strategy-card">
                <div class="strategy-card-title">预算管理策略</div>
                <div class="strategy-card-desc">${escapeHtml(trip.planContext.budgetStrategy)}</div>
              </div>
              <div class="strategy-card">
                <div class="strategy-card-title">餐饮风味引导</div>
                <div class="strategy-card-desc">${escapeHtml(trip.planContext.foodGuidance)}</div>
              </div>
            </div>
          ` : ''}

          <div class="weather-query-note"><strong>天气说明</strong><span>仅查询具有明确日期的重庆市级高德预报；超出接口预报范围、没有日期或接口暂未返回时会显示“待确认”，可在出发前再次刷新。</span></div>

          ${trip.days.map((day) => `
            <div class="day-block" data-trip-day="${day.day}">
              <div class="day-head">
                <strong>${escapeHtml(day.dateLabel)}</strong>
                <span data-weather-day="${day.day}">${weatherBadge(day)}</span>
              </div>
              ${day.departureContext ? `<div class="day-context">出发参考：${escapeHtml(day.departureContext)}</div>` : ''}
              ${day.stops.map((stop) => stopCard(stop, day.day)).join('')}
            </div>
          `).join('')}
        </section>

        <aside class="panel evidence-card">
          <div class="map-card-head">
            <div class="panel-title" style="margin-bottom:0;">高德全景路线图</div>
            <div class="map-head-actions">
              <button class="map-action-btn ${state.userLocation ? 'active' : ''}" data-action="locate-user" data-location-button ${state.locating ? 'disabled' : ''} title="点击向浏览器申请定位权限并在地图上展示您的相对位置">
                ${state.locating ? '定位中...' : (state.userLocation ? '已定位' : '我的定位')}
              </button>
              <button class="map-action-btn" data-action="reload-map" title="重新初始化高德地图">刷新地图</button>
              <button class="fullscreen-map-btn" data-action="open-fullscreen-map">全屏查看</button>
            </div>
          </div>

          <div class="map-day-tabs" style="margin-top:10px;">
            <button class="map-tab ${state.selectedMapDay === 0 ? 'active' : ''}" data-action="map-day" data-day="0">全景路线</button>
            ${trip.days.map((d) => `
              <button class="map-tab ${state.selectedMapDay === d.day ? 'active' : ''}" data-action="map-day" data-day="${d.day}">第${d.day}天</button>
            `).join('')}
          </div>

          <div id="trip-map" class="trip-map" data-map-stop-count="${mapStops.length}">
            <div class="map-fallback">
              <strong>正在准备地图</strong>
              <span>读取高德坐标与路线数据……</span>
            </div>
          </div>

          <div class="map-intel-card">
            <div class="intel-header">
              <span class="intel-badge">高德路网核验就绪</span>
              <span class="intel-poi-count">已定位 ${mapStops.length} 处机位</span>
            </div>
            ${userLocationRowHtml()}
            <div class="intel-row">
              <strong>出行建议</strong>
              <p>重庆依山而建，轻轨与户外自动扶梯是长辈出行的极佳选择，沿线商圈多为平街直连。</p>
            </div>
            <div class="intel-row">
              <strong>路线依据</strong>
              <p>路线会结合地图信息与当天实际出行情况安排，出发前可再次确认通行时间。</p>
            </div>
          </div>
        </aside>
      </div>
    </main>
  `;
}
