# 内联优先、图片保留期与历史墓碑改造 · improve-3

> 状态：用户已确认方案，正在独立实施分支执行
>
> 日期：2026-07-21
>
> 代码基线：`6c0714d`
>
> 前置批次：[improve-2](../improve-2/README.md)

## 目标

面向本机单实例、单用户产品，在不引入通用代理发现/路由系统的前提下：

1. Provider 官方接口可直接返回 Base64 时优先请求内联结果，减少对临时 CDN、DNS fake-IP 和代理配置的依赖。
2. URL-only Provider 仍在任务完成后立即安全转存；不把远端临时 URL 当作历史资产。
3. 未收藏图片默认保留 7 天并允许用户配置更长时间；收藏图片持续保留，直到用户主动删除。
4. 下载/导出只产生用户控制的外部副本，不延长应用内部图片的 7 天保留期。
5. 清理只移除图片文件，不抹掉任务、提示词、Provider 错误、生成记录和图片历史身份；历史界面明确显示“图片已过期清理”或“图片已删除”。
6. 当前 Web/Node 版本保持最小网络兼容；未来 App 优先复用宿主系统网络栈，不建设代理自动发现框架。

## 范围

### In scope

- ZenMux 保持 Base64/URL 双解析；豆包请求从 `url` 切换为 `b64_json`，并保留 URL 响应兼容。
- fal、SiliconFlow、智谱、通义千问、可灵继续使用 URL 转存；不改变各自同步/异步生命周期。
- `images` 从“文件存在即记录存在”改为可表达 `available`、`retention_expired`、`user_deleted`、`storage_missing` 的历史墓碑模型。
- schema v4 迁移、清理竞态、图片读取/下载/删除 API、Generation/History DTO 与界面状态。
- `IMAGE_RETENTION_DAYS` 默认值由 30 改为 7，支持合法非负整数；`0` 关闭自动清理。
- 标准浏览器下载与 App 未来原生“另存为”边界说明。
- storage、db、library、API、web-client、UI、i18n 和权威文档同步。

### Out of scope

- 自动扫描 Clash/Shadowsocks 端口、自动识别 HTTP/SOCKS/PAC、代理故障转移或自研网络路由层。
- 在尚未选择 App 宿主技术前实现 Electron/Tauri 专属网络代码或原生保存对话框。
- 把 Base64 原文写入 SQLite，或把 Provider SDK 当作改变厂商返回契约的手段。
- 将 fal 改成 `sync_mode=true`、改变其 queue/poll/restart recovery 语义，或牺牲 Provider request history 换取内联结果。
- 回收站、云同步、下载历史、访问时间续期、按 Provider 设置不同本地保留期、复杂磁盘配额系统。
- 本批不实现 Generation/Job/Prompt/Provider error 的整条历史删除；用户主动的 Generation 聚合硬删除由 [Provider 等待与 Generation 历史删除 improve-1](../../2026-07-20-provider-wait-and-history-delete/improve-1/README.md) 单独规划。该动作不属于 retention 或单图删除。

## 文档地图

| 顺序 | 文档 | 用途 |
|---|---|---|
| 1 | [00-discussion.md](./00-discussion.md) | 冻结用户已确认的产品与技术边界 |
| 2 | [01-problem-analysis-and-current-state.md](./01-problem-analysis-and-current-state.md) | 当前代码、数据流、Provider 能力和问题证据 |
| 3 | [02-optimization-plan-and-change-scope.md](./02-optimization-plan-and-change-scope.md) | 后续实施会话的执行契约、迁移与回滚 |
| 4 | [03-reference-projects.md](./03-reference-projects.md) | Provider 官方返回方式/URL 生命周期与取舍依据 |
| 5 | [04-test-and-acceptance.md](./04-test-and-acceptance.md) | 风险导向的自动化、迁移、浏览器验收与发布门 |

## 建议实施纵切

| Phase | 主题 | 独立完成定义 |
|---|---|---|
| P1 | Provider 内联优先 | 豆包请求 Base64、ZenMux 保持双解析；URL-only Provider 生命周期不变；adapter/HTTP 上限测试通过 |
| P2 | 图片墓碑与 schema v4 | 迁移不丢现有图片/收藏；可用、过期、主动删除、文件缺失语义可被 DB 与 API 区分 |
| P3 | 7 天清理与删除/下载 | 清理原子守护收藏；只移除文件并留墓碑；下载不续期；主动删除可幂等 |
| P4 | History/Generation/UI 与回归 | 过期/删除占位准确，计数不降为零；全门禁和受控浏览器流程通过；权威文档同步 |

## 实施契约

本目录只定义为何改、改什么、怎样验。代码实施发生在用户审查通过后的独立实施会话，并按 [02](./02-optimization-plan-and-change-scope.md) 与 [04](./04-test-and-acceptance.md) 执行。不得把当前工作区中无关的未跟踪/未提交文件混入本批提交。

## 核心架构决策摘要

- 远端 URL 有效期是**转存截止时间**，本地 7 天是**产品保留策略**；两者解耦。
- SQLite 保存轻量历史元数据，本机文件系统保存图片字节；Base64 只在受限响应与 staging 中短暂存在。
- 图片文件被清理后保留 tombstone，避免把“已完成后过期”误报成“Provider 未返回图片”。
- 系统网络栈是未来 App 的宿主能力目标，不反向要求当前 Node 服务实现一套跨代理产品。
