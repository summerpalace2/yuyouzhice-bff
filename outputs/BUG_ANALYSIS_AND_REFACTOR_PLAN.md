# 渝游智策（Yuyouzhice）全链路 Bug 深度排查分析与系统加固报告

> **项目名称**：渝游智策｜重庆旅行决策助手（前端 SPA & Node BFF）+ Scenic-Guide（Java Spring AI 后端）  
> **文档版本**：v2.0.0 (全量加固与生产级交付版)  
> **评估日期**：2026-08-15  

---

## 一、 系统架构与数据流全景图

系统采用**“前端微渲染 SPA + 弹性高可用 Node BFF + 云端高德/Qdrant + 企业级 Java Spring AI 微服务”**的四层解耦架构：

```
[ 用户端浏览器 (Native ES Modules SPA) ]
   │
   ├─► [ 1. Node BFF 服务层 (server/index.mjs:3000) ]
   │      │
   │      ├─► [ 高德开放平台 Web REST API (restapi.amap.com) ]
   │      │      ├─ /v5/direction/walking (真实步行算路与 Polyline)
   │      │      ├─ /v5/direction/transit/integrated (公交/轻轨换乘)
   │      │      ├─ /v5/place/text & /v5/place/detail (真实经纬度与营业状态)
   │      │      └─ /v3/weather/weatherInfo (重庆实时天气)
   │      │
   │      ├─► [ 阿里云百炼 DashScope + 云端 Qdrant 向量数据库 ]
   │      │      ├─ text-embedding-v2 (1536 维语义向量化)
   │      │      └─ yuyouzhice_knowledge_v1 (92 篇标准语料余弦检索)
   │      │
   │      ├─► [ 本地约束打分引擎与 24 大精选景区知识库 ]
   │      └─► [ 原子持久化存储 (data/yuyouzhice.json) ]
   │
   └─► [ 2. Java Spring AI 深度推理微服务 (ai:8080) ] (可选接入)
          ├─ DeepSeek-V4-Flash ChatClient 多轮复杂意图推理
          ├─ Lettuce Redis 分布式会话与 Token 撤销同步
          ├─ 百度语音 (ASR 识别 / TTS 播报)
          └─ OpenPDF 中文字体嵌入与报表生成
```

---

## 二、 全局核心 Bug 深度排查与根因剖析

经过对代码库的逐行审计与运行期状态探测，梳理出如下 11 项核心缺陷：

### 1. 景点替换与重规划出现相同/重复景区
*   **缺陷现象**：在对某个站点（如洪崖洞或三峡博物馆）点击“替换此站”时，经常替换出与原来一模一样的景点，或在整条多天行程中产生重复站点。
*   **根因剖析**：
    1. 旧版 `replacementFor()` 采用静态 Switch-Case 映射（如只要原因包含“想换室内”，一律固定返回 `cq-museum`）。若被替换站点本身就是三峡博物馆，则发生“自己替换自己”。
    2. 未在候选池中排查当前行程 `trip.days` 已占用的 `usedVenues` 集合，导致在其它天已有的景点被再次选中。
*   **解决方案**：
    *   构建 `usedVenues = new Set(trip.days.flatMap(d => d.stops.map(s => s.venueId)))`。
    *   在 24 大景点池中严格过滤 `item.id !== oldStop.venueId && !usedVenues.has(item.id)`。
    *   根据用户理由（`少走路`、`下雨换室内`、`时间变少`、`夜景`、`美食`）结合地理同区邻近度进行多维加权打分，动态选出最优替代景点。

---

### 2. 高德地图实例重复渲染、图层混合与 DOM 容器解绑导致白屏
*   **缺陷现象**：微调行程或点击反馈时，地图疯狂重绘闪烁，或在某些操作后地图区域变成空白灰色。
*   **根因剖析**：
    1. 页面每次调用 `render()` 时执行 `app.innerHTML = ...`，会导致旧的 `<div id="trip-map"></div>` 节点被销毁并生成新节点。
    2. 旧代码虽然保留了 `state.mapInstance`，但该实例指向的其实是已经从 DOM 树上卸载的孤立节点（`!document.contains(container)`），导致地图新容器内部空空如也。
    3. 地图缺少分天过滤机制，所有天的 Marker 和 Polyline 折线混合在一张图上，视觉混乱。
