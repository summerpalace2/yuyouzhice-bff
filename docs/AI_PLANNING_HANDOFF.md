# AI Planning 实施与验收总结

> 实施完成日期：2026-08-19
> 项目状态：全部目标功能已实现并通过全量回归验证。

## 1. 本轮完成的核心工程工作

### 1.1 AI 行程助手闭环 (Proposal → Confirm → Commit)
- **Node BFF 路由交付**：
  - `POST /api/chat/proposal`：接收前端对话意图，针对“修改行程”或“记住偏好”调用 Java Shadow（`shadowReplan`、`shadowMutateStops`、`shadowPlan`）生成待确认候选方案，不私自修改原草案或正式行程。
  - `POST /api/chat/proposal/confirm`：用户点击“确认并生成新版本”后，草稿模式更新 transient candidate；已保存正式行程调用 Java `updateTrip`（带 `expectedVersion` 与 `idempotencyKey`），生成不可变新版本并返回；偏好提案由已登录用户确认后委托给 Java Preferences Authority。
- **前端 SPA 适配 (`app/app.js`)**：
  - `sendChatMessage()` 与 `readChatStream()` 传递规划上下文（`plannerSessionId`、`tripId`、`currentVersion`）。
  - 对话流收到 `meta.assistant` 意图后自动拉取提案卡片。
  - 绑定 `confirm-chat-proposal` 和 `dismiss-chat-proposal` 按钮，完成交互闭环。

### 1.2 自然语言规划约束与可满足性
- **Java `TravelConstraintParser` & `TravelConstraints`**：
  - 区分 `ConstraintOrigin`（PROMPT / REQUEST / PREFERENCE / DEFAULT / DERIVED）。
  - 支持 `mustVisit`、`avoid` 负向过滤与否定词识别（如“不喜欢夜景”“不坐地铁”）。
  - 饮食限制优先于普通菜品词（如“素食火锅”解析为素食限制）。
  - 诊断并暴露 `criticalMissingFields` 与 `needsClarification`。
- **Java `ItineraryBuilder`**：
  - 仅在非默认约束时向站点追加 `matchedConstraints`，默认值不再伪装为用户显式匹配。
  - 针对 `mustVisit` 与 `avoid` 进行多维度候选打分排程与过滤。
  - `qualityMetrics` 真实计算 `mustVisit` 和 `avoidance` 的满足性检查。

### 1.3 高德导航 “到这去” 与地图清理
- **官方 AMap 导航唤起**：
  - 在行程卡片、详情页、地图信息弹窗中增加“到这去”入口。
  - 使用高德官方统一 URI API（`https://uri.amap.com/navigation?...&callnative=1`），在移动端/Android 设备优先拉起高德 App 导航，桌面端自动 fallback 至官方路线页。
  - 严格保持前端安全：浏览器端与 URL 中绝不包含 `AMAP_WEB_SERVICE_KEY`。
- **全屏地图与嵌入式地图 Overlays 治理**：
  - `state` 增加 `fullscreenMapOverlays` 与 `fullscreenMapInfoWindow` 追踪。
  - 在日期切换和全屏地图关闭时主动清理旧 Marker 和 Polyline，消除重复图层堆叠与内存泄露。

### 1.4 检索审计与 Android PDF Authority
- **Java 检索与 Qdrant 边界**：
  - 验证 Java-managed Qdrant 语义检索与本地知识回退（`kb_document`）链路，Node BFF 保持薄代理，不直连 Qdrant 或 Embedding 模型。
- **Java PDF 权威生成**：
  - Java `TripPlanPdfService` 经单元测试验证，可输出合规的 A4 结构化 PDF 字节流。
  - Android 客户端可通过统一的 `GET /ai/trips/{tripId}/export` 携带 Java Bearer JWT 直接调用导出。

---

## 2. 自动化测试与全量回归验证结果

### Node / Web BFF 回归测试（100% 通过）
1. `scripts/auth-flow-check.mjs`：登录回跳主链通过。
2. `scripts/phase5a-auth-foundation-check.mjs`：Auth 基础通过。
3. `scripts/phase5b-security-check.mjs`：安全与权限边界通过。
4. `scripts/acceptance-check.mjs`：全中文语义、服务启动、接口目录登记验收通过。
5. `scripts/golden-persona-check.mjs`：Golden Persona 规划与重规划通过。
6. `scripts/constraint-memory-check.mjs`：偏好提案与约束复用验收通过。
7. `scripts/browser-planning-check.mjs`：浏览器 Planning 主链与 Chat Proposal/Confirm 闭环检查通过。
8. `scripts/save-return-check.mjs`：保存与会话恢复契约通过。
9. `scripts/trips-management-check.mjs`：正式行程持久化、PDF 与删除管理通过。
10. `scripts/persistence-check.mjs`：持久化与跨设备边界验证通过。
11. `scripts/profile-feedback-check.mjs`：旅行档案与反馈分析通过。
12. `scripts/explore-history-check.mjs`：Explore 与正式行程历史通过。
13. `scripts/quality-metrics-check.mjs`：Java-owned 质量指标通过。
14. `scripts/feedback-analytics-check.mjs`：反馈聚合通过。
15. `scripts/admin-console-check.mjs`：管理控制台通过。
16. `scripts/cross-device-history-check.mjs`：跨设备历史同步通过。
17. `scripts/map-render-check.mjs`：地图 Marker / Polyline 与无 Key 回退通过。
18. `scripts/phase5-final-cutover-check.mjs`：Phase 5 统一切流验证通过。
19. `scripts/java-shadow-integration-check.mjs`：Java Shadow 候选集成通过。

### Java 核心后端测试（100% 通过）
1. `TravelConstraintParserTest`：来源跟踪、关键字段缺失、否定词识别、长辈非低步行、素食优先级验证通过。
2. `PlannerServiceTest`：持久化与 Shadow 规划、局部重规划、版本 CAS 校验、匿名凭据隔离验证通过。
3. `TripPlanPdfServiceTest`：PDF 导出字节流与中文排版验证通过。
4. `mvnw.cmd test`：全套 Spring Boot 核心测试（包括 Auth, User, Trip, Preferences, RAG, Migration）全部无错误通过。
