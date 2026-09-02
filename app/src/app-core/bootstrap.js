import { renderAppShell } from './app-shell.js';

/**
 * 应用启动编排。
 *
 * 不拥有业务状态：只规定启动顺序，保证会话恢复完成后才进行首次完整渲染，
 * 以避免游客页与已登录页连续挂载造成视觉闪烁。
 */
export async function bootstrapApplication({
  app,
  restoreAuthSession,
  render,
  scheduleDynamicRefresh,
  loadAdminHealth,
  state
} = {}) {
  renderAppShell(app);

  const viewMount = document.getElementById('view-mount');
  if (viewMount) {
    viewMount.innerHTML = '<main class="page shell"><div class="panel trip-empty"><p>正在恢复会话…</p></div></main>';
  }

  await restoreAuthSession();
  // 管理员直接回到控制中心时，先准备数据再首次挂载，避免先显示空指标、
  // 随后异步请求完成又整页替换一次所造成的闪烁。
  if (state?.user?.role === 'admin' && state.view === 'admin') {
    try {
      await loadAdminHealth({ renderAfterLoad: false });
    } catch (error) {
      console.warn('管理数据加载失败。', error);
    }
  }
  render();
  scheduleDynamicRefresh();

  if (state?.user?.role === 'admin' && state.view !== 'admin') {
    void loadAdminHealth({ renderAfterLoad: false })
      .catch((error) => console.warn('管理数据加载失败。', error));
  }
}
