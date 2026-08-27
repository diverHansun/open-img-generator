# 代理兼容与同步生图超时改造 · improve-2

> 状态：已实施并完成自动化与授权 live E2E；开发服务已交接为运行中。
> 日期：2026-07-20
> 前置批次：[improve-1](../improve-1/README.md)

## 目标

在不关闭远端图片 SSRF 防护、也不改变「提交结果未知时不盲重试」语义的前提下：

1. 让已明确配置的媒体主机能在本机 TUN/透明代理把它解析到 `198.18.0.0/15` 时安全转存；代理关闭、解析为公网地址时继续走默认安全路径。
2. 将所有**同步图片生成** Provider 的单次生成响应等待上限统一为三分钟；异步 Provider 的快速 submit、poll、取消与图片下载预算保持原有职责和数值。
3. 提供不泄漏 prompt、密钥或签名 URL 的运行诊断，并完成真实 Provider 浏览器验收后保持服务运行，交给用户继续手工测试。

## 范围

### In scope

- `src/lib/storage/image-url-policy.ts` 的精确媒体主机 + 代理映射地址例外。
- ZenMux、SiliconFlow、智谱、豆包的同步图片生成请求三分钟 timeout。
- 配置解析、`.env.example`、README 和 storage/providers/job-engine 权威文档同步。
- 对应 unit、integration、typecheck、release 门禁以及一次用户授权的 live browser E2E。

### Out of scope

- 全局开启 `ALLOW_PRIVATE_IMAGE_URLS`，通配符/后缀白名单，或任意私网例外。
- 更换 fal 或 ZenMux SDK、引入新队列/worker/代理服务、自动真实 Provider E2E/CI。
- 修改异步 Provider 的 submit、poll、cancel 或图片下载 timeout；它们不承担同步生成的同一等待语义。
- 恢复既有 `outcome_unknown` Job，或自动重投它们。

## 文档地图

| 顺序 | 文档 | 用途 |
|---|---|---|
| 1 | `00-discussion.md` | 已确认决策与交付约束 |
| 2 | `01-problem-analysis-and-current-state.md` | 基线、证据和风险 |
| 3 | `02-optimization-plan-and-change-scope.md` | 后续实施会话的执行契约 |
| 4 | `03-reference-projects.md` | 官方 API/SDK 调研及取舍 |
| 5 | `04-test-and-acceptance.md` | 测试、live E2E 与交接门槛 |

## 实施批次

| 批次 | 主题 | 独立完成定义 |
|---|---|---|
| P1 | 代理映射安全例外 | 默认拒绝不变；仅精确主机 + 全部 `198.18/15` DNS 结果可通过；单元/存储集成测试通过 |
| P2 | 同步生图三分钟预算 | 四个 sync adapter 传递同一有界 180 秒预算；async 流程不变；相关测试通过 |
| P3 | 文档、回归与 live 验收 | 全部门禁、真实浏览器单模型 flow、服务保持运行；用户接手手测 |

## 实施与验收闸门

本目录保留实施契约及执行记录。P1→P3 已按顺序完成并通过自动化回归；当前工作区仍含用户已有的 Gallery/locale 未提交改动，后续生成链路 commit 必须与其隔离。

## 本次执行记录

- P1：精确 host + 全 DNS answer `198.18.0.0/15` 的透明代理例外已实现，redirect 每跳继续复核；不使用全局 private-address bypass。
- P2：四个 sync adapter 统一使用 180 秒上限；fal/Qwen/Kling 的 async submit/poll 默认预算保持不变，已由 unit tests 断言。
- P3：已执行 typecheck、unit、contract、integration、smoke 与 `git diff --check`；用户授权下的 ZenMux 和 fal 单模型/单图浏览器流均完成并可读取落盘图片。fal live flow 使用当前私有 `.env` 中的 `TRUSTED_PROXY_IMAGE_HOSTS=v3b.fal.media`。
- 当前 `npm run dev` 保持在 `http://localhost:3000` 运行，供后续人工验证。关闭代理时的真实网络切换不由本次自动化更改用户代理状态；默认公网 DNS 分支由注入 resolver 的测试覆盖，建议由操作者在切换后手测一次。
