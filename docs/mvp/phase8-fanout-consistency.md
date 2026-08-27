# Phase 8 · 跨模块一致性检查（fan-out + web-ui）

> 日期: 2026-07-15
> 范围: job-engine ↔ providers ↔ web-ui ↔ api/constraints ↔ db

## 检查结果

| 检查项 | 结果 | 说明 |
|--------|------|------|
| 数据流衔接 | OK | web-ui → API `targets[]` → job-engine → providers NormalizedRequest；GET 轮询推进多 job |
| 职责不重叠 | OK | 扇出=job-engine；映射=providers；交集 UX=web-ui；持久化=db/storage |
| 公开宽高比 | OK | providers capabilities 声明公开比；adapter 映射；UI/校验共用字符串 |
| seed 规则 | OK | 只有全部 targets 支持时 UI 才显示；服务端收到部分支持的 Seed 时整单 400，避免静默部分生效 |
| negativePrompt | OK | UI 仅全部支持时显示；服务端任一不支持且有值 → 400 |
| 假参数 | OK | web-ui Non-Duty：无 capabilities 字段不渲染 Guidance/Steps/Quality/Safety |
| 状态聚合 | OK | constraints §8 与 db/data-model、job-engine 对齐（部分成功 → completed） |
| 轮询互斥 | OK | constraints §4 与 job-engine architecture 对齐（独立 `pollLeaseUntil`，不覆盖真实 status） |
| Breaking API | OK | quickstart/constraints/dfd 均以 `targets[]` 为准 |
| schema | OK | db 已支持 1:N；文档已去掉「MVP 只写一行」 |

## 已修正冲突

1. `db/data-model.md` 旧聚合「任一 failed → generation failed」→ 改为引用 constraints §8
2. `db/data-model.md`「MVP 每次只写一行」→ 改为 N jobs
3. job-engine goals Goal #5 措辞与 seed 省略规则对齐
4. brainstorm spec 标记为 superseded，以免 Codex 读错源
5. improve-1 将默认选择收紧为单模型，并把 Seed 从“部分生效”收紧为 capability 交集

## 实施顺序建议（给 Codex）

1. providers: fal `supportedAspectRatios` + 映射表 + 测试
2. job-engine: types `targets[]`、validator、orchestrator 扇出、聚合、锁收紧、测试
3. API routes 对齐 + constraints/quickstart 已更新
4. web-ui: capabilities-ui 纯函数 → Workbench → 接线

## 残余假设（可接受）

- fal∩zenmux 公开比目前实质为 `1:1`（文档已提示）
- POST 对多 sync target 可能较慢（localhost MVP）
- 顶层 `provider`/`model` 兼容 shim 可选，非契约要求
