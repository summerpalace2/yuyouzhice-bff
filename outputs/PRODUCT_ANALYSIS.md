# 渝游智策｜PRD + 高德接口分析摘要

## 产品主线

表达需求 → 解析结构化旅行约束 → 用户确认/修改 → 检索可信重庆知识 → 生成结构化 TripPlan → 查看推荐依据与 Citation → 进入景点详情 → 只替换不满意的 Stop → 确认是否形成长期偏好 → 保存旅行 → 登录后返回原规划 → 我的行程 → 第二次规划复用已确认偏好。

## P0 页面

1. Home：解释产品不是普通攻略生成器，承接 Golden Demo 示例需求。
2. AI Planning：承载自然语言、Slots、规划阶段、TripPlan、Fact/Citation、地图、保存。
3. Attraction Detail：帮助判断景点是否适合本次旅行，并支持加入/替换。
4. Login/Register：仅在保存、我的行程、长期偏好等需要账号的场景触发。
5. My Trips：只展示真实账号行程，支持继续规划、删除、导出 PDF。
6. Admin Console：与游客端分离，作为技术可信度补充。

## 接口到 UI

| UI 数据 | 高德能力 |
|---|---|
| POI 名称、ID、坐标、入口/出口 | `/v5/place/text` + `/v5/place/detail`，重点使用 `show_fields=navi` |
| 景点名/地址定位 | `/v3/geocode/geo` |
| 坐标转地址与周边 POI | `/v3/geocode/regeo` |
| 步行距离、耗时、step、walk_type、polyline | `/v5/direction/walking`，重点使用 `show_fields=cost,navi,polyline` |
| 公共交通路线 | `/v5/direction/transit/integrated` |
| 输入酒店/地铁站/景点 | `/v3/assistant/inputtips` |
| 动态天气 | `/v3/weather/weatherInfo` |

## 设计原则

- 推荐理由是 AI 决策解释，不能伪装成官方事实。
- 事实状态必须可见：UNKNOWN 不得渲染成免费；STALE 不得当当前信息；CONFLICT 不得静默选值；DYNAMIC 必须提醒实时确认。
- 局部 Replan 的输出必须包含替换原因、变更段、保持不变的 Stop、版本差异与引用。
- 长期偏好只有在用户明确选择“记住”时写入；“仅本次”不能形成永久画像。
