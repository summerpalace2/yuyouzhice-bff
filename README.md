# 渝游智策｜重庆旅行决策助手

这是基于用户提供的 PRD V1.0 与《AMAP Web Service API 接口目录》实现的 P0/P1 可运行版本。当前实现不是静态 UI：它包含匿名规划、结构化行程、事实状态、来源引用、景点详情、局部重规划、记忆提案、登录回跳、注册/登录/退出、持久化保存与我的行程、旅行档案、偏好历史、行程版本历史、反馈统计、历史会话、Explore 重庆、质量指标和服务状态页。

## 启动

无需安装第三方依赖，直接运行：

```bash
npm start
```

打开 `http://localhost:3000`。

如果需要接入高德 Web Service API，在启动前设置服务端环境变量 `AMAP_WEB_SERVICE_KEY`。必须使用高德控制台中绑定为“Web服务”的 Key；密钥只在服务端读取，不写入前端。

本地配置统一写入 `D:\\scenic-guide\\ai\\.env`（已加入忽略规则，不应提交）：“Web服务”应用 Key 使用 `AMAP_WEB_SERVICE_KEY`；“Web端”应用 Key 使用 `AMAP_WEB_JS_KEY`，对应安全密钥使用 `AMAP_WEB_JS_SECURITY_CODE`。两者不能互换。

持久化模式必须通过受保护配置设置 `YUYOUZHICE_AUTH_SECRET`（至少 32 个随机字符）；认证密钥不会写入 JSON 数据文件，也不会从旧 JSON 文件中的 `authSecret` 字段恢复。`YUYOUZHICE_MEMORY=1` 可用于自动化测试，此时允许使用仅存于当前进程的临时密钥；不要将临时密钥用于生产。

多实例部署如需让注销状态在实例间同步，可设置 `YUYOUZHICE_REVOKE_STORE=redis`，并提供 `YUYOUZHICE_REDIS_URL`，或提供 `YUYOUZHICE_REDIS_HOST`、`YUYOUZHICE_REDIS_PORT`、`YUYOUZHICE_REDIS_PASSWORD`、`YUYOUZHICE_REDIS_DATABASE` 和 `YUYOUZHICE_REDIS_SSL`。默认值是 `memory`，不会因为外部环境中存在 Redis 配置而自动连接；Redis 请求失败时认证按失败关闭处理，避免把已注销 Token 放行。

如果需要在浏览器中显示交互地图，还需在高德控制台创建单独绑定为“Web端（JS API）”的 Key，并设置 `AMAP_WEB_JS_KEY`；启用安全密钥时设置 `AMAP_WEB_JS_SECURITY_CODE`。Web 服务 Key 与 JS API Key 不混用，浏览器地图 Key 还应配置域名白名单。

PowerShell 示例：

```powershell
$env:AMAP_WEB_SERVICE_KEY="你的Web服务Key"
$env:AMAP_WEB_JS_KEY="你的Web端JS API Key"
$env:AMAP_WEB_JS_SECURITY_CODE="你的JS API安全密钥"
npm.cmd start
```

没有密钥时应用使用明确标注的“演示回退模式”，不会把演示数据伪装成实时高德事实。账号、行程和已确认偏好默认写入项目 `data/yuyouzhice.json`，可通过 `YUYOUZHICE_DATA_FILE` 指定路径；该数据目录仅供服务端读取，静态文件路由会拒绝 `/data/` 访问。自动化测试使用 `YUYOUZHICE_MEMORY=1` 隔离存储。

配置有效 Key 后，规划主链会查询重庆 POI、天气、步行和公交路线，并将 POI 名称、地址、坐标、营业信息、路线距离/耗时、polyline 和天气挂载到 TripPlan；公交路线优先尝试 v5，遇到当前 Key 不兼容时兼容回退到官方 v3 端点。接口部分失败时会标记“高德接口部分可用”，未配置或全部失败时保持“演示回退模式”。

如果已有 Production V2 Retrieval 服务，可设置 `YUYOUZHICE_RETRIEVAL_URL`。服务需要接受 `{ query, city, constraints }`，返回 `{ ok, facts, citations }`；返回的事实和引用会绑定到 TripPlan，并将 retrieval 标记为“Production V2 Retrieval”。当前 Web BFF 不把本地 JSONL、Embedding 或 Qdrant 当作运行时权威；`data/knowledge/yuyouzhice-knowledge-corpus.jsonl` 是可追溯的知识准备工件，当前 manifest 为 `not_generated/not_imported`，不能据此声称已有向量点数或在线验证。`GET /api/retrieval/status` 会明确返回 Java Core 检索边界；若向量库由外部 Retrieval 服务持有，可额外设置 `YUYOUZHICE_VECTOR_STORE_URL`、`YUYOUZHICE_VECTOR_STORE_PROVIDER` 和 `YUYOUZHICE_VECTOR_STORE_COLLECTION`。

## 验证

```bash
npm run check
npm run test:e2e
npm run test:auth
npm run test:phase5a-auth
npm run test:acceptance
npm run test:save-return
npm run test:trips-management
npm run test:persistence
npm run test:retrieval
npm run test:retrieval-readiness
npm run test:knowledge-corpus
npm run knowledge:dry-run
npm run test:knowledge-import
npm run test:profile
npm run test:explore-history
npm run test:quality
npm run test:feedback-analytics
npm run test:cross-device
npm run test:revocation-redis
npm run test:map
npm run test:browser
npm run test:golden
npm run test:memory
```

使用有效 Web服务 Key 做真实接口验收：

```powershell
$env:AMAP_WEB_SERVICE_KEY="你的Web服务Key"
npm.cmd run test:amap-live
```

