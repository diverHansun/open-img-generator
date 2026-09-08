# 收藏图应用内持久化（remote → managed pin）

> 状态：Improve 1 已实施；自动化与 Electron E2E 复检通过
>
> 日期：2026-09-07
>
> 代码基线：`main@22a757c`

## 目标

让「收藏」重新表示**应用拥有这张图的字节**。用户点收藏后，应用内 Gallery / 预览必须能一直打开该图；下载或转存失败时回滚红心，并给出「这张已经存不了了」一类诚实说明。不另建收藏目录当真相来源。

设置页展示逻辑相对位置 `images/`（以应用数据目录为基准）：桌面版提供打开按钮；Web 版不返回主机绝对路径。

## 轮次地图

| 轮次 | 开启日期 | 触发事件 | 状态 | 文档 |
|------|----------|----------|------|------|
| Improve 1 | 2026-09-07 | 首轮规划 | 已实施并复检 | [improve-1](./improve-1/README.md) |

本议题只有一轮。实施若分多次会话，用 improve-1 的 Stage 划分，不预开 `improve-2/`。

## 范围

**本轮 in-scope**

- 收藏时把仍存活的 `remote` 图片钉成 `managed`（复用现有 `downloadAndStore` 与校验）
- 字节未落地则收藏失败：回滚乐观红心，映射已有 `StorageError` / 不可用原因到用户文案
- 已有 remote 收藏：不在 cleanup 或打开 Gallery 时隐式下载；仍有远程链接时由用户点「保存到本地」补钉，已失去链接时保留红心并标示「原图已删除或丢失」
- 后端下载失败时，浏览器尽力回传字节再落盘（CORS 失败则诚实失败）；不做代理系统
- Web 设置展示逻辑相对路径 `images/`；桌面版打开实际存储根（已有打开数据目录能力，本轮对准存储根并补文案）
- 生成、详情、Gallery 共用工作区顶部提示卡片：从上向下堆叠，统一停留 3 秒；保存期间保留按钮 pending 状态
- 收藏成功后不再顺带触发浏览器下载到系统「下载」文件夹（下载 icon 仍常驻）

**本轮 out-of-scope**

- 未收藏 remote 图后台自动全量落盘
- 单独的用户可编辑「收藏文件夹」作为权威存储
- 导出人类可读文件名副本
- 补全各 Provider `remoteTtlMs` 与过期倒计时 UI
- 视频收藏钉盘
- 通用代理 / Fake-IP / Clash 网络修复

## 文档地图（Improve 1）

| 文件 | 作用 |
|------|------|
| [00-discussion.md](./improve-1/00-discussion.md) | 已确认决策与边界 |
| [01-problem-analysis-and-current-state.md](./improve-1/01-problem-analysis-and-current-state.md) | 现状诊断 |
| [02-optimization-plan-and-change-scope.md](./improve-1/02-optimization-plan-and-change-scope.md) | 后续开发会话的执行契约 |
| 03 | **跳过**：无外部参考项目 |
| [04-test-and-acceptance.md](./improve-1/04-test-and-acceptance.md) | 测试与验收契约 |
| [05-implementation-acceptance.md](./improve-1/05-implementation-acceptance.md) | 实施结果、自动化与 Electron 验收记录 |

## 实施记录

实现按 `02` 的两个 Stage 在同一轮完成，并按 `04` 补齐单元、契约、集成、构建、桌面打包与 Electron 手工验收；结果见 `05`。

## 与既有议题的关系

本轮**修正** [2026-07-21-web-remote-media-delivery](../2026-07-21-web-remote-media-delivery/README.md) 中「收藏 = 浏览器下载、应用不保证能再展示」的语义。远程预览（未收藏 URL 图 302 到 CDN）保留；收藏路径必须落到受管存储。该议题 Improve 1 文档已预告：若要求「收藏后应用内永远能显示原图」，必须恢复受管落盘。
