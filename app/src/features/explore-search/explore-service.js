import { state } from '../../app-core/state.js';
import { request } from '../../shared/api/client.js';
import { toast } from '../../shared/ui/toast.js';
import { renderExploreCardHtml } from '../../entities/attraction/explore-card.js';
import { isPageDataFresh, markPageDataFresh } from '../../app-core/page-cache.js';

export function updateExploreGridInDOM() {
  const container = document.getElementById('explore-grid-container');
  if (!container) return;

  const allItems = Array.isArray(state.exploreItems) ? state.exploreItems : [];
  const filtered = allItems.filter((item) => {
    if (state.exploreCategory && item.category !== state.exploreCategory) return false;
    if (state.exploreQuery) {
      const q = state.exploreQuery.toLowerCase();
      const haystack = [item.name, item.district, item.category, ...(item.tags || []), item.summary].join(' ').toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });

  container.innerHTML = filtered.length ? filtered.map(renderExploreCardHtml).join('') : `
    <div class="panel trip-empty" style="grid-column:1/-1;">
      <div>
        <div class="empty-symbol">查</div>
        <h2>没有匹配的景点</h2>
        <p class="muted">请尝试更换关键词或清除分类筛选。</p>
      </div>
    </div>
  `;

  const chips = document.querySelectorAll('.explore-toolbar .chip');
  chips.forEach((c) => {
    const cat = c.dataset.category;
    c.classList.toggle('selected', state.exploreCategory === cat || (!state.exploreCategory && !cat));
  });
}

export async function loadExplore({ force = false } = {}) {
  if (!force && isPageDataFresh('explore')) return state.exploreItems;
  try {
    // 首次只取一次完整目录；搜索和分类均在前端即时过滤，避免每个按键都往返后端。
    const params = new URLSearchParams({ q: '', category: '' });
    const data = await request(`/api/explore?${params}`);
    state.exploreItems = Array.isArray(data.items) ? data.items : [];
    state.exploreCategories = data.categories || ['夜景', '城市', '人文', '美食', '文创', '自然', '休闲'];
    markPageDataFresh('explore');
    if (state.view === 'explore') updateExploreGridInDOM();
    return state.exploreItems;
  } catch (error) {
    toast(error.message);
  }
}

export async function addExploreAttraction(id, day = 1, { render, scheduleTripMap } = {}) {
  if (!state.trip || !state.sessionId) {
    return toast('请先从首页生成一份行程，再添加探索景点。');
  }
  try {
    const data = await request('/api/trip/stops', {
      method: 'POST',
      body: JSON.stringify({
        sessionId: state.sessionId,
        attractionId: id,
        day: Number(day || 1),
        operation: 'add'
      })
    });
    state.trip = data.trip;
    state.view = 'planning';
    toast(`已成功加入第 ${day} 天行程！`);
    if (render) render();
    if (scheduleTripMap) scheduleTripMap();
  } catch (error) {
    toast(error.message);
  }
}
