import { state } from '../../app-core/state.js';
import { request } from '../../shared/api/client.js';

let workspaceSaveTimer = null;

function currentPayload(overrides = {}) {
  const savedTripId = String(overrides.savedTripId ?? state.savedTripId ?? '').trim();
  const sessionId = String(overrides.sessionId ?? state.sessionId ?? '').trim();
  if (!state.user || !savedTripId || !sessionId) return null;
  return {
    savedTripId,
    sessionId,
    chatMode: overrides.chatMode ?? state.chatMode,
    chatMessages: Array.isArray(overrides.chatMessages) ? overrides.chatMessages : state.chatMessages
  };
}

async function writeWorkspace(payload) {
  if (!payload) return null;
  try {
    const result = await request(`/api/trips/${encodeURIComponent(payload.savedTripId)}/workspace`, {
      method: 'PUT',
      body: JSON.stringify({
        sessionId: payload.sessionId,
        chatMode: payload.chatMode === 'planner' ? 'planner' : 'chat',
        chatMessages: payload.chatMessages
      })
    });
    return result.workspace || null;
  } catch (error) {
    // Local history remains an offline fallback. A later message or open will
    // retry, so a transient workspace write failure never interrupts chat.
    console.warn('[TripWorkspace] 保存行程对话工作区失败:', error?.message || error);
    return null;
  }
}

/**
 * Persist only saved-trip continuity state. Draft plans remain session-scoped
 * until Java assigns their formal Trip ID during save.
 */
export function persistTripWorkspace(overrides = {}, { immediate = false } = {}) {
  const payload = currentPayload(overrides);
  if (!payload) return Promise.resolve(null);
  if (immediate) {
    if (workspaceSaveTimer) window.clearTimeout(workspaceSaveTimer);
    workspaceSaveTimer = null;
    return writeWorkspace(payload);
  }
  if (workspaceSaveTimer) window.clearTimeout(workspaceSaveTimer);
  workspaceSaveTimer = window.setTimeout(() => {
    workspaceSaveTimer = null;
    void writeWorkspace(payload);
  }, 280);
  return Promise.resolve(null);
}
