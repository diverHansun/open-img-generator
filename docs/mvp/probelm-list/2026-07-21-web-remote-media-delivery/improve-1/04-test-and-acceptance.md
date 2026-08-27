# 4. 测试与验收

## 4.1 测试原则

- 遵守仓库 `docs/test-blueprint.md` 的 unit、contract、integration、smoke 分类与命名。
- 测试“应用可观测的事实”，不伪造普通 Web 无法观测的磁盘下载完成。
- Provider 真实测试只做最小成本生成；不把真实签名 URL、API Key、Prompt 或绝对路径写入快照/日志。
- URL 与 inline 两条生命周期都必须覆盖，避免修复 Qwen/Fal 后破坏 ZenMux/Gemini/Doubao。
- 先使用 fake provider/CDN 完成可重复自动化，再在真实 3000 端口与浏览器中验证网络栈差异。

## 4.2 单元测试

### Remote URL policy

- 接受 `https` + 当前 ModelSpec 精确媒体 host。
- 拒绝 `http`、`file`、`data`、`blob`、userinfo、fragment、控制字符、超长 URL。
- 拒绝 localhost、私网/保留 IP literal 和未声明 host。
- 不调用 DNS/HEAD/GET；用 spy 证明 validator 只做结构/host 校验。
- safe diagnostic 不包含 query、signature 或完整 URL。
- hostname 大小写、尾点、punycode、IPv6 bracket 和重定向式 query 不能绕过规则。

### Image invariant/query

- managed live、remote live 和 tombstone 三种合法行通过。
- storagePath + remoteUrl 同时存在、remote 无 URL、managed 无 path、tombstone 仍有 URL 等非法组合被拒绝。
- `expireRemoteImage` 原子清 URL，保留 favorite 和 generation。
- migration 将 v5 现有行全部转为 managed，ID/favorite/path 不变。

### Job lifecycle

- remote ref：写 remote image，job completed，`storage.downloadAndStore` 从未调用。
- inline ref：仍调用安全落盘；成功后 managed image + completed。
- mixed refs：remote 和 inline 各走正确分支，结果顺序稳定。
- 未准入 host：不重定向、不落 remote row，返回 provider contract/security safe code。
- crash recovery：remote row 已写后重试不重复插入；inline 保持现有 staging 幂等。
- no-replay：任一 image persistence retry 都不再次调用 Provider submit。

### UI/pure state

- available 始终显示有可访问名称的下载 icon，点击前后都不隐藏。
- remote expired 不渲染 `<img>`，显示正确墓碑。
- 每次未收藏→收藏触发一次 download navigation + 一次 favorite；已经收藏时的重复点击和取消收藏不触发下载。
- favorite/download 不同失败组合符合 02 的失败矩阵。

## 4.3 Contract 测试

### ImageView/GalleryItem

- `delivery` 只允许 `managed|remote`。
- `availability` 增加 `remote_expired`。
- `url`、`downloadUrl` 始终是同源 image ID route 或 null。
- 响应 JSON 永远不包含 `remoteUrl`、签名 query 或本地 storage path。

### `GET /api/images/:id`

- managed 返回正确 content type/body/cache headers。
- remote 返回 redirect，Location 正确但 response body/log 不泄漏；包含 `Referrer-Policy: no-referrer` 与 `Cache-Control: private, no-store`。
- known expired 返回 typed 410 `IMAGE_REMOTE_EXPIRED` 并持久化 tombstone。
- 临时 browser load error 不通过任何客户端 API自动写 expired。
- 跨 workspace/未知 ID 保持现有认证与 404 防枚举语义。

### `GET /api/images/:id/download`

- managed 可交付时返回 attachment stream 和安全文件名。
- remote 可交付时返回受控 302，不代理媒体字节。
- 重复 GET 始终可用且不写任何下载状态。
- expired/deleted/missing 返回 typed 410/404。
- 未授权请求被拒绝。
- 下载 anchor 带 `target="_blank"` 与 `rel="noopener noreferrer"`；浏览器选择内联展示时不替换应用页面。

### Favorite API

