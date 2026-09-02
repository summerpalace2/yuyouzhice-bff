import { state } from '../app-core/state.js';
import { escapeHtml } from '../shared/lib/security.js';

export function tripsView() {
  if (!state.user) {
    return `
      <main class="page shell">
        <div class="panel trip-empty">
          <div>
            <div class="empty-symbol">存</div>
            <h2>登录后查看已保存行程</h2>
            <p class="muted">登录后行程将持久化保存，并在任意设备随时恢复。</p>
            <button class="primary" data-action="login">登录 / 注册</button>
          </div>
        </div>
      </main>
    `;
  }

  if (state.savedTrips === null) {
    return `<main class="page shell"><div class="panel trip-empty"><p>正在读取您的行程……</p></div></main>`;
  }

  if (!state.savedTrips.length) {
    return `
      <main class="page shell">
        <div class="panel trip-empty">
          <div>
            <div class="empty-symbol">空</div>
            <h2>还没有保存的行程</h2>
            <p class="muted">从首页生成定制方案后，点击“保存行程”。</p>
            <button class="primary" data-action="go" data-view="home">开始定制规划</button>
          </div>
        </div>
      </main>
    `;
  }

  return `
    <main class="page shell">
      <div class="section-title">
        <div>
          <div class="eyebrow">您的专属旅行资产库</div>
          <h2>我的行程</h2>
          <p>已保存 ${state.savedTrips.length} 份精彩重庆行程方案。</p>
        </div>
        <button class="secondary" data-action="refresh-trips">刷新行程</button>
      </div>
      <div data-saved-trip-list>
      ${state.savedTrips.map((item) => `
        <article class="panel trip-card" data-saved-trip-id="${escapeHtml(item.id)}">
          <div>
            <div class="eyebrow">保存时间：${new Date(item.savedAt).toLocaleString('zh-CN')}</div>
            <h3>${escapeHtml(item.trip.title)}</h3>
            <p>${escapeHtml(item.trip.subtitle)} · 第 ${item.trip.version} 版 · 共 ${item.trip.days?.length || 2} 天</p>
          </div>
          <div class="trip-actions">
            <button class="secondary" data-action="load-saved" data-id="${escapeHtml(item.id)}">打开行程</button>
            <button class="secondary" data-action="export-pdf" data-id="${escapeHtml(item.id)}">导出 PDF</button>
            <button class="danger" data-action="delete-saved" data-id="${escapeHtml(item.id)}">删除</button>
          </div>
        </article>
      `).join('')}
      </div>
    </main>
  `;
}

/** 已保存行程的删除只更新当前列表，不重绘导航、弹窗挂载点或其它页面层。 */
export function refreshTripsInDOM() {
  if (state.view !== 'trips') return false;
  const mount = document.getElementById('view-mount');
  if (!mount) return false;
  const scrollY = window.scrollY;
  mount.innerHTML = tripsView();
  window.requestAnimationFrame(() => window.scrollTo({ top: scrollY }));
  return true;
}
