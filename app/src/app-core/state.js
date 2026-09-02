/**
 * 全局响应式状态与偏好存储
 */

// 默认 Golden Prompt 契约基准
export const GOLDEN_PROMPT = '周六下午到重庆，周日晚上离开，带父母，希望少走路，预算有限，喜欢城市、人文和夜景。';

/**
 * 偏好选择状态机对象：
 * - 单选类别：duration (游玩天数), companions (同行人员), pace (步行节奏), transport (交通偏好)
 * - 多选类别：dining (餐饮风味 Set), themes (体验主题 Set)
 */
export const preferences = {
  duration: '2天经典',
  companions: '带父母',
  pace: '少走路',
  transport: '',
  dining: new Set(['本地菜优先']),
  themes: new Set(['8D魔幻', '山城夜景', '人文历史'])
};

/**
 * 全局响应式状态存储
 */
export const state = {
  // 未登录首屏是独立游客聊天页；登录成功后再进入完整规划工作区。
  view: 'guest-chat',
  prompt: GOLDEN_PROMPT,
  trip: null,
  sessionId: null,
  detail: null,
  detailContext: null,
  loginOpen: false,
  authMode: 'login', // 'login' | 'register'
  csrfToken: null,
  user: null,
  adminPerspective: false,
  loading: false,
  loadingPhase: '',
  toast: '',
  replan: null,
  reason: '少走路',
  memoryProposal: null,
  memoryCandidate: null,
  savedTrips: null,
  savedTripId: null, // 当前正在编辑的已保存行程 ID（修改后保存覆盖原行程）
  // 当前正式行程的有效偏好快照；与账号级长期记忆分开保存。
  itineraryMemorySnapshot: null,
  health: null,
  adminOverview: null,
  // 管理控制台拥有独立加载态：未获得真实概览前不得渲染 0 值占位数据。
  adminLoading: false,
  adminLoadError: '',
  // Rerank 使用专用管理员接口读取，避免概览聚合数据延迟或口径不清。
  adminRerankStats: null,
  adminSection: 'overview',
  adminDocQuery: '',
  adminDocTopic: '',
  adminDocExpanded: new Set(),
  adminDocs: null,
  adminDigitalHuman: null,
  adminVoices: [],
  adminSettings: null,
  adminUserDetail: null,
  // 账号目录的展开状态属于控制中心本地 UI 状态；根视图重绘时也必须保留。
  adminUsersExpanded: true,
  adminFeedbackDetail: null,
  editingDoc: null,
  selectedMapDay: 0, // 0 = 全景总览, 1 = Day 1, 2 = Day 2...
  mapFullscreen: false, // 是否处于全屏地图模式
  adminDocsFolded: true, // 知识库语料默认折叠展示前6条
  userLocation: null, // 实时个人定位点 { coordinates: [lon, lat], accuracy, nearestStop, distanceText, locatedAt }
  locating: false,
  loginError: '',
  pendingAfterLogin: null,
  pendingFeedback: null,
  constraintEditing: false,
  preferenceProposal: null,
  // 规划前偏好确认期间暂存本次输入；确认后使用同一份条件发起唯一一次规划请求。
  pendingPlanOptions: null,
  deleteConfirm: null,
  userActionConfirm: null,
  adminActionPending: false,
  profile: null,
  feedbackSent: false,
  feedbackOpen: false,
  feedbackReason: '',
  feedbackDraft: '',
  exploreItems: [],
  exploreCategories: ['夜景', '城市', '人文', '美食', '文创', '自然', '休闲'],
  exploreQuery: '',
  exploreCategory: '',
  historySessions: null,
  historySync: null,
  mapConfig: null,
  mapInstance: null,
  fullscreenMapInstance: null,
  mapOverlays: [],
  mapInfoWindow: null,
  fullscreenMapOverlays: [],
  fullscreenMapInfoWindow: null,
  chatSessionId: null,
  chatMessages: [],
  chatInput: '',
  // 用户可见的对话路由：chat 只做问答，planner 负责行程调整与方案预览。
  // 后端聊天请求统一使用 Agentic RAG（由 chat-service 映射为 deep）。
  chatMode: 'chat',
  chatLoading: false,
  chatDockOpen: false,
  plannerProposalDockOpen: false,
  chatRoute: 'idle',
  chatMeta: null,
  chatProposal: null,
  suggestionDismissed: false,
  tripChatHistories: {},
  sessionAccessToken: null,
  legacyMode: false,
  adjustmentCapability: 'V1_PROPOSAL',
  activeDay: 1,
  selectedStopId: null,
  // 站点选择支持多选；selectedStopId 保留为 Planner V1 的单目标兼容字段。
  selectedStopIds: new Set(),
  pinnedStopIds: new Set(),
  activeProposal: null,
  selectedOptionId: 'option-1',
  plannerVersion: '1.0.0-v1',
  policyVersion: '2026.08-v1',
  routeDataStatus: 'ESTIMATED',
  explanationSource: 'TEMPLATE',
  degraded: false,
  degradationReasons: [],
  dynamicRefreshing: false,
  dynamicRefreshSessionId: null
};
