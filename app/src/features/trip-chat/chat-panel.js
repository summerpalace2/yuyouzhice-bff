import { state } from '../../app-core/state.js';
import { escapeHtml } from '../../shared/lib/security.js';
import { renderMarkdownStatic, renderMarkdownStreaming } from '../../shared/lib/markdown.js';

export function chatMessageHtml(message) {
  const role = message.role === 'user' ? 'user' : 'assistant';
  const content = String(message.content || '');
  const errorText = String(message.error || '');
  const plannerSessionError = role === 'assistant'
    && /规划会话(?:不存在|已过期|需要恢复)|无权访问|PLANNER_SESSION_NOT_FOUND/i.test(`${content} ${errorText}`);
  const offerChatMode = Boolean(message.offerChatMode || plannerSessionError);
  // 聊天模式只负责问答；局部调整动作只能由规划模式明确产生，
  // 避免一次普通问答失败就把用户误导到行程修改流程。
  const canOfferAdjustmentMode = Boolean(state.chatMode === 'planner' && state.user && state.view === 'planning' && state.trip);
  const offerAdjustmentMode = canOfferAdjustmentMode && Boolean(message.offerPlannerMode);
  const normalizedContent = content.trim().replace(/\s+/g, ' ');
  const normalizedError = errorText.trim().replace(/\s+/g, ' ');
  const duplicatedError = Boolean(normalizedContent && normalizedError && normalizedContent === normalizedError);
  const errorSummary = duplicatedError
    ? (/登录/.test(errorText) ? '需要登录后才能继续聊天' : '这次回复没有完成，请重试')
    : errorText;
  const planLabel = role === 'assistant' && !message.pending
    ? content.match(/方案\s*([A-CＡ-Ｃ])/i)?.[1]
    : null;
  let bodyHtml;
  if (role === 'user') {
    bodyHtml = escapeHtml(message.content || '').replace(/\n/g, '<br />');
  } else if (message.pending) {
    bodyHtml = message.content ? renderMarkdownStreaming(message.content) : '<span class="typing-cursor">正在请求后端模型…</span>';
  } else {
    bodyHtml = renderMarkdownStatic(message.content || '');
  }

  const errorClass = message.failureKind === 'temporary' ? ' chat-message-error-soft' : '';
  const errorHtml = message.error ? `
    <div class="chat-message-error${errorClass}" role="alert">
      <span class="chat-error-copy">⚠️ ${escapeHtml(errorSummary)}</span>
      <span class="chat-error-actions">
        ${!state.user && /登录/.test(errorText) ? '<button class="chat-inline-action chat-login-action" type="button" data-action="open-auth-page" data-mode="login">去登录</button>' : ''}
        ${message.retryMessage && !plannerSessionError ? `<button class="chat-inline-action" type="button" data-action="retry-chat" data-prompt="${escapeHtml(message.retryMessage)}">重新发送</button>` : ''}
        ${offerChatMode ? '<button class="chat-inline-action chat-mode-fallback-action" type="button" data-action="switch-chat-mode">切换到聊天</button>' : ''}
        ${offerAdjustmentMode ? `<button class="chat-inline-action chat-mode-adjust-action" type="button" data-action="switch-adjustment-mode" data-prompt="${escapeHtml(message.retryMessage || '')}">切换到局部调整</button>` : ''}
      </span>
    </div>
  ` : '';
  const planActionHtml = planLabel ? `
    <div class="chat-message-actions">
      <button class="chip primary-chip" type="button" data-action="quick-ai-action" data-mode="planner" data-prompt="方案${escapeHtml(planLabel)}选这个，帮我局部调整行程">🧭 采用方案${escapeHtml(planLabel)}，查看局部调整</button>
    </div>
  ` : '';

  return `
    <div class="chat-message chat-message-${role}">
      <div class="chat-message-role"><span class="chat-role-mark" aria-hidden="true">${role === 'user' ? '你' : '渝'}</span>${role === 'user' ? '你' : '悠悠助手'}</div>
      <div class="chat-message-content">${bodyHtml}</div>
      ${errorHtml}
      ${planActionHtml}
    </div>
  `;
}

export function chatMetaHtml(meta) {
  // 后端通道信息只留在调试数据中，不进入用户对话界面。
  return '';
}

