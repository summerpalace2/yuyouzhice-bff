import { state } from '../app-core/state.js';
import { escapeHtml } from '../shared/lib/security.js';
import { renderExploreCardHtml } from '../entities/attraction/explore-card.js';

export function exploreView() {
  const categories = ['全部', ...state.exploreCategories];
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

  return `
    <main class="page shell">
      <div class="section-title">
        <div>
          <div class="eyebrow">Explore Chongqing</div>
          <h2>探索重庆 24 大精选地标</h2>
          <p>涵盖夜景、城市、人文、8D魔幻、古镇美食与自然风光，点击即可加入行程。</p>
        </div>
      </div>

      <section class="panel panel-pad explore-toolbar">
        <input id="explore-query" value="${escapeHtml(state.exploreQuery)}" placeholder="搜索景点名称、区县（渝中区/江北区）、特色（夜景/少走路/火锅/室内）……" />
        <div class="chip-row">
          ${categories.map((category) => `
            <button class="chip ${state.exploreCategory === category || (!state.exploreCategory && category === '全部') ? 'selected' : ''}" data-action="explore-category" data-category="${escapeHtml(category === '全部' ? '' : category)}">${escapeHtml(category)}</button>
          `).join('')}
        </div>
      </section>

      <section class="explore-grid" id="explore-grid-container">
        ${filtered.length ? filtered.map(renderExploreCardHtml).join('') : `
          <div class="panel trip-empty" style="grid-column:1/-1;">
            <div>
              <div class="empty-symbol">查</div>
              <h2>没有匹配的景点</h2>
              <p class="muted">请尝试更换关键词或清除分类筛选。</p>
            </div>
          </div>
        `}
      </section>
    </main>
  `;
}
