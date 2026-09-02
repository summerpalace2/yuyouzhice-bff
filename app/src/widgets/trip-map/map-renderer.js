import { state } from '../../app-core/state.js';
import { escapeHtml } from '../../shared/lib/security.js';
import {
  DAY_COLORS,
  loadMapConfig,
  loadAmapSdk,
  mapPoints,
  mapPath,
  clearMapOverlays,
  clearFullscreenMapOverlays
} from '../../shared/lib/amap.js';

let mapRenderTimer = null;
let fullscreenMapRenderTimer = null;
let mapRenderedTrip = null;
let mapRenderedDay = null;

function reportMapRenderError(error, container) {
  console.warn('地图暂时不可用，保留行程内容供继续查看。', error);
  if (container?.isConnected) {
    container.innerHTML = `<div class="map-fallback"><div class="map-fallback-title">地图暂时不可用</div><p class="map-fallback-desc">行程安排不受影响，出发前可再次查看路线。</p><button class="secondary mini-btn" data-action="reload-map" style="margin-top:8px;align-self:flex-start;">重新加载地图</button></div>`;
  }
}

export async function renderTripMap() {
  const container = document.querySelector('#trip-map');
  if (!container || !state.trip) return;
  const trip = state.trip;
  const dayFilter = Number(state.selectedMapDay || 0);

  // 若容器在 DOM 中但尺寸尚未就绪（Flex/Grid还在计算），50ms后自愈重试
  if (container.clientWidth === 0 && container.isConnected) {
    window.setTimeout(() => renderTripMap().catch((error) => reportMapRenderError(error, container)), 50);
    return;
  }

  const isMapContainerConnected = Boolean(state.mapInstance && state.mapInstance.getContainer && document.contains(state.mapInstance.getContainer()));
  if (mapRenderedTrip === trip && mapRenderedDay === dayFilter && state.mapInstance && isMapContainerConnected && !state.locating) {
    return;
  }

  if (state.mapInstance && !isMapContainerConnected) {
    clearMapOverlays(state.mapInstance);
    try { state.mapInstance.destroy(); } catch {}
    state.mapInstance = null;
  }

  const points = mapPoints(trip, dayFilter);
  const targetDays = dayFilter > 0 ? trip.days.filter((d) => d.day === dayFilter) : trip.days;
  const routes = targetDays.flatMap((day) =>
    (day.stops || []).map((stop) => ({
      polyline: mapPath(stop.mapContext?.polyline || []),
      color: DAY_COLORS[(day.day - 1) % DAY_COLORS.length]
    }))
  ).filter((r) => r.polyline.length > 1);

  let config;
  try {
    config = await loadMapConfig();
  } catch (error) {
    reportMapRenderError(error, container);
    return;
  }
  if (state.trip !== trip || state.view !== 'planning' || !container.isConnected) return;

  if (!config.keyConfigured || !config.key) {
    if (state.mapInstance) { state.mapInstance.destroy(); state.mapInstance = null; }
    container.innerHTML = `
      <div class="map-fallback">
        <div class="map-fallback-title">高德路线与空间拓扑就绪</div>
        <p class="map-fallback-desc">${points.length ? `当前已解析 ${points.length} 个站点地理坐标与 ${routes.length} 条连接路线` : '高德 POI 坐标正在查询或回退中'}</p>
        <div class="map-fallback-note">路线数据模式下已完整绑定站点地理信息，配置前端 AMAP_JS_KEY 即可开启底图交互漫游。</div>
      </div>`;
    mapRenderedTrip = trip;
    mapRenderedDay = dayFilter;
    return;
  }

  try {
    const AMap = await loadAmapSdk();
    if (state.trip !== trip || state.view !== 'planning' || !container.isConnected) return;

    if (!state.mapInstance) {
      container.innerHTML = '';
      const center = points[0]?.coordinates || [106.577, 29.557];
      state.mapInstance = new AMap.Map(container, {
        zoom: points.length > 1 ? 12 : 14,
        center,
        resizeEnable: true
      });
    }

    clearMapOverlays(state.mapInstance);
    const overlays = [];
    const infoWindow = new AMap.InfoWindow({ offset: new AMap.Pixel(0, -30) });
    state.mapInfoWindow = infoWindow;

    // 渲染用户实时位置 Marker（如果已获取）
    if (state.userLocation && Array.isArray(state.userLocation.coordinates)) {
      const userMarkerContent = `
        <div class="map-marker-user-location">
          <div class="user-pulse-ring"></div>
          <div class="user-marker-core">我的位置</div>
        </div>
      `;
      const userMarker = new AMap.Marker({
        position: state.userLocation.coordinates,
        title: '我的当前位置',
        content: userMarkerContent,
        anchor: 'bottom-center'
      });
      userMarker.on('click', () => {
        infoWindow.setContent(`
          <div class="map-info-popup">
            <div class="info-popup-meta">当前设备定位点</div>
            <div class="info-popup-title">我的实时位置</div>
            <p class="info-popup-desc">精度约 ±${Math.round(state.userLocation.accuracy || 20)}米${state.userLocation.distanceText ? ` · ${state.userLocation.distanceText}` : ''}</p>
          </div>
        `);
        infoWindow.open(state.mapInstance, state.userLocation.coordinates);
      });
      userMarker.setMap(state.mapInstance);
      overlays.push(userMarker);
    }

    points.forEach(({ stop, day, dayIndex, color, coordinates }) => {
      const content = `
        <div class="map-marker-pin" style="background:${color};">
          D${day}-${dayIndex} ${escapeHtml(stop.name)}
        </div>
      `;
      const marker = new AMap.Marker({
        position: coordinates,
        title: `第${day}天 · ${stop.name}`,
        content,
        anchor: 'bottom-center'
      });

      marker.on('click', () => {
        const infoHtml = `
          <div class="map-info-popup">
            <div class="info-popup-meta">第 ${day} 天 · 第 ${dayIndex} 站 · ${escapeHtml(stop.district)}</div>
            <div class="info-popup-title">${escapeHtml(stop.name)}</div>
            <p class="info-popup-desc">${escapeHtml(stop.summary)}</p>
            <div class="info-popup-chips">
              <span class="info-chip duration">建议 ${escapeHtml(stop.duration)}</span>
              <span class="info-chip transit">${escapeHtml(stop.walk)}</span>
            </div>
            <div class="info-popup-actions" style="margin-top:8px;">
              <button class="primary mini-btn" data-action="navigate-to" data-name="${escapeHtml(stop.name)}" data-location="${coordinates.join(',')}">高德导航 · 到这去</button>
            </div>
          </div>
        `;
        infoWindow.setContent(infoHtml);
        infoWindow.open(state.mapInstance, coordinates);
      });

      marker.setMap(state.mapInstance);
      overlays.push(marker);
    });

    routes.forEach(({ polyline, color }) => {
      const line = new AMap.Polyline({
        path: polyline,
        strokeColor: color,
        strokeWeight: 5,
        strokeOpacity: 0.85,
        lineJoin: 'round',
        showDir: true
      });
      line.setMap(state.mapInstance);
      overlays.push(line);
    });

    state.mapOverlays = overlays;
    if (overlays.length) {
      state.mapInstance.setFitView(overlays, false, [36, 36, 36, 36]);
    }
    state.mapInstance.resize();
    window.requestAnimationFrame(() => {
      if (state.mapInstance) state.mapInstance.resize();
    });

    mapRenderedTrip = trip;
    mapRenderedDay = dayFilter;
  } catch (error) {
    reportMapRenderError(error, container);
    mapRenderedTrip = trip;
    mapRenderedDay = dayFilter;
  }
}

