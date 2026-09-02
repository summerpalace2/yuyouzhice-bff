import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (...parts) => readFileSync(path.join(root, ...parts), 'utf8');
const app = read('app', 'app.js');
const router = read('app', 'src', 'app-core', 'router.js');
const bootstrap = read('app', 'src', 'app-core', 'bootstrap.js');
const navigation = read('app', 'src', 'app-core', 'navigation-handler.js');
const profileActions = read('app', 'src', 'features', 'trip-memory', 'profile-action-handler.js');
const chatActions = read('app', 'src', 'features', 'trip-chat', 'chat-action-handler.js');
const docs = read('docs', 'frontend-architecture.md');

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

expect(!app.includes('export const views = {'), '页面注册表仍在 app.js 重复定义');
expect(app.includes("export { views } from './src/app-core/router.js';"), 'app.js 未兼容导出唯一路由表');
for (const view of ['home', 'planning', 'detail', 'explore', 'trips', 'history', 'profile', 'admin', "'guest-chat'", 'auth']) {
  expect(router.includes(`${view}:`) || router.includes(`${view},`), `router.js 缺少页面：${view}`);
}
expect(bootstrap.includes('await restoreAuthSession();') && bootstrap.indexOf('await restoreAuthSession();') < bootstrap.indexOf('render();'), '启动顺序不再保证先恢复会话再首次渲染');
expect(navigation.includes('handleNavigationAction') && navigation.includes("if (action === 'go')"), '导航动作没有移入专用 handler');
expect(app.includes('handleNavigationAction({') && app.includes('if (navigationHandled) return;'), '入口没有将导航动作委派给 handler');
expect(profileActions.includes('handleProfileAction') && profileActions.includes('delete-travel-memory'), '旅行档案动作没有移入专用 handler');
expect(chatActions.includes('handleChatAction') && chatActions.includes('reset-chat'), '聊天动作没有移入专用 handler');
expect(docs.includes('渲染规则') && docs.includes('注释规范'), '缺少前端架构与注释约定文档');

console.log('前端架构检查通过：唯一路由表、启动编排、导航事件边界与工程约定均已建立。');
