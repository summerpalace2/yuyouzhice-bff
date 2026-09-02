import { state } from '../../app-core/state.js';
import { escapeHtml } from '../../shared/lib/security.js';
import { request } from '../../shared/api/client.js';
import { invalidatePageCache, markPageDataFresh } from '../../app-core/page-cache.js';

const topicLabels = {
  accessibility: '无障碍与轻松出行',
  transport: '交通衔接',
  dynamic: '实时动态信息',
  warning: '出行提醒',
  itinerary: '行程建议'
};

export function floatingAdminReturnBtn() {
  if (state.user?.role === 'admin' && state.view !== 'admin') {
    return `
      <div class="floating-admin-btn" data-action="go" data-view="admin" title="您当前以管理员身份浏览用户端，点击随时返回管理控制台">
        返回管理中心
      </div>
    `;
  }
  return '';
}

export function updateAdminDocListInDOM() {
  const container = document.getElementById('doc-accordion-container');
  if (!container) return;

  const allDocs = state.adminDocs || [];
  const filteredDocs = allDocs.filter((doc) => {
    if (state.adminDocTopic && doc.topic !== state.adminDocTopic) return false;
    if (state.adminDocQuery) {
      const q = state.adminDocQuery.toLowerCase();
      const match = [doc.title, doc.entityName, doc.content].join(' ').toLowerCase();
      if (!match.includes(q)) return false;
    }
    return true;
  });

  const displayedDocs = state.adminDocsFolded ? filteredDocs.slice(0, 6) : filteredDocs;

  container.innerHTML = displayedDocs.length ? displayedDocs.map((doc) => {
    const isExpanded = state.adminDocExpanded.has(doc.docId);
    return `
      <div class="doc-item ${isExpanded ? 'expanded' : ''}" data-doc-id="${doc.docId}">
        <div class="doc-item-head" data-action="toggle-doc-expand" data-id="${doc.docId}">
          <div class="doc-title-group">
            <span class="doc-badge">${escapeHtml(doc.entityName)}</span>
            <strong>${escapeHtml(doc.title)}</strong>
            <span class="doc-topic-tag">${escapeHtml(topicLabels[doc.topic] || '其它旅行资料')}</span>
          </div>
          <div class="doc-head-actions">
            <button class="secondary mini-btn" data-action="edit-doc" data-id="${doc.docId}" data-entity="${escapeHtml(doc.entityName)}" data-title="${escapeHtml(doc.title)}" data-content="${escapeHtml(doc.content)}">编辑语料</button>
            <span class="expand-icon">${isExpanded ? '收起 ↑' : '展开 ↓'}</span>
          </div>
        </div>
        <div class="doc-body-view ${isExpanded ? 'show-full' : ''}">
          <div class="doc-content-text">${escapeHtml(doc.content)}</div>
          <div class="doc-meta-footer">
            <span>实体ID: <code>${escapeHtml(doc.entityId || doc.docId)}</code></span>
            <span>资料归类: <b class="health-ok">${escapeHtml(topicLabels[doc.topic] || '其它旅行资料')}</b></span>
          </div>
        </div>
      </div>
    `;
  }).join('') : `<div class="notice">没有找到匹配的知识库文档，请尝试更换关键词。</div>`;

  const toggleBtn = document.querySelector('.fold-toggle-btn');
  if (toggleBtn) {
    toggleBtn.textContent = state.adminDocsFolded ? `展开全部 (${filteredDocs.length} 篇) ↓` : '折叠精选 (6 篇) ↑';
  }
  const footerToggle = document.querySelector('.fold-footer-bar');
  if (footerToggle) {
    footerToggle.innerHTML = filteredDocs.length > 6 ? `
      <button class="ghost" data-action="toggle-admin-docs-fold">
        ${state.adminDocsFolded ? `查看更多语料（当前显示 6 / ${filteredDocs.length} 篇，点击展开全部）` : '收起至精选 6 篇'}
      </button>
    ` : '';
  }

  const topicButtons = document.querySelectorAll('#admin-doc-topic-bar .chip');
  topicButtons.forEach((btn) => {
    const topic = btn.dataset.topic;
    btn.classList.toggle('selected', state.adminDocTopic === topic || (!state.adminDocTopic && !topic));
  });
}

export async function health(renderCallback) {
  state.health = await request('/api/health');
  if (state.user?.role === 'admin') {
    // 概览、语料和 Rerank 互不依赖；并发读取可缩短首次进入控制中心的等待，
    // 而专用 Rerank 接口也避免通过概览聚合数据猜测统计来源。
    const [overviewResult, documentsResult, rerankResult] = await Promise.allSettled([
      request('/api/admin/overview'),
      request('/api/admin/knowledge/documents'),
      loadRerankStats()
    ]);
    const overviewLoaded = overviewResult.status === 'fulfilled' && overviewResult.value?.ok !== false;
    state.adminOverview = overviewLoaded ? overviewResult.value : null;
    state.adminLoadError = overviewLoaded
      ? ''
      : (overviewResult.reason?.message || overviewResult.value?.message || '无法读取管理概览。');
    state.adminDocs = documentsResult.status === 'fulfilled'
      ? documentsResult.value.documents || null
      : null;
    if (rerankResult.status === 'rejected') state.adminRerankStats = null;
    if (overviewLoaded) markPageDataFresh('admin');
    else invalidatePageCache('admin');
  }
  if (renderCallback) renderCallback();
}

/** 只刷新重排缓存指标时使用，不触发整个管理控制台的数据重载。 */
export async function loadRerankStats() {
  const response = await request('/api/admin/rerank/stats');
  state.adminRerankStats = response.stats || null;
  return state.adminRerankStats;
}

export async function clearRerankCache() {
  return request('/api/admin/rerank/cache/clear', { method: 'POST' });
}