export async function renderFullscreenMap() {
  const container = document.querySelector('#fullscreen-trip-map');
  if (!container || !state.trip || !state.mapFullscreen) return;
  const trip = state.trip;
  const dayFilter = Number(state.selectedMapDay || 0);

  const points = mapPoints(trip, dayFilter);
  const targetDays = dayFilter > 0 ? trip.days.filter((d) => d.day === dayFilter) : trip.days;
  const routes = targetDays.flatMap((day) =>
    (day.stops || []).map((stop) => ({
      polyline: mapPath(stop.mapContext?.polyline || []),
      color: DAY_COLORS[(day.day - 1) % DAY_COLORS.length]
    }))
  ).filter((r) => r.polyline.length > 1);

  const config = await loadMapConfig();
  if (!config.keyConfigured || !config.key) {
    container.innerHTML = `<div class="map-fallback"><div class="map-fallback-title">全屏路线拓扑就绪</div><p class="map-fallback-desc">已连接 ${points.length} 处机位及 ${routes.length} 条折线。</p></div>`;
    return;
  }

  try {
    const AMap = await loadAmapSdk();
    if (!state.fullscreenMapInstance) {
      container.innerHTML = '';
      state.fullscreenMapInstance = new AMap.Map(container, {
        zoom: points.length > 1 ? 13 : 15,
        center: points[0]?.coordinates || [106.577, 29.557],
        resizeEnable: true
      });
    }

    clearFullscreenMapOverlays(state.fullscreenMapInstance);
    const overlays = [];
    const infoWindow = new AMap.InfoWindow({ offset: new AMap.Pixel(0, -30) });
    state.fullscreenMapInfoWindow = infoWindow;

    if (state.userLocation && Array.isArray(state.userLocation.coordinates)) {
      const userMarker = new AMap.Marker({
        position: state.userLocation.coordinates,
        title: '我的当前位置',
        content: `
          <div class="map-marker-user-location">
            <div class="user-pulse-ring"></div>
            <div class="user-marker-core">我的位置</div>
          </div>
        `,
        anchor: 'bottom-center'
      });
      userMarker.setMap(state.fullscreenMapInstance);
      overlays.push(userMarker);
    }

    points.forEach(({ stop, day, dayIndex, color, coordinates }) => {
      const content = `
        <div class="map-marker-pin" style="background:${color};">
          D${day}-${dayIndex} ${escapeHtml(stop.name)}
        </div>
      `;
      const marker = new AMap.Marker({
        position: coordinates,
        title: `第${day}天 · ${stop.name}`,
        content,
        anchor: 'bottom-center'
      });
      marker.on('click', () => {
        infoWindow.setContent(`
          <div class="map-info-popup">
            <div class="info-popup-meta">第 ${day} 天 · 第 ${dayIndex} 站 · ${escapeHtml(stop.district)}</div>
            <div class="info-popup-title">${escapeHtml(stop.name)}</div>
            <p class="info-popup-desc">${escapeHtml(stop.summary)}</p>
            <div class="info-popup-chips">
              <span class="info-chip duration">游玩 ${escapeHtml(stop.duration)}</span>
              <span class="info-chip transit">${escapeHtml(stop.walk)}</span>
            </div>
            <div class="info-popup-actions" style="margin-top:8px;">
              <button class="primary mini-btn" data-action="navigate-to" data-name="${escapeHtml(stop.name)}" data-location="${coordinates.join(',')}">高德导航 · 到这去</button>
            </div>
          </div>
        `);
        infoWindow.open(state.fullscreenMapInstance, coordinates);
      });
      marker.setMap(state.fullscreenMapInstance);
      overlays.push(marker);
    });

    routes.forEach(({ polyline, color }) => {
      const line = new AMap.Polyline({
        path: polyline,
        strokeColor: color,
        strokeWeight: 6,
        strokeOpacity: 0.9,
        lineJoin: 'round',
        showDir: true
      });
      line.setMap(state.fullscreenMapInstance);
      overlays.push(line);
    });

    state.fullscreenMapOverlays = overlays;

    if (overlays.length) {
      state.fullscreenMapInstance.setFitView(overlays, false, [60, 60, 60, 60]);
    }
    state.fullscreenMapInstance.resize();
  } catch (err) {
    container.innerHTML = `<div class="map-fallback"><p>${escapeHtml(err.message)}</p></div>`;
  }
}

export function scheduleTripMap() {
  if (mapRenderTimer) return;
  mapRenderTimer = window.setTimeout(() => {
    mapRenderTimer = null;
    renderTripMap().catch((error) => reportMapRenderError(error, document.querySelector('#trip-map')));
  }, 0);
}

export function destroyTripMap() {
  if (mapRenderTimer) {
    window.clearTimeout(mapRenderTimer);
    mapRenderTimer = null;
  }
  if (state.mapInstance) {
    clearMapOverlays(state.mapInstance);
    state.mapInstance.destroy();
    state.mapInstance = null;
  }
  if (state.fullscreenMapInstance) {
    try { state.fullscreenMapInstance.destroy(); } catch {}
    state.fullscreenMapInstance = null;
  }
  mapRenderedTrip = null;
  mapRenderedDay = null;
}
