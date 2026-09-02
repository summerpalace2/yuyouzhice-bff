import { state } from '../../app-core/state.js';
import { request } from '../api/client.js';

// 多天路线分色调色板（红、蓝、绿、紫、橙、青、粉）
export const DAY_COLORS = ['#c23e32', '#2563eb', '#059669', '#7c3aed', '#d97706', '#0891b2', '#db2777'];

/**
 * 读取高德开放平台地图配置
 */
export async function loadMapConfig() {
  if (state.mapConfig) return state.mapConfig;
  try {
    state.mapConfig = (await request('/api/map-config')).map;
  } catch {
    state.mapConfig = { keyConfigured: false, mode: '路线数据模式' };
  }
  return state.mapConfig;
}

/**
 * 异步动态加载高德 JS API 2.0 SDK（带超时保护与失败自愈机制）
 */
export function loadAmapSdk() {
  if (window.AMap) return Promise.resolve(window.AMap);
  if (window.__yuyouzhiceAmapPromise) return window.__yuyouzhiceAmapPromise;
  const config = state.mapConfig;
  if (!config?.key) return Promise.reject(new Error('未配置高德 JS API Key'));
  window._AMapSecurityConfig = config.securityJsCode ? { securityJsCode: config.securityJsCode } : undefined;
  window.__yuyouzhiceAmapPromise = new Promise((resolve, reject) => {
    const callback = `__yuyouzhiceAmapReady_${Date.now()}`;
    const timeoutTimer = window.setTimeout(() => {
      delete window[callback];
      window.__yuyouzhiceAmapPromise = null;
      reject(new Error('高德 JS API 加载超时，请点击刷新地图'));
    }, 8000);

    window[callback] = () => {
      window.clearTimeout(timeoutTimer);
      delete window[callback];
      resolve(window.AMap);
    };

    const script = document.createElement('script');
    script.src = `https://webapi.amap.com/maps?v=2.0&key=${encodeURIComponent(config.key)}&callback=${callback}`;
    script.async = true;
    script.onerror = () => {
      window.clearTimeout(timeoutTimer);
      delete window[callback];
      window.__yuyouzhiceAmapPromise = null;
      reject(new Error('高德 JS API 脚本加载失败，请检查网络'));
    };
    document.head.appendChild(script);
  });
  return window.__yuyouzhiceAmapPromise;
}

/**
 * 提取行程中指定天数的有效经纬度打点
 */
export function mapPoints(trip, dayFilter = 0) {
  if (!trip?.days) return [];
  const days = dayFilter > 0 ? trip.days.filter((d) => d.day === dayFilter) : trip.days;
  return days.flatMap((day) =>
    (day.stops || []).map((stop, idx) => ({
      stop,
      day: day.day,
      dayIndex: idx + 1,
      color: DAY_COLORS[(day.day - 1) % DAY_COLORS.length],
      coordinates: stop.mapContext?.coordinates
    }))
  ).filter((item) => Array.isArray(item.coordinates) && item.coordinates.length === 2 && item.coordinates.every(Number.isFinite));
}

/**
 * 解析路线经纬度数组
 */
export function mapPath(polyline = []) {
  return polyline
    .map((value) => String(value).split(',').map(Number))
    .filter((point) => point.length === 2 && point.every(Number.isFinite));
}

/**
 * 清除常规地图覆盖物与弹窗
 */
export function clearMapOverlays(targetMapInstance = state.mapInstance) {
  if (state.mapOverlays.length && targetMapInstance) {
    try { targetMapInstance.remove(state.mapOverlays); } catch {}
    state.mapOverlays = [];
  }
  if (state.mapInfoWindow) {
    try { state.mapInfoWindow.close(); } catch {}
    state.mapInfoWindow = null;
  }
}

/**
 * 清除全屏地图覆盖物与弹窗
 */
export function clearFullscreenMapOverlays(targetMapInstance = state.fullscreenMapInstance) {
  if (state.fullscreenMapOverlays?.length && targetMapInstance) {
    try { targetMapInstance.remove(state.fullscreenMapOverlays); } catch {}
    state.fullscreenMapOverlays = [];
  }
  if (state.fullscreenMapInfoWindow) {
    try { state.fullscreenMapInfoWindow.close(); } catch {}
    state.fullscreenMapInfoWindow = null;
  }
}

/**
 * 唤起官方高德导航/路线规划（不暴露服务端 Key，优先唤起 App，支持 Web Fallback）
 */
export function navigateTo(name, location = '') {
  const targetName = encodeURIComponent(String(name || '目的地'));
  let coords = String(location || '').trim();
  let lng = '';
  let lat = '';
  if (coords.includes(',')) {
    const parts = coords.split(',');
    lng = parts[0].trim();
    lat = parts[1].trim();
  }

  // 高德官方统一 URI API：支持在移动端唤起高德 App，桌面端无缝展示官方路线页
  const webNavUrl = coords
    ? `https://uri.amap.com/navigation?to=${lng},${lat},${targetName}&mode=walk&policy=1&src=yuyouzhice&coordinate=gaode&callnative=1`
    : `https://uri.amap.com/search?keyword=${targetName}&city=重庆&src=yuyouzhice&coordinate=gaode&callnative=1`;

  window.open(webNavUrl, '_blank', 'noopener,noreferrer');
}