只有 `test:amap-live` 成功时，才可确认当前环境真实拿到了高德 POI、天气和路线；没有 `AMAP_WEB_SERVICE_KEY` 时，其余测试验证的是明确标注的回退模式。`test:profile` 验证旅行档案、偏好历史、版本历史和基础反馈统计；`test:explore-history` 验证 Explore 筛选、历史会话权限、重规划同步和会话恢复；`test:quality` 验证约束满足度、Citation 覆盖率、实时数据覆盖率和未知事实计数；`test:feedback-analytics` 验证反馈原因、版本、来源模式和管理员聚合；`test:cross-device` 验证账号历史跨进程、跨设备恢复与修订同步；`test:map` 验证 MapContext、无 JS Key 回退和 AMap Marker/Polyline 渲染契约。

## 当前 PRD 完成度

- P0：Home、AI Planning、Constraint Review、Fact/Citation、Attraction Detail、Local Replan、匿名 Session、登录注册、Save → Login → Return、My Trips、PDF、Memory Proposal、Admin Console 已接通并有自动化验收。
- P1 已补齐的闭环：Travel Profile、Preference History、Trip Version History、Feedback Analytics、Explore 重庆、登录用户历史会话、质量指标、跨设备历史恢复；历史会话可恢复并继续局部重规划，反馈可按原因、版本和来源模式分析。认证 Token 使用 HMAC 签名格式；持久化模式从受保护配置读取认证密钥，认证密钥不写入 JSON 数据文件。
- P2 尚未展开：实时客流、ASR/TTS、Android、数字人和多模态能力；地图交互渲染已接入，配置独立的 Web端（JS API）Key 后显示真实底图，未配置时保留路线数据回退。
- P2 边界：高德 Web Service 的 POI/天气/步行/公交已接入，AMap JS 地图渲染已接入；当前检查库包含 104 条可追溯知识语料，但 manifest 保持 `not_generated/not_imported`，没有伪造 Embedding 维度、Qdrant pointCount 或在线回读证据。运行时检索仍以 Java Core Backend 为唯一边界，知识语料准备状态不等同于生产向量检索已上线。住宿区域、交通偏好、步行耐受和饮食偏好会进入每日出发衔接、路线选择、餐饮策略和站点推荐理由。实时客流、ASR/TTS、Android、数字人和多模态仍未接入。

### Embedding / Qdrant 导入

默认只做安全 dry-run，不调用外部服务：

```powershell
npm run knowledge:dry-run
```

真正导入前需要配置一个 OpenAI-compatible Embedding API 和 Qdrant。脚本不会打印 API Key，也不会在配置不完整时写入 manifest。导入脚本固定读取 `D:\\scenic-guide\\ai\\.env`，不再通过 `YUYOUZHICE_ENV_FILE` 链接其他配置文件：

```powershell
$env:YUYOUZHICE_EMBEDDING_URL = 'https://your-embedding-service/v1/embeddings'
$env:YUYOUZHICE_EMBEDDING_API_KEY = '只在当前终端设置'
$env:YUYOUZHICE_EMBEDDING_MODEL = '你的 embedding 模型名'
$env:QDRANT_URL = 'https://your-qdrant-host'
$env:QDRANT_API_KEY = '只在当前终端设置'
$env:QDRANT_COLLECTION = 'scenic_guide_production_v2'
node scripts/knowledge-import.mjs --run --rebuild
```

如果主语料已经有旧的导入清单，新增语料合并后使用 `--rebuild` 明确重建整个集合并回读校验：

```powershell
node scripts/knowledge-import.mjs --run --rebuild
```

在 `D:\\scenic-guide\\ai\\.env` 中配置 canonical 变量后，脚本会识别 DashScope/百炼兼容变量；不支持通过 `YUYOUZHICE_ENV_FILE` 切换配置文件：

```powershell
node scripts/knowledge-import.mjs --dry-run
node scripts/knowledge-import.mjs --run --rebuild
```

其中 `DASHSCOPE_API_KEY` / `BAILIAN_API_KEY` 会默认使用 DashScope `text-embedding-v2`，`QDRANT_HOST` / `QDRANT_PORT` 会转换为 REST 端点（6334 gRPC 配置对应 REST 端口 6333；`*.qdrant.io` 云端主机自动使用 HTTPS）。Embedding 服务需要返回 OpenAI 兼容的 `{ data: [{ index, embedding }] }`，或 DashScope 的 `{ output: { embeddings: [{ text_index, embedding }] } }`。脚本只有在真实 Embedding 服务、Qdrant 可用且回读点数达到当前 JSONL 文档数后，才会把 manifest 更新为 `generated/imported`；没有真实服务时，104 条语料的状态必须保持 `not_generated/not_imported`，不得填写 pointCount 或 `verified`。

## 主要接口

适配器登记并使用用户接口目录中的：

- `/v5/place/text`
- `/v5/place/detail`
- `/v3/geocode/geo`
- `/v3/geocode/regeo`
- `/v5/direction/walking`
- `/v5/direction/transit/integrated`
- `/v3/assistant/inputtips`
- `/v3/weather/weatherInfo`

前端所有核心文案为中文。未知、动态、冲突状态在行程卡片和详情中显式展示；“我的行程”只读取登录用户实际保存的数据，不混入演示草稿。

登录用户可在“我的行程”导出真实 TripPlan PDF，也可以删除指定保存记录；删除前会二次确认，PDF 与删除接口均按当前用户会话鉴权。支持注册、登录和退出，账号密码使用 Node `scrypt` 哈希保存，不写入明文密码。
