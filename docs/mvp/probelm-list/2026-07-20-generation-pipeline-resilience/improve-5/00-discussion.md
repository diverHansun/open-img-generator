# 0. 讨论与确认

## 0.1 本轮问题

用户确认本机代理已关闭，但路由器可能运行 Nikki 的 Mihomo 内核；同时提出：

1. 判断路由器代理是否仍会影响后端图片下载。
2. 修正不符合产品名称的模型标识。
3. 增加“只重试保存、不重做生成”的生命周期。

## 0.2 已确认事实

### 本机与路由器网络

- `scutil --proxy` 显示 HTTP、HTTPS、SOCKS 均未启用。
- `scutil --dns` 的 en0 DNS 为 `114.114.114.114`；默认网关为 `192.168.2.1`。
- Node 将以下域名解析到保留的 Fake-IP 网段 `198.18.0.0/15`：
  - `dashscope-7c2c.oss-accelerate.aliyuncs.com` → `198.18.31.85`
  - `v3b.fal.media` → `198.18.28.228`
  - `www.apple.com` → `198.18.0.58`
- 到这些地址的路由经 en0 默认网关，不经本机 utun；`curl https://www.apple.com` 仍成功。
- 本机虽存在 Clash Verge helper 进程，但系统代理关闭且没有证据表明它在本机接管 DNS 53 端口。

据此判断：路由器侧 Fake-IP DNS/透明转发极可能正在生效。它不会必然导致普通浏览器或 curl 失败，却会让后端 SSRF 预检看到保留地址并拒绝下载。这个拒绝是安全策略正常工作，不应通过全局放行 `198.18.0.0/15` 绕过。

### 真实失败

- Qwen `qwen-image-2.0-pro` 与 `wan2.7-image-pro` 已到存储阶段，错误为 `STORAGE_ERROR / proxy_mapping_not_trusted`，诊断主机均为 `dashscope-7c2c.oss-accelerate.aliyuncs.com`。
- 当前环境变量的精确主机列表已包含 Fal 与 Zhipu 媒体主机，但不包含该 Qwen OSS 主机。
- Doubao `doubao-seedream-5-0-260128` 在 Provider 接口阶段失败，诊断是 `model_or_endpoint`；它不是同一个网络保存问题。

## 0.3 产品决策

### 代理与安全

- 不建设通用代理层，不检测 Shadowsocks/Clash/Nikki 端点，也不自动修改系统或路由器配置。
- 优先复用 Node/操作系统网络栈；路由器透明代理可继续存在。
- 对“官方适配中已知的媒体主机”使用 Provider 私有精确 allowlist；用户可通过环境变量追加精确主机。
- 只对“域名解析结果全部属于 `198.18.0.0/15`”这一代理映射场景使用该例外；公网解析仍走普通 SSRF 校验，私网/回环/链路本地地址仍拒绝。
- 不从错误诊断或响应 URL 自动学习主机，不使用 `*.aliyuncs.com` 等通配符。

### 模型标识

- UI 名称 `Seedream 5.0 Lite` 必须对应 `doubao-seedream-5-0-lite-260128`。
- 当前错误标识 `doubao-seedream-5-0-260128` 从可选模型中移除；它代表非 Lite 变体，不能继续挂 Lite 标签。
- 旧 Generation/Job 记录保留原字符串，避免篡改历史；旧 preference 可删除或忽略。
- 非 Lite 5.0 只有在 Ark 当前账号和接口真实探测成功后，才能作为另一个独立 ModelSpec 上架。

### 只重试保存

- Provider 已返回可持久化结果后，任何允许恢复的保存失败不得再清空结果快照。
- 公开状态保持 `running`，内部 phase 改为 `storage_blocked`；UI 明确显示“生成已完成，等待保存”，而不是“生成中”。
- `storage_blocked` 不进入自动 due job 扫描，避免网络配置未修复时热循环。
- 用户点击“重试保存”只把该 job 原子迁回 `storing`；worker 从持久化结果快照继续，禁止 submit/poll 新任务。
- 多图任务可从尚未落盘的下一张继续；已经成功写入的图片不重复下载、不重复插入。
- 同一问题再次发生时回到 `storage_blocked`，快照继续保留。
- 用户取消 blocked job 等价于放弃尚未落盘的结果：清理快照/暂存文件并终止，不调用 Provider cancel。

## 0.4 暂不追溯恢复的边界

旧代码已经把失败 job 的 `resultSnapshot` 清空：

- 无 handle、无 snapshot 的历史任务无法安全“只重试保存”，只能明确显示不可恢复；不得偷偷重新生成。
- 仍有异步 Provider handle 的历史任务，可沿 improve-4 的只读 poll/result 恢复方案另行处理，但不能混入新 retry-storage API。
- 新生命周期只保证发布后的任务在存储受阻时可恢复。

## 0.5 开放但不阻塞实施的问题

- `storage_blocked` 快照长期占用空间的上限：本批先随 job 保留到重试、取消或删除；后续可复用 7 天策略增加“结果已过期”的终态，但不能在未设计通知与日志前静默清除。
- 用户主动收藏只能发生在本地 Image 行已建立之后；尚未保存的远程结果不能收藏，避免把临时 URL 当永久资产。
