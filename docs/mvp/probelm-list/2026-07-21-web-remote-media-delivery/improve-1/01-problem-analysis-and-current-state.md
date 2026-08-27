# 1. 问题分析与现状

## 1.1 调查基线

- 时间：2026-07-21（Asia/Shanghai）
- 分支/提交：`mvp@f0adcc6`
- 数据库 schema manifest：v5
- 应用形态：Next.js 15 + React 19 + Node 服务端 + SQLite，本仓库没有 Electron 运行时依赖
- 当前改动区已有未跟踪的 `generation-pipeline-resilience/improve-5` 文档，本批不覆盖或改写

## 1.2 当前端到端链路

```text
Browser
  │ POST /api/generations
  ▼
job-engine ──submit/poll──> Provider API
  │                            │
  │                       URL / Base64
  ▼                            ▼
resultSnapshot ──storing──> storage.downloadAndStore()
                                  │
                                  ├─ Node fetch + DNS/SSRF guard
                                  ├─ magic/size 校验
                                  └─ data/images 原子落盘
                                           │
                                           ▼
                                     images.storagePath
                                           │
Browser <img> <────────────── /api/images/:id 本地流
```

这里有两个不同的网络阶段：

1. Provider 控制面：服务端提交/轮询生成任务。
2. 媒体数据面：Provider 成功后，服务端再次下载图片。

现有错误多发生在第二阶段，而 UI 把整个任务显示为失败，导致“生成失败”和“后端未能转存已生成图片”混为一谈。

## 1.3 代码事实

### Provider 请求仍是 Node fetch

- `src/lib/providers/http-client.ts` 的 `requestJson()` 使用服务端 `fetch`，负责超时、重定向、响应上限和错误归一化。
- `src/lib/providers/types.ts` 的 `ProviderImageRef` 目前只有 `url`、尺寸、content type 和 index；`url` 同时承载 HTTPS 与 Data URL。
- ZenMux/Gemini 主要返回 inline data；Doubao 可能返回 URL 或 `b64_json`；Fal/Qwen/Zhipu/SiliconFlow/Kling 等通常返回 URL。

结论：Provider 生成控制面已有合理的服务端边界，不应为了媒体下载问题把它移动到浏览器。

### job-engine 强制所有结果进入 storage

- `src/lib/job-engine/lifecycle.ts` 把 Provider 结果写入 `resultSnapshot`，随后进入 `storing`。
- `storeNextImage()` 对每个 `ProviderImageRef` 调用 `storage.downloadAndStore()`。
- 只有所有图片安全落盘并写入 `images` 后 job 才进入 `completed`；任一 URL 因网络/安全策略无法下载，用户就看不到 Provider 已生成的结果。

结论：job 完成条件绑定了“Provider 完成”和“应用取得本地字节”两个事实，这是本次体验问题的直接业务根因。

### storage 的拒绝在安全上是正确的

- `src/lib/storage/index.ts` 的远程下载执行协议限制、DNS 解析、私网/保留地址检查、重定向复检、响应大小与图片 magic 校验。
- 文件先写 `.tmp`，校验成功后才原子移动到 `LOCAL_STORAGE_DIR`，默认实际目录是仓库下 `./data/images`。
- 路由器 Nikki/Mihomo Fake-IP 可能把公网 CDN 解析到 `198.18.0.0/15`；从 SSRF 视角它是保留地址，后端不能在未知主机上绕过检查。

结论：问题不应通过关闭 SSRF、信任所有 Fake-IP 或自动代理路由来解决。若应用根本不需要由 Node 读取远程字节，就应移除这一不必要的网络责任。

### 数据库不能表示“有效远程图片”

`src/lib/db/schema.ts` 当前 `images` 约束只允许两种状态：

```text
live local:
  storagePath != null
  removedAt == null
  removalReason == null

tombstone:
  storagePath == null
  removedAt != null
  removalReason in retention_expired | user_deleted | storage_missing
```

`generation_jobs.resultSnapshot` 的注释把远程引用定义为 storing 期间的短期数据，不是长期图片来源。`favorites` 又必须引用 `images.id`，而 `addFavorite()` 只接受 `storagePath IS NOT NULL` 的图片。因此现有 schema 无法让远程图片成为可预览、可收藏的一等记录。

### API 和 View 只认识本地文件

- `src/lib/job-engine/orchestrator.ts` 的 `toGenerationView()` 对可用图片返回 `/api/images/:id`，对 tombstone 返回 `null`。
- `src/lib/job-engine/types.ts` 与 `src/lib/web-client/types.ts` 的 availability 只有 `available`、`retention_expired`、`user_deleted`、`storage_missing`。
- `src/app/api/images/[id]/route.ts` 只会打开本地文件；缺失时写入 `storage_missing`。
- `src/app/api/images/[id]/download/route.ts` 只会流式返回本地文件，并设置 attachment filename。
- `src/lib/library/images.ts` 以 `storagePath` 为读取前提。

结论：不能只把 Provider URL 塞进前端 DTO。需要先让 image domain、API 和历史/收藏查询认识 remote source，并继续使用稳定的同源 image ID 路由。

### UI 已有预览，但下载位置和状态不符合目标

