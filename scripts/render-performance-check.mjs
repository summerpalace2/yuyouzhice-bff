import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (...parts) => readFileSync(path.join(root, ...parts), 'utf8');
const app = read('app', 'app.js');
const shell = read('app', 'src', 'app-core', 'app-shell.js');
const bootstrap = read('app', 'src', 'app-core', 'bootstrap.js');
const planner = read('app', 'src', 'features', 'trip-planning', 'planner-service.js');
const profile = read('app', 'src', 'pages', 'profile-page.js');
const profileActions = read('app', 'src', 'features', 'trip-memory', 'profile-action-handler.js');
const admin = read('app', 'src', 'pages', 'admin-page.js');
const navigation = read('app', 'src', 'app-core', 'navigation-handler.js');
const adminActions = read('app', 'src', 'features', 'admin-corpus', 'admin-action-handler.js');
const trips = read('app', 'src', 'features', 'trip-save', 'save-service.js');
const pageCache = read('app', 'src', 'app-core', 'page-cache.js');

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

expect(shell.includes('recordLocalViewMount') && shell.includes('__yuyouzhiceRenderStats'), '缺少本地根视图重绘观测器');
expect(shell.includes("state.loading && state.loadingPhase ? 'loading' : ''"), '普通异步状态仍会给整页加上不可点击的 loading 层');
expect(bootstrap.includes('await restoreAuthSession();') && bootstrap.indexOf('await restoreAuthSession();') < bootstrap.indexOf('render();'), '启动仍在会话恢复前渲染完整页面');
expect(app.includes('renderDynamic: refreshPlanningDynamicInDOM') && app.includes('refreshPlanningLocationInDOM()'), '天气或定位仍未采用行程页局部更新');
expect(planner.includes('renderDynamic') && planner.includes('else if (render) {\n      render();'), '动态数据刷新没有优先采用局部渲染适配器');
const constraintEditBlock = app.split("if (action === 'edit-constraints')")[1]?.split("if (action === 'cancel-constraints')")[0] || '';
expect(constraintEditBlock.includes('if (!refreshPlanningConstraintsInDOM()) renderView();'), '修改旅行条件没有优先采用侧栏局部更新');
expect(profile.includes('refreshProfileMemoryInDOM') && profileActions.includes('refreshProfileMemoryInDOM'), '旅行记忆操作未采用面板级更新');
expect(admin.includes('switchAdminSectionInDOM') && navigation.includes("state.view === 'admin' && switchAdminSectionInDOM(section)"), '控制中心分区切换仍会整页重绘');
expect(admin.includes('state.adminLoading || !state.adminOverview') && admin.includes('admin-loading-skeleton'), '管理员首屏缺少真实数据加载态，仍可能先展示空指标');
expect(navigation.includes("state.view = 'admin';") && navigation.includes('state.adminLoading = true') && navigation.includes('await loadAdminHealth'), '管理员导航没有先进入加载页再读取概览');
expect(trips.includes('updateTripsInDOM') && trips.includes('state.savedTrips = Array.isArray(state.savedTrips)'), '行程删除未采用局部乐观更新');
expect(pageCache.includes("CACHEABLE_VIEWS = new Set(['explore', 'trips', 'history', 'profile', 'admin'])"), '页面缓存范围缺失或意外缓存了规划/聊天会话');
expect(pageCache.includes('stashViewSnapshot') && pageCache.includes('restoreViewSnapshot') && shell.includes('restoreViewSnapshot'), '已访问页面没有通过 DOM 快照复用');
expect(trips.includes("invalidatePageCache('trips', 'profile', 'history')") && trips.includes("isPageDataFresh('trips')"), '行程写入没有精确失效或复用数据缓存');
expect(profileActions.includes("loadProfile(refreshProfileInDOM, { force: true })"), '旅行档案手动刷新没有绕过缓存');

const adminDetailBlock = adminActions.split("if (action === 'view-user-detail')")[1]?.split("if (action === 'close-doc-edit')")[0] || '';
expect(!adminDetailBlock.includes('renderView()') && adminDetailBlock.includes('renderModals()'), '管理员详情仍通过根视图重绘打开');

console.log('渲染性能回归检查通过：启动、局部更新、页面快照复用与精确缓存失效均已覆盖。');
