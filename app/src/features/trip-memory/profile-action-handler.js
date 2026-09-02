/**
 * 旅行档案与长期记忆动作协调器。
 *
 * 长期记忆写入均以服务端结果为准；删除采用乐观更新并在失败时恢复原档案。
 * 普通记忆操作只刷新档案面板，不能重绘主行程或中断当前聊天流。
 */
export async function handleProfileAction({
  action,
  target,
  state,
  request,
  toast,
  loadProfile,
  refreshProfileInDOM,
  refreshProfileMemoryInDOM,
  renderChatInDOM,
  renderView,
  invalidatePageCache,
  markPageDataFresh
} = {}) {
  const refreshMemoryPanel = () => {
    if (!refreshProfileMemoryInDOM()) refreshProfileInDOM();
  };

  if (action === 'refresh-profile') {
    await loadProfile(refreshProfileInDOM, { force: true });
    return true;
  }
  if (action === 'add-custom-preference') {
    const value = document.querySelector('#new-pref-input')?.value?.trim();
    if (value && state.user) {
      await request('/api/preferences', { method: 'POST', body: JSON.stringify({ value }) });
      await loadProfile(refreshProfileInDOM, { force: true });
      toast(`已添加偏好“${value}”！`);
    }
    return true;
  }
  if (action === 'confirm-memory-candidate') {
    const candidate = state.memoryCandidate;
    if (!candidate) return true;
    try {
      if (candidate.id) {
        await request(`/api/memories/candidates/${encodeURIComponent(candidate.id)}/confirm`, { method: 'POST' });
      } else {
        await request('/api/memories', {
          method: 'POST',
          body: JSON.stringify({ content: candidate.content, category: candidate.category, sourceType: 'CHAT_CONFIRMED' })
        });
      }
      state.memoryCandidate = null;
      state.profile = null;
      invalidatePageCache?.('profile');
      renderChatInDOM({ scrollToBottom: false }, renderView);
      toast('已记住，未来规划会在不与本次需求冲突时参考。');
    } catch (error) {
      toast(error.message);
    }
    return true;
  }
  if (action === 'dismiss-memory-candidate') {
    const candidate = state.memoryCandidate;
    if (candidate?.id) {
      try {
        await request(`/api/memories/candidates/${encodeURIComponent(candidate.id)}/dismiss`, { method: 'POST' });
      } catch (error) {
        toast(error.message);
        return true;
      }
    }
    state.memoryCandidate = null;
    renderChatInDOM({ scrollToBottom: false }, renderView);
    return true;
  }
  if (action === 'add-travel-memory') {
    const content = String(document.querySelector('#new-memory-input')?.value || '').trim();
    if (!content) {
      toast('请输入要记住的旅行习惯。');
      return true;
    }
    try {
      const data = await request('/api/memories', {
        method: 'POST',
        body: JSON.stringify({ content, category: 'CUSTOM', sourceType: 'USER_EDIT' })
      });
      state.profile = { ...(state.profile || {}), memories: [...(state.profile?.memories || []), data.memory].filter(Boolean) };
      markPageDataFresh?.('profile');
      refreshMemoryPanel();
      toast('旅行记忆已添加。');
    } catch (error) {
      toast(error.message);
    }
    return true;
  }
  if (action === 'edit-travel-memory') {
    const content = window.prompt('编辑旅行记忆', target.dataset.content || '');
    if (content === null || !content.trim()) return true;
    try {
      const data = await request(`/api/memories/${encodeURIComponent(target.dataset.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ content: content.trim(), category: target.dataset.category || 'CUSTOM' })
      });
      state.profile = {
        ...(state.profile || {}),
        memories: (state.profile?.memories || []).map((memory) => memory.id === target.dataset.id
          ? (data.memory || { ...memory, content: content.trim() })
          : memory)
      };
      markPageDataFresh?.('profile');
      refreshMemoryPanel();
      toast('旅行记忆已更新。');
    } catch (error) {
      toast(error.message);
    }
    return true;
  }
  if (action === 'delete-travel-memory') {
    const previousProfile = state.profile;
    state.profile = {
      ...(state.profile || {}),
      memories: (state.profile?.memories || []).filter((memory) => memory.id !== target.dataset.id)
    };
    markPageDataFresh?.('profile');
    refreshMemoryPanel();
    toast('已从当前档案移除，正在后台删除。');
    void request(`/api/memories/${encodeURIComponent(target.dataset.id)}`, { method: 'DELETE' }).then(() => {
      toast('旅行记忆已删除。');
    }).catch((error) => {
      state.profile = previousProfile;
      refreshMemoryPanel();
      toast(`删除失败，已恢复：${error.message}`);
    });
    return true;
  }
  if (action === 'confirm-profile-memory-candidate' || action === 'dismiss-profile-memory-candidate') {
    const id = target.dataset.id;
    if (!id) return true;
    try {
      const operation = action === 'confirm-profile-memory-candidate' ? 'confirm' : 'dismiss';
      const data = await request(`/api/memories/candidates/${encodeURIComponent(id)}/${operation}`, { method: 'POST' });
      state.profile = {
        ...(state.profile || {}),
        memoryCandidates: (state.profile?.memoryCandidates || []).filter((candidate) => candidate.id !== id),
        memories: operation === 'confirm' && data.memory
          ? [...(state.profile?.memories || []), data.memory]
          : (state.profile?.memories || [])
      };
      markPageDataFresh?.('profile');
      refreshMemoryPanel();
      toast(operation === 'confirm' ? '旅行记忆已确认。' : '已忽略这条记忆建议。');
    } catch (error) {
      toast(error.message);
    }
    return true;
  }
  if (action === 'toggle-travel-memory' || action === 'enable-travel-memory') {
    const current = state.profile?.memoryEnabled === true;
    if (action === 'enable-travel-memory' && current) return true;
    try {
      const enabled = action === 'enable-travel-memory' ? true : !current;
      const data = await request('/api/memory-settings', { method: 'PUT', body: JSON.stringify({ enabled }) });
      state.profile = { ...(state.profile || {}), memoryEnabled: data.memoryEnabled === true };
      markPageDataFresh?.('profile');
      refreshMemoryPanel();
      toast(data.memoryEnabled ? '已启用长期旅行记忆。' : '已关闭长期旅行记忆；现有条目仍会保留。');
    } catch (error) {
      toast(error.message);
    }
    return true;
  }
  if (action === 'remove-preference') {
    state.loading = true;
    try {
      await request(`/api/preferences/${encodeURIComponent(target.dataset.value)}`, { method: 'DELETE' });
      await loadProfile(refreshProfileInDOM, { force: true });
      toast('已移除该偏好标签。');
    } catch (error) {
      toast(error.message);
    } finally {
      state.loading = false;
    }
    return true;
  }
  return false;
}