- `src/components/generate/generate-stage.tsx` 已支持点击缩略图选择 image ID 并打开预览 Dialog。
- `src/components/dialogs/image-preview-dialog.tsx` 已显示大图、收藏按钮和下载链接，但下载是详情下方的文字按钮，不是大图右下角 icon。
- 当前没有下载状态；用户已确认新方案也不需要增加下载状态，icon 应始终可用。
- `src/components/dialogs/generation-detail-dialog.tsx`、`src/components/gallery/gallery-tile.tsx` 和 Gallery 查询都假设收藏图片拥有应用内 URL。

结论：图片放大交互可以复用；需要调整的是 source-aware 数据、icon 布局、收藏副作用与过期占位，不需要增加下载状态机。

## 1.4 当前文档与新目标的冲突

| 主题 | 当前约束 | 新目标 | 冲突 |
|---|---|---|---|
| job 完成 | 所有图片立即安全转存后才 completed | URL 结果持久化远程引用后即可 completed | 完成条件需拆分 |
| 图片事实源 | 应用本地受管文件 | URL 结果以远程来源为主；inline 仍本地 | image 需支持两种 source |
| 收藏 | 收藏图片由应用永久保留字节 | 远程收藏触发浏览器下载，应用永久保留元数据 | “永久保留”含义发生变化 |
| 下载 | 应用流式发送本地附件 | remote 路由交给浏览器/Provider CDN | 文件名与保存提示受 CDN/浏览器控制 |
| 过期 | 未收藏本地图片 7 天清理；收藏不清理 | remote 按 Provider 链接寿命过期，收藏也可能失去预览 | 需新增 remote expired 墓碑 |
| 保存失败 | 整个生成失败或进入 storage recovery 设计 | URL 媒体不再由 Node 保存 | improve-5 部分设计被替代 |

实施后必须同步权威模块文档，避免开发者继续按照旧约束把 URL 强制转存。

## 1.5 根因分层

### 主根因：职责绑定错误

产品把“生成”、“应用内持久化”和“用户下载”视为同一个事务，但三者实际上属于不同系统：Provider、应用 SQLite/文件系统、浏览器/用户文件系统。普通 Web 环境无法让它们原子提交。

### 触发条件：媒体数据面的网络路径不同

浏览器、Node、curl、系统代理、TUN、路由器透明代理和 Fake-IP DNS 不保证走同一网络路径。即使浏览器能打开 CDN，Node 的 DNS 安全预检仍可能看到保留 IP 并拒绝；开启 Shadowsocks 后系统代理端点和 DNS 行为也可能再次改变。它解释了“Codex 进程测试正常、用户浏览器/服务进程异常”以及“开关代理结果不同”。

### 放大因素：错误语义过粗

Provider 已成功与图片转存失败没有分别持久展示；用户只能看到 0 张图片和任务失败，无法判断是否重复生成会产生二次费用。

## 1.6 七个质量维度

| 维度 | 现状 | 问题 | 改进方向 |
|---|---|---|---|
| 正确性 | 本地图片完整性强 | 把媒体转存失败误判为生成失败 | URL 引用持久化即完成；inline 仍校验落盘 |
| 安全性 | Node 下载有严格 SSRF guard | 为兼容代理而放宽 guard 风险高 | Node 不取远程媒体；持久 URL 做 HTTPS/host/长度校验，受控重定向 |
| 可靠性 | 本地文件不依赖远程链接 | 多网络栈导致下载脆弱 | 浏览器负责 remote 数据面；过期状态显式化 |
| 可维护性 | storage 职责清楚 | job-engine 对所有输出采用一种策略 | 用 `sourceKind` 明确分支，不按 Provider 名称散落判断 |
| 可测试性 | storage 下载可 mock | UI 下载完成无法真实观测 | 不建下载状态；只测试入口常驻和导航行为 |
| 可观测性 | 有 request/job 诊断 | 签名 URL 不能安全写日志 | 记录 imageId/source/host hash/expiry/outcome，不记录 raw URL |
| 用户体验 | 可预览、下载、收藏本地图片 | 已生成图片因后端保存失败完全不可见 | 远程立即预览；过期和收藏状态可解释；下载入口无状态常驻 |

## 1.7 影响范围

### 必须修改

- DB schema manifest 与手写 migration
- image queries、favorite queries、retention/cleanup 查询
- job-engine Provider result → image persistence 生命周期
- image read/download API
- generation/history/gallery Web DTO
- preview dialog、favorite flow、remote expiry UI 和 i18n
- safe logging、安全 URL 校验、测试 fixtures
- storage/job-engine/api 权威文档

### 不应修改

- Provider API Key 保存边界
- Provider submit/poll 的服务端 HTTP client
- 现有本地文件 magic/size/atomic write 机制
- 既有本地 image ID、favorite 关系和下载文件
- 通用系统代理、路由器或 DNS 配置

## 1.8 与 improve-5 的协调结论

`generation-pipeline-resilience/improve-5` 可保留：

- Doubao 模型标识修正；
- Provider 私有 ModelSpec 中的精确媒体 host 信息；
- 脱敏诊断与 no-replay 原则；
- Base64/本地写入失败时的 storage recovery 思路。

对 URL 型图片不再采用：

- Node 下载被网络阻塞后进入 `storage_blocked`；
- 用户点击“只重试保存”让 Node 再次请求同一个媒体 URL；
- 只有安全落盘后才让 job completed。

原因是本批直接移除了 URL 型图片对 Node 媒体转存的依赖。实施前应把 improve-5 标注为被本批部分取代，避免两个状态机设计同时落地。