*   **解决方案**：
    *   增加容器挂载状态检测：`Boolean(state.mapInstance && document.contains(state.mapInstance.getContainer()))`，若容器已解绑则安全销毁旧实例并在新 DOM 上重新初始化。
    *   增加多天 Tab 切换（`[全景路线]`、`[第 1 天]`、`[第 2 天]`...），并为每一天分配独立专属色彩（红、蓝、绿、紫、橙、青、粉）。
    *   为 Marker 绑定交互式 `InfoWindow`，点击即弹出站点简介、游玩建议与交通方案。

---

### 3. SPA 全局重新渲染导致输入框焦点与光标丢失
*   **缺陷现象**：在知识库搜索框、偏好输入框或旅行需求框中连续打字时，每输入一个字符输入框就会失去焦点，光标跳动，无法连续输入。
*   **根因剖析**：
    *   由于采用原生 Vanilla JS 的 `app.innerHTML = views[state.view]()` 整体渲染模式，每次触发 `render()` 都会把正在获得焦点的 `<input>` 元素销毁重建物件，浏览器的原生焦点状态和选择范围（SelectionRange）被强行重置。
*   **解决方案**：
    *   在 `render()` 执行前记录当前激活元素及光标位置：`activeElId = document.activeElement?.id`、`activeSelectionStart`。
    *   在 `app.innerHTML` 赋值后，立即通过 `document.getElementById(activeElId)?.focus()` 恢复焦点并还原 `setSelectionRange(start, end)`，实现与现代 Virtual DOM 框架一致的无感知输入体验。

---

### 4. 景区图片与静态资源 404 无法加载
*   **缺陷现象**：本地服务正常启动，但景点卡片与详情页图片全部破损或加载失败。
*   **根因剖析**：
    *   `server/index.mjs` 中的 `staticFile()` 路由中间件早期仅限定了 `APP_DIR = path.join(ROOT, 'app')`，对于以 `/outputs/`、`/images/` 开头的图片请求直接返回了 404。
*   **解决方案**：
    *   重构静态文件路由：分别识别 `/images/`、`/outputs/`、`/data/` 与 `app/` 路径，安全校验 `full.startsWith(ROOT)`。
    *   增加全自动 SVG 生成脚本（`scripts/generate-attraction-svgs.mjs`），为全部 24 个景区生成现代化高清全景矢量插画，并提供兜底 SVG 回退，彻底杜绝 404。

---

### 5. 景点详情与探索页天数添加逻辑固定且缺少站点移除功能
*   **缺陷现象**：详情页点击添加固定在 Day 2，探索页点击固定在 Day 1，重复点击没有拦截，且站点无法从行程中移除。
*   **根因剖析**：
    1. 前端视图中硬编码了天数标识；
    2. 后端 `/api/trip/stops` 缺少同天重复添加拦截校验；
    3. 行程卡片未暴露删除按钮，后端未实现删除站点后的前后路线重新衔接与耗时重算。
*   **解决方案**：
    *   在详情页与探索页均增加天数选择器下拉框（`<select>`），支持动态指定加入到第 1~N 天。
    *   服务端增加同天重复添加拦截（400 友好提示）。
    *   卡片新增“移除”操作，后端支持 `operation === 'delete'`，删除后自动调用 `hydrateDayRoutes()` 重新计算前后站点的步行/公交路线。

---

### 6. 工程验收指标污染 C 端用户界面
*   **缺陷现象**：用户主界面大量充斥“事实待核验”、“事实状态总览”、“Citation 覆盖 100%”、“实时数据覆盖 0%”及政府政务网站长链接。
*   **根因剖析**：
    *   早期开发为了满足自动化测试脚本对数据契约的显式检查，把系统内部的数据可信度指标（Quality Metrics）生硬地铺在 C 端用户的界面中。
*   **解决方案**：
    *   彻底拆分“数据载荷契约”与“UI 视图渲染”：在 JSON 返回结构中 100% 保留所有质量指标字段（供 22+ 自动化测试脚本严格校验），但在 C 端用户界面中只呈现优雅简洁的“门票”、“时长”、“交通”和“推荐依据”卡片。

---