export function plannerProposalHtml(proposal) {
  if (!proposal) return '';
  const changed = Array.isArray(proposal.changedSegments) ? proposal.changedSegments.length : 0;
  const isFeasible = proposal.feasible !== false;
  const alternatives = Array.isArray(proposal.alternatives) ? proposal.alternatives : [];
  const candidates = Array.isArray(proposal.candidateReplacements) ? proposal.candidateReplacements : [];
  const selectedOption = state.selectedOptionId || 'option-1';
  const directCandidate = candidates.find((candidate) => candidate.directReplacement) || candidates[0];
  const isDirectReplacement = proposal.replacementMode === 'DIRECT' || Boolean(directCandidate?.directReplacement);
  const sourceName = proposal.sourceStopName || proposal.intent?.targetStopReference || '当前站点';
  const requestedName = proposal.requestedReplacementName || directCandidate?.requestedName || directCandidate?.name || '目标地点';

  return `
    <div class="chat-proposal ${!isFeasible ? 'proposal-infeasible' : ''}" role="region" aria-label="行程调整方案预览">
      <div class="chat-proposal-head">
        <div>
          <span class="proposal-overline">${isDirectReplacement ? 'ONE-TO-ONE CHANGE' : 'LOCAL ITINERARY CHANGE'}</span>
          <strong>${isFeasible ? (isDirectReplacement ? '一对一替换预览' : '行程调整预览') : '路线提示：仍可按你的选择执行'}</strong>
        </div>
        <span class="proposal-impact ${isFeasible ? 'is-ready' : 'is-caution'}">${isFeasible ? (changed ? `仅影响 ${changed} 站` : '局部微调') : '顺路度较低'}</span>
      </div>
      ${isDirectReplacement ? `<div class="direct-replacement-summary"><span class="direct-replacement-place">${escapeHtml(sourceName)}</span><span class="direct-replacement-arrow">→</span><strong>${escapeHtml(requestedName)}</strong><small>确认后只替换这一站，最终决定权在你</small></div>` : ''}
      <p class="proposal-message">${escapeHtml(isFeasible
        ? (proposal.message || (isDirectReplacement ? '已锁定目标地点；确认后只替换这一站，其余安排保持不变。' : '悠悠已为你生成局部调整预览。'))
        : '按当前时间与路线，采用后当天可能更赶一些。这个提示不会阻止你修改，是否采用仍由你决定。')}</p>

      ${!isFeasible ? `
        <div class="proposal-alert" role="note">
          <span class="proposal-alert-icon" aria-hidden="true">✦</span>
          <div><strong>你的选择优先。</strong><span> 我会保留这个替换目标，同时准备更顺路的备选。</span></div>
          ${alternatives.length ? `
            <div class="proposal-alternative-hint">可参考：${escapeHtml(alternatives.slice(0, 2).join('、'))}</div>
          ` : ''}
        </div>
      ` : ''}

      ${candidates.length > 0 ? `
        <div class="candidate-options-group">
          <div class="options-title">${isDirectReplacement ? '已锁定目标地点，请确认这一对一替换：' : '请选择心仪的替换候选（默认选中方案 1）：'}</div>
          <div class="candidate-options-list">
            ${candidates.map((cand, idx) => {
              const optId = cand.optionId || `option-${idx + 1}`;
              const isSelected = optId === selectedOption;
              return `
                <label class="candidate-option-card ${isSelected ? 'selected' : ''}" data-action="select-option" data-option-id="${escapeHtml(optId)}">
                  <div class="option-card-head">
                    <input type="radio" name="proposal-option" value="${escapeHtml(optId)}" ${isSelected ? 'checked' : ''} />
                    <strong>${isDirectReplacement ? '目标地点：' : `方案 ${idx + 1}：`}${escapeHtml(cand.requestedName || cand.name)}</strong>
                    <span class="chip">${escapeHtml(cand.district || '')} · 步行${escapeHtml(cand.walkDifficulty || '低')}</span>
                  </div>
                  <p class="option-summary">${escapeHtml(cand.summary || '')}</p>
                </label>
              `;
            }).join('')}
          </div>
        </div>
      ` : ''}

      <div class="chat-proposal-actions">
        ${isFeasible ? `
          <button class="primary mini-btn proposal-primary-action" type="button" data-action="confirm-planner-proposal">确认并应用</button>
          ${!isDirectReplacement ? '<button class="ghost mini-btn" type="button" data-action="request-other-proposals">查看其他方案</button>' : ''}
        ` : `
          ${isDirectReplacement ? '<button class="primary mini-btn proposal-primary-action" type="button" data-action="force-apply-planner-proposal">仍按此方案替换</button>' : ''}
          <button class="secondary mini-btn" type="button" data-action="request-other-proposals">查看替代方案</button>
        `}
        <button class="ghost mini-btn proposal-dismiss-action" type="button" data-action="dismiss-planner-proposal">先不修改</button>
      </div>
    </div>
  `;
}

