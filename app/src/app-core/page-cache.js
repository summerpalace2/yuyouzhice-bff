import { state } from './state.js';

// 仅缓存数据稳定、没有地图实例或流式会话的页面。规划与聊天仍由当前 state 驱动，
// 不能恢复旧 DOM，否则会把过期会话、焦点或 SDK 节点带回页面。
const CACHEABLE_VIEWS = new Set(['explore', 'trips', 'history', 'profile', 'admin']);
const viewSnapshots = new Map();
const dataFreshness = new Map();

function scopeKey() {
  return state.user?.id ? `user:${state.user.id}` : 'guest';
}

function cacheKey(view) {
  return `${scopeKey()}:${String(view || '')}`;
}

export function isViewCacheable(view) {
  return CACHEABLE_VIEWS.has(String(view || ''));
}

/** Data is valid until an explicit write/refresh invalidates it; callers may add a TTL for volatile dashboards. */
export function isPageDataFresh(view, { maxAgeMs = Number.POSITIVE_INFINITY } = {}) {
  const updatedAt = dataFreshness.get(cacheKey(view));
  return Number.isFinite(updatedAt) && Date.now() - updatedAt <= maxAgeMs;
}

export function markPageDataFresh(view) {
  if (isViewCacheable(view)) dataFreshness.set(cacheKey(view), Date.now());
}

/** Marks both detached DOM and in-memory data stale before the next route entry. */
export function invalidatePageCache(...views) {
  for (const view of views.flat()) {
    if (!isViewCacheable(view)) continue;
    const key = cacheKey(view);
    viewSnapshots.delete(key);
    dataFreshness.delete(key);
  }
}

export function clearPageCache() {
  viewSnapshots.clear();
  dataFreshness.clear();
}

/** Detach, rather than serialize, so filters, scrollable lists and current input values survive a route round-trip. */
export function stashViewSnapshot(view, mount) {
  if (!mount || !isViewCacheable(view) || !isPageDataFresh(view)) return;
  const fragment = document.createDocumentFragment();
  while (mount.firstChild) fragment.appendChild(mount.firstChild);
  viewSnapshots.set(cacheKey(view), fragment);
}

export function restoreViewSnapshot(view, mount) {
  if (!mount || !isViewCacheable(view) || !isPageDataFresh(view)) return false;
  const key = cacheKey(view);
  const fragment = viewSnapshots.get(key);
  if (!fragment) return false;
  viewSnapshots.delete(key);
  mount.replaceChildren(fragment);
  return true;
}
