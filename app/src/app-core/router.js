/**
 * 唯一页面注册表。
 *
 * 新页面只能在这里登记；App Shell 依据 state.view 取视图。
 * 页面函数只负责生成本页 HTML，不负责导航、请求或全局挂载。
 */
import { homeView } from '../pages/home-page.js';
import { planView } from '../pages/plan-page.js';
import { detailView } from '../pages/detail-page.js';
import { exploreView } from '../pages/explore-page.js';
import { tripsView } from '../pages/trips-page.js';
import { historyView } from '../pages/history-page.js';
import { profileView } from '../pages/profile-page.js';
import { adminView } from '../pages/admin-page.js';
import { guestChatView } from '../pages/guest-chat-page.js';
import { authView } from '../pages/auth-page.js';

export const views = {
  home: homeView,
  planning: planView,
  detail: detailView,
  explore: exploreView,
  trips: tripsView,
  history: historyView,
  profile: profileView,
  admin: adminView,
  'guest-chat': guestChatView,
  auth: authView
};