export function chatProposalHtml(proposal) {
  if (!proposal) return '';
  const changed = Array.isArray(proposal.changedSegments) ? proposal.changedSegments.length : 0;
  return `
    <div class="chat-proposal" role="region" aria-label="行程修改方案">
      <div class="chat-proposal-head"><strong>待确认的行程修改</strong><span class="chip">${changed ? `影响 ${changed} 个站点` : '仅建议，不会自动修改'}</span></div>
      <p>${escapeHtml(proposal.summary || proposal.message || '悠悠已准备一份修改方案。')}</p>
      ${proposal.reason ? `<div class="muted">依据：${escapeHtml(proposal.reason)}</div>` : ''}
      ${proposal.requiresConfirmation ? `<div class="chat-proposal-actions"><button class="primary mini-btn" data-action="confirm-chat-proposal">确认并生成新版本</button><button class="ghost mini-btn" data-action="dismiss-chat-proposal">暂不修改</button></div>` : ''}
    </div>
  `;
}

export function chatModeBannerHtml() {
  const selectedIds = state.selectedStopIds instanceof Set
    ? state.selectedStopIds
    : new Set(state.selectedStopId ? [state.selectedStopId] : []);
  const selectedStops = state.trip?.days?.flatMap((d) => d.stops || [])
    .filter((stop) => selectedIds.has(stop.id)) || [];
  const hasPlanningContext = state.view === 'planning' && Boolean(state.trip);
  const isAdjustment = hasPlanningContext && state.chatMode === 'planner';
  const modeLabel = isAdjustment ? '局部调整' : '聊天';
  const modeDescription = isAdjustment
    ? '只调整当前行程片段，确认后才会应用'
    : hasPlanningContext ? '只回答景点、天气和出行问题，不修改行程' : '游客模式：只回答旅行问题，不修改或保存行程';
  const selectedStopName = selectedStops.length === 1
    ? `当前站点：${selectedStops[0].name}`
    : selectedStops.length > 1
      ? `已选 ${selectedStops.length} 个景点`
      : '';
  return `
    <div class="chat-mode-helper ${isAdjustment ? 'is-adjustment' : 'is-chat'}">
      <span class="chat-mode-helper-icon" aria-hidden="true">${isAdjustment ? '✦' : '◌'}</span>
      <span class="chat-mode-helper-copy"><strong>${modeLabel}</strong><small>${modeDescription}</small></span>
      ${selectedStopName ? `<span class="chat-selected-stop">${escapeHtml(selectedStopName)}</span>` : ''}
    </div>
  `;
}

function selectedStopsForChat() {
  const selectedIds = state.selectedStopIds instanceof Set
    ? state.selectedStopIds
    : new Set(state.selectedStopId ? [state.selectedStopId] : []);
  return state.trip?.days?.flatMap((d) => d.stops || [])
    .filter((stop) => selectedIds.has(stop.id)) || [];
}

