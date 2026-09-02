# 渝游智策 Architecture Contract (架构契约)

> **版本**: 1.0.0  
> **制定日期**: 2026-08-16  
> **核心原则**: 单一业务核心、物理与逻辑分层自治、消除双重实现、多端契约共享。

---

## 1. Layer Definition (分层定义)

系统严格划分为以下三层：
*   **Frontend / Browser SPA**: 位于 `app/`，运行于浏览器端的原生 ES 模块单页应用，负责 UI 展现与轻量交互。
*   **Web BFF**: 位于 `server/` (Node.js 监听端口 `3000`)，定位为 Web 专属的业务适配器，主要负责静态文件托管、Web 安全 (CSRF、HttpOnly Cookie) 以及请求透传代理。
*   **Java Core Backend**: 位于 `D:\scenic-guide\ai` (Spring Boot 监听端口 `8080`)，为本系统**唯一**共享业务核心后端，承载全部核心文旅业务逻辑、AI/RAG 算法以及底层数据库持久化。

---

## 2. Business Ownership & Boundaries (业务归属与边界)

### 2.1 Frontend Boundary (前端边界)
*   **允许承担 (UI & Presentation Logic)**:
    *   DOM 树挂载与视图跳转路由管理。
    *   表单输入收集、本地交互状态维护 (如 Modal 弹窗显示、加载状态机、当前选中的 Tab 等)。
    *   高德地图前端 JavaScript SDK 地图底图渲染、Marker 点标记及折线路线 (Polyline) 物理绘制。
*   **禁止承担 (Business Logic)**:
    *   硬编码的景点元数据 (如 `ATTRACTIONS_LIST` 作为 Source of Truth)。
    *   基于地理经纬度的路线偏好计算或直接的测距与排序决策。
    *   重规划去重及景点推荐决策算法。
    *   任何直接的身份验证逻辑与敏感密钥持有。

### 2.2 BFF Boundary (BFF 边界)
*   **允许承担 (Web-specific & Proxy Logic)**:
    *   静态前端网页托管 (HTML, CSS, JS)。
    *   反向代理 Web API 请求至 Java Core Backend。
    *   高德前端 JS API 安全凭证 (Token) 的安全下发。
    *   Web 租户 Cookie 组装及 CSRF 防御机制。
*   **禁止承担 (Core Business Logic)**:
    *   旅游意图解析 (Natural Language Constraint Parsing)。
    *   多天排程、景点推荐与评分规则 (`demoTrip()`)。
    *   局部去重重规划候选计算与策略算法 (`replacementFor()`)。
    *   高德 Web Service POI 算路及路线填充 (`hydrateDayRoutes()`)。
    *   直接请求 DashScope 进行向量化或直接查询 Qdrant 数据库。
    *   行程持久化直接写入本地 JSON 文件 (`data/yuyouzhice.json`)。
    *   独立于 Java Core Backend 的第二套用户认证 (如本地 scrypt 哈希、独立的 JWT 颁发)。

### 2.3 Java Boundary (Java 边界)
*   **核心职责 (Shared Business Logic Owner)**:
    *   **唯一**地标景点元数据库的主管方 (Attraction Domain)。
    *   **唯一**行程排程与智能路线推荐引擎的执行方 (Planner / Replan Domain)。
    *   高德 Web Service 路线、POI 与天气服务的封装方 (Amap Route Service)。
    *   **唯一**的多设备同步行程持久化与版本演进管理方 (Trip & Version Domain)。
    *   **唯一**的身份鉴权、角色权限管理与偏好档案中心 (User, Auth & Preferences Domain)。
    *   DeepSeek 意图槽位解析、阿里云百炼嵌入与 Qdrant 向量检索的唯一接口方 (AI/RAG Domain)。

---

## 3. Infrastructure & Data Ownership (数据与基础设施所有权)

*   **数据库实体**: 所有持久化数据（用户、行程、偏好标签、知识库切片）均由 Java Core Backend 独占。存储介质为 SQLite 数据库 (生产环境可扩展为 PostgreSQL) 和 Redis/Valkey 缓存。
*   **第三方接口调用流向**:
    *   **Qdrant / DashScope / Redis**: Web BFF 禁止持有 Qdrant API 密钥与 DashScope Key，所有向量检索与向量计算请求均必须流经 Java Core Backend。
    *   **高德开放平台**: 实时气象与步行/公交路线规划由 Java Core Backend 在服务端统一请求并打包下发，Web BFF 不得直连高德 Web Service 接口进行路线重组。

---

## 4. Multi-client Strategy (多端共享策略 - Android / Web)

未来接入 Android 客户端时，其物理调用流向如下：

```text
[ Web SPA ]                [ Android App ]
    │                            │
    ▼ (HTTP:3000)                │
[ Web BFF (Node.js) ]            │
    │                            │
    ▼ (HTTP:8080)                ▼ (HTTP:8080)
┌──────────────────────────────────────────────┐
│            Java Core Backend                 │
│  (Planner/Recommendation/Auth/Persistence)   │
└──────────────────────────────────────────────┘
```

*   **API 统一性**: Web BFF 仅作为 Web 端的安全适配层与透传通道，核心业务模型对于 Web BFF 与 Android App 保持 100% 格式对齐，防止出现针对特定平台的特化业务逻辑。
*   **数据一致性**: 取消 Node 本地 JSON 双写，统一由 Java 接口写入 SQLite，彻底杜绝数据版本分叉。

---

## 5. Fallback & Resilience Rules (降级与弹性容错规则)

*   **核心逻辑**: 降级策略必须属于业务所有者。
    *   当大模型 (DeepSeek/DashScope) 或向量库 (Qdrant) 服务暂时不可用时，必须由 **Java Core Backend 内部**触发 Fallback 机制（如降级到本地词频检索或缓存事实），然后将降级事实标记返回给客户端。
    *   **Web BFF 不得作为 Java Core Backend 的镜像**。如果 Java Core Backend 服务整体不可用，Web BFF 应友好返回 `503 Core Backend Unavailable`，绝对禁止在 Web BFF 中运行备用 Planner 逻辑进行数据拼装。

---

## 6. Migration Protocol (迁移执行协议)

为了保证生产环境平滑过渡，核心代码迁移必须严格按照如下节奏执行：
1.  **Java Capability Completion (Java 能力补全)**: 优先在 Java Core Backend 中完整移植 24 景元数据、排程评分、高德路线计算、版本管理等。
2.  **API Verification (API 接口校验)**: 运行 Java 新端点的单元与集成测试，确保结构与业务正确性。
3.  **Shadow Validation (影子模式验证)**: Web BFF 开启影子流量，并发对比 Java Planner 与 Node Planner 的计算耗时与质量指标，数据比对无误后正式上线。
4.  **Web Cutover (切流上线)**: Web BFF 彻底关闭本地业务流程，转为 100% 依赖 Java 接口。
5.  **Node Cleanup (废弃代码清理)**: 彻底下线并删除 BFF 遗留的已迁移算法代码。