- remote live 可以收藏，不再要求 `storagePath IS NOT NULL`。
- remote expired favorite 仍可列出为墓碑；不能新收藏已过期图片，是否取消收藏不受影响。
- favorite 响应不含下载状态或 raw URL。

## 4.4 Integration 测试

### URL Provider 完整链路

使用 MSW/fake Provider 返回一个精确准入的 HTTPS image URL：

1. 创建 generation/job。
2. worker submit/poll 取得 remote ref。
3. job completed，images 存在 remote live row。
4. 断言 Node 没有请求媒体 URL。
5. generation/history API 返回同源 preview URL。
6. GET preview redirect 到 fake CDN。
7. GET download redirect 到 fake CDN，且不改变 DB。
8. refresh 后下载 icon 仍显示。

### Inline Provider 完整链路

- 返回有效 Base64 PNG/JPEG，验证临时文件、magic、大小、原子移动与 managed row。
- 非图片、过大、磁盘写失败仍走 storage error/no-replay；不能错误降级为 remote。
- 服务重启后本地图片仍可读取、下载和收藏。

### 收藏与保留

- remote 每次未收藏→收藏写 favorite，并由 UI 同时触发无状态 download link。
- 7 天未收藏 remote 清 URL并标记 `retention_expired`；历史保留。
- 已收藏 remote 在已知 Provider expiry 到达时标记 `remote_expired`，favorite 保留。
- managed favorite 仍阻止 7 天文件清理。
- 取消 remote favorite 不删除/修改用户浏览器副本。
- 删除 generation/image 清 remote URL，移除对应 favorite，保留现有级联语义。

### 并发与恢复

- 两个并发下载 GET 都能得到可交付响应，且不产生数据库写入。
- 收藏与 expiry 竞争：事务后只能得到合法 remote live favorite 或 remote expired favorite tombstone，不能悬空。
- 删除与下载竞争：删除获胜后不能泄漏 remote URL；已返回给浏览器的下载无法撤回，日志如实记录顺序。
- worker 重启时 resultSnapshot 含 remote/inline 混合结果，不重复 Provider submit，不重复 image index。

### 安全与日志

- canary API Key、Prompt、signed URL query、绝对路径、raw Error 不出现在 stdout/stderr/JSONL。
- 伪造 image ID 不能构造开放重定向。
- ModelSpec host 不匹配时 Location header 不出现攻击 URL。
- remote redirect 不触发服务端 DNS；managed storage 下载仍保持原 SSRF 测试。

## 4.5 Smoke 与 build

实现后至少运行：

```bash
npm run typecheck
npm run test:unit
npm run test:contract
npm run test:integration
npm run test:smoke
npm run build
```

如果总测试时间允许，补充：

```bash
npm test
```

所有命令必须使用真实仓库环境变量边界，测试凭据不能进入 snapshot、commit 或命令输出。

## 4.6 真实 Provider 准入矩阵

用户已授权使用已配置凭据进行最小成本测试。每类结果至少选择一个模型：

| 形态 | 首选 Provider/模型 | 关键验证 |
|---|---|---|
| remote URL | Qwen Image 2.0 Pro 或 Wan 2.7 Image Pro | Node 不下载 OSS；浏览器能跟随 Aliyun URL |
| remote URL | Fal FLUX/Nano Banana 任一低成本模型 | Fal URL host/expiry/重定向 |
| remote URL | Zhipu GLM Image | 复现过往“安全保存失败”环境时仍完成并预览 |
| inline/base64 | ZenMux GPT Image 或 Gemini image | 仍安全落盘、重启后可见 |
| mixed-capable | Doubao Seedream | 按真实响应形态进入正确 source |

Kling 未配置 API Key，不是 Improve 1 的真实测试门槛；其 adapter/ModelSpec 仍要通过自动化 source/host 合同。

真实结果记录只包含 provider、model、job/image ID、source kind、状态、耗时和 safe hostname；不得记录 remote URL query。

## 4.7 浏览器手工 E2E

### 环境

- 在 `mvp` 分支用真实 `npm run dev` 启动 3000 端口，不使用临时 DB/storage root。
- 先备份真实 SQLite 和 `data/images`，不得为了测试清空用户历史。
- 至少执行两组网络状态：
  1. 本机代理关闭、路由器 Nikki/Mihomo 保持用户日常配置；
  2. 本机 Shadowsocks 开启。
