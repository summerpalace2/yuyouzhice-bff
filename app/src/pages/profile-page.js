import { state } from '../app-core/state.js';
import { escapeHtml } from '../shared/lib/security.js';
import { request } from '../shared/api/client.js';
import { toast } from '../shared/ui/toast.js';
import { isPageDataFresh, markPageDataFresh } from '../app-core/page-cache.js';

const memoryCategoryLabels = {
  PACE: '节奏与体力',
  ACCESSIBILITY: '无障碍需求',
  TRANSPORT: '出行方式',
  DIET: '饮食习惯',
  COMPANION: '同行偏好',
  INTEREST: '旅行兴趣',
  BUDGET: '消费倾向',
  WEATHER: '天气体感',
  TIME: '出行作息',
  STAY: '住宿偏好',
  CUSTOM: '自定义记忆'
};

function memoryCategoryLabel(category) {
  return memoryCategoryLabels[String(category || 'CUSTOM').toUpperCase()] || '自定义记忆';
}

function profileStatsHtml({ trips, memories, history }) {
  return `
    <div class="profile-stats-grid">
      <div class="profile-stat-card"><div class="stat-name">已存方案</div><div class="stat-val">${trips.length}</div><div class="stat-sub">份持久化行程</div></div>
      <div class="profile-stat-card"><div class="stat-name">旅行记忆</div><div class="stat-val" data-profile-memory-count>${memories.length}</div><div class="stat-sub">条已确认记忆</div></div>
      <div class="profile-stat-card"><div class="stat-name">变更记录</div><div class="stat-val">${history.length}</div><div class="stat-sub">次偏好调整流水</div></div>
      <div class="profile-stat-card"><div class="stat-name">评价反馈</div><div class="stat-val">${state.profile.feedback?.length || 0}</div><div class="stat-sub">条互动记录</div></div>
    </div>
  `;
}

function memoryProfilePanelHtml() {
  const memories = state.profile?.memories || [];
  const memoryCandidates = state.profile?.memoryCandidates || [];
  const memoryEnabled = state.profile?.memoryEnabled === true;
  const lastReviewLabel = state.profile?.memoryLastReviewAt
    ? new Date(state.profile.memoryLastReviewAt).toLocaleString('zh-CN')
    : '尚未进行自动整理';
  return `
    <section class="panel panel-pad memory-profile-panel">
      <div class="memory-profile-head">
        <div><span class="memory-kicker">LONG-TERM MEMORY</span><div class="panel-title">我的旅行记忆</div></div>
        <button class="memory-switch ${memoryEnabled ? 'is-on' : ''}" data-action="toggle-travel-memory" aria-pressed="${memoryEnabled}" aria-label="${memoryEnabled ? '关闭长期旅行记忆' : '开启长期旅行记忆'}"><i></i>${memoryEnabled ? '已启用' : '未启用'}</button>
      </div>
      <p class="muted memory-profile-copy">${memoryEnabled ? '新建 AI 规划与普通聊天会召回下面已确认的记忆；本次明确输入始终优先。' : '它不是自动替你做决定的“偏好标签”。开启后，悠悠只会把稳定的旅行表达整理成候选，仍由你确认是否记住。'}</p>
      ${memoryEnabled ? '' : '<div class="memory-enable-cta"><div><strong>让悠悠逐渐了解你的旅行习惯</strong><span>只记录你确认的内容；可随时编辑、删除或关闭。</span></div><button class="primary memory-enable-btn" data-action="enable-travel-memory">开启长期记忆</button></div>'}
      <div class="memory-review-status"><span>自动整理：后台每小时检查一次；同一账号至少间隔 12 小时</span><time>最近整理：${escapeHtml(lastReviewLabel)}</time></div>
      <div class="memory-priority-line"><span>本次明确输入</span><b>›</b><span>已确认长期记忆</span><b>›</b><span>对话候选（需确认）</span></div>
      ${memoryCandidates.length ? `<div class="memory-candidate-list"><strong>待你确认的记忆建议</strong>${memoryCandidates.map((candidate) => `<article class="memory-candidate-item"><div><span>${escapeHtml(memoryCategoryLabel(candidate.category))}</span><b>${escapeHtml(candidate.content)}</b><small>由后台定时整理生成，确认后才会用于未来规划。</small></div><div><button class="ghost mini-btn" data-action="dismiss-profile-memory-candidate" data-id="${escapeHtml(candidate.id)}">忽略</button><button class="primary mini-btn" data-action="confirm-profile-memory-candidate" data-id="${escapeHtml(candidate.id)}">确认记住</button></div></article>`).join('')}</div>` : ''}
      <div class="travel-memory-list">
        ${memories.length ? memories.map((memory) => `
          <article class="travel-memory-item" data-travel-memory-id="${escapeHtml(memory.id)}">
            <div><span class="travel-memory-category">${escapeHtml(memoryCategoryLabel(memory.category))}</span><strong>${escapeHtml(memory.content)}</strong><small>${escapeHtml(memory.sourceType === 'USER_EDIT' ? '你手动添加' : '由对话识别，经你确认')} · 更新于 ${new Date(memory.updatedAt).toLocaleDateString('zh-CN')}</small></div>
            <div class="travel-memory-actions"><button class="ghost mini-btn" data-action="edit-travel-memory" data-id="${escapeHtml(memory.id)}" data-content="${escapeHtml(memory.content)}" data-category="${escapeHtml(memory.category || 'CUSTOM')}">编辑</button><button class="ghost mini-btn" data-action="delete-travel-memory" data-id="${escapeHtml(memory.id)}">删除</button></div>
          </article>
        `).join('') : '<div class="notice">暂无已确认记忆。聊天中说“以后尽量少走路”后，悠悠会先询问是否记住。</div>'}
      </div>
      <div class="add-pref-inline memory-add-row">
        <input id="new-memory-input" placeholder="添加旅行记忆，例如：喜欢老茶馆、不吃香菜…" />
        <button class="primary" data-action="add-travel-memory">添加记忆</button>
      </div>
    </section>
  `;
}

