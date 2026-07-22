# Web 远程图片预览、浏览器下载与收藏语义

> 状态：Improve 1 方案待用户审查；尚未实施
>
> 日期：2026-07-21
>
> 代码基线：`mvp@f0adcc6`

## 目标

在当前 Next.js Web 产品中，把“应用展示图片”和“应用替用户保存图片字节”拆开：Provider 返回远程图片 URL 时，应用保存受控的远程引用，通过浏览器网络栈展示缩略图和大图；用户点击下载，或每次从未收藏切换为收藏时，由浏览器发起下载。Provider 返回 Base64/Data URL 时仍由后端安全落盘，形成一个明确的混合交付模型。

这样可以绕开 Node 媒体转存受到本机、路由器 Fake-IP、Clash/Nikki/Shadowsocks 代理路径差异影响的问题，同时不把 API Key 或 Provider 生成请求下放到浏览器。

## 批次

| 批次 | 目标 | 状态 | 文档 |
|---|---|---|---|
| Improve 1 | Web 图片远程预览、浏览器下载、收藏触发下载、远程过期墓碑和本地图片兼容 | 已实施；浏览器视觉回归待手工确认 | [improve-1](./improve-1/README.md) |
| Improve 2 | Electron/Chromium App 受管下载、视频远程交付、下载完成回执 | 未设计 | 后续另行讨论 |

## 核心边界

- Provider submit/poll、鉴权、错误归一化继续运行在服务端；浏览器不直接持有 API Key，也不直接发起生图请求。
- 只有 Provider 返回的媒体下载与预览改用浏览器网络栈；这不是把整个 Provider adapter 移到浏览器。
- URL 图片不再因为 Node 下载失败而把已经成功的 Provider 生成判为失败。
- Base64/Data URL 没有可供浏览器导航的远程地址，继续写入应用受管目录。
- Web 不能证明用户没有取消、文件已经写入磁盘或其保存路径，因此不持久化下载状态：下载 icon 对可用图片始终显示，用户可随时重复下载。
- 本批只处理图片。视频、图片编辑、多图融合、Electron 下载管理器和通用代理系统不在范围内。

## 与现有文档的关系

- 本文档对“所有 Provider URL 必须立即转存到本地后 job 才能完成”的旧约束提出后续变更；实施完成后必须同步更新 `docs/mvp/storage/`、`docs/mvp/job-engine/`、`docs/mvp/api/` 和相关 README。
- `2026-07-20-generation-pipeline-resilience/improve-5` 中模型标识修正、Provider 媒体域名规格与安全诊断仍有价值；其中“远程 URL 转存失败进入 `storage_blocked` 并只重试保存”的部分，应先与本批重新协调，不可原样实施。
- 现有本地图片和收藏不做破坏性迁移；它们继续由应用管理并遵循已确认的保留策略。

## 阅读顺序

按 `README → 00 → 01 → 02 → 03 → 04` 阅读。`02` 是后续实现契约，`04` 是测试与验收契约。
