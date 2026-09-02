# 渝游智策（Yuyouzhice）前端架构重构与工程化规范

> **文档版本**：v1.0.0 (生产级演进版)  
> **制定日期**：2026-08-29  
> **执行目标**：将当前 P0 原型阶段的单文件巨石架构（`app.js` 4,085 行 + `styles.css` 2,398 行）系统化重构为现代模块化、类型安全、响应式组件化的高性能前端体系。  
> **前置契约**：必须严格遵循 [`docs/architecture/ARCHITECTURE_CONTRACT.md`](./ARCHITECTURE_CONTRACT.md) 中关于前端边界的规定（禁止前端硬编码业务逻辑、景点元数据或进行直接算路决策）。

---

## 目录
1. [重构目标与范围](#1-重构目标与范围)
2. [技术选型与工程化底座](#2-技术选型与工程化底座)
3. [分层架构规范 (Feature-Sliced Design - FSD)](#3-分层架构规范-feature-sliced-design---fsd)
4. [核心领域数据模型与 TypeScript 契约](#4-核心领域数据模型与-typescript-契约)
5. [关键技术模块重构实施细则](#5-关键技术模块重构实施细则)
   - 5.1 网络与 BFF 安全通信层
   - 5.2 高德地图声明式组件与生命周期管理
   - 5.3 AI 流式对话（SSE）与智能提案状态机
   - 5.4 偏好选择与规划阶段状态机
   - 5.5 样式系统与 Design Tokens 迁移
6. [分阶段实施路线图与任务清单](#6-分阶段实施路线图与任务清单)
7. [质量门禁与回归验收标准](#7-质量门禁与回归验收标准)

---

## 1. 重构目标与范围

### 1.1 核心痛点消除目标
*   **消除巨石单文件**：拆解 4,085 行的 `app.js` 与 2,398 行的 `styles.css`，建立高内聚、低耦合的模块目录。
*   **淘汰字符串模板与 `innerHTML` 重绘机制**：引入现代声明式组件范式，杜绝因全量 DOM 销毁带来的“输入框失焦/光标跳动”、“地图容器解绑白屏”等问题，彻底废除手动记录光标恢复与定时器防抖 hack。
*   **消除全局单一可变状态**：将当前包含 50+ 字段的单一 `state` 对象解耦，严格分离 **服务端缓存状态（Server State）** 与 **客户端 UI 状态（Client State）**。
*   **全面引入类型安全（TypeScript）**：实现与后端 Java DTO（`TripPlan`, `Stop`, `DayRoute`, `ChatProposal`, `Preferences`）100% 对齐的强类型契约。

### 1.2 业务功能全量保真范围
重构必须 100% 覆盖现有全部业务场景：
1.  **首页与偏好选择**：自然语言旅行需求输入、预设偏好芯片（天数/同行/节奏/交通/餐饮/主题）联动。
2.  **智能行程规划与看板**：多阶段加载动画（理解→检索→组装→生成）、分天行程展示、站点卡片、事实依据（Citations）与质量指标覆盖率展示。
3.  **高德地图多维联动**：分天图层 Polyline 轨迹、动态专属色彩、交互式 InfoWindow、全屏沉浸式地图模式、个人实时 GPS 定位与就近站点测距。
4.  **站点微调与去重替换**：单点替换弹窗、站点移除、前后路线耗时动态重算。
5.  **AI 对话助手（深度推理与流式响应）**：SSE 流式渲染（增量 Markdown 解析）、AI 改期/换站提案生成与一键采纳确认。
6.  **景点探索与详情**：多分类景点检索、景点高清全景插画、动态选择天数加入行程。
7.  **用户中心与偏好档案**：多设备会话历史恢复、行程云端保存/覆盖更新、偏好记忆与自动召回、PDF 导出。
8.  **管理员控制台**：系统健康指标探针、92 篇知识库语料搜索/折叠展开/在线实时编辑。

---

## 2. 技术选型与工程化底座

| 领域 | 选型 | 选用理由 |
| :--- | :--- | :--- |
| **构建工具** | **Vite 6+** | 极速冷启动、原生 ESM 开发体验、基于 Rollup 的高效生产打包与代码分割。 |
| **编程语言** | **TypeScript 5.5+** | 严格类型检查（`strict: true`），消除运行期属性访问未定义异常，与后端 DTO 强契约绑定。 |
| **UI 框架** | **Vue 3 (SFC) / React 19 (TSX)** | 成熟的响应式组件体系，完备的生命周期钩子（完美管理地图 SDK 挂载），细粒度 DOM 更新。 |
| **路由管理** | **Vue Router 4 / TanStack Router** | 支持 HTML5 History 模式、路由守卫、参数与 URL 状态双向同步。 |
| **状态管理** | **Zustand / Pinia + TanStack Query** | 分离客户端瞬时状态（Modals、Tab、输入缓存）与服务端异步数据缓存（行程、景点、语料）。 |
| **样式体系** | **Tailwind CSS + CSS Modules + PostCSS** | 原子化样式与 Design Tokens 相结合，彻底消除 2400 行全局 CSS 命名冲突与冗余代码。 |
| **测试套件** | **Vitest + Playwright** | Vitest 执行毫秒级状态与算法单测；Playwright 执行浏览器端端到端业务主链自动化回归。 |

---

## 3. 分层架构规范 (Feature-Sliced Design - FSD)

项目按照 **Feature-Sliced Design (FSD)** 规范组织代码，自顶向下分为 6 层，严格遵循 **单向依赖原则**（上层可依赖下层，下层严禁依赖上层，同层不得直接跨切片引用）：

```
frontend/
├── src/
│   ├── app/                      # [Layer 1] 应用全局配置与初始化
│   │   ├── providers/            # 全局 Provider (QueryClient, Auth, Theme)
│   │   ├── router/               # 路由表定义与导航守卫
│   │   ├── styles/               # 全局 Design Tokens 与 Tailwind 入口
│   │   ├── App.vue (App.tsx)     # 根组件与主挂载骨架
│   │   └── main.ts               # SPA 入口文件
│   │
│   ├── pages/                    # [Layer 2] 页面路由装配层（纯容器，无复杂业务）
│   │   ├── home/                 # 首页
│   │   ├── planning/             # 行程规划与地图看板页
│   │   ├── explore/              # 景点探索列表页
│   │   ├── detail/               # 景点详情页
│   │   ├── trips/                # 我的已保存行程页
│   │   ├── history/              # 跨设备会话历史页
│   │   ├── profile/              # 个人偏好中心页
│   │   └── admin/                # 知识库与系统管理后台
│   │
│   ├── widgets/                  # [Layer 3] 跨 Feature 的复合大区块 UI
│   │   ├── header/               # 全局导航栏、用户身份徽章与登录入口
│   │   ├── trip-map-viewer/      # 核心高德地图分天轨迹展示与全屏容器
│   │   ├── chat-panel/           # AI 智能助理侧边/悬浮面板
│   │   ├── admin-doc-table/      # 知识库语料检索、折叠与编辑复合表格
│   │   └── toast-container/      # 全局通知提示容器
│   │
│   ├── features/                 # [Layer 4] 具体用户交互行为与业务能力
│   │   ├── trip-planning/        # 偏好选择、Prompt 组装与规划请求
│   │   ├── trip-replan/          # 站点重规划、单点替换弹窗逻辑
│   │   ├── trip-chat/            # SSE 流式解析、提案生成与确认采纳
│   │   ├── trip-save/            # 行程云端保存、版本覆盖与 PDF 导出
│   │   ├── auth/                 # 用户登录、注册、注销、密码强度校验
│   │   ├── explore-search/       # 景点分类过滤、实时搜索、动态加入天数
│   │   └── admin-corpus-edit/    # 知识库语料实时编辑与健康探针轮询
│   │
│   ├── entities/                 # [Layer 5] 业务核心领域实体模型与展示卡片
│   │   ├── trip/                 # TripPlan 模型、StopCard、DayCard
│   │   ├── attraction/           # Attraction 详情模型、ExploreCard
│   │   ├── user/                 # User 模型、Preferences 偏好设置
│   │   └── corpus-doc/           # 知识库语料模型
│   │
│   └── shared/                   # [Layer 6] 底层共享基础设施（纯通用，无业务逻辑）
│       ├── api/                  # 统一 Fetch/SSE 封装、CSRF/Device-ID 拦截器
│       ├── ui/                   # 基础 UI Kit (Button, Modal, Input, Badge, Loader)
│       ├── lib/                  # 高德 SDK Loader、Markdown 流式解析器、Geo 测距工具
│       └── types/                # 全局通用 TypeScript 类型定义
```

---

## 4. 核心领域数据模型与 TypeScript 契约

必须在 `src/shared/types/` 和各 `entities/` 中严格定义数据契约，确保与 Java Core 后端对齐：

```typescript
// src/entities/trip/model/types.ts

export type RoutePreference = 'walking' | 'transit' | 'driving';

export interface GeoCoordinate {
  longitude: number;
  latitude: number;
}

export interface Citation {
  title: string;
  endpoint: string;
  note?: string;
  confidence?: number;
}

export interface MapContext {
  coordinates: [number, number]; // [经度, 纬度]
  address: string;
  district: string;
  recommendedTransport: string;
}

export interface Stop {
  id: string;
  venueId: string;
  name: string;
  durationMinutes: number;
  arrivalTime: string;
  departureTime: string;
  routePreference: RoutePreference;
  recommendationReason: string;
  mapContext: MapContext;
  citations: Citation[];
  image?: string;
  imageStatus?: 'READY' | 'DEGRADED' | 'FALLBACK';
}

export interface DayRoute {
  day: number;
  date: string;
  weatherSummary?: string;
  theme?: string;
  totalDistanceMeters: number;
  totalDurationMinutes: number;
  stops: Stop[];
  polyline?: Array<[number, number]>;
}

export interface TripPlan {
  id?: string;
  sessionId: string;
  version: number;
  prompt: string;
  constraints: {
    duration: string;
    companions: string;
    pace: string;
    stayArea: string;
    transportPreference: string;
    dietPreference: string;
    themes: string[];
  };
  planContext?: {
    startingArea: string;
    routePreference: string;
    foodGuidance?: string;
  };
  sourceStatus: {
    citationCoverage: number;
    mode: 'VECTOR_HYBRID' | 'FALLBACK_LOCAL';
  };
  qualityMetrics: {
    constraintSatisfaction: number;
    dataCoverage: { overall: number };
  };
  days: DayRoute[];
}
```

```typescript
// src/entities/user/model/types.ts

export interface UserPreferences {
  duration: string;
  companions: string;
  pace: string;
  transport: string;
  dining: string[];
  themes: string[];
}

export interface UserProfile {
  id: string;
  username: string;
  role: 'user' | 'admin';
  deviceCount?: number;
  preferences: UserPreferences;
  createdAt: string;
}
```

```typescript
// src/features/trip-chat/model/types.ts

export interface ChatProposal {
  proposalId: string;
  type: 'REPLACE_STOP' | 'ADJUST_TIME' | 'CHANGE_ROUTE';
  description: string;
  candidate?: {
    venueId: string;
    name: string;
    targetDay: number;
    targetStopId: string;
  };
  requiresConfirmation: boolean;
}

export interface ChatMessage {
  id: string;
  sender: 'user' | 'assistant' | 'system';
  content: string;
  meta?: {
    model?: string;
    reasoningDurationMs?: number;
    citations?: Citation[];
  };
  proposal?: ChatProposal;
  timestamp: number;
}
```

---

## 5. 关键技术模块重构实施细则

### 5.1 网络与 BFF 安全通信层 (`src/shared/api`)
1.  **安全基准**：
    *   浏览器不持有、不解析 Java JWT，所有认证由 Node BFF HttpOnly Cookie 维护。
    *   每次请求必须通过拦截器自动附加 `x-yuyouzhice-device: deviceId()` 客户端设备指纹。
    *   针对 `POST / PUT / PATCH / DELETE` 等写操作，必须从服务端获取并自动携带 `x-yuyouzhice-csrf` Token。
2.  **实现规范**：
    *   统一封装 `apiClient` 实例，提供统一的 HTTP 拦截器、网络异常格式化与友好错误码转换机制。

### 5.2 高德地图声明式组件与生命周期管理 (`src/widgets/trip-map-viewer`)
1.  **淘汰定时器防抖与直接 DOM 操作**：
    *   封装 `<TripMapView :trip="trip" :activeDay="activeDay" />`。
    *   利用框架的 `onMounted` 钩子加载 `loadAmapSdk()` 并初始化 Map 实例，利用 `onUnmounted` 严格调用 `mapInstance.destroy()` 释放显存与事件监听，彻底杜绝内存泄漏。
2.  **响应式绘制（Watch / Effect）**：
    *   当 `trip` 或 `activeDay` 变化时，调用内部绘制函数清除旧 Overlay 并批量添加新 Marker / Polyline，通过 `mapInstance.setFitView()` 自动计算视野缩放，不再触碰外层 DOM 节点。

### 5.3 AI 流式对话（SSE）与智能提案状态机 (`src/features/trip-chat`)
1.  **流式解析封装**：
    *   封装 `useChatStream()` 组合式 Hook，使用 `fetch()` + `ReadableStream` 读取 `/api/chat/stream`。
    *   标准事件调度器：
        *   `event: meta`：更新推理耗时、检索模式与模型状态；
        *   `event: text`：增量拼接正文文本，通过 Markdown 解析器进行流式高亮渲染；
        *   `event: proposal`：挂载需要用户确认的改期/换站提案卡片；
        *   `event: done`：结束加载状态机。
2.  **提案确认闭环**：
    *   用户点击“采纳方案”触发 `/api/chat/proposal/confirm`，成功后无缝将最新 `TripPlan` 注入全局状态，使规划看板和地图同步更新。

### 5.4 偏好选择与规划阶段状态机 (`src/features/trip-planning`)
1.  **阶段加载器规范**：
    *   定义 4 步加载状态机：`'UNDERSTANDING'` (理解旅行条件) → `'RETRIEVING'` (检索可信信息) → `'COMPOSING'` (组合路线) → `'GENERATING'` (生成方案)。
    *   在规划触发时以进度条和友好文案展示当前进度，不再使用阻塞式的全局全屏透明遮罩。
2.  **约束编辑与响应式同步**：
    *   将预设芯片（`preferences`）与自由输入框（`prompt`）通过双向数据绑定双向联动，修改任意选项即时生成符合自然语言意图的 Prompt 基准。

### 5.5 样式系统与 Design Tokens 迁移 (`src/app/styles`)
1.  **提取 Design Tokens**：
    *   提取原 `styles.css` 中的色板体系：
        *   主背景色：`#f7f3ec` (山城米白)
        *   主品牌色：`#b84a2f` (重庆椒红 / 暖砖红)
        *   辅助色：`#1e3a5f` (长江黛蓝)、`#2c6e49` (林泉翡翠)、`#d97706` (晨光落日金)
        *   中性色阶：`#1f2937` (主文字)、`#6b7280` (次要说明)、`#e5e7eb` (边框分隔线)
2.  **采用 Scoped CSS / Tailwind 改造**：
    *   各组件只保留属于自身的局部作用域样式，全局仅保留基础字体、Reset 与颜色变量。

---

## 6. 分阶段实施路线图与任务清单

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       前端重构五阶段路线图 (Phase 1 ~ Phase 5)                │
├─────────────────────────────────────────────────────────────────────────────┤
│ Phase 1: 现代化工程脚手架与类型契约建立                                        │
│ Phase 2: 共享基础设施与通用 UI 组件库实现                                      │
│ Phase 3: 核心实体模型与业务 Feature 组件化重构                                 │
│ Phase 4: 复合 Widget 封装与多页面路由集成                                      │
│ Phase 5: 全链路自动化回归、BFF 托管切换与生产验证                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Phase 1: 现代化工程脚手架与类型契约建立
- [ ] 初始化 Vite + TypeScript 项目骨架（放置于 `frontend/` 或通过工作区组织）。
- [ ] 配置 `tsconfig.json`（开启 `strict: true`、路径别名 `@/` 映射至 `src/`）。
- [ ] 配置 Tailwind CSS 与 PostCSS，迁移全局颜色与排版 Design Tokens。
- [ ] 编写 `src/shared/types/` 下全部领域类型定义文件，与后端契约保持对齐。
- [ ] 封装 `src/shared/api/client.ts`，完成 Device-ID 与 CSRF 自动化拦截。

### Phase 2: 共享基础设施与通用 UI 组件库实现
- [ ] 实现基础原子组件：`Button`, `Input`, `Modal`, `Toast`, `Badge`, `Card`, `Select`, `Dropdown`。
- [ ] 实现 `src/shared/lib/amap.ts` 高德 JS API 2.0 异步加载与安全凭证管理封装。
- [ ] 实现 `src/shared/lib/markdown.ts` Markdown 解析器与 HTML 净化（XSS 防御）。
- [ ] 实现 `src/shared/lib/geo.ts` 经纬度距离计算与可读格式化函数。

### Phase 3: 核心实体模型与业务 Feature 组件化重构
- [ ] **`entities/trip`**：实现 `StopCard`, `DayCard`, `WeatherBadge`, `QualityScore`。
- [ ] **`entities/attraction`**：实现 `ExploreCard`, `DetailHeader`。
- [ ] **`features/trip-planning`**：实现 `PreferenceChips`, `PromptInput`, `PlanningStageLoader`。
- [ ] **`features/trip-replan`**：实现 `ReplanModal`，支持 5 大理由筛选与最优去重替换。
- [ ] **`features/trip-chat`**：实现 `ChatStreamPanel`, `ProposalCard`, `SuggestionCallouts`。
- [ ] **`features/auth`**：实现 `AuthModal`（登录、注册、管理员快速切入）。
- [ ] **`features/admin-corpus`**：实现知识库检索输入框、语料卡片、在线编辑表单与指标轮询。

### Phase 4: 复合 Widget 封装与多页面路由集成
- [ ] **`widgets/trip-map-viewer`**：封装多天分色路线 Polyline、Marker、InfoWindow 联动与全屏模式。
- [ ] **`widgets/header`**：封装顶部导航栏、登录状态与路由跳转。
- [ ] **配置页面路由 (`src/pages/`)**：
  - [ ] `HomePage`（偏好输入 + 热门推荐）
  - [ ] `PlanningPage`（规划结果看板 + 地图联动 + 站点替换）
  - [ ] `ExplorePage`（24 大景点检索 + 加入行程）
  - [ ] `DetailPage`（单景点详情）
  - [ ] `TripsPage`（已保存行程管理 + PDF 导出）
  - [ ] `HistoryPage`（跨设备会话历史）
  - [ ] `ProfilePage`（个人档案与偏好标签设置）
  - [ ] `AdminPage`（管理员知识库与系统健康监控）

### Phase 5: 全链路自动化回归、BFF 托管切换与生产验证
- [ ] 配置 Vite 生产构建输出至 `server/` 或独立的 `dist/` 静态目录。
- [ ] 调整 `server/index.mjs` 中的静态资源中间件，支持现代化 SPA 的 HTML5 History 路由回退（Fallback to `index.html`）。
- [ ] 运行全套验收与质量检查脚本：
  - [ ] `npm run test:config-contract`
  - [ ] `npm run test:auth`
  - [ ] `npm run test:phase5a-auth`
  - [ ] `npm run test:phase5b`
  - [ ] `npm run test:browser`
  - [ ] `npm run test:save-return`
  - [ ] `npm run test:trips-management`
  - [ ] `npm run test:acceptance`
- [ ] 执行端到端浏览器录屏与回归审计，确认无任何控制台报错、无样式破损。

---

## 7. 质量门禁与回归验收标准

重构完成后必须满足以下硬性指标方可验收合并：

1.  **零契约违规**：
    *   前端代码内严禁出现 `ATTRACTIONS_LIST`、`getReplanCandidate`、`candidateVenueId`、`Qdrant`、`DashScope` 等被禁止的共享业务或后端直连标记（必须通过 `scripts/browser-planning-check.mjs` 中的禁止标记静态扫描）。
2.  **零 DOM 破坏性更新**：
    *   任何用户输入过程中光标位置与焦点 100% 保持稳定，杜绝任何手动 restore selection 逻辑。
    *   高德地图在视图切换、行程微调或全屏展开时平滑过渡，无任何白屏、闪烁或容器解绑异常。
3.  **类型健全率**：
    *   TypeScript 编译无任何 `error`，禁止在业务核心数据结构中使用 `any` 进行类型逃避。
4.  **全量测试通过**：
    *   `package.json` 中的所有 20+ 项测试脚本必须全部呈现绿色通过状态（`100% PASS`）。