export function profileView() {
  if (!state.user) {
    return `
      <main class="page shell">
        <div class="panel trip-empty">
          <div>
            <div class="empty-symbol">档</div>
            <h2>登录后查看旅行档案</h2>
            <p class="muted">沉淀您的专属旅行偏好与行程演变历程。</p>
            <button class="primary" data-action="login">登录查看</button>
          </div>
        </div>
      </main>
    `;
  }

  if (!state.profile) {
    return `<main class="page shell"><div class="panel trip-empty"><p>正在读取旅行档案……</p></div></main>`;
  }

  const memories = state.profile.memories || [];
  const history = state.profile.preferenceHistory || [];
  const trips = state.profile.trips || [];

  return `
    <main class="page shell">
      <div class="section-title">
        <div>
          <div class="eyebrow">旅行者专属画像与资产</div>
          <h2>旅行档案 · ${escapeHtml(state.user.name || '旅行者')}</h2>
          <p>直观管理您的长期出行偏好、足迹资产与规划演化历程。</p>
        </div>
        <button class="secondary" data-action="refresh-profile">刷新档案</button>
      </div>

      ${profileStatsHtml({ trips, memories, history })}

      <div class="profile-layout-grid">
        ${memoryProfilePanelHtml()}

        <section class="panel panel-pad">
          <div class="panel-title">行程版本演进与对比</div>
          <p class="muted" style="font-size:12px;margin:4px 0 12px;">记录初始规划、局部重规划与微调的历史轨迹。</p>
          <div class="timeline-container">
            ${trips.length ? trips.map((trip) => `
              <div class="timeline-item">
                <div class="timeline-marker"></div>
                <div class="timeline-content">
                  <strong>${escapeHtml(trip.title)} (第 ${trip.version} 版)</strong>
                  <span class="timeline-time">${new Date(trip.savedAt).toLocaleString('zh-CN')}</span>
                  <div class="version-badges-row">
                    ${(trip.versionHistory || [{ version: trip.version, label: '保存版本' }]).map((vh) => `
                      <span class="v-badge">V${vh.version} ${escapeHtml(vh.label || '')}${vh.reason ? ` · ${escapeHtml(vh.reason)}` : ''}</span>
                    `).join('')}
                  </div>
                </div>
              </div>
            `).join('') : '<div class="notice">暂无已保存行程版本。</div>'}
          </div>
        </section>
      </div>
    </main>
  `;
}

export async function loadProfile(renderViewCallback, { force = false } = {}) {
  if (!state.user) return;
  if (!force && state.profile && isPageDataFresh('profile')) return state.profile;
  try {
    state.profile = await request('/api/profile');
    markPageDataFresh('profile');
    if (state.view === 'profile' && renderViewCallback) renderViewCallback();
    return state.profile;
  } catch (error) {
    toast(error.message);
  }
}

export function refreshProfileInDOM() {
  if (state.view !== 'profile') return false;
  const mount = document.getElementById('view-mount');
  if (!mount) return false;
  const scrollY = window.scrollY;
  mount.innerHTML = profileView();
  window.requestAnimationFrame(() => window.scrollTo({ top: scrollY }));
  return true;
}

export function refreshProfileMemoryInDOM() {
  if (state.view !== 'profile' || !state.profile) return false;
  const panel = document.querySelector('.memory-profile-panel');
  if (!panel) return false;
  panel.outerHTML = memoryProfilePanelHtml();
  document.querySelectorAll('[data-profile-memory-count]').forEach((element) => {
    element.textContent = String((state.profile.memories || []).length);
  });
  return true;
}

export async function rememberPreference(renderModalsCallback) {
  if (!state.user) return;
  try {
    await request('/api/preferences', { method: 'POST', body: JSON.stringify({ value: state.reason }) });
    state.memoryProposal = null;
    if (renderModalsCallback) renderModalsCallback();
    toast(`已记住“${state.reason}”偏好。`);
  } catch (error) {
    toast(error.message);
  }
}
