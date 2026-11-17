# AGENTS.md — 渝游智策 Web Frontend & BFF

## 1. Overview
「渝游智策」Web 展示与代理层，核心业务全部委托给 Java Core（`http://localhost:8080`）：
- **Node BFF**（`server/index.mjs`，端口 `3000`，健康检查 `/api/health`）：静态托管、Cookie/CSRF 会话、请求透传至 Java `/ai/**`。
- **Web SPA**（`frontend/web/src/`，Vite 6 构建，端口 `5173`）：当前运行时为原生现代化 ESM + CSS 变量（注意：`frontend/package.json` 虽含 Vue 依赖，实际页面仍运行于原生 DOM 渲染）。

## 3. Commands（在仓库根目录执行）
- BFF 语法检查：`npm run check`
- BFF 契约测试：`node --test (Get-ChildItem server -Filter '*.test.mjs').FullName`
- 前端单元测试：`node --test (Get-ChildItem frontend/web/src -Recurse -Filter '*.test.mjs' -File)`
- 前端架构守卫：`npm run test:architecture`
- 前端生产构建：`npm run build:frontend`

## 7. Boundaries
### Always
- 浏览器只请求同源 `/api/*`，由 BFF 统一代理至 Java Core，并透传 `baseRevision` 与 `idempotencyKey`。
- 扩展 Agent SSE 事件（思考步骤、工具调用、流内提案卡）须保持对现有 `meta` / `sentiment` / `error` / `done` 的向后兼容；迟到的旧版本回执必须丢弃，禁止逆流覆盖。
- 详见三端总契约 `docs/architecture/ARCHITECTURE_CONTRACT.md`。对本文件遵循“因错迭代 + 定期修剪”：仅在同一错误真实犯两次时追加，已被脚本守卫拦截的及时删掉。

### Ask first
- 修改 `server/web-security.mjs`、Cookie/CSRF 校验、Java 代理契约，或将原生 ESM 页面迁移为 Vue 组件。

### Never
- 禁止在 BFF 或前端实现排程算法、景点真值列表、经纬度算路、向量检索（Qdrant/DashScope）或独立的用户鉴权存储。
- 禁止在 BFF 持有 DashScope / Qdrant / 高德 Web Service 服务端私钥，禁止直接写入本地 `data/yuyouzhice.json`，禁止前端绕过 BFF 直连 `8080` 端口。
- 禁止修改或扫描 `frontend/web/dist/`、`node_modules/`、`frontend/node_modules/`、`data/yuyouzhice.json`、`logs/`、`.adg/`。
- 未启动真实 Java Core 与外部服务做浏览器联调时，禁止将 stub 测试冒充为全栈端到端通过。