### 7. 管理员知识库文档硬编码与 92 篇全量语料脱节
*   **缺陷现象**：管理后台语料列表仅展示了 6 条写死的示例，无法查看与编辑 Qdrant/本地语料库中真实的 92 篇全量文档。
*   **根因剖析**：
    *   前端 `adminView()` 在初始化时未向服务端请求 `/api/admin/knowledge/documents`，直接回退了本地 6 条假数据数组。
*   **解决方案**：
    *   在 `health()` 中动态加载全量知识文档并存入 `state.adminDocs`。
    *   实现**语料检索 + 5 大主题分类筛选（accessibility / transport / dynamic / warning / itinerary）**。
    *   实现**手风琴抽屉式展开/收起**与**大视野在线编辑弹窗**，修改后调用 `/api/admin/knowledge/update` 实时更新。

---

### 8. 用户管理纯只读，缺乏交互与权限操作
*   **缺陷现象**：管理员界面用户板块标注“用户管理 · 只读”，仅能看文字，无法进行管理操作。
*   **根因剖析**：
    *   前端未封装用户管理交互 API，后端未打通身份切换、数据重置与账号清理接口。
*   **解决方案**：
    *   在 Node BFF 与持久化存储层实现：
        1. `POST /api/admin/users/role`（一键切换系统管理员 / 普通游客）
        2. `POST /api/admin/users/reset`（重置用户行程与偏好数据）
        3. `POST /api/admin/users/delete`（安全删除指定用户，内置 demo/admin 受保护不可删）
    *   前端界面提供直观操作按钮组与操作二次确认弹窗。

---

### 9. UI 过度依赖 Emoji，AI 原型感过强
*   **缺陷现象**：每个标题、按钮、卡片均充斥大量 Emoji（如 `🗺️`, `⏱️`, `🎫`, `🚶`, `👑`, `👁️`），缺乏现代成熟 SaaS 的典雅与专业感。
*   **根因剖析**：早期快速原型阶段直接用 Emoji 代替设计规范。
*   **解决方案**：
    *   全面清理生硬 Emoji，重塑为基于石板灰（`#1c1917`）与传统矿物朱砂红（`#c23e32`）的成熟设计系统。
    *   使用结构清晰的属性徽章（Pill Badges）、数据 KPI 指标卡与高对比度微阴影。

---

### 10. 管理员模式在非标准分辨率下布局挤压与图表溢出
*   **缺陷现象**：在较窄或非常规屏幕下，管理端 KPI 卡片与 SVG 图表重叠挤压，文字换行错乱。
*   **根因剖析**：
    *   CSS Grid 采用了固定的列比例，SVG 图表没有设置自适应 `viewBox` 与 `preserveAspectRatio`。
*   **解决方案**：
    *   重构 `styles.css` 中的媒体查询断点（1200px / 960px / 640px），网格全面采用 `minmax()` 弹性布局。
    *   SVG 图表增加 `preserveAspectRatio="xMidYMid meet"` 与滚动溢出容器。

---

### 11. Java Spring AI 后端在未配置 Key 时阻断容器初始化
*   **缺陷现象**：本地未设置 `DEEPSEEK_API_KEY` 环境变量时，Spring Boot 启动因 `Assert.hasText(apiKey)` 异常直接 Crash 退出。
*   **根因剖析**：
    *   `application.yml` 中 `spring.ai.openai.api-key: "${DEEPSEEK_API_KEY:}"` 默认回退为空字符串。
*   **解决方案**：
    *   配置安全默认回退：`"${DEEPSEEK_API_KEY:disabled-dev-mock-key}"`，同时清理了 `pom.xml` 中重复的 `jackson-datatype-jsr310` 依赖。

---

## 三、 全量测试套件与自动化回归覆盖结果

系统目前拥有 **23 个前端/BFF 测试脚本** 与 **24 个 Java 后端单元/集成测试**，当前运行结果为 **100% 绿灯全量通过**：

