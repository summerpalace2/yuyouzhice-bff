# Web 前端架构与注释约定

## 目标

本项目是原生 JavaScript SPA。它不追求框架化重写，而是以清晰的状态边界、唯一页面注册表和局部 DOM 更新保证可维护性与性能。

## 分层与依赖方向

```text
app-core（启动、路由、状态、事件装配）
  └─ pages（完整页面 HTML）
       └─ widgets（跨页面 UI 组合）
            └─ features（用户动作与业务流程）
                 └─ entities（旅行者、行程、景点展示规则）
                      └─ shared（纯工具、API 协议、基础 UI）
```

- `pages` 只负责页面结构；不直接发起业务写入。
- `features` 负责一个用户可感知的流程，例如聊天、保存行程、重新规划。
- `shared` 默认不读取全局 `state`；已有例外应逐步迁移到 `app-core` 注入。
- `widgets` 不得反向导入 `pages`。管理员弹层后续移入 `features/admin-corpus`。
- [router.js](../app/src/app-core/router.js) 是唯一页面注册表，禁止再创建第二份 `views` 映射。

## 状态边界

当前 `state` 仍是兼容层。新增字段必须归入下列分组，并写清生命周期：

| 分组 | 例子 | 生命周期 |
|---|---|---|
| auth | `user`、`csrfToken` | 会话恢复与登出 |
| trip | `trip`、`sessionId`、`savedTripId` | 当前行程 |
| chat | `chatMessages`、`activeProposal` | 当前行程聊天键 |
| profile | `profile`、记忆候选 | 账号档案 |
| admin | `adminOverview`、语料状态 | 管理员控制中心 |
| map | 地图实例、覆盖物、定位 | 仅运行时，不持久化 |
| ui | loading、弹窗、当前页面 | 仅当前浏览器视图 |

禁止把地图实例、AbortController、DOM 节点等运行时对象写入本地持久化。

## 渲染规则

1. 仅路由切换、生成/打开/应用一份完整行程时调用 `render()` 或 `renderView()`。
2. 聊天流、天气、定位、记忆、管理员列表行、弹窗、筛选和折叠必须优先调用对应局部刷新函数。
3. 局部刷新失败时可回退 `renderView()`，但必须在代码中解释回退原因。
4. 后台请求成功后不得顺手触发全量 health/overview 刷新，除非当前页面展示的数据确实依赖该聚合结果。
5. 账号级偏好和长期旅行记忆必须在调用规划接口前由用户确认；确认弹窗期间暂存本次条件，选择后仅发送一次规划请求。

## 事件分发

- 所有 `data-action` 继续由根节点事件委托承接。
- 新动作先归类：导航/认证、规划、聊天、档案、探索、管理员。
- 每个领域 handler 返回 `true` 表示已消费，根事件委托立即返回。
- handler 接收依赖参数，不反向导入其它页面；这使同一流程可以被 Web、测试和未来 Android API 契约复用。

## 注释规范

只注释“代码无法直接说明的约束”。推荐注释下列内容：

- 业务不变量：例如正式行程与聊天键的绑定、记忆优先级、版本号递增。
- 异步策略：取消、重试、乐观更新、失败回滚、后台增强。
- 性能边界：为何此处不能触发根视图重绘。
- 外部契约：Java/BFF 字段、SDK 限制、兼容迁移的删除条件。

不要注释变量的字面含义、顺序编号或重复代码本身。公共异步函数统一使用 JSDoc 说明：输入、状态副作用、不变量、渲染影响和失败行为。

```js
/**
 * 应用已确认的局部调整提案。
 *
 * 不变量：服务端版本必须严格等于 baseRevision + 1。
 * 副作用：替换当前行程、清空提案、持久化工作区。
 * 渲染：成功后允许重绘行程；失败时仅更新聊天区域。
 */
```

## 渐进式拆分顺序

1. 已完成：启动流程进入 `bootstrap.js`，导航动作进入 `navigation-handler.js`。
2. 已完成：管理端与旅行档案/长期记忆动作分别进入 feature handler，并保留局部刷新与乐观更新。
3. 已完成：聊天交互动作进入 `features/trip-chat/chat-action-handler.js`；流式请求仍由 `chat-service` 管理。
4. 下一步：删除入口中的已迁移聊天分支，再拆分规划 action handler。
5. 再将 `chat-service`、`planner-service` 中的 UI 回调收敛到 controller 层。
6. 最后将全局 `state` 物理拆分为领域 slice，并为每个 slice 建立最小测试。
