/**
 * 管理控制中心动作协调器。
 *
 * 不直接导入页面或 App Shell：所有 UI 更新能力由组合根注入。
 * 账号停用采用乐观更新；失败时恢复 state，再由调用方执行页面级回退渲染。
 */
function usersFromOverview(state) {
  return Array.isArray(state.adminOverview?.users) ? state.adminOverview.users : [];
}

function findUserRow(app, userId) {
  return [...app.querySelectorAll('[data-admin-user-id]')]
    .find((row) => row.dataset.adminUserId === String(userId)) || null;
}

function syncUserSummary(app, state) {
  const users = usersFromOverview(state);
  const admins = users.filter((user) => user.role === 'admin').length;
  app.querySelectorAll('[data-admin-user-count]').forEach((element) => {
    element.textContent = `共 ${users.length} 位注册用户`;
  });
  app.querySelectorAll('[data-admin-user-count-value]').forEach((element) => {
    element.textContent = String(users.length);
  });
  app.querySelectorAll('[data-admin-admin-count]').forEach((element) => {
    element.textContent = String(admins);
  });
}

function removeUserRow(app, userId) {
  const row = findUserRow(app, userId);
  if (!row) return;
  row.classList.add('is-removing');
  window.setTimeout(() => {
    row.remove();
    const list = app.querySelector('[data-admin-user-list]');
    if (list && !list.querySelector('[data-admin-user-id]')) {
      list.innerHTML = '<div class="notice">当前没有可管理的账号。</div>';
    }
  }, 180);
}

function updateUserRole(app, userId, role) {
  const row = findUserRow(app, userId);
  if (!row) return;
  const roleLabel = row.querySelector('[data-admin-user-role-label]');
  if (roleLabel) roleLabel.textContent = role === 'admin' ? '系统管理员' : '普通旅行者';
  const button = row.querySelector('[data-admin-user-role-button]');
  if (button) {
    button.dataset.role = role === 'admin' ? 'traveler' : 'admin';
    button.textContent = role === 'admin' ? '设为游客' : '设为管理员';
    button.classList.toggle('role-demote', role === 'admin');
    button.classList.toggle('role-promote', role !== 'admin');
  }
  row.classList.remove('is-updating');
}

/**
 * 返回 true 表示动作已由管理端消费。
 */
