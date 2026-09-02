# 渝游智策｜P0 UI Coverage Inventory

## Golden Demo 主链

Home → AI Planning → Constraint Review → TripPlan → Attraction Detail → Local Replan → Memory Proposal → Save → Login / Register → Return → My Trips → 第二次规划复用偏好。

## Coverage

| 能力 | 资源 | 关键状态/行为 |
|---|---|---|
| Home | `home.*` | 开始 AI 规划、示例需求、用户入口 |
| AI Planning | `planning.*` | Slots 与自然语言一致、Day/Stop 结构化、推荐理由、地图、Citation、保存 |
| Attraction Detail | `attraction-detail.*` | 图片、适配当前用户、访问信息、路线、Fact 状态、Citation、加入/替换 |
| Local Replan | `replan-memory.*` | 原因选择、只影响目标 Stop、变更摘要、保持不变列表、版本差异 |
| Memory Proposal | `replan-memory.*` | “记住”/“仅本次”，明确用户授权 |
| Save → Login → Return | `login-save.png` | 登录/注册、失败不丢草稿、成功返回并自动保存 |
| My Trips | `my-trips.png` | 真实保存行程、继续规划、PDF、删除、无 Demo 数据 |
| Loading / Partial / Conflict / Unavailable | `states.*` | 阶段式加载、UNKNOWN、DYNAMIC、冲突查看、保留草稿重试 |

## 设计遗漏检查

- 未把模型 Chain of Thought 暴露给用户。
- 未把 UNKNOWN 当作免费或确定事实。
- 未把局部否定扩散成整份 TripPlan 重生成。
- 未把匿名规划强制提前登录。
- 未让登录失败导致当前旅行草稿消失。
- 未使用“Image binding pending”作为完成结果。

## 实现时的状态源

自然语言、Constraint Chips、Planning Context 与 Backend Planning State 必须绑定同一个状态源；页面中的 Chip 不是独立的第二套状态。
