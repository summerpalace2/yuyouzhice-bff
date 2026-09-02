import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const app = readFileSync(path.join(root, 'app', 'app.js'), 'utf8');
const state = readFileSync(path.join(root, 'app', 'src', 'app-core', 'state.js'), 'utf8');
const chatActions = readFileSync(path.join(root, 'app', 'src', 'features', 'trip-chat', 'chat-action-handler.js'), 'utf8');

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

expect(app.includes('async function requestPlan(opts = {})'), '缺少规划前偏好确认入口');
expect(app.includes("const profile = state.profile || await request('/api/profile');"), '规划前没有读取用户旅行档案');
expect(app.includes('state.pendingPlanOptions = opts') && state.includes('pendingPlanOptions'), '未保存确认前的本次行程条件');
expect(app.includes("if (action === 'plan') await requestPlan();"), '首页规划仍绕过偏好确认');
expect(app.includes('await requestPlan({') && app.includes('constraints: constraintValues(event.target)'), '条件表单仍绕过偏好确认');
expect(chatActions.includes('planFromCurrent') && app.includes('planFromCurrent: requestPlan'), '聊天重新规划仍绕过偏好确认');
expect(app.includes("preferenceDecision: 'use'") && app.includes("preferenceDecision: 'ignore'"), '确认选择没有传递明确偏好决策');
expect(!app.includes('usePreferences: opts.usePreferences ?? Boolean(state.user)'), '登录态仍被默认当作沿用偏好');

console.log('规划偏好前置确认检查通过：检测档案 → 暂存本次条件 → 用户选择 → 单次请求规划。');