| 测试分类 | 核心覆盖脚本 | 验证范围与断言目标 | 状态 |
| :--- | :--- | :--- | :---: |
| **主链规划与重规划** | `test:e2e`<br>`test:golden`<br>`test:browser` | 匿名规划生成、局部去重替换、其余站点不可变性、约束匹配打分 | ✅ 通过 |
| **高德地图与空间计算** | `test:map`<br>`test:amap-live` | AMap Marker/Polyline 渲染契约、多天图层切换、无 Key 弹性回退 | ✅ 通过 |
| **知识库与语义检索** | `test:knowledge-corpus`<br>`test:qdrant-retrieval`<br>`test:knowledge-import` | 92 篇语料主题覆盖、Qdrant 1536 维向量召回、Embedding 导入清单回读 | ✅ 通过 |
| **持久化与跨设备同步** | `test:persistence`<br>`test:cross-device`<br>`test:auth`<br>`test:revocation-redis` | 账号与行程跨进程恢复、多设备修订号同步、Redis Token 撤销同步 | ✅ 通过 |
| **行程与档案资产** | `test:save-return`<br>`test:trips-management`<br>`test:profile`<br>`test:explore-history` | 行程保存/导出 PDF/删除、偏好演进时间轴、24 景分类探索 | ✅ 通过 |
| **管控与数据分析** | `test:quality`<br>`test:feedback-analytics`<br>`test:admin` | 约束满足 100%、反馈多维聚合、脱敏用户管理与语料编辑 | ✅ 通过 |
| **Java 后端核心套件** | `mvn test` (24 项用例) | Spring Boot 容器上下文、Qdrant 管道集成、AmapWebServiceClient 等 | ✅ 通过 |

---

## 四、 总结与后续演进建议

本次重构彻底解决了系统在**去重算法、高德地图交互生命周期、UI 审美去 AI 感、管理后台全量数据联动与跨平台兼容性**上的所有阻碍点。

### 后续演进路线建议：
1. **多模态与语音集成**：进一步将 Java 后端的百度 ASR/TTS 与前端录音组件联动，实现语音直接定制旅行行程。
2. **实时人流与拥挤度预警**：对接重庆文旅实时景区客流监控开放接口，在行程规划中引入高峰时段避堵动态重规划。

---

## 五、2026-08-30 聊天规划模式专项复盘

### 5.1 完整链路与现场证据

本次问题的实际链路为：

`浏览器输入“方案A：渝中区文化室内线，选这个帮我改行程”`
→ `chat-service.js` 判断通道
→ Node BFF 选择 `/api/planner/conversation` 或 `/api/chat/stream`
→ `ChatController` 接收规划请求
→ `ConversationIntentClassifier` 解析意图
→ `PlanAdjustmentService` 生成行程调整预览
→ 前端展示 Proposal，等待用户确认。

现场日志先证明了请求曾经走的是普通聊天流：`[CHAT_STREAM_START] mode=normal`，因此后端规划器没有被触发。修复前，前端路由规则没有识别“方案A/选这个/帮我改行程”这一类叙事方案选择；即使手动进入规划接口，Java 确定性解析器也没有把它识别为全行程重规划。

### 5.2 根因分层

1. **入口路由漏判**：前端只覆盖了“替换、删除、重排、确认方案”等有限词形，未覆盖“选择模型刚刚给出的方案并应用到行程”的自然表达。
2. **后端意图漏判**：`planner.llm.intent.enabled=false` 时使用确定性解析器，原逻辑无法将叙事方案选择映射为 `REPLAN_DAY + TRIP`。
3. **调整范围不足**：重规划实现原本偏向单日，无法表达方案 A 对多个天/多个站点的整体调整。
4. **候选与时间槽不一致**：候选景点筛选先截取候选，再检查营业时间，可能把 17:00 关闭的景点放入晚间时段，产生 `CLOSED_AT_SLOT_TIME`。
5. **旧 Proposal 阻塞重试**：前一次失败预览残留时，后续相同输入被错误地当作已有方案冲突，分类结果变为 `UNKNOWN`。
6. **前端反馈不足**：普通聊天与规划聊天的通道、模型、决策状态不明显；错误时只有通用失败表现；长文本中的转义 Markdown/HTML 实体也影响可读性。旧 CSS 查询参数还会使浏览器继续使用旧版窄输入框。

### 5.3 处理结果

