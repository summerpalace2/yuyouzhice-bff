# 渝游智策 Android 实现交接与工程约束

> 本文是 Android 项目的实施契约。未在本文允许的架构调整，先写 ADR 并评审；不能以“还原页面”为理由复制 Java 业务逻辑。

## 1. 技术栈冻结

| 项目 | 约束 |
| --- | --- |
| 语言 / JDK | Kotlin；JDK 17 |
| SDK | `minSdk 26`；`targetSdk` / `compileSdk` 固定为 Android Studio 当前稳定 API，升级需单独变更记录 |
| UI | Jetpack Compose + Material 3；禁止新建 XML 页面或 Fragment 导航 |
| 导航 | Navigation 3 stable（当前基线 `1.1.6`）；禁止并存 Navigation 2、Fragment NavController 或第二套手写路由 |
| DI | Hilt + KSP；禁止 Service Locator 和在 Composable 中手动创建 Repository |
| 网络 | Retrofit + OkHttp + Kotlinx Serialization；SSE 使用单独的可取消流式客户端 |
| 异步 | Kotlin Coroutines + Flow；禁止 `GlobalScope`、阻塞式网络和在 ViewModel 外保存业务协程 |
| 本地 | DataStore 保存轻量设置/草稿；Room 仅保存可失效只读缓存；JWT 使用 Android Keystore 加密封装 |
| 地图 | 高德 Android SDK 通过 `AndroidView` 封装；Android Key 仅由本机配置/CI Secret 提供 |
| 图片 | Coil Compose；统一占位、错误和缓存策略 |
| 测试 | JUnit、Turbine、MockWebServer、Compose UI Test；关键页面增加截图测试；规划列表与地图启动加入 Macrobenchmark |