export function selectedStopActionHtml() {
  if (state.view !== 'planning' || !state.trip) return '';
  const selectedStops = selectedStopsForChat();
  if (!selectedStops.length) return '';
  const selectedText = selectedStops.map((stop) => `【${stop.name}】`).join('、');
  const namesText = selectedStops.map((stop) => stop.name).join('、');
  const isAdjustment = state.chatMode === 'planner';
  const detailPrompt = `请详细介绍${selectedText}，包括开放时间、主要亮点、交通方式和适合人群。`;
  const actions = isAdjustment
    ? [
      ['推荐同片区替换', `请推荐${selectedText}的同片区可替换景点`],
      ['推荐室内景点', `请为${selectedText}推荐适合替换的室内景点`],
      ['推荐低步行景点', `请为${selectedText}推荐步行量更低的替换景点`]
    ]
    : [['咨询详细信息', detailPrompt]];
  return `
    <section class="chat-selection-panel ${isAdjustment ? 'is-adjustment' : 'is-chat'}" aria-live="polite">
      <div class="chat-selection-copy">
        <strong>${isAdjustment ? '已选中，开始局部调整' : '已选中这个景点'}</strong>
        <span>${isAdjustment
          ? `当前选择：${escapeHtml(namesText)}。请选择一种替换推荐方式：`
          : `已选中${escapeHtml(selectedText)}，请问你是要咨询更详细的信息吗？`}</span>
      </div>
      <div class="chat-selection-actions">
        ${actions.map(([label, prompt]) => `
          <button class="chat-selection-action" type="button" data-action="quick-ai-action" data-mode="${isAdjustment ? 'planner' : 'chat'}" data-prompt="${escapeHtml(prompt)}">${escapeHtml(label)}</button>
        `).join('')}
        <button class="chat-selection-clear" type="button" data-action="clear-stop-selection">清除选择</button>
      </div>
    </section>
  `;
}

export function suggestionCalloutHtml() {
  // 主页已经负责完整行程规划；AI 浮窗只保留聊天或局部调整，不再渲染额外建议卡和快捷操作。
  return '';
}

export function quickChipsHtml() {
  return '';
}

function memoryCandidateHtml() {
  const candidate = state.memoryCandidate;
  if (!candidate || !state.user) return '';
  return `
    <section class="chat-memory-candidate" aria-live="polite">
      <span class="chat-memory-candidate-icon" aria-hidden="true">✦</span>
      <div><strong>要把这件事记住吗？</strong><p>${escapeHtml(candidate.content)}</p><small>仅在你确认后，才会用于未来的旅行规划。</small></div>
      <div class="chat-memory-candidate-actions"><button class="primary mini-btn" type="button" data-action="confirm-memory-candidate">记住</button><button class="ghost mini-btn" type="button" data-action="dismiss-memory-candidate">仅本次</button></div>
    </section>
  `;
}

export function chatPanel({ floating = false } = {}) {
  const hasPlanningContext = state.view === 'planning' && Boolean(state.trip);
  const canAdjust = Boolean(state.user && hasPlanningContext);
  const chatMode = canAdjust && state.chatMode === 'planner' ? 'planner' : 'chat';
  const isGuestChat = !state.user && !hasPlanningContext;
  const inputPlaceholder = chatMode === 'planner'
    ? (state.selectedStopId ? '输入局部调整要求，例如：换成附近的室内景点…' : '描述要怎样微调当前行程，例如：少走路、多安排室内景点…')
    : hasPlanningContext ? '问问景点、天气、交通或美食，不会直接修改行程…' : '问问重庆景点、天气、交通或美食…';
  return `
    <aside class="panel chat-panel ${floating ? 'chat-panel-floating' : ''} ${isGuestChat ? 'chat-panel-guest' : ''}" ${floating ? 'role="dialog" aria-label="悠悠 AI 行程助手"' : 'aria-label="AI 智能旅行助理"'}>
      <div class="panel-pad">
        <div class="chat-header-row">
          <div class="chat-dock-heading">
            <span class="chat-dock-avatar" aria-hidden="true">渝</span>
            <div>
              <div class="panel-title">AI 旅行决策助手</div>
              <span class="chat-dock-live"><i></i> 悠悠在线</span>
            </div>
            <span class="chat-subtitle">${hasPlanningContext ? '聊天，或对当前行程做局部调整' : '游客体验 · 只聊旅行问题'}</span>
          </div>
          <div class="chat-header-controls">
            ${canAdjust ? `
              <div class="chat-mode-select-wrap">
                <label for="chat-mode" class="chat-mode-label">对话用途：</label>
                <select id="chat-mode" class="chat-mode-select">
                  <option value="chat" ${chatMode === 'chat' ? 'selected' : ''}>聊天</option>
                  <option value="planner" ${chatMode === 'planner' ? 'selected' : ''}>局部调整</option>
                </select>
              </div>
            ` : '<span class="guest-chat-mode-pill">游客聊天</span>'}
            ${floating ? '<button class="chat-dock-close" type="button" data-action="close-chat-dock" aria-label="收起 AI 助手">×</button>' : ''}
          </div>
        </div>

        <div class="chat-mode-banner-mount">
          ${chatModeBannerHtml()}
        </div>
        ${selectedStopActionHtml()}

        <div class="chat-transcript" role="log" aria-live="polite">
          ${state.chatMessages.length === 0 ? `
            <div class="chat-empty">
              <span class="chat-empty-orb" aria-hidden="true">✦</span>
              <strong>${hasPlanningContext ? '从你的行程开始聊' : '先从旅行问题开始聊'}</strong>
              <p>${hasPlanningContext ? '可以问景点，也可以说“把第二天改得轻松一点”。我会先给你预览，确认后再应用。' : '可以问景点、天气、交通和美食。完整行程规划需要登录账号。'}</p>
            </div>
          ` : state.chatMessages.map(chatMessageHtml).join('')}
        </div>
        ${memoryCandidateHtml()}

        <form class="chat-input-row" data-action="chat-form">
            <textarea
              id="chat-input"
              rows="1"
              placeholder="${inputPlaceholder}"
              aria-label="输入旅行问题或局部调整要求；Enter 发送，Shift 加 Enter 换行"
              title="Enter 发送 · Shift + Enter 换行"
            ${state.chatLoading ? 'disabled' : ''}
            >${escapeHtml(state.chatInput)}</textarea>
          ${state.chatLoading
            ? '<button type="button" class="secondary" data-action="cancel-chat">停止生成</button>'
            : '<button type="submit" class="primary">发送</button>'
          }
        </form>
      </div>
    </aside>
  `;
}

