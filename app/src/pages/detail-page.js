import { state } from '../app-core/state.js';
import { escapeHtml } from '../shared/lib/security.js';
import { request } from '../shared/api/client.js';
import { toast } from '../shared/ui/toast.js';

export function detailView() {
  const detail = state.detail;
  if (!detail) {
    return `<main class="page shell"><div class="panel trip-empty"><p>正在读取景点详细信息……</p></div></main>`;
  }

  const context = state.detailContext || {};
  const canAdd = Boolean(state.sessionId && state.trip);
  const totalDays = state.trip?.days?.length || 2;
  const imageSrc = String(detail.image || '').trim();
  const imageHero = imageSrc
    ? `<div class="detail-hero" style="background-image:url('${escapeHtml(imageSrc)}')">
         <div class="vertical">山城渝景</div>
         <span class="image-credit">${escapeHtml(detail.imageSource || '高德 Web Service API')} · ${escapeHtml(detail.district)}</span>
       </div>`
    : `<div class="detail-hero detail-hero-unavailable">
         <div class="vertical">山城渝景</div>
         <div class="image-unavailable">高德图片未返回</div>
         <span class="image-credit">${escapeHtml(detail.imageStatus || '未返回')} · ${escapeHtml(detail.imageReason || '本次没有可用景区图片。')}</span>
       </div>`;
  const fromView = state.detailFromView || context.fromView || 'explore';
  const returnViewLabel = fromView === 'explore' ? '← 返回探索地标' : '← 返回定制方案';

  return `
    <main class="page shell">
      <div class="detail-header-nav">
        <button class="back-to-plan-btn" data-action="go" data-view="${fromView}">
          ${returnViewLabel}
        </button>
        <div class="detail-district-badge">景点深度介绍 · ${escapeHtml(detail.district)}</div>
      </div>

      <div class="detail-layout">
        ${imageHero}

        <section class="detail-copy">
          <div class="eyebrow">Attraction Guide · ${escapeHtml(detail.district)}</div>
          <h1>${escapeHtml(detail.name)}</h1>
          <p class="intro">${escapeHtml(detail.intro || detail.summary)}</p>

          <div class="tag-row">
            ${(detail.tags || []).map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join('')}
          </div>

          <div class="detail-facts">
            <div class="detail-fact">
              <strong>建议时长</strong>
              <div><b>${escapeHtml(detail.duration || '约 90 分钟')}</b><small>游玩深度推荐</small></div>
            </div>
            <div class="detail-fact">
              <strong>门票建议</strong>
              <div><b>${escapeHtml(detail.ticket || '免费开放')}</b><small>以现场及官方公告为准</small></div>
            </div>
            <div class="detail-fact">
              <strong>最佳时段</strong>
              <div><b>${escapeHtml(detail.bestTime || '全天开放')}</b><small>景观或光线最佳游览时段</small></div>
            </div>
            <div class="detail-fact">
              <strong>交通到达</strong>
              <div><b>${escapeHtml(detail.walk || '轻轨/公交直达')}</b><small>高德路线核验</small></div>
            </div>
            <div class="detail-fact">
              <strong>适合人群</strong>
              <div><b>${escapeHtml(detail.fit || '适合各类旅行者')}</b></div>
            </div>
          </div>

          <div class="detail-actions-bar" style="margin-top:12px;margin-bottom:12px;">
            <button class="secondary mini-btn" data-action="navigate-to" data-name="${escapeHtml(detail.name)}" data-location="${escapeHtml(detail.location || '')}">高德导航 · 到这去</button>
          </div>

          ${canAdd ? `
            <div class="add-to-trip-panel">
              <div class="add-select-row">
                <label>选择加入到：</label>
                <select id="detail-day-select">
                  ${Array.from({ length: totalDays }, (_, i) => `
                    <option value="${i + 1}" ${context.day === i + 1 ? 'selected' : ''}>第 ${i + 1} 天行程</option>
                  `).join('')}
                </select>
              </div>
              <div class="modal-actions detail-actions">
                <button class="primary" data-action="add-attraction-custom" data-id="${escapeHtml(detail.id || detail.attractionId)}">加入选定天数</button>
                ${context.stopId ? `
                  <button class="secondary" data-action="replace-attraction" data-id="${escapeHtml(detail.id || detail.attractionId)}" data-day="${context.day || 1}" data-stop-id="${escapeHtml(context.stopId)}">替换当前站点</button>
                ` : ''}
              </div>
            </div>
          ` : ''}
        </section>
      </div>
    </main>
  `;
}

export async function openDetail(id, context = {}, { renderHeader, renderView } = {}) {
  state.loading = true;
  state.detailFromView = context.fromView || (state.view === 'detail' ? (state.detailFromView || 'explore') : state.view) || 'explore';
  state.view = 'detail';
  state.detailContext = context;
  if (renderHeader) renderHeader();
  if (renderView) renderView();
  try {
    state.detail = (await request(`/api/attractions/${id}`)).detail;
  } catch (error) {
    toast(error.message);
  } finally {
    state.loading = false;
    if (renderView) renderView();
  }
}

export async function updateTripWithAttraction(operation, target, { renderLoader, render, scheduleTripMap } = {}) {
  state.loading = true;
  if (renderLoader) renderLoader();
  try {
    const dayVal = Number(target.dataset.day || document.querySelector('#detail-day-select')?.value || 1);
    const data = await request('/api/trip/stops', {
      method: 'POST',
      body: JSON.stringify({
        sessionId: state.sessionId,
        attractionId: target.dataset.id,
        day: dayVal,
        operation,
        targetStopId: target.dataset.stopId
      })
    });
    state.trip = data.trip;
    state.view = 'planning';
    toast(operation === 'replace' ? '已成功替换当前站点，路线已重新优化。' : `已加入第 ${dayVal} 天行程！`);
  } catch (error) {
    toast(error.message);
  } finally {
    state.loading = false;
    if (render) render();
    if (scheduleTripMap) scheduleTripMap();
  }
}
