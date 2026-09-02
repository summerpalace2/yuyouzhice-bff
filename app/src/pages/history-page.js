import { state } from '../app-core/state.js';
import { escapeHtml } from '../shared/lib/security.js';
import { request } from '../shared/api/client.js';
import { toast } from '../shared/ui/toast.js';
import { getTripChatKey, loadUserChats, saveUserChats } from '../app-core/user-store.js';
import { persistTripWorkspace } from '../features/trip-workspace/workspace-service.js';
import { isPageDataFresh, markPageDataFresh } from '../app-core/page-cache.js';

export function historyView() {
  if (!state.user) {
    return `
      <main class="page shell">
        <div class="panel trip-empty">
          <div>
            <div class="empty-symbol">史</div>
            <h2>登录后查看历史规划会话</h2>
            <p class="muted">登录后每次智能规划与局部微调都会保存在您的账号中。</p>
            <button class="primary" data-action="login">登录 / 注册</button>
          </div>
        </div>
      </main>
    `;
  }

  if (!state.historySessions) {
    return `<main class="page shell"><div class="panel trip-empty"><p>正在读取历史规划会话……</p></div></main>`;
  }

  if (!state.historySessions.length) {
    return `
      <main class="page shell">
        <div class="panel trip-empty">
          <div>
            <div class="empty-symbol">空</div>
            <h2>暂无历史规划会话</h2>
            <p class="muted">开始一次 AI 规划，会话将自动记录在此。</p>
            <button class="primary" data-action="go" data-view="home">立即规划</button>
          </div>
        </div>
      </main>
    `;
  }

  const sync = state.historySync || {};
  const syncTime = sync.latestUpdatedAt ? new Date(sync.latestUpdatedAt).toLocaleString('zh-CN') : '刚刚';

  return `
    <main class="page shell">
      <div class="section-title">
        <div>
          <div class="eyebrow">跨设备历史同步</div>
          <h2>历史会话</h2>
          <p>点击任意会话即可恢复并继续调整行程。</p>
        </div>
        <button class="secondary" data-action="refresh-history">刷新会话</button>
      </div>

      <div class="notice history-sync">
        <strong>跨设备会话同步就绪</strong>
        <span>共 ${state.historySessions.length} 条记录 · 最近同步于 ${escapeHtml(syncTime)}</span>
      </div>

      ${state.historySessions.map((item) => `
        <article class="panel trip-card">
          <div>
            <div class="eyebrow">${new Date(item.createdAt).toLocaleString('zh-CN')} · 第 ${item.version} 版</div>
            <h3>${escapeHtml(item.title || '重庆旅行规划')}</h3>
            <p>${escapeHtml(item.prompt || '默认需求')} ${item.replanHistory?.length ? ` · 已局部微调 ${item.replanHistory.length} 次` : ''}</p>
          </div>
          <div class="trip-actions">
            <button class="primary" data-action="load-history" data-id="${escapeHtml(item.id)}">恢复并继续规划 →</button>
          </div>
        </article>
      `).join('')}
    </main>
  `;
}

export async function loadHistory(renderViewCallback, { force = false } = {}) {
  if (!state.user) return;
  if (!force && Array.isArray(state.historySessions) && isPageDataFresh('history')) return state.historySessions;
  try {
    const data = await request('/api/history');
    state.historySessions = data.sessions || [];
    state.historySync = data.sync;
    markPageDataFresh('history');
    if (state.view === 'history' && renderViewCallback) renderViewCallback();
    return state.historySessions;
  } catch (error) {
    toast(error.message);
  }
}

export async function loadHistorySession(id, { renderLoader, render, scheduleTripMap } = {}) {
  state.loading = true;
  if (renderLoader) renderLoader();
  try {
    const data = await request(`/api/history/${encodeURIComponent(id)}`);
    state.sessionId = data.session.id;
    state.legacyMode = Boolean(data.legacyMode || data.session.legacyMode);
    state.adjustmentCapability = data.adjustmentCapability || data.session.adjustmentCapability || (state.legacyMode ? 'LEGACY' : 'V1_PROPOSAL');
    state.sessionAccessToken = data.sessionAccessToken || null;
    state.activeProposal = null;
    state.selectedOptionId = 'option-1';
    state.trip = data.session.trip;
    state.savedTripId = data.savedTripId || data.session.formalTripId || null;
    if (state.savedTripId) state.trip.savedTripId = state.savedTripId;
    state.prompt = data.session.prompt || state.prompt;
    state.historySync = data.sync || state.historySync;
    state.view = 'planning';
    const chatKey = getTripChatKey(state.savedTripId, state.sessionId);
    const workspace = data.workspace && typeof data.workspace === 'object' ? data.workspace : {};
    state.tripChatHistories = { ...loadUserChats(state.user?.id), ...(state.tripChatHistories || {}) };
    const localMessages = state.tripChatHistories[chatKey] || [];
    const remoteMessages = Array.isArray(workspace.chatMessages) ? workspace.chatMessages : [];
    state.chatSessionId = chatKey;
    state.chatMessages = remoteMessages.length >= localMessages.length ? remoteMessages : localMessages;
    state.chatMode = workspace.chatMode === 'planner' ? 'planner' : 'chat';
    state.itineraryMemorySnapshot = workspace.itineraryMemorySnapshot || null;
    state.tripChatHistories[chatKey] = state.chatMessages;
    saveUserChats(state.user?.id, state.tripChatHistories);
    if (localMessages.length > remoteMessages.length) {
      await persistTripWorkspace({}, { immediate: true });
    }
    toast('已恢复 Java 正式行程，可继续调整后覆盖保存。');
  } catch (error) {
    toast(error.message);
  } finally {
    state.loading = false;
    if (render) render();
    if (scheduleTripMap) scheduleTripMap();
  }
}