export function floatingChatDock() {
  if (state.view !== 'planning' || !state.trip) return '';
  const attention = state.activeProposal ? '待确认调整' : state.chatLoading ? '正在回复' : '问问悠悠';
  return `
    <div class="chat-dock ${state.chatDockOpen ? 'is-open' : ''}">
      ${state.chatDockOpen ? `<div id="chat-dock-panel" class="chat-dock-panel">${chatPanel({ floating: true })}</div>` : `
        <button class="chat-dock-trigger" type="button" data-action="open-chat-dock" aria-expanded="false" aria-controls="chat-dock-panel">
          <span class="chat-dock-trigger-icon" aria-hidden="true">✦</span>
          <span class="chat-dock-trigger-copy"><strong>悠悠 AI</strong><small>${attention}</small></span>
          ${state.activeProposal ? '<span class="chat-dock-badge">1</span>' : ''}
        </button>
      `}
    </div>
  `;
}

/**
 * 行程调整方案单独占用一个小悬浮窗，避免候选卡片把聊天记录和输入框顶走。
 * 方案窗口和 AI 聊天窗口可以同时打开，用户可先看方案再决定下一步。
 */
export function floatingPlannerProposalDock() {
  if (state.view !== 'planning' || !state.trip || !state.activeProposal) return '';
  if (!state.plannerProposalDockOpen) {
    return `
      <button class="planner-proposal-trigger" type="button" data-action="open-planner-proposal" aria-label="打开局部调整预览">
        <span class="planner-proposal-trigger-icon" aria-hidden="true">🧭</span>
        <span><strong>局部调整</strong><small>等待你的决定</small></span>
        <b>1</b>
      </button>
    `;
  }
  return `
    <section class="planner-proposal-dock" role="dialog" aria-label="局部调整预览">
      <div class="planner-proposal-dock-head">
        <div><span class="planner-proposal-kicker">TRIP DECISION</span><strong>局部调整预览</strong></div>
        <button class="planner-proposal-close" type="button" data-action="close-planner-proposal" aria-label="关闭方案预览">×</button>
      </div>
      <div class="planner-proposal-dock-body">${plannerProposalHtml(state.activeProposal)}</div>
    </section>
  `;
}

export function renderPlannerProposalDockInDOM() {
  const root = document.querySelector('#planner-proposal-dock-root');
  if (!root) return;
  root.className = `planner-proposal-dock-root ${state.chatDockOpen ? 'with-chat' : ''}`;
  root.innerHTML = floatingPlannerProposalDock();
}