export async function handleAdminAction({
  action,
  target,
  app,
  state,
  request,
  toast,
  renderModals,
  renderView,
  updateAdminDocListInDOM,
  clearRerankCache,
  loadRerankStats,
  refreshRerankPanelInDOM,
  loadAdminHealth
} = {}) {
  if (action === 'admin-doc-topic') {
    state.adminDocTopic = target.dataset.topic || '';
    updateAdminDocListInDOM();
    return true;
  }
  if (action === 'toggle-admin-docs-fold') {
    state.adminDocsFolded = !state.adminDocsFolded;
    updateAdminDocListInDOM();
    return true;
  }
  if (action === 'toggle-doc-expand') {
    const id = target.dataset.id;
    const itemEl = target.closest('.doc-item');
    if (itemEl) {
      const expanded = itemEl.classList.contains('expanded');
      itemEl.classList.toggle('expanded', !expanded);
      itemEl.querySelector('.doc-body-view')?.classList.toggle('show-full', !expanded);
      const icon = itemEl.querySelector('.expand-icon');
      if (icon) icon.textContent = !expanded ? '收起 ↑' : '展开 ↓';
      if (expanded) state.adminDocExpanded.delete(id);
      else state.adminDocExpanded.add(id);
    }
    return true;
  }
  if (action === 'edit-doc') {
    state.editingDoc = {
      id: target.dataset.id,
      entity: target.dataset.entity,
      title: target.dataset.title,
      content: target.dataset.content
    };
    renderModals();
    return true;
  }
  if (action === 'view-user-detail') {
    try {
      const result = await request(`/api/admin/users/${encodeURIComponent(target.dataset.id)}`);
      state.adminUserDetail = result.detail || result.user || null;
      renderModals();
    } catch (error) {
      toast(error.message || '无法读取用户详情。');
    }
    return true;
  }
  if (action === 'close-user-detail') {
    state.adminUserDetail = null;
    renderModals();
    return true;
  }
  if (action === 'view-feedback-detail') {
    const index = Number(target.dataset.index);
    state.adminFeedbackDetail = Array.isArray(state.adminOverview?.feedbackItems)
      ? state.adminOverview.feedbackItems[index] || null
      : null;
    renderModals();
    return true;
  }
  if (action === 'close-feedback-detail') {
    state.adminFeedbackDetail = null;
    renderModals();
    return true;
  }
  if (action === 'close-doc-edit') {
    state.editingDoc = null;
    renderModals();
    return true;
  }
  if (action === 'toggle-user-role') {
    const userId = target.dataset.id;
    const newRole = target.dataset.role;
    const row = findUserRow(app, userId);
    row?.classList.add('is-updating');
    try {
      await request('/api/admin/users/role', {
        method: 'POST',
        body: JSON.stringify({ userId, role: newRole })
      });
      state.adminOverview = {
        ...state.adminOverview,
        users: usersFromOverview(state).map((user) => user.id === userId ? { ...user, role: newRole } : user)
      };
      updateUserRole(app, userId, newRole);
      syncUserSummary(app, state);
      toast(`用户权限已成功更新为：${newRole === 'admin' ? '系统管理员' : '普通用户'}`);
    } catch (error) {
      row?.classList.remove('is-updating');
      toast(error.message);
    }
    return true;
  }
  if (action === 'clear-admin-rerank-cache') {
    state.userActionConfirm = {
      title: '清空 Rerank 缓存？',
      message: '这只会清理 Java Rerank 的 L1/L2/L3 缓存，不会删除知识文档或修改行程。',
      isDanger: false,
      execute: async () => {
        try {
          await clearRerankCache();
          await loadRerankStats();
          refreshRerankPanelInDOM();
          toast('Rerank 缓存已清空。');
        } catch (error) {
          toast(error.message || 'Rerank 缓存清理失败。');
        }
      }
    };
    renderModals();
    return true;
  }
  if (action === 'reset-user-data') {
    const userId = target.dataset.id;
    const userName = target.dataset.name;
    state.userActionConfirm = {
      title: '重置用户数据？',
      message: `确定要重置用户【${userName}】的所有行程和偏好数据吗？此操作不可逆。`,
      isDanger: false,
      execute: async () => {
        try {
          await request('/api/admin/users/reset', { method: 'POST', body: JSON.stringify({ userId }) });
          toast(`已成功重置用户【${userName}】的行程与偏好数据。`);
          await loadAdminHealth();
        } catch (error) {
          toast(error.message);
        }
      }
    };
    renderModals();
    return true;
  }
  if (action === 'delete-user') {
    const userId = target.dataset.id;
    const userName = target.dataset.name;
    const previousOverview = state.adminOverview;
    const overview = previousOverview || {};
    const removedUser = Array.isArray(overview.users) ? overview.users.find((item) => item.id === userId) : null;
    const nextUsers = Array.isArray(overview.users) ? overview.users.filter((item) => item.id !== userId) : overview.users;
    state.adminOverview = {
      ...overview,
      users: nextUsers,
      metrics: overview.metrics ? {
        ...overview.metrics,
        users: Math.max(0, Number(overview.metrics.users || 0) - 1),
        travelers: removedUser?.role === 'admin'
          ? Number(overview.metrics.travelers || 0)
          : Math.max(0, Number(overview.metrics.travelers || 0) - 1)
      } : overview.metrics
    };
    removeUserRow(app, userId);
    syncUserSummary(app, state);
    toast(`已从当前列表移除【${userName}】；正在后台停用账号。`);
    void request('/api/admin/users/delete', {
      method: 'POST',
      body: JSON.stringify({ userId })
    }).then(() => {
      toast(`账号【${userName}】已停用。`);
    }).catch((error) => {
      state.adminOverview = previousOverview;
      renderView();
      toast(`账号停用失败，已恢复列表：${error.message}`);
    });
    return true;
  }
  if (action === 'cancel-user-action') {
    state.userActionConfirm = null;
    renderModals();
    return true;
  }
  if (action === 'confirm-user-action') {
    if (!state.adminActionPending && state.userActionConfirm?.execute) {
      await state.userActionConfirm.execute();
    }
    state.userActionConfirm = null;
    state.adminActionPending = false;
    renderModals();
    return true;
  }
  return false;
}
