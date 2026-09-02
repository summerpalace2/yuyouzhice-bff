# 渝游智策｜P0 Stitch UI 资源包

本资源包来自 Stitch 项目 `13401971643263082423`，设计事实只依据用户提供的《渝游智策 PRD V1.0》和《高德 Web Service API｜渝游智策接口目录》整理。

## 设计基线

- 视觉：暖白纸张背景、深墨文字、重庆红主色、旅行杂志式编辑布局、克制的 AI 感。
- 主要字体：Noto Serif（标题）+ Hanken Grotesk（正文/标签）。
- 主要交互：结构化约束、结构化 TripPlan、推荐理由、Fact/Citation、局部 Replan、Memory Proposal、匿名规划、Save → Login → Return、My Trips。

## 屏幕清单

| 文件 | 用途 |
|---|---|
| `home.png` / `home.html` | Home：首页价值表达与 Golden Demo 需求输入 |
| `planning.png` / `planning.html` | AI Planning：约束、Day/Stop、地图、引用、保存 |
| `attraction-detail.png` / `attraction-detail.html` | Attraction Detail：个性化判断、路线、事实状态、引用 |
| `replan-memory.png` / `replan-memory.html` | Local Replan + Memory Proposal：只替换一个 Stop 并询问记忆 |
| `login-save.png` | Save → Login → Return：登录失败保留草稿、登录成功返回保存 |
| `my-trips.png` | My Trips：真实账号行程管理，不展示 Demo Trip |
| `states.png` / `states.html` | Loading / Partial Data / Conflict / Service Unavailable 状态 |
| `attraction-hero.png` | 洪崖洞详情页使用的 Stitch 视觉资产 |

## 高德接口绑定提示

P0 设计中对应的接口能力：

- POI：`/v5/place/text`、`/v5/place/detail`
- 地址：`/v3/geocode/geo`、`/v3/geocode/regeo`
- 路线：`/v5/direction/walking`、`/v5/direction/transit/integrated`
- 输入：`/v3/assistant/inputtips`
- 动态信息：`/v3/weather/weatherInfo`

界面中的 `UNKNOWN`、`DYNAMIC`、`CONFLICT` 必须按状态渲染，不能把未知事实显示为“免费”或当前有效信息。

## 注意

HTML 是 Stitch 生成的页面资源，适合作为前端实现基线和视觉参考；真实产品仍需绑定现有后端/认证/TripPlan/Citation 数据契约。临时导出地址未写入本 README，避免资源过期后误用。