版本统一从 `gradle/libs.versions.toml` 提供；任何模块不得写依赖版本号。Compose 库使用 BOM，插件版本由 `build-logic` 统一施加。Navigation 3 的 back stack 由应用显式拥有，正符合其 Compose-first、可控 back stack 的设计。[官方 Navigation 3 指南](https://developer.android.com/guide/navigation/navigation-3) [官方发布说明](https://developer.android.com/jetpack/androidx/releases/navigation3)

## 2. Gradle 多模块结构

```text
:app                         # Application、根 NavDisplay、DI 装配、启动与 deep link
:build-logic                 # Convention plugins（included build）
:core:common                 # Result、错误、dispatcher、日志脱敏、时间
:core:model                  # 纯 Kotlin 领域模型、ID value class、Route key
:core:network                # Retrofit/OkHttp、认证/SSE/错误映射，不能含业务 Repository
:core:datastore              # 加密 token、用户设置、游客 ID、草稿
:core:database               # Room 只读缓存
:core:designsystem           # Theme、颜色、字体、组件、图标、预览
:core:ui                     # 通用 Loading/Error/Empty、可访问性与弹窗基元
:core:navigation             # Navigation 3 route、Navigator、deep link 声明
:core:testing                # fake、test dispatcher、fixture、测试规则
:api:auth                    # AuthRepository 接口和对外 DTO/UseCase
:api:planner                 # PlannerRepository、PlannerSessionStore、行程调整契约
:api:trip                    # TripRepository、PDF 导出契约
:api:catalog                 # 景点/地图事实读取契约
:api:profile                 # 偏好、记忆、反馈、历史读取契约
:data:auth / :data:planner / :data:trip / :data:catalog / :data:profile
                              # Retrofit + cache 实现，只向对应 :api 提供绑定
:feature:guestchat
:feature:auth
:feature:home
:feature:planner
:feature:trips
:feature:explore
:feature:history
:feature:profile
```

粒度规则：第一期按业务域拆模块，不把每一个 UI 组件拆成独立 Gradle 模块。官方多模块指南也明确指出：模块过细会增加构建和样板成本，过粗又会退化成单体。[官方模块化指南](https://developer.android.com/topic/modularization)

### 2.1 依赖方向（硬规则）

```text
feature:* ───────► api:* ───────► core:model / core:common
    │                 ▲
    ├──────────────► core:ui / core:designsystem / core:navigation
    │
data:* ───────────► api:* + core:network / core:database / core:datastore
app ──────────────► feature:* + data:*（仅负责 Hilt 装配）
```

- `feature` 之间禁止互相依赖、禁止直接访问 Retrofit、Room、DataStore 或具体 `data:*`。
- `api:*` 必须是纯 Kotlin 公共契约，不依赖 Android View、Compose、Retrofit、Hilt 或某个 feature。
- `data:*` 实现 `api:*` 的接口，通过 Hilt `@Binds` 注入；不能向 UI 发事件。
- 跨模块只传稳定的 ID、不可变 model、明确 command/result；禁止传 `ViewModel`、`NavController`、`Context`、可变列表或页面 lambda。
- 跨 feature 跳转只调用 `Navigator.navigate(AppRoute)`；结果通过 `SavedStateHandle` 的强类型 result key 或对应 `api:*` 的共享会话状态返回，不能直接回调另一个 Feature 的 ViewModel。

## 3. Convention Plugin 规范

`build-logic` 必须提供且只允许使用下列插件：

| 插件 | 使用模块 | 强制内容 |
| --- | --- | --- |
| `yuyou.android.application` | `:app` | SDK、签名占位、Compose、baseline profile |
| `yuyou.android.library` | Android core/data/feature | Kotlin/JDK、lint、test options |
| `yuyou.kotlin.library` | `:api:*`、`core:model`、`core:common` | JVM 17、显式 API、detekt |
| `yuyou.android.compose` | 含 Compose 的模块 | Compose BOM、compiler plugin、Material 3、debug preview |
| `yuyou.android.feature` | 所有 feature | Android library + Compose + Hilt + navigation API |
| `yuyou.android.hilt` | app/data/需要 ViewModel 的 feature | KSP、Hilt 测试配置 |
| `yuyou.android.test` | 所有 Android 模块 | unit/UI test、test fixtures、coverage |

CI 必须执行 `assembleDebug`、`lintDebug`、模块单测、关键 Compose UI 测试；PR 禁止通过临时关闭 lint、`allowBackup` 或跳过测试来规避失败。

## 4. Navigation 3 封装

```kotlin
@Serializable sealed interface AppRoute : NavKey {
  @Serializable data object GuestChat : AppRoute
  @Serializable data object Home : AppRoute
  @Serializable data class Planner(val plannerSessionId: String) : AppRoute
  @Serializable data class SavedTrip(val tripId: String) : AppRoute
  @Serializable data class Attraction(val attractionId: String, val source: String) : AppRoute
  @Serializable data object Profile : AppRoute
}
```

- 根 `AppNavigationState` 是唯一 back stack owner；只存可序列化 route key，绝不在 route 放完整行程、JWT、聊天正文或 `sessionAccessToken`。
- `NavDisplay` 只在 `:app` 根层创建；Feature 只注册 destination content，不直接持有 root stack。
- 规划页在手机显示单目的地；平板通过 Navigation 3 scene/adaptive layout 同时展示行程和聊天/详情，但仍使用同一份 route key 和会话状态。
- 登录成功将游客草稿迁移到 `Home` 或 `Planner`，并清除 Auth route；返回键不会回到密码表单。
- 对话抽屉、反馈来信、调整预览属于 UI overlay，不进入正式 URL/deep link；地图全屏可使用独立 overlay key，关闭时回到原行程状态。

## 5. Compose 状态与事件规则

### 5.1 状态归属

- Screen ViewModel 持有业务 `StateFlow<ScreenUiState>`，公开不可变状态和语义化 `onEvent(event)`。
- Composable 只接收 `state`、`onEvent`、必要的 slot；禁止向下传 `ViewModel`。
- 文本展开、短动画、单组件焦点等未共享 UI element state 可以保留在 `rememberSaveable`；跨多个组件的列表滚动、景点多选、聊天输入提升到最低共同父级；业务数据提升到 ViewModel。
- 使用“状态向下、事件向上”的单向数据流；这是 Compose 推荐的 state hoisting 方式。[官方状态提升指南](https://developer.android.com/develop/ui/compose/state-hoisting)
- `SavedStateHandle` 仅存 route ID、筛选条件、草稿、选中 ID、滚动锚点等小数据；数据库/网络数据通过 repository 重建。

### 5.2 推荐模板

```text
FeatureScreen
  └─ FeatureRoute(viewModel)             # collectAsStateWithLifecycle + effect collector
       └─ FeatureScreen(state, onEvent)  # 尽量无状态、可预览
            └─ component(value, onValueChange / semantic callback)

ViewModel: Event -> reducer -> repository/use case -> immutable UiState
```

- Loading、Error、Content、Empty 使用封闭状态或明确字段，禁止用多个互相矛盾的 Boolean。
- 一次性导航、Toast、下载通知使用带 `eventId` 的 effect 流；屏幕重建不得重复消费。
- SSE 消息按 `chatThreadId` 归属；新发言、切换行程、退出账号、ViewModel 清除时必须取消前一条 job。禁止共享一个“全局聊天 Flow”。
- 乐观更新仅适用于可恢复动作（例如管理员停用不在 Android 一期）；正式行程更新必须等待 Java 返回的 `currentVersion`。

## 6. 网络、鉴权与数据策略

### 6.1 客户端请求层

- `CoreApiClient` 只连接 `CORE_BASE_URL`，生产必须 HTTPS。debug emulator 使用 `10.0.2.2`，真机使用明确的局域网/测试环境地址；禁止把 `localhost` 写入 release。
- `AuthInterceptor` 只从加密 TokenStore 读取 JWT，`401` 由统一 session coordinator 处理：取消账户请求、清本地私有缓存、导航至登录页。
- `PlannerSessionInterceptor` 仅为需要的请求加入 `X-Plan-Session-Token`；它不能替代 JWT，也不能输出到日志。
- 所有响应映射为 `AppResult.Success / HttpError / NetworkError / Timeout / SerializationError`；UI 不读取 Retrofit exception 文本。
- POST 规划、保存、确认调整携带稳定 idempotency key；冲突（409）展示“行程已在其他设备更新，刷新后再试”。

### 6.2 缓存与同步

- Java 是账号、行程、偏好、记忆和版本的唯一事实源；Room 只保存带 `updatedAt/version` 的只读快照。
- DataStore：游客 ID、是否展示过引导、未提交输入草稿、非敏感 UI 设置。
- TokenStore：Keystore 加密的 JWT；不能放 DataStore 明文、Bundle、截图日志或 Crash tag。
- 网络不可用时，只允许展示标记为“上次同步”的数据；天气/路线/AI 回答必须显示不可用或待核验，不能使用伪造结果。

## 7. 地图、手势与自定义 View

### 7.1 地图适配

- 通过 `AndroidView` 包装单一 `MapView`，由 `MapController` 负责生命周期、marker、polyline、info window 和资源释放。
- 每次切换日期或关闭全屏地图先按 route/session 清理旧 overlay；弹窗容器必须高于地图 View，避免 SDK logo/控件盖住确认框。
- 位置权限不作为第一期前置条件；“到这去”使用高德 URI 拉起外部导航，未安装时打开官方网页回退。

### 7.2 事件分发硬规则

- 普通点击、长按、列表滑动优先 Compose `clickable`、`combinedClickable`、`scrollable`，禁止为普通按钮手写 `pointerInput`。
- 只有地图、复杂 Canvas 路径或第三方 SDK 必须使用 View 时才创建 Custom View；一个自定义手势类只负责一种语义（如拖拽或缩放），不混合业务写入。
- `ACTION_DOWN` 确认接管后，后续 `MOVE/UP/CANCEL` 必须完整消费并在 `CANCEL` 清理 active pointer、velocity tracker、动画和临时状态；不得在消费 DOWN 后返回 false。
- 多指交互维护 active pointer ID；越过 touch slop 后才声明拖动；使用 `VelocityTracker` 判定 fling；与滚动容器冲突时遵循 nested scrolling，不通过父 View 的强制拦截抢事件。
- 所有手势状态可单测：down、slop 前 move、drag、pointer up、cancel、快速 fling、父容器滚动冲突。

Android 自定义 View 交互应通过 `onTouchEvent` 与 `GestureDetector` 解释原始触摸；官方文档也强调手势以 `onDown()` 开始，并需处理未识别事件。[官方交互自定义 View 指南](https://developer.android.com/develop/ui/views/layout/custom-views/making-interactive)

## 8. 实施顺序与门禁

1. **契约门禁**：Java 补齐 `/ai/profile`、`/ai/profile/memory-settings`、`/ai/feedback`、workspace 与 OpenAPI；用 MockWebServer 契约测试验证。
2. **工程门禁**：创建空多模块、convention plugins、design system、网络/鉴权/错误映射和 Navigation 3 根框架。
3. **P1 主链**：游客聊天 → 登录注册 → AI 规划 → 规划工作区 → 局部调整预览/确认 → 保存 → 我的行程/PDF。
4. **P2 个性化**：探索、详情、历史、旅行档案、长期旅行记忆、反馈来信。
5. **P3 质量**：平板自适应、地图资源治理、截图回归、无障碍、性能基线和断网恢复。

每一阶段均需：API 契约测试、ViewModel 状态测试、关键 Compose UI 测试、真机/模拟器手工验收。未补齐 Java 契约前不得以 BFF 作为 Android 长期依赖来绕过问题。