- 前端新增叙事方案选择识别，命中后明确设置 `chatRoute=planner`，并增加脱敏的 `[CHAT_ROUTE]` 日志；BFF 增加 `[BFF][planner-route]` 阶段日志，不记录完整输入或凭据。
- Java 确定性解析器支持“方案 A/选这个/按这个方案改行程”，生成 `REPLAN_DAY`、`TRIP`、室内/少走路等约束；规划服务支持跨天预览。
- 候选筛选在截取候选前校验营业时间，避免晚间安排已闭店景点；失败 Proposal 不再阻塞同一请求的重新解析。
- UI 改为“先生成预览、用户确认后应用”，展示通道、模型、决策、影响站点数和 Proposal ID；增加“看其他候选/暂不修改/重试”入口、规划 loading 和错误提示。
- Markdown 渲染兼容 `\\##`、`-**`、`1.**` 及常见 HTML 实体；输入区改为自适应全宽，并刷新静态 CSS 版本。

### 5.4 验证结论

- Node：`npm run check`、`npm run test:browser`、`npm run test:chat-stream` 均通过。
- Java：本次相关的 `ConversationIntentClassifierTest` 与 `PlanAdjustmentServiceTest` 共 34 个测试通过；此前完整 `mvn test` 也已通过 229 个测试。
- 内置浏览器实测同一句方案选择输入已进入“行程规划”，生成 `REPLAN_DAY` 的待确认预览，未再出现“后端模型未能完成本次回答”。当前设计不会自动修改正式行程，必须点击“确认应用方案”才会提交 revision。
- 若 Qdrant 确实不可用，Java RAG 才会进入本地知识库降级路径；这是检索能力的独立状态，不是本次“规划模式未触发”的根因。健康检查和日志应区分“本机探测失败”与“Java 云端连接状态”。

### 5.5 2026-08-30 直接替换与聊天窗专项修复

用户随后给出了更严格的请求：“把重庆中国三峡博物馆替换成重庆大剧院外围广场”。这类请求包含明确的源景点和目标景点，不能再退化为“给当前站点推荐一批候选”。本次补充修复如下：

1. **源/目标拆分优先**：`ConversationIntentClassifier` 先按“替换成/换成/改成”等连接词切分左右两侧，分别解析源站点与目标地点，生成 `REPLACE_STOP + SUGGEST_REPLACEMENTS`，并保留精确的 `replacementPlaceId`。
2. **服务端精确执行预览**：`PlanAdjustmentService` 对显式目标只构建一个目标候选，并继续执行重复景点、原地替换、营业时间和规划校验；目标无效时返回明确的不可行 Proposal，不用泛化候选覆盖用户原意。
3. **修复误选首站**：此前以“整句包含源词”匹配站点，源词“博物馆”会让第一天的首站误命中，即使目标日期是第二天。现在必须让站点名称与 `targetStopReference` 相互匹配，且相对表达“晚上最后一个行程”按目标日末尾晚间站点解析。
4. **替代候选上下文连续**：点击“看其他候选”时，从当前 Proposal 恢复原目标站点，避免第二轮候选请求丢失上下文；快捷候选按钮与 Proposal 操作按钮不再重复展示。
5. **规划页聊天浮窗化**：规划页移除全宽聊天面板，改为仅在 `planning + trip` 状态挂载的“悠悠 AI”悬浮按钮。点击后打开右侧 Planner 对话窗，移动端改为底部抽屉；关闭、Esc 收起只改变 UI 状态，不修改行程。Proposal 仍遵循“预览 → 用户确认 → Revision +1 应用”。
6. **登录边界显式化**：内置浏览器匿名生成规划成功，但聊天流在未登录状态显示登录提示，这是当前 Java ChatController/BFF 的安全契约，不应被误判为后端无响应；登录后才验收完整聊天请求链路。

本轮验证：`ConversationIntentClassifierTest` 7 项、`PlanAdjustmentServiceTest` 30 项共 37 项通过；Node `check`、`test:browser`、`test:chat-stream` 通过；内置浏览器已验证规划页悬浮按钮、打开/收起交互和桌面布局。这里的 `localhost:6334` 仅是旧本机探测地址，不代表当前 Qdrant Cloud 状态。

### 5.6 2026-08-31 会话恢复、运行日志与最终验收

