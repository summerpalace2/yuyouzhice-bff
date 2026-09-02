/**
 * 聊天工作区动作协调器。
 *
 * 只处理用户交互和当前行程聊天上下文；流式网络协议仍由 chat-service 管理。
 * 选中景点、模式切换和提案预览都只刷新聊天/浮窗区域，避免重建行程地图。
 */
function persistChatMode(state, saveUserPlan, persistTripWorkspace) {
  saveUserPlan(state.user?.id, {
    trip: state.trip,
    sessionId: state.sessionId,
    savedTripId: state.savedTripId,
    prompt: state.prompt,
    view: state.view,
    chatMode: state.chatMode
  });
  void persistTripWorkspace();
}

export async function handleChatAction({
  action,
  target,
  state,
  toast,
  renderView,
  renderFloatingBtn,
  renderChatInDOM,
  renderPlannerProposalDockInDOM,
  saveUserPlan,
  saveUserChats,
  persistTripWorkspace,
  getTripChatKey,
  sendChatMessage,
  cancelChatMessage,
  applyPlannerProposal,
  planFromCurrent
} = {}) {
  if (action === 'select-stop') {
    const stopId = String(target.dataset.id || '').trim();
    if (!stopId) return true;
    if (!(state.selectedStopIds instanceof Set)) state.selectedStopIds = new Set();
    if (state.selectedStopIds.has(stopId)) state.selectedStopIds.delete(stopId);
    else state.selectedStopIds.add(stopId);
    state.selectedStopId = Array.from(state.selectedStopIds).at(-1) || null;
    state.activeDay = Number(target.dataset.day || 1);
    state.suggestionDismissed = false;
    document.querySelectorAll('.stop').forEach((element) => {
      const selected = state.selectedStopIds.has(element.dataset.stopId);
      element.classList.toggle('selected-stop-card', selected);
      const button = element.querySelector('[data-action="select-stop"]');
      if (button) {
        button.classList.toggle('active-btn', selected);
        button.textContent = selected ? '取消选中' : '选中此站';
      }
    });
    renderChatInDOM({ scrollToBottom: false }, renderView);
    const count = state.selectedStopIds.size;
    toast(state.chatMode === 'planner'
      ? `已选择 ${count} 个景点，可在聊天框直接选择替换推荐方式。`
      : `已选择 ${count} 个景点；聊天模式可继续咨询选中景点的详细信息。`);
    return true;
  }
  if (['cancel-select-stop', 'clear-selected-stop', 'clear-stop-selection'].includes(action)) {
    state.selectedStopId = null;
    if (!(state.selectedStopIds instanceof Set)) state.selectedStopIds = new Set();
    state.selectedStopIds.clear();
    document.querySelectorAll('.stop').forEach((element) => {
      element.classList.remove('selected-stop-card');
      const button = element.querySelector('[data-action="select-stop"], [data-action="clear-selected-stop"]');
      if (button) {
        button.classList.remove('active-btn');
        button.dataset.action = 'select-stop';
        button.textContent = '选中此站';
      }
    });
    renderChatInDOM({ scrollToBottom: false }, renderView);
    toast('已清除景点选择。');
    return true;
  }
  if (action === 'toggle-pin-stop') {
    const stopId = String(target.dataset.id || '');
    if (stopId) {
      const pinned = state.pinnedStopIds.has(stopId);
      if (pinned) state.pinnedStopIds.delete(stopId);
      else state.pinnedStopIds.add(stopId);
      const stopElement = document.querySelector(`.stop[data-stop-id="${stopId}"]`);
      if (stopElement) {
        stopElement.classList.toggle('pinned-stop-card', !pinned);
        const button = stopElement.querySelector('[data-action="toggle-pin-stop"]');
        if (button) {
          button.classList.toggle('active-btn', !pinned);
          button.textContent = !pinned ? '取消固定' : '📌 固定';
        }
      }
    }
    return true;
  }
  if (action === 'select-option') {
    const optionId = String(target.dataset.optionId || '').trim();
    if (optionId && state.activeProposal) {
      state.selectedOptionId = optionId;
      document.querySelectorAll('.candidate-option-card').forEach((element) => {
        const selected = element.dataset.optionId === optionId;
        element.classList.toggle('selected', selected);
        const radio = element.querySelector('input[type="radio"]');
        if (radio) radio.checked = selected;
      });
      renderChatInDOM({ scrollToBottom: false }, renderView);
    }
    return true;
  }
  if (action === 'dismiss-suggestion' || action === 'reopen-suggestion') {
    state.suggestionDismissed = action === 'dismiss-suggestion';
    renderChatInDOM({ scrollToBottom: false }, renderView);
    return true;
  }
  if (action === 'replan-v1') {
    await planFromCurrent({ usePreferences: true });
    return true;
  }
  if (action === 'confirm-planner-proposal' || action === 'force-apply-planner-proposal') {
    await applyPlannerProposal();
    return true;
  }
  if (action === 'open-planner-proposal' || action === 'close-planner-proposal') {
    state.plannerProposalDockOpen = action === 'open-planner-proposal';
    renderPlannerProposalDockInDOM();
    return true;
  }
  if (action === 'switch-chat-mode' || action === 'switch-adjustment-mode') {
    state.chatMode = action === 'switch-chat-mode' ? 'chat' : 'planner';
    state.chatInput = action === 'switch-chat-mode' ? '' : String(target.dataset.prompt || '');
    persistChatMode(state, saveUserPlan, persistTripWorkspace);
    renderChatInDOM({ scrollToBottom: false }, renderView);
    toast(action === 'switch-chat-mode'
      ? '已切换到聊天，可以继续咨询景点、天气和出行建议。'
      : '已切换到局部调整；原问题已放回输入框，请确认后发送。');
    return true;
  }
  if (action === 'request-other-proposals') {
    if (state.chatLoading) {
      toast('正在生成方案，请稍候。');
      return true;
    }
    state.chatMode = 'planner';
    state.plannerProposalDockOpen = false;
    state.chatDockOpen = true;
    renderFloatingBtn();
    await sendChatMessage(String(target.dataset.prompt || '换同片区其他景点'), true);
    return true;
  }
  if (action === 'open-chat-dock' || action === 'close-chat-dock') {
    state.chatDockOpen = action === 'open-chat-dock';
    renderFloatingBtn();
    if (state.chatDockOpen) window.setTimeout(() => document.querySelector('#chat-input')?.focus(), 0);
    return true;
  }
  if (action === 'dismiss-planner-proposal') {
    state.activeProposal = null;
    state.plannerProposalDockOpen = false;
    state.selectedOptionId = 'option-1';
    state.suggestionDismissed = false;
    renderChatInDOM({ scrollToBottom: false }, renderView);
    toast('已取消本次调整预览，当前行程未改变。');
    return true;
  }
  if (action === 'reset-chat') {
    // A formal Trip owns exactly one chat stream; clearing it must preserve its stable key.
    const chatKey = state.chatSessionId || getTripChatKey(state.savedTripId, state.sessionId);
    state.chatSessionId = chatKey;
    state.chatMessages = [];
    state.chatMeta = null;
    state.chatProposal = null;
    state.activeProposal = null;
    state.plannerProposalDockOpen = false;
    state.tripChatHistories = state.tripChatHistories || {};
    state.tripChatHistories[chatKey] = state.chatMessages;
    saveUserChats(state.user?.id, state.tripChatHistories);
    void persistTripWorkspace();
    renderChatInDOM({ scrollToBottom: true }, renderView);
    toast('已清空当前行程的对话记录。');
    return true;
  }
  if (action === 'unpin-and-retry') {
    state.pinnedStopIds.clear();
    state.activeProposal = null;
    state.plannerProposalDockOpen = false;
    state.selectedOptionId = 'option-1';
    state.suggestionDismissed = false;
    renderChatInDOM({ scrollToBottom: false }, renderView);
    toast('已取消固定站点，请重新描述希望怎样调整行程。');
    return true;
  }
  if (action === 'cancel-chat') {
    cancelChatMessage();
    return true;
  }
  if (action === 'retry-chat' || action === 'quick-ai-action') {
    if (state.chatLoading) {
      toast(action === 'retry-chat' ? '正在生成回复，请先停止当前回复后再重试。' : '正在生成回复，请先停止当前回复后再发送新的问题。');
      return true;
    }
    if (action === 'quick-ai-action' && target.dataset.mode === 'planner' && state.chatMode !== 'planner') {
      state.chatMode = 'planner';
      renderChatInDOM({ scrollToBottom: false }, renderView);
    }
    const prompt = String(target.dataset.prompt || '');
    if (action === 'retry-chat') state.chatInput = prompt;
    await sendChatMessage(prompt, action === 'quick-ai-action');
    return true;
  }
  return false;
}