export function renderChatInDOM({ scrollToBottom = true } = {}, renderViewCallback) {
  const panel = document.querySelector('.chat-panel');
  if (!panel) {
    renderPlannerProposalDockInDOM();
    if (renderViewCallback) renderViewCallback();
    return;
  }

  // 1. 更新模式专属标识条 (chat-mode-banner)
  const bannerMount = panel.querySelector('.chat-mode-banner-mount');
  if (bannerMount) {
    bannerMount.innerHTML = chatModeBannerHtml();
  }

  // 景点选择是聊天框内的即时上下文，不需要重刷整页；切换模式或多选站点时同步更新。
  const oldSelectionPanel = panel.querySelector('.chat-selection-panel');
  oldSelectionPanel?.remove();
  if (bannerMount) {
    const selectionHtml = selectedStopActionHtml();
    if (selectionHtml) bannerMount.insertAdjacentHTML('afterend', selectionHtml);
  }

  // 2. 更新聊天消息记录区 (transcript)
  const transcript = panel.querySelector('.chat-transcript');
  if (transcript) {
    if (state.chatMessages.length === 0) {
      transcript.innerHTML = `
        <div class="chat-empty">
          <p>你可以直接向 AI 发问，或在左侧点击任一景点的<strong>【选中此站】</strong>进行精准微调。</p>
        </div>
      `;
    } else {
      transcript.innerHTML = state.chatMessages.map(chatMessageHtml).join('');
    }
    if (scrollToBottom) {
      transcript.scrollTop = transcript.scrollHeight;
    }
  }

  panel.querySelector('.chat-memory-candidate')?.remove();
  const liveInputRow = panel.querySelector('.chat-input-row');
  if (state.memoryCandidate && liveInputRow) {
    liveInputRow.insertAdjacentHTML('beforebegin', memoryCandidateHtml());
  }

  // 规划 Proposal 统一由独立方案窗承载，聊天窗不再渲染旧版 Chat Proposal，
  // 避免历史兼容状态与当前方案窗重复占位。
  panel.querySelector('.chat-proposal')?.remove();
  // 兼容热更新或旧版本已挂载的面板：清掉不再面向用户展示的内部状态区。
  panel.querySelector('.chat-meta')?.remove();
  panel.querySelector('.chat-context-strip')?.remove();
  panel.querySelector('.chat-suggestion-mount')?.remove();
  panel.querySelector('.quick-chips-mount')?.remove();

  renderPlannerProposalDockInDOM();

  // 3. 输入框状态更新
  const inputEl = panel.querySelector('#chat-input');
  if (inputEl) {
    inputEl.value = state.chatInput;
    inputEl.disabled = state.chatLoading;
    inputEl.placeholder = state.chatMode === 'planner'
      ? (state.selectedStopId ? '输入局部调整要求，例如：换成附近的室内景点…' : '描述要怎样微调当前行程，例如：少走路、多安排室内景点…')
      : '问问景点、天气、交通或美食，不会直接修改行程…';
    resizeChatInput(inputEl);
  }
  const modeSelect = panel.querySelector('#chat-mode');
  if (modeSelect) modeSelect.value = state.chatMode === 'planner' ? 'planner' : 'chat';
  const inputRow = panel.querySelector('.chat-input-row');
  const actionBtn = inputRow?.querySelector('button');
  if (inputRow) {
    const shouldShowCancel = Boolean(state.chatLoading);
    const isCancelButton = actionBtn?.dataset.action === 'cancel-chat';
    if (actionBtn && shouldShowCancel !== isCancelButton) {
      actionBtn.outerHTML = shouldShowCancel
        ? '<button type="button" class="secondary" data-action="cancel-chat">停止生成</button>'
        : '<button type="submit" class="primary">发送</button>';
    } else if (actionBtn) {
      actionBtn.disabled = false;
      actionBtn.textContent = shouldShowCancel ? '停止生成' : '发送';
    } else {
      inputRow.insertAdjacentHTML('beforeend', shouldShowCancel
        ? '<button type="button" class="secondary" data-action="cancel-chat">停止生成</button>'
        : '<button type="submit" class="primary">发送</button>');
    }
  }
}

/**
 * 聊天输入随内容增长到可读高度；达到上限后改为输入框内部滚动，
 * 防止长文本把浮窗消息区和发送按钮挤出视口。
 */
export function resizeChatInput(input) {
  if (!(input instanceof HTMLTextAreaElement)) return;
  const maxHeight = 144;
  input.style.height = 'auto';
  const nextHeight = Math.min(input.scrollHeight, maxHeight);
  input.style.height = `${Math.max(42, nextHeight)}px`;
  input.style.overflowY = input.scrollHeight > maxHeight ? 'auto' : 'hidden';
}