- 如可行再用 Chrome/Chromium 与 Safari 各验证一次跨域下载行为；记录差异而不是强行统一。

### 操作与验收

1. 选择一个 URL Provider 生成 1 张图片。
   - Provider job 显示完成，不出现“生成图片未能安全保存”。
   - DB image 为 remote，`data/images` 没有对应新文件。
2. 在生成页确认缩略图可见，点击后打开大图。
   - 列表缩略图使用 remote source 的受限展示尺寸，不在 `data/images` 生成额外 thumbnail 文件。
   - 大图不暴露 raw URL 文本。
   - 下载 icon 位于大图右下角，可用鼠标与键盘操作。
3. 点击下载 icon。
   - 浏览器接管下载或打开原图；应用提示语与真实行为一致。
   - 如果打开原图，应位于新标签，生成详情页保持不变。
   - 当前页 icon 保持显示；刷新后仍显示；可以重复点击。
4. 对另一张图片点击收藏。
   - 同一手势发起浏览器下载并完成 favorite 写入。
   - Gallery 立即显示该收藏。
   - 取消收藏不会删除 Downloads 中的文件。
   - 取消后再次收藏会再次触发下载。
5. 模拟/构造 remote expiry。
   - 历史与 Gallery 保留记录和收藏。
   - 图片区域显示“远程图片链接已过期”，不出现 broken image。
6. 使用 inline Provider 生成。
   - 图片写入 `data/images`，重启服务后仍可见。
   - 下载、收藏和 7 天/永久本地保留规则与旧行为一致。

### 网络验收重点

- URL Provider 在两组代理状态下都不发生 Node 媒体 DNS/SSRF 下载，因此不会再因 Fake-IP 判定而丢失已生成结果。
- 浏览器能否访问最终 CDN 仍受用户网络影响；如果浏览器本身也无法打开，UI 应显示远程加载失败/可重试，不把它误报为 Provider 生成失败。
- 不要求应用自动修改代理、DNS 或路由器配置。

## 4.8 验收清单

### 功能

- [ ] remote URL 图片无需 Node 转存即可使 job completed。
- [ ] inline/Base64 图片继续安全落盘。
- [ ] 缩略图点击打开大图。
- [ ] 大图右下角下载 icon 满足 a11y。
- [ ] 下载 icon 始终显示，点击后不隐藏，可重复下载。
- [ ] 每次未收藏→收藏触发一次下载；已收藏状态和取消收藏动作本身不触发下载。
- [ ] remote 过期保留历史/favorite 墓碑。
- [ ] 既有 managed 图片、收藏、下载、删除、retention 不回归。

### 语义

- [ ] UI/DTO/DB 不存在下载状态，不声称 Web 确认 requested/completed。
- [ ] 收藏说明明确区分“永久元数据”与“应用内永久图片字节”。
- [ ] 浏览器打开原图而非直接保存时有明确回退说明。

### 安全

- [ ] raw signed URL 不进入公共 JSON、日志或错误文案。
- [ ] redirect 只基于已授权 image ID 和已准入 host，不是开放重定向。
- [ ] remote 路径不做服务端 DNS/媒体 fetch；managed storage SSRF guard 未放宽。
- [ ] API Key、Prompt、绝对路径和 raw Error 脱敏测试通过。

### 工程

- [ ] schema v6 migration/backup/self-check 通过。
- [ ] 先 reader 后 writer 的发布顺序得到遵守。
- [ ] typecheck、unit、contract、integration、smoke、build 全部通过。
- [ ] 3000 端口真实 Provider 与浏览器 E2E 有 safe 结果记录。
- [ ] 权威 storage/job-engine/api/providers 文档完成同步。

## 4.9 不作为失败的已知限制

- 浏览器可能因 CDN 响应头打开远程原图，而不是自动保存。
- 用户可取消下载；应用不记录或推断结果。
- 应用不知道下载目录，也不能删除或验证浏览器副本。
- remote URL 到期后，远程收藏可能只剩元数据墓碑。

如果这些限制不可接受，Improve 1 不应伪造成功，而应转入 Electron/App 方案设计。
