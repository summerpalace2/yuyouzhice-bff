# 渝游智策 Java Core 后端架构设计与领域模型规范文档

> **版本**：2.1.0 (生产精简版)  
> **更新日期**：2026-08-27  
> **服务定位**：系统唯一业务核心后端（Single Source of Truth），负责文旅排程、大模型意图分析、RAG 知识检索、用户画像偏好、正式行程生命周期管理及运营监控大盘。已清理已完成历史使命的 Phase 5 一次性离线迁移代码。

---

## 1. 系统总体拓扑与物理分层

渝游智策系统遵循**“多端共享唯一业务核心”**的架构设计原则，物理与逻辑拓扑如下：

```text
┌───────────────────────────┐      ┌───────────────────────────┐
│     Web SPA (浏览器端)    │      │    Android App (移动客户端)│
│       (Vanilla ES)        │      │       (Kotlin / Jetpack)  │
└─────────────┬─────────────┘      └─────────────┬─────────────┘
              │ HTTP:3000                        │ HTTP:8080
              ▼                                  │
┌───────────────────────────┐                    │
│   Web BFF (Node.js/Server)│                    │
│ (静态托管/Cookie/CSRF适配) │                    │
└─────────────┬─────────────┘                    │
              │ HTTP:8080                        │
              ▼                                  │
┌────────────────────────────────────────────────▼─────────────┐
│                    Java Core Backend (Spring Boot)           │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │               API 网关与安全鉴权拦截层                   │  │
│  │          (JwtAuthFilter, UserContext, FilterConfig)    │  │
│  └──────────────────────────┬─────────────────────────────┘  │
│                             │                                │
│  ┌──────────────────────────▼─────────────────────────────┐  │
│  │                     核心业务领域层                      │  │
│  │                                                        │  │
│  │   [Planner]      [Trip]       [Preferences]  [Attraction]│  │
│  │   智能排程引擎    正式行程演进   偏好档案画像   24景元数据库 │  │
│  │                                                        │  │
│  │   [Chat]         [RAG]        [Analytics]    [Admin]     │  │
│  │   SSE流式导游    向量增强检索   运营大盘与心跳  后台系统治理 │  │
│  └──────────────────────────┬─────────────────────────────┘  │
│                             │                                │
│  ┌──────────────────────────▼─────────────────────────────┐  │
│  │                     数据与基础设施层                    │  │
│  │   SQLite (DB)     Redis/Valkey (Cache)   Qdrant (Vector)│  │
│  │   DashScope (LLM) 高德开放平台 (Route/POI) OpenPDF (PDF)  │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

---

## 2. 领域模块划分与核心职责

生产代码划分为 **`common` (通用基础设施)** 与 **10 大核心业务领域 (Domain Modules)**，共 132 个纯净 Java 源文件：

### 2.1 基础设施层 (`com.ai.guide.common`)
- **`common.config`**：全局基础设施配置，包含 SQLite 连接池 (`KnowledgeDbConfig`)、Redis 连接与健康探测 (`RedisConfig`, `RedisHealthCheck`)、线程池 (`ThreadPoolConfig`)、Qdrant 客户端 (`QdrantConfig`)、阿里云 DashScope Embedding (`AlibabaEmbeddingConfig`) 以及 WebMVC 拦截与跨域配置 (`WebMvcConfig`)。
- **`common.context`**：线程级安全上下文 (`UserContext`)，通过 `ThreadLocal` 传递已鉴权用户的 `userId`、`username`、`role` 及匿名标识。
- **`common.model`**：全局通用响应封装对象 (`Result<T>`)。
- **`common.security`**：JWT 令牌解析与签发 (`JwtUtil`)、请求安全拦截器 (`JwtAuthFilter`) 以及分布式登出黑名单与作废管理 (`JwtRevocationService`)。

### 2.2 核心业务领域层 (`com.ai.guide.domain.*`)

#### ① 智能排程与规划引擎域 (`domain.planner`)
- **定位**：系统最核心的文旅排程计算中枢。
- **核心组件**：
  - `PlannerController`：提供多天规划创建、草稿读取、局部重规划、站点增删改、对话调整意图识别、方案预览与确认应用。
  - `RouteAwarePlanner`：路线感知启发式规划器，结合景点开放时间、游览时长、交通耗时与地理聚类进行多天排程打分。
  - `PlanVerifier`：规划约束核验器，校验雨天室内外冲突、游玩超时、开闭园时间冲突。
  - `LocalPlanRepairer`：局部智能修复器，在发生冲突时执行最小代价的替换与排程修复。
  - `PlanAdjustmentService`：多轮对话式调整编排服务，负责预览生成、方案对比与原子确认。
  - `AmapRouteService` / `AmapPlannerGateway`：高德路线规划（驾车/公交/步行）计算与两级缓存。
  - `PlannerSessionRepository`：规划会话与草稿状态在内存及本地的高速存储。

#### ② 正式行程与版本演进域 (`domain.trip`)
- **定位**：用户已确认保存的正式行程（Trip 聚合根）生命周期管理。
- **核心组件**：
  - `TripController`：行程列表、保存、读取、更新、删除、版本历史查询与 PDF 导出。
  - `TripService`：正式行程业务服务，支持客户端幂等提交 (`x-idempotency-key`) 与版本隔离。
  - `TripReplanEngine`：正式行程服务端智能重排策略引擎。
  - `TripPlanPdfService`：高保真 PDF 电子行程单生成服务（基于 OpenPDF 渲染图文排版）。
  - `TripRepository`：`trip`、`trip_version` 及 `trip_idempotency` 表持久化仓储。

#### ③ 用户认证与账户域 (`domain.user`)
- **定位**：系统唯一用户与身份权威中心。
- **核心组件**：
  - `AuthController`：用户注册 (`/ai/auth/register`)、登录 (`/ai/auth/login`)、登出 (`/ai/auth/logout`)。
  - `UserProfileController`：当前登录用户信息与权限查询 (`/ai/auth/me`)。
  - `UserService`：用户持久化、BCrypt 密码哈希、账户状态与角色管理。
  - `LegacyNodeScryptVerifier`：老版 Node.js Scrypt 密码兼容校验与自动平滑升级器。

#### ④ 用户偏好与个性化画像域 (`domain.preferences`)
- **定位**：用户个性化旅游偏好的唯一权威数据源 (Source of Truth)。
- **核心组件**：
  - `PreferencesController`：偏好档案的强类型读取 (`GET`)、增量合并 (`POST/PATCH`)、全量覆盖 (`PUT`) 与清空 (`DELETE`)。
  - `PreferencesService`：偏好版本控制 (Revision-based OCC 乐观并发控制)、字段冲突裁决与校验。
  - `PreferencesRepository` / `PreferenceAuditRepository`：偏好数据与版本变更审计日志仓储。

#### ⑤ 24 景文旅地标与百科域 (`domain.attraction`)
- **定位**：重庆 24 大核心文旅地标元数据的权威所有方。
- **核心组件**：
  - `AttractionController`：景点列表检索、区县/分类筛选与单景点详情获取。
  - `AttractionService`：内存加载并索引 24 大地标的经纬度、建议时长、门票、开放时间等元数据。
  - `AttractionMediaService`：为景点注入高清配图、VR/导览多媒体资源。

#### ⑥ AI 导游流式交互域 (`domain.chat`)
- **定位**：基于大模型的智能导游多轮流式会话中枢。
- **核心组件**：
  - `ChatController`：基于 Spring AI + Reactor Flux 提供 `/ai/chat/stream` SSE 流式事件推送。
  - `IntentService`：自然语言意图分类器（问答、行程修改、偏好记录、抱怨/夸赞）。
  - `SlotTrackingService`：多轮对话槽位提取与个性化信息沉淀。
  - `RedisChatMemory`：会话多轮历史缓存记忆管理。
  - `ChatDomainPolicy`：导游对话安全与提示词保护策略。

#### ⑦ 文旅知识与检索增强域 (`domain.rag`)
- **定位**：文旅垂直知识库切片、Qdrant 向量检索与多级缓存 Rerank 重排。
- **核心组件**：
  - `RagController`：RAG 检索接口 (`/ai/rag/retrieve`)、状态指标与碎片管理。
  - `KnowledgeController`：知识文档的后台管理（CRUD、分类统计与同步向量化）。
  - `RagRetrievalService`：知识语义召回与事实核验编排服务。
  - `RerankService`：阿里百炼重排服务（内建 L1 精确 / L2 归一化 / L3 SimHash 三级缓存）。
  - `pipeline.*`：Production V2 数据清洗、文档切片 (`ChunkService`) 与 Qdrant 导入器 (`QdrantImporter`)。

#### ⑧ 运营监控与在线看板域 (`domain.analytics`)
- **定位**：为前端/管理端提供服务人数看板、在线心跳维护、游客情绪趋势与日报导出。
- **核心组件**：
  - `AnalyticsController`：综合服务大盘 (`/dashboard`)、热点问题排行 (`/hot-questions`)、情绪趋势 (`/sentiment-trend`) 及日报导出。
  - `OnlinePresenceController`：客户端在线心跳接收 (`/online/heartbeat`) 与管理员在线用户列表 (`/admin/online-users`)。
  - `OnlinePresenceService`：基于 Redis ZSet 滑动时间窗口算法的精确在线人数与存活会话管理。
  - `AnalyticsService`：服务交互日志记录 (`service_log`)、指标聚合与日报定时巡检。
  - `EmotionAnalysisService`：大模型异步满意度情绪分析与规则降级。
  - `PdfExportService`：运营日报 OpenPDF 生成导出。

#### ⑨ 管理后台治理域 (`domain.admin`)
- **定位**：系统管理后台全局治理与初始化。
- **核心组件**：
  - `AdminController`：用户列表查看、角色提权/降权、账号封禁与管理端统计。
  - `AdminInitConfig`：系统启动时管理员账号的安全 Bootstrap 初始化。

#### ⑩ 语音交互域 (`domain.voice`)
- **定位**：百度短语音识别 ASR 与语音合成 TTS 适配器。
- **核心组件**：`AsrController`、`TtsController`。

---

## 3. 核心 API 清单与职责对照表

| 领域 | HTTP | 接口路径 | 权限要求 | 核心功能说明 |
| :--- | :--- | :--- | :--- | :--- |
| **Planner** | `POST` | `/ai/planner/v1/plan` | 公开/可选 Token | 依据用户意图生成 1~N 天智能排程方案草稿 |
| | `GET` | `/ai/planner/v1/sessions/{id}` | 会话拥有者 | 读取规划会话上下文与草稿行程 |
| | `POST` | `/ai/planner/v1/sessions/{id}/replan` | 会话拥有者 | 针对特定站点的局部智能重排与替换 |
| | `POST` | `/ai/planner/v1/sessions/{id}/stops` | 会话拥有者 | 站点的增加、删除、顺序重调 |
| | `POST` | `/ai/planner/v1/sessions/{id}/conversation`| 会话拥有者 | 对话式调整意图与槽位解析 |
| | `POST` | `/ai/planner/v1/sessions/{id}/adjust/preview`| 会话拥有者 | 生成调整方案多候选预览与路线比对 |
| | `POST` | `/ai/planner/v1/sessions/{id}/adjust/apply`| 会话拥有者 | 确认并原子应用选定的调整方案 |
| | `POST` | `/ai/planner/v1/sessions/{id}/save` | 已登录用户 | 将草稿转正持久化为正式行程 |
| **Trip** | `GET` | `/ai/trips` | 已登录用户 | 查询用户保存的全部正式行程列表 |
| | `POST` | `/ai/trips` | 已登录用户 | 保存正式行程（支持幂等键） |
| | `GET` | `/ai/trips/{tripId}` | 行程拥有者 | 读取正式行程最新版本快照 |
| | `PUT` | `/ai/trips/{tripId}` | 行程拥有者 | 修改行程并递增版本号 |
| | `DELETE`| `/ai/trips/{tripId}` | 行程拥有者 | 删除正式行程 |
| | `GET` | `/ai/trips/{tripId}/versions` | 行程拥有者 | 获取行程历史演进版本列表 |
| | `GET` | `/ai/trips/{tripId}/export` | 行程拥有者 | 导出行程单高清 PDF |
| **User** | `POST` | `/ai/auth/register` | 公开 | 用户注册 |
| | `POST` | `/ai/auth/login` | 公开 | 用户登录并颁发 JWT |
| | `POST` | `/ai/auth/logout` | 已登录用户 | 注销登录并作废 Token |
| | `GET` | `/ai/auth/me` | 已登录用户 | 获取当前登录用户画像与角色 |
| **Preferences** | `GET` | `/ai/preferences` | 已登录用户 | 查询强类型偏好配置 |
| | `POST` | `/ai/preferences` | 已登录用户 | 增量合并偏好（OCC 乐观并发控制） |
| | `PUT` | `/ai/preferences` | 已登录用户 | 全量替换偏好配置 |
| | `DELETE`| `/ai/preferences` | 已登录用户 | 重置/清空偏好配置 |
| **Attraction** | `GET` | `/ai/attractions` | 公开 | 24景元数据列表（支持分类与区县筛选） |
| | `GET` | `/ai/attractions/{id}` | 公开 | 景点详情与富媒体百科 |
| **Chat** | `GET` | `/ai/chat/stream` | 公开/可选 Token | SSE 流式 AI 导游对话与检索增强 |
| **RAG** | `POST` | `/ai/rag/retrieve` | 公开/可选 Token | 语义检索真实文旅知识切片与引文 |
| | `GET` | `/ai/rag/stats` | 公开 | 向量库与重排缓存健康指标 |
| | `GET` | `/ai/knowledge` | 管理员 | 知识库文档列表分页查询 |
| | `PUT` | `/ai/rag/knowledge/{id}` | 管理员 | 更新指定知识文档 |
| **Analytics** | `POST` | `/ai/online/heartbeat` | 已登录用户 | 发送心跳维持在线活跃状态 |
| | `GET` | `/ai/admin/online-users` | 管理员 | 查询当前系统实时在线人数与会话 |
| | `GET` | `/ai/analytics/dashboard` | 公开/管理员 | 获取综合服务指标大盘数据 |
| | `GET` | `/ai/analytics/sentiment-trend`| 公开/管理员 | 获取游客满意度与情感趋势时序 |
| | `GET` | `/ai/analytics/export/today` | 公开/管理员 | 导出运营日报 PDF 报表 |
| **Admin** | `GET` | `/ai/admin/users` | 管理员 | 分页查询系统注册用户 |
| | `PUT` | `/ai/admin/users/{userId}/role`| 管理员 | 修改用户角色与状态 |
| | `DELETE`| `/ai/admin/users/{userId}` | 管理员 | 禁用指定用户 |