1. **修复 BFF 重启后的会话断链**：规划会话映射、Java Planner Session ID 和加密后的会话能力凭据写入持久化 JSON；BFF 重启后先校验设备/用户边界，再向 Java 恢复会话。明文凭据不落盘，Java 仍是正式行程和规划会话的权威来源。
2. **修复本地启动误报**：`start-local.ps1` 强制用户侧 `:3000` 使用持久化模式，并在 8080/3000 已有服务时复用进程，避免重复启动 Java 后出现“端口占用”假失败。Java/BFF 标准输出和错误输出写入系统临时日志目录，BFF 规划异常额外记录路由、错误码、请求编号和脱敏堆栈。
3. **修复前端刷新丢失待确认方案**：聊天消息、当前 Proposal 和选中的候选同步保存；刷新或 BFF 重启后仍展示“待确认”，不会伪装成已完成，也不会自动修改行程。
4. **补齐配置契约**：修正 `KnowledgeDbConfig` 已迁移到 `common/config` 后仍使用旧路径的问题，并登记 Planner 意图/叙事开关、BFF 日志路径等配置。LLM 意图提取默认仍关闭，确定性解析作为无凭据/超时/非法 JSON 的安全回退。

最终验证：Node `check`、`test:admin`、`test:persistence`、`test:browser`、`test:chat-stream`、`test:config-contract`、`test:proposal`、`test:e2e` 全部通过；Java `mvn test` 通过（234 项，0 失败，10 项按环境跳过）。内置浏览器复测“博物馆替换为大剧院”时只生成一个目标候选，显示“确认后仅替换这一站”；BFF 重启后继续发送“少推荐一个景点”成功生成 `REDUCE_DAY_DENSITY` 预览。

### 5.7 Qdrant 状态复核

前一版结论“当前 Qdrant 不可用”不准确。当前 canonical 配置使用的是 Qdrant Cloud 主机和 gRPC `6334` 端口，并已配置访问凭据；本机 `localhost:6333/6334` 没有监听是正常的，因为项目并未配置本地 Qdrant 容器。Java 启动检查已成功读取目标集合，确认 168 个向量、1536 维，并完成 `rag_eligible` payload 索引与类型校验。

BFF `/api/health` 中的 `directQdrant=false` 表示 Node 不允许直连 Qdrant，`verified=false` 表示 BFF 没有代替 Java 做实时探测，不表示 Qdrant 不可用。Java RAG 的最终状态应以 Java `/ai/rag/stats` 或 Java 检索日志为准；此前本机端口探测失败不应再写成云端 Qdrant 降级。

### 5.8 2026-08-31 用户可选模式与独立方案窗

针对“聊天和规划由用户主动选择、方案选择不遮挡行程页面”的最终交互约定，已完成以下调整：

1. **模式由用户选择**：右上角仅显示“聊天模式 / 规划模式”。聊天模式用于景点、天气、交通和美食问答，不直接修改行程；规划模式用于替换、增删、重排和候选方案确认。
2. **底层链路统一**：聊天模式的普通问答统一调用 Java 深度 Agentic RAG 链路（前端不再暴露 normal / deep、模型名或检索供应商）；规划模式统一调用 Java Planner 的 Proposal → Confirm 链路。
3. **选中站点自动切换**：点击“选中此站”后自动进入规划模式，并明确提示“如需普通咨询，请切换到聊天模式”。规划请求发生服务端异常时，错误区域提供“切换到聊天模式”操作，不把内部错误码和状态直接展示给用户。
4. **一换一优先**：明确说出源景点和目标景点时，只生成一个目标候选；用户确认后只替换这一站。目标不太建议时仍保留用户明确指定的草稿，并提供“仍按此方案应用 / 换其他方案 / 暂不修改”，最终决定权在用户。
5. **候选请求补齐**：支持“推荐同片区其他室内景点”“换同片区其他景点”等自然表达。Java 规则分类器把它们识别为替换候选请求，若上下文已有选中站点或活动提案则自动补齐替换源；BFF 在会话恢复后也会从当前提案安全恢复目标站点。
6. **方案独立悬浮窗**：Proposal 不再渲染在 AI 对话窗内，而是在规划页单独展示。关闭后只保留“方案预览”入口；聊天窗只保留对话和模式切换，避免长方案卡片挡住行程内容。

最终验收结果：内置浏览器已验证模式切换、选中景点自动进入规划、明确一换一生成独立预览，以及继续输入“推荐同片区其他室内景点”生成 3 个候选；Node `check`、`test:browser`、`test:proposal`、`test:chat-stream`、`test:e2e` 通过；Java `mvn test` 通过 236 项，0 失败，10 项按环境跳过。
